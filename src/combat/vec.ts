/**
 * Minimal allocation-light vector helpers for the combat simulation.
 * No Babylon imports: the combat sim runs (and is tested) in plain Node.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Rng = () => number;

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (o: Vec3, a: Vec3): Vec3 => ((o.x = a.x), (o.y = a.y), (o.z = a.z), o);
export const set = (o: Vec3, x: number, y: number, z: number): Vec3 => ((o.x = x), (o.y = y), (o.z = z), o);
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2 = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Normalises in place; returns the original length. Zero vectors become +Z. */
export function normalize(a: Vec3): number {
  const l = Math.hypot(a.x, a.y, a.z);
  if (l < 1e-9) {
    a.x = 0;
    a.y = 0;
    a.z = 1;
    return 0;
  }
  a.x /= l;
  a.y /= l;
  a.z /= l;
  return l;
}

/** o = unit(b - a); returns the distance. */
export function dirTo(o: Vec3, a: Vec3, b: Vec3): number {
  o.x = b.x - a.x;
  o.y = b.y - a.y;
  o.z = b.z - a.z;
  return normalize(o);
}

/** Forward vector of a yaw/pitch pose (same convention as ShipPhysics.forward()). */
export function forwardOf(o: Vec3, yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  o.x = Math.sin(yaw) * cp;
  o.y = Math.sin(pitch);
  o.z = Math.cos(yaw) * cp;
  return o;
}

/**
 * Local → world rotation matching Babylon `rotation.set(-pitch, yaw, roll)`
 * (Euler YXZ): v' = Ry(yaw) · Rx(-pitch) · Rz(roll) · v. Local +Z is the nose.
 */
export function localToWorld(o: Vec3, yaw: number, pitch: number, roll: number, lx: number, ly: number, lz: number): Vec3 {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  let x = lx * cr - ly * sr;
  let y = lx * sr + ly * cr;
  let z = lz;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y2 = y * cp + z * sp;
  const z2 = -y * sp + z * cp;
  y = y2;
  z = z2;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  o.x = x * cy + z * sy;
  o.y = y;
  o.z = -x * sy + z * cy;
  return o;
}

/**
 * Rotates unit vector `f` towards unit vector `d` by at most `maxAngle` (in place).
 * Returns the remaining angle between them before the turn.
 */
export function turnTowards(f: Vec3, d: Vec3, maxAngle: number): number {
  const c = clamp(dot(f, d), -1, 1);
  const ang = Math.acos(c);
  if (ang <= maxAngle || ang < 1e-6) {
    copy(f, d);
    return ang;
  }
  let px = d.x - f.x * c, py = d.y - f.y * c, pz = d.z - f.z * c;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    // Opposite directions: turn via world up (or +X if f is vertical).
    px = -f.z;
    py = 0;
    pz = f.x;
    pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) {
      px = 1;
      pz = 0;
      pl = 1;
    }
  }
  px /= pl;
  py /= pl;
  pz /= pl;
  const cm = Math.cos(maxAngle), sm = Math.sin(maxAngle);
  f.x = f.x * cm + px * sm;
  f.y = f.y * cm + py * sm;
  f.z = f.z * cm + pz * sm;
  normalize(f);
  return ang;
}

/**
 * First intersection parameter t ∈ [0,1] of segment A→B with the sphere of
 * radius r at the origin, or -1 for a miss. Callers pass positions relative to
 * the (moving) target so a fast bolt cannot tunnel through a moving ship.
 */
export function segmentSphere(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
  const c = ax * ax + ay * ay + az * az - r * r;
  if (c <= 0) return 0;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return -1;
  const b = 2 * (ax * dx + ay * dy + az * dz);
  if (b > 0) return -1; // moving away and starting outside
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/**
 * Time for a projectile of speed `s` (fired from the origin) to meet a target at
 * relative position `p` moving with relative velocity `v`. Returns -1 if it can't.
 */
export function interceptTime(px: number, py: number, pz: number, vx: number, vy: number, vz: number, s: number): number {
  const a = vx * vx + vy * vy + vz * vz - s * s;
  const b = 2 * (px * vx + py * vy + pz * vz);
  const c = px * px + py * py + pz * pz;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-9) return -1;
    const t = -c / b;
    return t > 0 ? t : -1;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const t = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  return t > 0 ? t : -1;
}

/** Perturbs unit vector `d` by a random angle up to `spread` radians (in place). */
export function applySpread(d: Vec3, spread: number, rng: Rng): Vec3 {
  if (spread <= 0) return d;
  // Orthonormal basis around d.
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(d.y) > 0.95) {
    ux = 1;
    uy = 0;
  }
  // r = normalize(u × d), u2 = d × r
  let rx = uy * d.z - uz * d.y, ry = uz * d.x - ux * d.z, rz = ux * d.y - uy * d.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const qx = d.y * rz - d.z * ry, qy = d.z * rx - d.x * rz, qz = d.x * ry - d.y * rx;
  const a = rng() * Math.PI * 2;
  const m = Math.tan(spread * Math.sqrt(rng()));
  d.x += (rx * Math.cos(a) + qx * Math.sin(a)) * m;
  d.y += (ry * Math.cos(a) + qy * Math.sin(a)) * m;
  d.z += (rz * Math.cos(a) + qz * Math.sin(a)) * m;
  normalize(d);
  return d;
}

/** Deterministic mulberry32 (same algorithm as core/random) so the sim has no external deps. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
