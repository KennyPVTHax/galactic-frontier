import { Color3, Effect, Mesh, MeshBuilder, Scene, ShaderMaterial, Vector3 } from "../engine/babylon";

/**
 * Procedural sky dome: gradient atmosphere, sun, star field, a galactic band,
 * a distant black hole with an accretion disk (OrbitBtc's black-hole motif),
 * and a ringed gas giant. One draw call, no textures.
 */
const VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = worldViewProjection * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
uniform vec3 sunColor;
uniform vec3 bhDir;
uniform vec3 planetDir;
uniform float time;
uniform float starAmount;
uniform float cloudAmount;
uniform float cloudLo;
uniform vec3 cloudTint;
uniform vec3 giantA;
uniform vec3 giantB;
uniform vec3 ringColor;
uniform float flash;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y), mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
vec2 localCoords(vec3 d, vec3 axis) {
  vec3 u = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
  vec3 v = cross(u, axis);
  return vec2(dot(d, u), dot(d, v));
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  // Optical-depth style gradient: thick, bright horizon; deep zenith.
  float od = 1.0 / (up + 0.12);
  vec3 col = mix(zenithColor, horizonColor, clamp((od - 0.9) / 7.4, 0.0, 1.0));
  float cosT = dot(d, sunDir);
  // Warm extinction toward the sun near the horizon.
  float sunAz = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
  col = mix(col, col * vec3(1.18, 0.9, 0.78), pow(sunAz, 3.0) * exp(-up * 5.0) * 0.6);
  // Mie forward scattering halo (Henyey-Greenstein, g = 0.76).
  float g = 0.76;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
  col += sunColor * hg * 0.012 * (0.4 + 0.6 * exp(-up * 3.0));

  // Night-side stars and galactic band (fade near horizon)
  float starMask = smoothstep(0.02, 0.35, h) * starAmount;
  vec3 sp = d * 380.0;
  vec3 cell = floor(sp);
  float r = hash13(cell);
  float tw = 0.7 + 0.3 * sin(time * (1.0 + r * 3.0) + r * 40.0);
  float star = step(0.9965, r) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5)) * tw;
  vec3 bandN = normalize(vec3(0.35, 0.25, 0.9));
  float band = exp(-pow(dot(d, bandN) * 5.5, 2.0));
  float neb = vnoise(d * 6.0) * 0.6 + vnoise(d * 15.0) * 0.4;
  col += starMask * (vec3(star) * 1.4 + band * neb * vec3(0.32, 0.16, 0.48) * 0.9 + band * vec3(0.05, 0.08, 0.14));

  // Sun disc
  float sd = max(cosT, 0.0);
  col += sunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 60.0) * 0.3);
  // Horizon glow toward the sun
  float az = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
  col += sunColor * 0.25 * pow(az, 4.0) * exp(-abs(h) * 7.0);

  // Black hole: shadow, photon ring, tilted accretion disk with doppler beaming
  float facing = dot(d, bhDir);
  if (facing > 0.8) {
    vec2 p = localCoords(d, bhDir);
    float tilt = 0.22;
    vec2 q = vec2(p.x, p.y / tilt);
    float dr = length(q);
    float rr = length(p);
    float beaming = 1.0 + 0.75 * clamp(p.x / max(dr, 1e-4), -1.0, 1.0);
    float swirl = 0.65 + 0.35 * sin(atan(q.y, q.x) * 9.0 - time * 0.6 + dr * 160.0);
    float disk = smoothstep(0.042, 0.052, dr) * smoothstep(0.15, 0.07, dr) * swirl;
    vec3 diskCol = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.85, 0.6), smoothstep(0.12, 0.05, dr)) * beaming;
    // Back half of the disk (upper side) sits behind the shadow, lensed above it.
    float lensArc = exp(-pow((rr - 0.046) / 0.006, 2.0)) * 0.9;
    float shadow = smoothstep(0.036, 0.031, rr);
    if (p.y > 0.0) col += diskCol * disk * 1.6;
    col += vec3(1.0, 0.75, 0.5) * lensArc;
    col = mix(col, vec3(0.0), shadow);
    if (p.y <= 0.0) col += diskCol * disk * 1.9;
    col += vec3(0.5, 0.3, 0.9) * exp(-rr * 18.0) * 0.25;
  }

  // Ringed gas giant
  float pf = dot(d, planetDir);
  if (pf > 0.9) {
    vec2 p = localCoords(d, planetDir);
    float R = 0.085;
    float rr = length(p);
    vec2 rq = vec2(p.x * 0.96 + p.y * 0.28, (p.y * 0.96 - p.x * 0.28) / 0.18);
    float rd = length(rq);
    float rings = smoothstep(0.115, 0.12, rd) * smoothstep(0.19, 0.18, rd) * (0.55 + 0.45 * sin(rd * 420.0));
    vec3 ringCol = ringColor * rings * 0.55;
    bool front = (p.y * 0.96 - p.x * 0.28) < 0.0;
    if (!front) col = mix(col, col + ringCol, 1.0);
    if (rr < R) {
      float z = sqrt(max(R * R - rr * rr, 0.0)) / R;
      vec3 n = normalize(vec3(p / R, z));
      vec3 L = normalize(vec3(0.6, 0.35, 0.7));
      float lit = clamp(dot(n, L), 0.0, 1.0) * 0.9 + 0.08;
      float bands = sin(p.y / R * 14.0 + vnoise(vec3(p * 60.0, 1.0)) * 2.0);
      vec3 base = mix(giantA, giantB, bands * 0.5 + 0.5);
      vec3 pc = base * lit;
      float edge = smoothstep(R, R * 0.96, rr);
      col = mix(col, pc + horizonColor * 0.12, edge * 0.92);
    }
    if (front) col += ringCol;
  }

  // High cirrus layer drifting on the wind (Enhanced / Ultra).
  if (cloudAmount > 0.0 && h > 0.0) {
    vec2 cp = d.xz / (h + 0.08) * 1.6 + vec2(time * 0.004, time * 0.0025);
    float c = vnoise(vec3(cp * 1.1, 0.5)) * 0.55 + vnoise(vec3(cp * 2.7, 1.7)) * 0.3 + vnoise(vec3(cp * 6.1, 3.1)) * 0.15;
    c = smoothstep(cloudLo, 0.85, c) * smoothstep(0.0, 0.18, h) * cloudAmount;
    vec3 cloudCol = mix(horizonColor * 1.1, sunColor, pow(sd, 4.0) * 0.8) * (0.8 + 0.4 * up) * cloudTint;
    col = mix(col, cloudCol, c * 0.55);
  }

  // Storm lightning (0 on calm worlds).
  col += (horizonColor * 0.6 + vec3(0.35)) * flash * (0.35 + 0.65 * up);

  // Below horizon: dark ground haze
  col = mix(col, groundColor, smoothstep(0.0, -0.08, h));
  gl_FragColor = vec4(col, 1.0);
}`;

export interface SkyColors {
  zenith: Color3;
  horizon: Color3;
  ground: Color3;
  sun: Color3;
}

/** Per-planet sky extras. Every default reproduces the Veyra-7 (M2) sky exactly. */
export interface SkyOptions {
  /** Cloud amount shown even when the tier disables clouds (0 = Veyra-7 behaviour). */
  baseClouds?: number;
  /** Cloud coverage 0..1 (0.5 = M2). */
  cloudCover?: number;
  cloudTint?: Color3;
  giantA?: Color3;
  giantB?: Color3;
  ring?: Color3;
  /** Direction to the ringed gas giant / black hole. */
  giantDir?: Vector3;
  holeDir?: Vector3;
}

export class Sky {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private time = 0;
  private readonly baseClouds: number;

  constructor(scene: Scene, sunDir: Vector3, colors: SkyColors, starAmount = 0.75, opts: SkyOptions = {}) {
    Effect.ShadersStore["gfSkyVertexShader"] = VERT;
    Effect.ShadersStore["gfSkyFragmentShader"] = FRAG;
    this.baseClouds = opts.baseClouds ?? 0;
    this.mesh = MeshBuilder.CreateSphere("gf-sky", { diameter: 2, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.scaling.setAll(1000);
    this.material = new ShaderMaterial(
      "gf-sky-mat",
      scene,
      { vertex: "gfSky", fragment: "gfSky" },
      {
        attributes: ["position"],
        uniforms: [
          "worldViewProjection", "sunDir", "zenithColor", "horizonColor", "groundColor", "sunColor", "bhDir", "planetDir", "time", "starAmount", "cloudAmount",
          "cloudLo", "cloudTint", "giantA", "giantB", "ringColor", "flash",
        ],
      },
    );
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.setVector3("sunDir", sunDir.normalizeToNew());
    this.material.setColor3("zenithColor", colors.zenith);
    this.material.setColor3("horizonColor", colors.horizon);
    this.material.setColor3("groundColor", colors.ground);
    this.material.setColor3("sunColor", colors.sun);
    this.material.setVector3("bhDir", (opts.holeDir ?? new Vector3(-0.55, 0.42, 0.72)).normalizeToNew());
    this.material.setVector3("planetDir", (opts.giantDir ?? new Vector3(0.75, 0.3, -0.58)).normalizeToNew());
    this.material.setFloat("starAmount", starAmount);
    this.material.setFloat("time", 0);
    this.material.setFloat("cloudAmount", this.baseClouds);
    this.material.setFloat("cloudLo", 0.77 - (opts.cloudCover ?? 0.5) * 0.5);
    this.material.setColor3("cloudTint", opts.cloudTint ?? new Color3(1, 1, 1));
    this.material.setColor3("giantA", opts.giantA ?? new Color3(0.36, 0.55, 0.78));
    this.material.setColor3("giantB", opts.giantB ?? new Color3(0.62, 0.48, 0.82));
    this.material.setColor3("ringColor", opts.ring ?? new Color3(0.85, 0.72, 0.95));
    this.material.setFloat("flash", 0);
    this.mesh.material = this.material;
    this.mesh.renderingGroupId = 0;
    this.mesh.applyFog = false;
  }

  setClouds(on: boolean): void {
    this.material.setFloat("cloudAmount", on ? 1 : this.baseClouds);
  }

  /** Lightning flash brightness 0..1 (storm weather). */
  setFlash(v: number): void {
    this.material.setFloat("flash", v);
  }

  update(dt: number): void {
    this.time += dt;
    this.material.setFloat("time", this.time);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose(true);
  }
}
