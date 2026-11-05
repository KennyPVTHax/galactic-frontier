// Generates tests/fixtures/humanoid-test.glb: a TEST FIXTURE for the GLB pipeline (skin, joints with Mixamo-style names, PBR material
// with a baseColor texture, a "Walk" clip). It is geometry made of boxes on purpose — it exists to exercise loader / rig mapping /
// retargeting / fallback / packaging in CI with zero licensing questions. It is NOT visual content and is never shipped.
//   node scripts/make-test-glb.cjs
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---- skeleton: name, parent, local translation (T-pose, +Z forward, +Y up, character's left = +X) ----------------------------
const J = [];
const add = (name, parent, t) => (J.push({ name: "mixamorig:" + name, parent: parent === null ? null : J.findIndex((j) => j.name === "mixamorig:" + parent), t }), J.length - 1);
add("Hips", null, [0, 0.95, 0]);
add("Spine", "Hips", [0, 0.1, 0]);
add("Spine1", "Spine", [0, 0.2, 0]);
add("Spine2", "Spine1", [0, 0.15, 0]);
add("Neck", "Spine2", [0, 0.15, 0]);
add("Head", "Neck", [0, 0.1, 0]);
for (const [side, sx] of [["Left", 1], ["Right", -1]]) {
  add(side + "Shoulder", "Spine2", [sx * 0.05, 0.1, 0]);
  add(side + "Arm", side + "Shoulder", [sx * 0.1, 0, 0]);
  add(side + "ForeArm", side + "Arm", [sx * 0.28, 0, 0]);
  add(side + "Hand", side + "ForeArm", [sx * 0.26, 0, 0]);
  add(side + "UpLeg", "Hips", [sx * 0.09, -0.05, 0]);
  add(side + "Leg", side + "UpLeg", [0, -0.42, 0]);
  add(side + "Foot", side + "Leg", [0, -0.42, 0]);
  add(side + "ToeBase", side + "Foot", [0, -0.07, 0.12]);
}
const world = J.map(() => [0, 0, 0]);
J.forEach((j, i) => { world[i] = j.parent === null ? j.t.slice() : world[j.parent].map((v, k) => v + j.t[k]); });

// ---- geometry: one box per bone (from the bone to its first child, or a stub), rigidly skinned -------------------------------
const pos = [], nor = [], uv = [], jnt = [], wgt = [], idx = [];
function box(cx, cy, cz, sx, sy, sz, joint) {
  const faces = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  for (const n of faces) {
    const u = n[0] ? [0, 0, 1] : n[1] ? [1, 0, 0] : [1, 0, 0];
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const base = pos.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(cx + (n[0] * sx + a * u[0] * sx + b * v[0] * sx) / 2, cy + (n[1] * sy + a * u[1] * sy + b * v[1] * sy) / 2, cz + (n[2] * sz + a * u[2] * sz + b * v[2] * sz) / 2);
      nor.push(...n);
      uv.push((a + 1) / 2, (b + 1) / 2);
      jnt.push(joint, 0, 0, 0);
      wgt.push(1, 0, 0, 0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
J.forEach((j, i) => {
  const child = J.findIndex((c) => c.parent === i);
  const p = world[i];
  const q = child >= 0 ? world[child] : [p[0], p[1] + 0.12, p[2]];
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  const d = [Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]), Math.abs(q[2] - p[2])];
  if (/ToeBase/.test(j.name)) box(p[0], p[1] - 0.02, p[2] + 0.06, 0.1, 0.05, 0.16, i);
  else box(mid[0], mid[1], mid[2], Math.max(d[0], 0.1), Math.max(d[1], 0.1), Math.max(d[2], 0.1), i);
});

// ---- binary buffer -------------------------------------------------------------------------------------------------------------
const chunks = [];
const views = [];
const accessors = [];
function push(buf, target, type, comp, count, min, max) {
  while (chunks.reduce((a, c) => a + c.length, 0) % 4) chunks.push(Buffer.alloc(1));
  const offset = chunks.reduce((a, c) => a + c.length, 0);
  chunks.push(buf);
  views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
  accessors.push({ bufferView: views.length - 1, componentType: comp, count, type, ...(min ? { min, max } : {}) });
  return accessors.length - 1;
}
const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
const u16 = (a) => Buffer.from(new Uint16Array(a).buffer);
const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mins[k] = Math.min(mins[k], pos[i + k]); maxs[k] = Math.max(maxs[k], pos[i + k]); }
const aPos = push(f32(pos), 34962, "VEC3", 5126, pos.length / 3, mins, maxs);
const aNor = push(f32(nor), 34962, "VEC3", 5126, nor.length / 3);
const aUv = push(f32(uv), 34962, "VEC2", 5126, uv.length / 2);
const aJnt = push(u16(jnt), 34962, "VEC4", 5123, jnt.length / 4);
const aWgt = push(f32(wgt), 34962, "VEC4", 5126, wgt.length / 4);
const aIdx = push(u16(idx), 34963, "SCALAR", 5123, idx.length);
const ibm = [];
J.forEach((_, i) => ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -world[i][0], -world[i][1], -world[i][2], 1));
const aIbm = push(f32(ibm), null, "MAT4", 5126, J.length);

// walk clip: swing the legs and arms about X
const quatX = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const times = [0, 0.25, 0.5, 0.75, 1];
const aTime = push(f32(times), null, "SCALAR", 5126, times.length, [0], [1]);
const swing = (amp, phase) => times.flatMap((t) => quatX(amp * Math.sin((t + phase) * Math.PI * 2)));
const channels = [], samplers = [];
for (const [name, amp, ph] of [["LeftUpLeg", 0.6, 0], ["RightUpLeg", 0.6, 0.5], ["LeftArm", 0.4, 0.5], ["RightArm", 0.4, 0]]) {
  const out = push(f32(swing(amp, ph)), null, "VEC4", 5126, times.length);
  samplers.push({ input: aTime, output: out, interpolation: "LINEAR" });
  channels.push({ sampler: samplers.length - 1, target: { node: J.findIndex((j) => j.name === "mixamorig:" + name), path: "rotation" } });
}

// 4x4 checker PNG (baseColor)
function png() {
  const w = 4, h = 4, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const c = (x + y) % 2 ? 235 : 190; raw.set([c, c, c, 255], y * (w * 4 + 1) + 1 + x * 4); } }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
while (chunks.reduce((a, c) => a + c.length, 0) % 4) chunks.push(Buffer.alloc(1));
const pngBuf = png();
const imgOffset = chunks.reduce((a, c) => a + c.length, 0);
chunks.push(pngBuf);
views.push({ buffer: 0, byteOffset: imgOffset, byteLength: pngBuf.length });
const imgView = views.length - 1;

const nodes = J.map((j) => ({ name: j.name, translation: j.t, children: J.map((c, i) => (c.parent === J.indexOf(j) ? i : -1)).filter((i) => i >= 0) }));
nodes.forEach((n) => { if (!n.children.length) delete n.children; });
nodes.push({ name: "TestHumanoidMesh", mesh: 0, skin: 0 });
const gltf = {
  asset: { version: "2.0", generator: "galactic-frontier make-test-glb (test fixture)" },
  scene: 0,
  scenes: [{ nodes: [0, nodes.length - 1] }],
  nodes,
  meshes: [{ name: "TestHumanoid", primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, TEXCOORD_0: aUv, JOINTS_0: aJnt, WEIGHTS_0: aWgt }, indices: aIdx, material: 0 }] }],
  skins: [{ joints: J.map((_, i) => i), inverseBindMatrices: aIbm, skeleton: 0 }],
  materials: [{ name: "TestSuit", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.2, roughnessFactor: 0.6 } }],
  textures: [{ source: 0, sampler: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  images: [{ bufferView: imgView, mimeType: "image/png" }],
  animations: [{ name: "Walk", samplers, channels }],
  accessors, bufferViews: views,
  buffers: [{ byteLength: chunks.reduce((a, c) => a + c.length, 0) }],
};
const bin = Buffer.concat(chunks);
let json = Buffer.from(JSON.stringify(gltf));
while (json.length % 4) json = Buffer.concat([json, Buffer.from(" ")]);
const total = 12 + 8 + json.length + 8 + bin.length;
const head = Buffer.alloc(12); head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.write("JSON", 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.write("BIN\0", 4);
const out = path.resolve(__dirname, "../tests/fixtures/humanoid-test.glb");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, jh, json, bh, bin]));
console.log("wrote", out, total, "bytes;", J.length, "joints,", idx.length / 3, "triangles");
