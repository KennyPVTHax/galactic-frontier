import {
  Color3,
  DynamicTexture,
  Material,
  MaterialPluginBase,
  PBRMaterial,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
  Vector4,
  type AbstractMesh,
  type MaterialDefines,
} from "../engine/babylon";
import { fabricHeight, groundAtlas, hullPanels, normalFromHeight, waterHeight, type Pixels } from "./texgen";

// ------------------------------------------------------------------ textures

/** Uploads RGBA pixels into a tiling, mip-mapped DynamicTexture (canvas-backed: survives context loss). */
export function makeTexture(scene: Scene, name: string, px: Pixels, size: number, linear: boolean): DynamicTexture {
  return upload(scene, name, px, size, linear);
}

function upload(scene: Scene, name: string, px: Pixels, size: number, linear: boolean): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  img.data.set(px);
  ctx.putImageData(img, 0, 0);
  t.update(false);
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  t.gammaSpace = !linear;
  return t;
}

/**
 * All procedural surface textures, regenerated when the texture size changes.
 * Canvas-backed DynamicTextures survive WebGL context loss (Babylon re-uploads
 * them from the canvas).
 */
export class SurfaceTextures {
  size = 0;
  ground!: DynamicTexture;
  groundNormal!: DynamicTexture;
  waterNormal!: DynamicTexture;
  hullAlbedo!: DynamicTexture;
  hullOrm!: DynamicTexture;
  hullNormal!: DynamicTexture;
  fabricNormal!: DynamicTexture;
  private onChange: (() => void)[] = [];

  constructor(private readonly scene: Scene) {}

  /** Returns the estimated GPU bytes (with mips) of all textures. */
  get bytes(): number {
    const s = this.size;
    const w = this.waterSize;
    return Math.round((s * s * 4 * 2 + w * w * 4 + s * s * 4 * 3 + (s / 2) ** 2 * 4) * 1.33);
  }
  private get waterSize(): number {
    return Math.max(128, this.size / 2);
  }

  build(size: number): void {
    if (size === this.size) return;
    const old = [this.ground, this.groundNormal, this.waterNormal, this.hullAlbedo, this.hullOrm, this.hullNormal, this.fabricNormal];
    this.size = size;
    const g = groundAtlas(size);
    this.ground = upload(this.scene, "gf-ground", g.rgba, size, true);
    this.groundNormal = upload(this.scene, "gf-ground-n", normalFromHeight(g.height, size, size / 64), size, true);
    const ws = this.waterSize;
    this.waterNormal = upload(this.scene, "gf-water-n", normalFromHeight(waterHeight(ws), ws, ws / 48), ws, true);
    const h = hullPanels(size);
    this.hullAlbedo = upload(this.scene, "gf-hull-a", h.albedo, size, false);
    this.hullOrm = upload(this.scene, "gf-hull-orm", h.orm, size, true);
    this.hullNormal = upload(this.scene, "gf-hull-n", normalFromHeight(h.height, size, size / 96), size, true);
    const fs = Math.max(128, size / 2);
    this.fabricNormal = upload(this.scene, "gf-fabric-n", normalFromHeight(fabricHeight(fs), fs, fs / 80), fs, true);
    for (const f of this.onChange) f();
    for (const t of old) t?.dispose();
  }

  changed(f: () => void): void {
    this.onChange.push(f);
  }
}

// ------------------------------------------------------------------ world shader plugin

export interface WorldPluginOptions {
  terrain?: boolean;
  triplanar?: boolean;
  /** 0..1: force the rock (steep) layer, for boulders. */
  rock?: number;
  /** Sway amplitude for vegetation (0 = static). */
  wind?: number;
  atmosphere?: boolean;
  /** Treat vertex colours as sRGB in PBR (keeps M1 palette). */
  linearVertexColor?: boolean;
  /** Terrain only: view-dependent snow/ice glints, 0..1 (Kryos). 0/absent = M2 shader. */
  sparkle?: number;
}

/** Shared per-frame values for every world plugin. */
export const WorldUniforms = {
  tiling: new Vector4(0.16, 0.012, 0.09, 0.55),
  /** x: steep start (1-ny), y: steep end, z: (rock mode, per material), w: detail fade per metre */
  params: new Vector4(0.12, 0.32, 0, 1 / 140),
  /** x: density, y: height falloff, z: base height, w: strength */
  atmos: new Vector4(0.0016, 0.012, -5, 1),
  sunDir: new Vector4(-0.62, 0.4, -0.67, 0),
  haze: new Color3(0.64, 0.38, 0.45),
  sunColor: new Color3(1.0, 0.82, 0.62),
  /** x,z: wind direction, z: strength, w: time */
  wind: new Vector4(0.8, 0.6, 1, 0),
};

const FRAG_DEFS = `
#ifdef GF_WORLD
#ifdef GF_TERRAIN
uniform sampler2D gfGroundTex;
uniform sampler2D gfGroundNrm;
vec3 gfApply(vec3 base, vec3 pos, inout vec3 n) {
  float dist = length(pos - vEyePosition.xyz);
  float fade = clamp(1.0 - dist * gfParams.w, 0.0, 1.0);
  float steep = max(smoothstep(gfParams.x, gfParams.y, 1.0 - n.y), gfRock.x);
  vec2 uvT = pos.xz * gfTiling.x;
  vec4 t1 = texture2D(gfGroundTex, uvT);
  vec4 t2 = texture2D(gfGroundTex, pos.xz * gfTiling.y + vec2(0.37, 0.71));
  float soil = mix(0.5, t1.r * 0.65 + t2.r * 0.35, fade);
#ifdef GF_TRIPLANAR
  vec3 an = abs(n);
  float wx = an.x / max(an.x + an.z, 1e-4);
  vec2 uvX = pos.zy * gfTiling.z;
  vec2 uvZ = pos.xy * gfTiling.z;
  float rock = mix(texture2D(gfGroundTex, uvZ).b, texture2D(gfGroundTex, uvX).b, wx);
#else
  float rock = texture2D(gfGroundTex, uvT * 0.6).b;
#endif
  rock = mix(0.5, rock, max(fade, 0.35));
  float lum = mix(0.76 + soil * 0.5, 0.56 + rock * 0.78, steep);
  vec3 col = base * lum;
  float mossy = clamp((base.g - base.r) * 4.0 + 0.4, 0.0, 1.0);
  float lichen = t2.g * (1.0 - steep) * mossy;
  col = mix(col, col * vec3(0.78, 1.16, 1.08), lichen * 0.7);
  col *= mix(1.0, 0.72 + 0.28 * t1.a, (1.0 - steep) * fade);
  vec3 nt = texture2D(gfGroundNrm, uvT).xyz * 2.0 - 1.0;
  vec3 pert = vec3(nt.x, 0.0, nt.y) * (1.0 - steep);
#ifdef GF_TRIPLANAR
  vec3 nx = texture2D(gfGroundNrm, uvX).xyz * 2.0 - 1.0;
  vec3 nz = texture2D(gfGroundNrm, uvZ).xyz * 2.0 - 1.0;
  pert += (vec3(0.0, nx.y, nx.x) * wx + vec3(nz.x, nz.y, 0.0) * (1.0 - wx)) * steep;
#endif
  n = normalize(n + pert * gfTiling.w * max(fade, 0.25));
#ifdef GF_SPARKLE
  {
    vec3 gfSp = floor(pos * 7.0);
    float gfH1 = fract(sin(dot(gfSp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 gfVd = normalize(vEyePosition.xyz - pos);
    float gfTw = fract(gfH1 * 31.7 + dot(gfVd, vec3(5.3, 3.1, 4.7)));
    float gfG = step(0.955, gfH1) * smoothstep(0.78, 1.0, gfTw) * (1.0 - steep) * clamp(1.0 - dist / 70.0, 0.0, 1.0);
    col += vec3(gfG * gfRock.z * 1.8);
  }
#endif
  return col;
}
#endif
#endif
`;

const FRAG_ALBEDO_PBR = `
#ifdef GF_WORLD
#if defined(GF_LINEARVC) && defined(VERTEXCOLOR)
  surfaceAlbedo *= pow(max(vColor.rgb, vec3(1e-4)), vec3(1.2));
#endif
#ifdef GF_TERRAIN
  surfaceAlbedo = gfApply(surfaceAlbedo, vPositionW, normalW);
#endif
#endif
`;

const FRAG_ALBEDO_STD = `
#ifdef GF_WORLD
#ifdef GF_TERRAIN
  baseColor.rgb = gfApply(baseColor.rgb, vPositionW, normalW);
#endif
#endif
`;

const atmosCode = (v: string) => `
#ifdef GF_ATMOS
  vec3 gfV = vPositionW - vEyePosition.xyz;
  float gfD = length(gfV);
  vec3 gfDirV = gfV / max(gfD, 1e-3);
  float gfH = mix(vEyePosition.y, vPositionW.y, 0.6) - gfAtmos.z;
  float gfDens = gfAtmos.x * exp(-max(gfH, 0.0) * gfAtmos.y);
  float gfF = 1.0 - exp(-gfD * gfDens);
  float gfSunAmt = pow(max(dot(gfDirV, gfSunDir.xyz), 0.0), 6.0);
  vec3 gfIn = mix(gfHaze.rgb, gfSunCol.rgb, gfSunAmt * 0.65);
  ${v}.rgb = mix(${v}.rgb, gfIn, clamp(gfF * gfAtmos.w, 0.0, 1.0));
#endif
`;

const VERT_WIND = `
#ifdef GF_WIND
  float gfHgt = max(positionUpdated.y, 0.0);
  float gfPh = gfWind.w * 1.7 + worldPos.x * 0.21 + worldPos.z * 0.17;
  float gfS = (sin(gfPh) * 0.55 + sin(gfPh * 2.3 + 1.7) * 0.25 + 0.5) * gfWind.z * gfHgt * gfHgt * gfRock.y;
  worldPos.xz += vec2(gfWind.x, gfWind.y) * gfS;
#endif
`;

export class WorldPlugin extends MaterialPluginBase {
  opts: WorldPluginOptions;
  private atmosOn: boolean;
  private triOn: boolean;
  private readonly rockVec = new Vector4();
  private readonly tmpHaze = new Color3();
  private readonly tmpSun = new Color3();

  constructor(
    material: Material,
    opts: WorldPluginOptions,
    private readonly textures: SurfaceTextures,
  ) {
    super(material, "GFWorld", 200, { GF_WORLD: false, GF_TERRAIN: false, GF_TRIPLANAR: false, GF_ATMOS: false, GF_WIND: false, GF_LINEARVC: false, GF_SPARKLE: false });
    this.opts = { ...opts };
    this.atmosOn = !!opts.atmosphere;
    this.triOn = !!opts.triplanar;
    this._enable(true);
  }

  /**
   * Babylon collects injection point names from getCustomCode() inside the base
   * constructor, so this must work before subclass fields are initialised.
   */
  private get isPbr(): boolean {
    return (this as unknown as { _material: Material })._material instanceof PBRMaterial;
  }

  setQuality(triplanar: boolean, atmosphere: boolean): void {
    const t = !!this.opts.terrain && triplanar;
    const a = !!this.opts.atmosphere && atmosphere;
    if (t !== this.triOn || a !== this.atmosOn) {
      this.triOn = t;
      this.atmosOn = a;
      this.markAllDefinesAsDirty();
    }
  }

  override getClassName(): string {
    return "GFWorldPlugin";
  }

  override prepareDefines(defines: MaterialDefines): void {
    const d = defines as unknown as Record<string, boolean>;
    d.GF_WORLD = true;
    d.GF_TERRAIN = !!this.opts.terrain;
    d.GF_TRIPLANAR = this.triOn;
    d.GF_ATMOS = this.atmosOn;
    d.GF_WIND = (this.opts.wind ?? 0) > 0;
    d.GF_LINEARVC = this.isPbr && !!this.opts.linearVertexColor;
    d.GF_SPARKLE = !!this.opts.terrain && (this.opts.sparkle ?? 0) > 0;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("gfGroundTex", "gfGroundNrm");
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "gfTiling", size: 4, type: "vec4" },
        { name: "gfParams", size: 4, type: "vec4" },
        { name: "gfRock", size: 4, type: "vec4" },
        { name: "gfAtmos", size: 4, type: "vec4" },
        { name: "gfSunDir", size: 4, type: "vec4" },
        { name: "gfHaze", size: 3, type: "vec3" },
        { name: "gfSunCol", size: 3, type: "vec3" },
        { name: "gfWind", size: 4, type: "vec4" },
      ],
      vertex: `#ifdef GF_WORLD
uniform vec4 gfWind;
uniform vec4 gfRock;
#endif`,
      fragment: `#ifdef GF_WORLD
uniform vec4 gfTiling;
uniform vec4 gfParams;
uniform vec4 gfRock;
uniform vec4 gfAtmos;
uniform vec4 gfSunDir;
uniform vec3 gfHaze;
uniform vec3 gfSunCol;
#endif`,
    };
  }

  override bindForSubMesh(ubo: { updateVector4(n: string, v: Vector4): void; updateColor3(n: string, c: Color3): void; setTexture(n: string, t: unknown): void }): void {
    const U = WorldUniforms;
    ubo.updateVector4("gfTiling", U.tiling);
    ubo.updateVector4("gfParams", U.params);
    this.rockVec.set(this.opts.rock ?? 0, this.opts.wind ?? 0, this.opts.sparkle ?? 0, 0);
    ubo.updateVector4("gfRock", this.rockVec);
    ubo.updateVector4("gfAtmos", U.atmos);
    ubo.updateVector4("gfSunDir", U.sunDir);
    if (this.isPbr) {
      U.haze.toLinearSpaceToRef(this.tmpHaze);
      U.sunColor.toLinearSpaceToRef(this.tmpSun);
    } else {
      this.tmpHaze.copyFrom(U.haze);
      this.tmpSun.copyFrom(U.sunColor);
    }
    ubo.updateColor3("gfHaze", this.tmpHaze);
    ubo.updateColor3("gfSunCol", this.tmpSun);
    ubo.updateVector4("gfWind", U.wind);
    if (this.opts.terrain) {
      ubo.setTexture("gfGroundTex", this.textures.ground);
      ubo.setTexture("gfGroundNrm", this.textures.groundNormal);
    }
  }

  override getCustomCode(shaderType: string): { [point: string]: string } | null {
    if (shaderType === "vertex") return { CUSTOM_VERTEX_UPDATE_WORLDPOS: VERT_WIND };
    if (shaderType === "fragment") {
      // Always declare every point; the unused one for this material type is empty.
      const pbr = this.isPbr;
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: FRAG_DEFS,
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: pbr ? FRAG_ALBEDO_PBR : "",
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: pbr ? "" : FRAG_ALBEDO_STD,
        CUSTOM_FRAGMENT_BEFORE_FOG: atmosCode(pbr ? "finalColor" : "color"),
      };
    }
    return null;
  }
}

// ------------------------------------------------------------------ material library

export interface Look {
  albedo: Color3;
  roughness: number;
  metallic?: number;
  emissive?: Color3;
  alpha?: number;
  vertexColors?: boolean;
  backFaceCulling?: boolean;
  /** Texture set (procedural). */
  maps?: "hull" | "fabric" | "water";
  mapScale?: number;
  /** PBR image-based-light multiplier (default 0.9). Raised for the ship, which is mostly seen from its unlit back. */
  envIntensity?: number;
  /**
   * Caller-owned emissive map (e.g. a planet's lava texture). The library never
   * disposes it. Standard: added on top of `emissive`; PBR: multiplied by `emissiveMapLevel`.
   */
  emissiveMap?: Texture;
  emissiveMapLevel?: number;
  world?: WorldPluginOptions;
}

export class GfMaterial {
  std: StandardMaterial | null = null;
  pbr: PBRMaterial | null = null;
  constructor(
    readonly name: string,
    readonly look: Look,
  ) {}
}

/**
 * Keeps a StandardMaterial (Telegram Basic) and a PBRMaterial (Enhanced /
 * Ultra) for each look and swaps every bound mesh live when the tier changes.
 */
export class MaterialLibrary {
  pbr = false;
  triplanar = false;
  atmosphere = false;
  readonly all: GfMaterial[] = [];
  private bindings = new Map<GfMaterial, Set<AbstractMesh>>();
  /** Texture views created by `view()` (they borrow another texture's GPU texture). */
  private readonly views = new WeakSet<Texture>();

  constructor(
    private readonly scene: Scene,
    readonly textures: SurfaceTextures,
  ) {
    textures.changed(() => {
      for (const m of this.all) this.applyMaps(m);
    });
  }

  make(name: string, look: Look): GfMaterial {
    const m = new GfMaterial(name, look);
    this.all.push(m);
    return m;
  }

  /** Assigns the material for the current tier and remembers the binding. */
  bind(mesh: AbstractMesh, m: GfMaterial): void {
    let set = this.bindings.get(m);
    if (!set) this.bindings.set(m, (set = new Set()));
    set.add(mesh);
    mesh.material = this.current(m);
  }

  /**
   * Frees a material made with `make()`: disposes its Standard/PBR instances and
   * their texture views (never the shared SurfaceTextures or caller-owned maps)
   * and forgets its bindings. Used by planets on warp so repeated planet
   * transitions do not accumulate materials. Meshes still using it keep a
   * disposed material, so dispose or rebind them first.
   */
  release(m: GfMaterial): void {
    const i = this.all.indexOf(m);
    if (i >= 0) this.all.splice(i, 1);
    this.bindings.delete(m);
    for (const mat of [m.std, m.pbr]) {
      if (!mat) continue;
      for (const t of mat.getActiveTextures()) if (this.views.has(t as Texture)) this.disposeView(t as Texture);
      mat.dispose(true, false);
    }
    m.std = null;
    m.pbr = null;
  }

  /** True when `t` is a library texture view (borrowed GPU texture). */
  isView(t: unknown): boolean {
    return this.views.has(t as Texture);
  }

  /** Disposes a texture view without releasing the GPU texture it borrows. */
  disposeView(t: Texture): void {
    this.views.delete(t);
    (t as unknown as { _texture: unknown })._texture = null;
    t.dispose();
  }

  current(m: GfMaterial): Material {
    if (this.pbr) return (m.pbr ??= this.createPbr(m));
    return (m.std ??= this.createStd(m));
  }

  setMode(pbr: boolean, triplanar: boolean, atmosphere: boolean): void {
    this.pbr = pbr;
    this.triplanar = triplanar;
    this.atmosphere = atmosphere;
    for (const m of this.all) {
      const mat = this.current(m);
      for (const mesh of this.bindings.get(m) ?? []) mesh.material = mat;
      for (const x of [m.std, m.pbr]) (x?.pluginManager?.getPlugin("GFWorld") as WorldPlugin | null)?.setQuality(triplanar, atmosphere);
    }
  }

  private createStd(m: GfMaterial): StandardMaterial {
    const L = m.look;
    const s = new StandardMaterial(`${m.name}-std`, this.scene);
    s.diffuseColor = L.albedo.clone();
    const metal = L.metallic ?? 0;
    const spec = (1 - L.roughness) * (0.35 + metal * 0.5);
    s.specularColor = Color3.Lerp(new Color3(1, 1, 1), L.albedo, metal).scale(spec);
    s.specularPower = Math.max(8, Math.min(256, 2 / Math.max(0.02, L.roughness ** 4) - 2));
    if (L.emissive) s.emissiveColor = L.emissive.clone();
    if (L.alpha !== undefined) s.alpha = L.alpha;
    if (L.backFaceCulling === false) s.backFaceCulling = false;
    if (L.emissiveMap) s.emissiveTexture = L.emissiveMap;
    if (L.world) new WorldPlugin(s, L.world, this.textures).setQuality(this.triplanar, this.atmosphere);
    this.applyMaps(m, s);
    return s;
  }

  private createPbr(m: GfMaterial): PBRMaterial {
    const L = m.look;
    const p = new PBRMaterial(`${m.name}-pbr`, this.scene);
    p.albedoColor = L.albedo.toLinearSpace();
    p.metallic = L.metallic ?? 0;
    p.roughness = L.roughness;
    if (L.emissive) p.emissiveColor = L.emissive.toLinearSpace().scale(1.6);
    if (L.alpha !== undefined) p.alpha = L.alpha;
    if (L.backFaceCulling === false) p.backFaceCulling = false;
    if (L.emissiveMap) {
      p.emissiveTexture = L.emissiveMap;
      p.emissiveColor = new Color3(1, 1, 1).scale(L.emissiveMapLevel ?? 1.6);
    }
    p.environmentIntensity = L.envIntensity ?? 0.9;
    p.directIntensity = 1;
    if (L.world) new WorldPlugin(p, { linearVertexColor: !!L.vertexColors, ...L.world }, this.textures).setQuality(this.triplanar, this.atmosphere);
    this.applyMaps(m, undefined, p);
    return p;
  }

  /** A Texture that shares the GPU texture of `src` but has its own tiling. */
  private view(src: Texture, scale: number, level = 1): Texture {
    const t = new Texture(null, this.scene, false, false);
    (t as unknown as { _texture: unknown })._texture = src.getInternalTexture();
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.uScale = t.vScale = scale;
    t.gammaSpace = src.gammaSpace;
    t.anisotropicFilteringLevel = 8;
    t.level = level;
    this.views.add(t);
    return t;
  }

  /** Assigns a texture slot, disposing the view it replaces (texture-size changes). */
  private setSlot<T extends object>(mat: T, key: keyof T, t: Texture): void {
    const old = mat[key] as unknown;
    if (old && old !== t && this.views.has(old as Texture)) this.disposeView(old as Texture);
    (mat as Record<keyof T, unknown>)[key] = t;
  }

  private applyMaps(m: GfMaterial, std = m.std ?? undefined, pbr = m.pbr ?? undefined): void {
    const L = m.look;
    if (!L.maps) return;
    const T = this.textures;
    const sc = L.mapScale ?? 1;
    if (L.maps === "hull") {
      if (std) {
        this.setSlot(std, "diffuseTexture", this.view(T.hullAlbedo, sc));
        this.setSlot(std, "bumpTexture", this.view(T.hullNormal, sc, 0.6));
      }
      if (pbr) {
        this.setSlot(pbr, "albedoTexture", this.view(T.hullAlbedo, sc));
        this.setSlot(pbr, "metallicTexture", this.view(T.hullOrm, sc));
        pbr.useRoughnessFromMetallicTextureGreen = true;
        pbr.useMetallnessFromMetallicTextureBlue = true;
        pbr.useAmbientOcclusionFromMetallicTextureRed = true;
        pbr.metallic = L.metallic ?? 0.6;
        pbr.roughness = 1;
        this.setSlot(pbr, "bumpTexture", this.view(T.hullNormal, sc, 0.7));
      }
    } else if (L.maps === "fabric") {
      if (std) this.setSlot(std, "bumpTexture", this.view(T.fabricNormal, sc, 0.25));
      if (pbr) this.setSlot(pbr, "bumpTexture", this.view(T.fabricNormal, sc, 0.3));
    } else if (L.maps === "water") {
      // Basic keeps M1's flat water: under Standard lighting the 256 px wave normals read as dark blotches.
      if (pbr) this.setSlot(pbr, "bumpTexture", this.view(T.waterNormal, sc, 0.45));
    }
  }

  /** Per-frame uniform updates (wind time, sun). */
  update(dt: number): void {
    WorldUniforms.wind.w += dt;
  }

  /** Estimated material count actually compiled (for profiling). */
  get compiled(): number {
    return this.all.reduce((n, m) => n + (m.std ? 1 : 0) + (m.pbr ? 1 : 0), 0);
  }
}

export function sunVector(v: Vector3): void {
  WorldUniforms.sunDir.set(v.x, v.y, v.z, 0);
}
