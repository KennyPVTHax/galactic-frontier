/**
 * Cinematic deep space for the Android / desktop Full package: a galaxy band with dust lanes, layered nebulae, gas clouds and
 * distant planetary systems, drawn on one additive sky dome. Original, procedural (no downloaded art, nothing licensed).
 *
 * It is PRESENTATION ONLY: it reads nothing from and writes nothing to the shared gameplay state. It is independently scalable
 * (`setLevel` 0..3 selects noise octaves and which features run — see cinematicController.ts for who decides the level) and the
 * same single shader program serves every level, so changing level never recompiles a shader (no stutter).
 *
 * Level 0 disables the mesh entirely (zero GPU cost). It is not part of the Lite package (see cinematic.lite.ts).
 */
import { Color3, Constants, Effect, Mesh, MeshBuilder, Scene, ShaderMaterial, Vector3 } from "../../engine/babylon";
import { CinematicController, CINEMATIC_MAX, cinematicCeiling, type CinematicChange, type CinematicContext, type CinematicLevel } from "./cinematicController";

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
uniform float uLevel;      // 1..3
uniform float uAlpha;      // altitude fade (0 on the ground, 1 in orbit)
uniform float uTime;
uniform vec3 uGalaxyN;     // normal of the galactic plane
uniform vec3 uGalaxyC;     // direction of the galactic core
uniform vec3 uNebA;
uniform vec3 uNebB;
uniform vec3 uGasC;
uniform vec3 uSysDir0;
uniform vec3 uSysDir1;
uniform vec3 uSysDir2;
uniform vec3 uStarDir;     // light direction for the distant worlds

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, float oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= oct) break;
    s += a * vnoise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}
// A distant planet: lit disc with a soft terminator and thin atmosphere rim. Returns rgb + coverage in a.
vec4 world(vec3 d, vec3 c, float r, vec3 tint) {
  float cs = dot(d, c);
  float ang = acos(clamp(cs, -1.0, 1.0));
  if (ang > r * 1.12) return vec4(0.0);
  vec3 up = abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, c));
  vec3 b = cross(c, t);
  vec2 q = vec2(dot(d, t), dot(d, b)) / sin(r);
  float rr = dot(q, q);
  if (rr > 1.0) { float rim = smoothstep(1.12, 1.0, sqrt(rr)); return vec4(tint * 0.5, rim * 0.5); }
  vec3 n = vec3(q, sqrt(1.0 - rr));
  vec3 nw = t * n.x + b * n.y + c * n.z;
  float lit = clamp(dot(nw, uStarDir) * 0.8 + 0.2, 0.0, 1.0);
  float bands = 0.75 + 0.25 * sin(n.y * 14.0 + vnoise(nw * 5.0) * 4.0);
  return vec4(tint * bands * lit + tint * 0.04, 1.0);
}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.0);

  // Galaxy band: bright core region, dust lanes cut by noise.
  float plane = dot(d, uGalaxyN);
  float band = exp(-plane * plane * 38.0);
  float core = pow(max(dot(d, uGalaxyC), 0.0), 6.0);
  float oct = uLevel < 1.5 ? 2.0 : (uLevel < 2.5 ? 3.0 : 5.0);
  float dust = fbm(d * 5.0 + vec3(0.0, uTime * 0.002, 0.0), oct);
  float lane = smoothstep(0.38, 0.68, dust);
  vec3 gal = mix(vec3(0.34, 0.38, 0.55), vec3(1.0, 0.82, 0.58), core);
  col += gal * band * (0.16 + 0.55 * core) * (1.0 - 0.8 * lane * band);

  // Nebula clouds (two tints).
  float n1 = fbm(d * 2.6 + 3.1, oct);
  float n2 = fbm(d * 3.4 - 7.7, oct);
  col += uNebA * smoothstep(0.55, 0.90, n1) * 0.30;
  col += uNebB * smoothstep(0.56, 0.92, n2) * 0.24;

  // Gas clouds + distant systems from level 2.
  if (uLevel > 1.5) {
    float g = fbm(d * 1.4 + vec3(uTime * 0.0015, 2.0, 5.0), oct);
    col += uGasC * smoothstep(0.50, 0.85, g) * 0.20 * (0.5 + 0.5 * band);
    vec4 w0 = world(d, uSysDir0, 0.060, vec3(0.45, 0.62, 0.95));
    vec4 w1 = world(d, uSysDir1, 0.034, vec3(0.92, 0.62, 0.42));
    vec4 w2 = world(d, uSysDir2, 0.022, vec3(0.7, 0.9, 0.8));
    col = mix(col, w0.rgb, w0.a);
    col = mix(col, w1.rgb, w1.a);
    col = mix(col, w2.rgb, w2.a);
  }
  gl_FragColor = vec4(col * uAlpha, 1.0);
}`;

function hash32(n: number): () => number {
  let s = (n ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CinematicSpace {
  readonly controller = new CinematicController();
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private level: CinematicLevel = 0;
  private time = 0;
  private fade = 0;

  constructor(scene: Scene, seed: number) {
    Effect.ShadersStore["gfCinematicVertexShader"] = VERT;
    Effect.ShadersStore["gfCinematicFragmentShader"] = FRAG;
    const rnd = hash32(seed);
    const dir = (): Vector3 => new Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    const tint = (): Color3 => Color3.FromHSV(rnd() * 360, 0.55 + rnd() * 0.3, 0.5 + rnd() * 0.35);
    this.mesh = MeshBuilder.CreateSphere("gf-cinematic-space", { diameter: 2, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.scaling.setAll(900);
    this.mesh.applyFog = false;
    this.mesh.renderingGroupId = 0;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mat = new ShaderMaterial(
      "gf-cinematic-mat",
      scene,
      { vertex: "gfCinematic", fragment: "gfCinematic" },
      { attributes: ["position"], uniforms: ["worldViewProjection", "uLevel", "uAlpha", "uTime", "uGalaxyN", "uGalaxyC", "uNebA", "uNebB", "uGasC", "uSysDir0", "uSysDir1", "uSysDir2", "uStarDir"] },
    );
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mat.alphaMode = Constants.ALPHA_ADD;
    this.mat.needAlphaBlending = () => true;
    const n = dir();
    const c = Vector3.Cross(n, Math.abs(n.y) < 0.9 ? Vector3.Up() : Vector3.Right()).normalize();
    this.mat.setVector3("uGalaxyN", n);
    this.mat.setVector3("uGalaxyC", c);
    this.mat.setColor3("uNebA", tint().scale(0.7));
    this.mat.setColor3("uNebB", tint().scale(0.7));
    this.mat.setColor3("uGasC", tint().scale(0.55));
    this.mat.setVector3("uSysDir0", dir());
    this.mat.setVector3("uSysDir1", dir());
    this.mat.setVector3("uSysDir2", dir());
    this.mat.setVector3("uStarDir", dir());
    this.mat.setFloat("uLevel", 1);
    this.mat.setFloat("uAlpha", 0);
    this.mat.setFloat("uTime", 0);
    this.mesh.material = this.mat;
    this.mesh.setEnabled(false);
  }

  get currentLevel(): CinematicLevel {
    return this.level;
  }

  /** `?cinematic=0..3` pins a level (tests, screenshots); `off`/`auto` handled by the caller. */
  force(level: CinematicLevel | null): void {
    this.controller.force(level === null ? null : (Math.min(level, CINEMATIC_MAX) as CinematicLevel));
    this.apply(this.controller.level);
  }

  /**
   * @param altitudeFade 0 on the ground … 1 in orbit (reuse the star-field fade)
   * @param ctx          frame/device context for the performance controller
   */
  update(dtSec: number, altitudeFade: number, ctx: CinematicContext): CinematicChange | null {
    this.time += dtSec;
    this.fade = altitudeFade;
    const change = this.controller.frame(dtSec * 1000, ctx);
    if (change) this.apply(change.to);
    const on = this.level > 0 && altitudeFade > 0.01;
    if (this.mesh.isEnabled() !== on) this.mesh.setEnabled(on);
    if (on) {
      this.mat.setFloat("uAlpha", altitudeFade);
      this.mat.setFloat("uTime", this.time);
    }
    return change;
  }

  private apply(l: CinematicLevel): void {
    this.level = l;
    if (l > 0) this.mat.setFloat("uLevel", l);
    if (l === 0) this.mesh.setEnabled(false);
  }

  stats(): { level: CinematicLevel; baseline: unknown; changes: unknown[]; blocked: number[] } {
    return { level: this.level, baseline: this.controller.baseline, changes: this.controller.changes.slice(-10), blocked: this.controller.blocked };
  }

  dispose(): void {
    this.mesh.dispose();
    this.mat.dispose(true);
  }
}

export { cinematicCeiling };
