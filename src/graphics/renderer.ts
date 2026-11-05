import {
  CascadedShadowGenerator,
  Color3,
  ColorCurves,
  DefaultRenderingPipeline,
  Engine,
  EngineInstrumentation,
  ImageProcessingConfiguration,
  ReflectionProbe,
  RenderTargetTexture,
  Scene,
  SceneInstrumentation,
  ShadowGenerator,
  SphericalHarmonics,
  SphericalPolynomial,
  Vector3,
  type AbstractMesh,
  type Camera,
  type DirectionalLight,
  type HemisphericLight,
  type Mesh,
} from "../engine/babylon";
import { QualityGovernor, type GovernorAction, type ReductionStep } from "./governor";
import type { GpuCapabilities, RenderProfile } from "./profiles";
import type { MaterialLibrary } from "./materials";
import { WorldUniforms } from "./materials";

export interface SkyRadiance {
  zenith: Color3;
  horizon: Color3;
  ground: Color3;
  sun: Color3;
  sunDir: Vector3;
}

/** CPU approximation of the sky dome for image-based ambient light (linear RGB). */
export function skyIrradiance(sky: SkyRadiance, samples = 768): SphericalPolynomial {
  const sh = new SphericalHarmonics();
  const golden = Math.PI * (3 - Math.sqrt(5));
  const lin = (c: Color3) => c.toLinearSpace();
  const z = lin(sky.zenith), h = lin(sky.horizon), g = lin(sky.ground), s = lin(sky.sun);
  const dir = new Vector3();
  for (let i = 0; i < samples; i++) {
    const y = 1 - (i / (samples - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    dir.set(Math.cos(th) * r, y, Math.sin(th) * r);
    const up = Math.max(0, y);
    const c = Color3.Lerp(h, z, Math.pow(up, 0.5));
    if (y < 0) Color3.LerpToRef(c, g, Math.min(1, -y * 4), c);
    const sd = Math.max(0, Vector3.Dot(dir, sky.sunDir));
    c.addInPlace(s.scale(Math.pow(sd, 6) * 0.35 + Math.pow(sd, 60) * 0.6));
    sh.addLight(dir.clone(), c, (4 * Math.PI) / samples);
  }
  sh.convertIncidentRadianceToIrradiance();
  sh.convertIrradianceToLambertianRadiance();
  return SphericalPolynomial.FromHarmonics(sh);
}

export interface RendererDeps {
  engine: Engine;
  scene: Scene;
  camera: Camera;
  sun: DirectionalLight;
  ambient: HemisphericLight;
  skyMesh: Mesh;
  sky: SkyRadiance;
  materials: MaterialLibrary;
  caps: GpuCapabilities;
}

export interface ProfileHooks {
  /** Called with the decor fraction to draw (0..1). */
  setDecorDensity(decor: number, grass: number, distance: number): void;
  setPropLod(high: number, cull: number, terrainLod: number): void;
  setParticleBudget(b: RenderProfile["particles"]): void;
  setSky(clouds: boolean): void;
  setWater(reflections: boolean, waves: boolean): void;
  shadowCasters(): { dynamic: AbstractMesh[]; props: AbstractMesh[] };
  shadowReceivers(): AbstractMesh[];
}

export class Renderer {
  profile!: RenderProfile;
  readonly governor: QualityGovernor;
  private pipeline: DefaultRenderingPipeline | null = null;
  private shadow: ShadowGenerator | null = null;
  private csm: CascadedShadowGenerator | null = null;
  private probe: ReflectionProbe | null = null;
  private envPoly: SphericalPolynomial | null = null;
  private readonly sceneInst: SceneInstrumentation;
  private readonly engineInst: EngineInstrumentation;
  private particleScale = 1;
  private decorScale = 1;
  private shadowStep = 0;
  private bloomOff = false;
  resolutionScale = 1;

  constructor(
    private readonly d: RendererDeps,
    private readonly hooks: ProfileHooks,
  ) {
    this.governor = new QualityGovernor({ maxScale: 1, minScale: 0.6, targetFps: 30 });
    this.sceneInst = new SceneInstrumentation(d.scene);
    this.sceneInst.captureFrameTime = true;
    this.sceneInst.captureRenderTime = true;
    this.engineInst = new EngineInstrumentation(d.engine);
    try {
      this.engineInst.captureGPUFrameTime = true;
    } catch {
      /* EXT_disjoint_timer_query unavailable */
    }
    d.engine.onContextRestoredObservable.add(() => this.probe?.cubeTexture.resetRefreshCounter());
  }

  /** Applies a profile to the live scene. Safe to call repeatedly. */
  apply(profile: RenderProfile): void {
    const prev = this.profile;
    this.profile = profile;
    this.particleScale = 1;
    this.decorScale = 1;
    this.shadowStep = 0;
    this.bloomOff = false;
    const { scene, materials } = this.d;

    materials.textures.build(profile.textureSize);
    materials.setMode(profile.pbr, profile.terrainDetail >= 2, profile.atmosphere);

    // Lighting & fog balance per shading model.
    this.d.ambient.intensity = profile.pbr ? 0.32 : 0.62;
    this.d.sun.intensity = profile.pbr ? 2.6 : 1.75;
    scene.fogMode = profile.atmosphere ? Scene.FOGMODE_NONE : Scene.FOGMODE_EXP2;
    scene.fogDensity = profile.fogDensity;
    WorldUniforms.atmos.x = profile.fogDensity * 1.05;
    WorldUniforms.params.w = profile.terrainDetail === 0 ? 1 / 90 : 1 / 160;

    this.setupEnvironment(profile);
    this.setupShadows(profile);
    this.setupPost(profile);

    this.hooks.setDecorDensity(profile.decorDensity, profile.grassDensity, profile.decorDistance);
    this.hooks.setPropLod(profile.propLod.high, profile.propLod.cull, profile.terrainLodDistance);
    this.hooks.setParticleBudget(profile.particles);
    this.hooks.setSky(profile.sky.clouds);
    this.hooks.setWater(profile.water.reflections, profile.water.waves);

    if (!prev || prev.tier !== profile.tier || prev.renderScale !== profile.renderScale) {
      this.governor.reset({ maxScale: profile.renderScale, minScale: profile.minRenderScale, targetFps: profile.targetFps, enabled: this.governor.enabled });
    }
    this.applyResolution();
  }

  applyResolution(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.profile.maxDevicePixelRatio);
    this.d.engine.setHardwareScalingLevel(1 / Math.max(0.25, dpr * this.governor.scale));
  }

  private setupEnvironment(p: RenderProfile): void {
    const { scene } = this.d;
    if (p.envProbeSize === 0 || !p.pbr) {
      this.probe?.dispose();
      this.probe = null;
      scene.environmentTexture = null;
      return;
    }
    if (!this.probe || this.probe.cubeTexture.getSize().width !== p.envProbeSize) {
      this.probe?.dispose();
      const probe = new ReflectionProbe("gf-env", p.envProbeSize, scene, true, false);
      probe.renderList!.push(this.d.skyMesh);
      probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      probe.position.set(0, 50, 0);
      this.probe = probe;
    }
    this.envPoly ??= skyIrradiance(this.d.sky);
    try {
      (this.probe.cubeTexture as unknown as { sphericalPolynomial: SphericalPolynomial }).sphericalPolynomial = this.envPoly;
    } catch {
      /* irradiance falls back to hemispheric light */
    }
    scene.environmentTexture = this.probe.cubeTexture;
  }

  private setupShadows(p: RenderProfile): void {
    const want = this.shadowStep >= 2 ? "none" : this.shadowStep === 1 && p.shadows === "cascaded" ? "single" : p.shadows;
    const sun = this.d.sun;
    const current = this.csm ? "cascaded" : this.shadow ? "single" : "none";
    if (current === want && (this.csm ?? this.shadow)?.getShadowMap()?.getSize().width === p.shadowMapSize) return;
    this.csm?.dispose();
    this.shadow?.dispose();
    this.csm = null;
    this.shadow = null;
    const receivers = this.hooks.shadowReceivers();
    for (const r of receivers) r.receiveShadows = want !== "none";
    if (want === "none") return;
    const { dynamic, props } = this.hooks.shadowCasters();
    if (want === "cascaded") {
      const csm = new CascadedShadowGenerator(p.shadowMapSize, sun);
      csm.numCascades = 3;
      csm.lambda = 0.82;
      csm.shadowMaxZ = 320;
      csm.stabilizeCascades = true;
      csm.cascadeBlendPercentage = 0.12;
      csm.autoCalcDepthBounds = false;
      csm.usePercentageCloserFiltering = true;
      csm.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      csm.darkness = 0.22;
      csm.bias = 0.002;
      csm.normalBias = 0.03;
      sun.autoUpdateExtends = true;
      sun.shadowFrustumSize = 0;
      for (const m of [...dynamic, ...props]) csm.addShadowCaster(m, false);
      this.csm = csm;
    } else {
      const sg = new ShadowGenerator(p.shadowMapSize, sun);
      sg.usePercentageCloserFiltering = this.d.caps.webgl2;
      if (!this.d.caps.webgl2) sg.usePoissonSampling = true;
      sg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      sg.bias = 0.0008;
      sg.normalBias = 0.02;
      sg.darkness = 0.3;
      sun.autoUpdateExtends = false;
      sun.shadowFrustumSize = 70;
      sun.shadowMinZ = 1;
      sun.shadowMaxZ = 300;
      for (const m of [...dynamic, ...(p.propShadowDistance > 0 ? props : [])]) sg.addShadowCaster(m, false);
      this.shadow = sg;
    }
  }

  /** Keeps a fixed-frustum shadow map centred on what the player looks at. */
  updateShadowFocus(focus: Vector3): void {
    if (!this.shadow) return;
    const dir = this.d.sun.direction;
    this.d.sun.position.set(focus.x - dir.x * 140, focus.y - dir.y * 140, focus.z - dir.z * 140);
  }

  private setupPost(p: RenderProfile): void {
    const { scene } = this.d;
    if (!p.post.enabled) {
      this.pipeline?.dispose();
      this.pipeline = null;
      const ip = scene.imageProcessingConfiguration;
      ip.applyByPostProcess = false;
      ip.toneMappingEnabled = false;
      ip.exposure = 1;
      ip.contrast = 1;
      ip.vignetteEnabled = false;
      ip.colorCurvesEnabled = false;
      return;
    }
    if (!this.pipeline) {
      // HDR targets double post-process memory; phones use 8-bit targets.
      this.pipeline = new DefaultRenderingPipeline("gf-post", !this.d.caps.isMobile, scene, [this.d.camera]);
    }
    const pl = this.pipeline;
    pl.samples = this.d.caps.webgl2 ? p.post.msaa : 1;
    pl.fxaaEnabled = p.post.fxaa;
    pl.bloomEnabled = p.post.bloom && !this.bloomOff;
    pl.bloomThreshold = 0.82;
    pl.bloomWeight = 0.32;
    pl.bloomKernel = 48;
    pl.bloomScale = p.post.bloomScale;
    pl.sharpenEnabled = p.post.sharpen;
    if (pl.sharpenEnabled) {
      pl.sharpen.edgeAmount = 0.22;
      pl.sharpen.colorAmount = 1;
    }
    pl.imageProcessingEnabled = true;
    const ip = pl.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.16;
    ip.contrast = 1.22;
    ip.vignetteEnabled = p.post.vignette;
    ip.vignetteWeight = 1.6;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor.set(0.06, 0.02, 0.1, 0);
    ip.colorCurvesEnabled = true;
    const cc = new ColorCurves();
    // Cool shadows, warm highlights; keeps Veyra-7's magenta/teal identity.
    cc.shadowsHue = 230;
    cc.shadowsDensity = 18;
    cc.shadowsSaturation = 10;
    cc.highlightsHue = 28;
    cc.highlightsDensity = 14;
    cc.globalSaturation = 28;
    ip.colorCurves = cc;
  }

  // ------------------------------------------------------------------ runtime

  /** Runs the governor; returns user-facing notes for reductions. */
  tick(dt: number): string[] {
    const fps = this.d.engine.getFps();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const actions = this.governor.update(dt, fps, mem ? mem.usedJSHeapSize / mem.jsHeapSizeLimit : undefined);
    const notes: string[] = [];
    for (const a of actions) {
      if (a.type === "scale") this.applyResolution();
      else notes.push(this.reduce(a));
    }
    return notes;
  }

  private reduce(a: Extract<GovernorAction, { type: "reduce" }>): string {
    const step: ReductionStep = a.step;
    const p = this.profile;
    switch (step) {
      case "bloom":
        this.bloomOff = true;
        if (this.pipeline) this.pipeline.bloomEnabled = false;
        return "Bloom off to keep the frame rate steady";
      case "particles":
        this.particleScale = 0.5;
        this.hooks.setParticleBudget(scaleParticles(p.particles, 0.5));
        return "Particle effects reduced";
      case "shadows":
        this.shadowStep = p.shadows === "cascaded" ? 1 : 2;
        this.setupShadows(p);
        return p.shadows === "cascaded" ? "Shadow detail reduced" : "Shadows off";
      case "decor":
        this.decorScale = 0.5;
        this.hooks.setDecorDensity(p.decorDensity * 0.5, p.grassDensity * 0.5, p.decorDistance * 0.75);
        return "Vegetation density reduced";
      case "textures":
        this.d.materials.textures.build(Math.max(256, p.textureSize / 2) as 256 | 512);
        return "Texture resolution reduced (memory)";
    }
  }

  stats() {
    const e = this.d.engine;
    const s = this.d.scene;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    // Unique GPU textures (shared texture views counted once), incl. render targets.
    let texBytes = 0;
    for (const it of e.getLoadedTexturesCache() as unknown as Array<{ width: number; height: number; depth?: number; is2DArray?: boolean; is3D?: boolean; isCube: boolean; type: number; generateMipMaps: boolean; samples?: number }>) {
      const layers = (it.is2DArray || it.is3D ? Math.max(1, it.depth ?? 1) : 1) * (it.isCube ? 6 : 1);
      const fmt = (it as unknown as { format: number }).format;
      const channels = fmt === 6 ? 1 : fmt === 7 ? 2 : fmt >= 13 && fmt <= 20 ? 0 : 4;
      const bpc = it.type === 1 ? 4 : it.type === 2 ? 2 : 1;
      const bpp = channels === 0 ? 4 : channels * bpc;
      texBytes += it.width * it.height * layers * bpp * (it.generateMipMaps ? 1.33 : 1) * Math.max(1, it.samples ?? 1);
    }
    let gpu: { count: number; lastSecAverage: number } | null = null;
    try {
      gpu = this.engineInst.gpuFrameTimeCounter;
    } catch {
      gpu = null;
    }
    return {
      tier: this.profile.tier,
      fps: +e.getFps().toFixed(1),
      cpuFrameMs: +this.sceneInst.frameTimeCounter.lastSecAverage.toFixed(2),
      renderMs: +this.sceneInst.renderTimeCounter.lastSecAverage.toFixed(2),
      gpuFrameMs: gpu && gpu.count > 0 ? +(gpu.lastSecAverage * 1e-6).toFixed(2) : null,
      drawCalls: this.sceneInst.drawCallsCounter.current,
      activeMeshes: s.getActiveMeshes().length,
      triangles: Math.round(s.getActiveIndices() / 3),
      renderScale: this.governor.scale,
      renderPixels: e.getRenderWidth() * e.getRenderHeight(),
      textureMB: +(texBytes / 1048576).toFixed(1),
      jsHeapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
      reductions: [...this.governor.reductions],
      shadows: this.csm ? "cascaded" : this.shadow ? "single" : "none",
      post: !!this.pipeline,
    };
  }

  dispose(): void {
    this.pipeline?.dispose();
    this.shadow?.dispose();
    this.csm?.dispose();
    this.probe?.dispose();
    this.sceneInst.dispose();
    this.engineInst.dispose();
  }
}

export function scaleParticles(b: RenderProfile["particles"], k: number): RenderProfile["particles"] {
  return { dust: Math.round(b.dust * k), gusts: Math.round(b.gusts * k), sparks: Math.round(b.sparks * k), debris: Math.round(b.debris * k), exhaust: Math.round(b.exhaust * k) };
}
