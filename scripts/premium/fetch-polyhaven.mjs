// Reproducible fetch of CC0 Poly Haven assets for the premium Unity project.
// Verifies every file against the MD5 published by the Poly Haven API and writes a
// provenance record (unity/Assets/ThirdParty/PolyHaven/_provenance.json).
// Usage: node scripts/premium/fetch-polyhaven.mjs
import { mkdir, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "unity", "Assets", "ThirdParty", "PolyHaven");
const UA = { "User-Agent": "GalacticFrontier-dev (idkenny518@gmail.com)" };
const RES = "1k"; // mobile-first; upgrade per asset later

const MODELS = ["boulder_01", "rock_07", "namaqualand_boulder_02", "namaqualand_boulder_03", "namaqualand_boulder_05", "namaqualand_cliff_01"];
const TEXTURES = ["forest_ground_04", "brown_mud_leaves_01", "aerial_rocks_02", "dry_ground_rocks"];
const TEX_MAPS = [["Diffuse", "diff"], ["nor_gl", "nor_gl"], ["arm", "arm"]]; // arm = AO(R) Rough(G) Metal(B)

const json = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };

async function get(url, md5, dest, log) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const got = createHash("md5").update(buf).digest("hex");
  if (md5 && got !== md5) throw new Error(`MD5 mismatch ${url}: ${got} != ${md5}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  log.push({ file: dest.slice(ROOT.length + 1).replaceAll("\\", "/"), url, md5: got, bytes: buf.length });
}

const log = [];
const meta = [];
for (const id of MODELS) {
  const [info, files] = await Promise.all([json(`https://api.polyhaven.com/info/${id}`), json(`https://api.polyhaven.com/files/${id}`)]);
  const g = files.gltf[RES].gltf;
  await get(g.url, g.md5, join(ROOT, "Models", id, `${id}.gltf`), log);
  for (const [rel, f] of Object.entries(g.include)) await get(f.url, f.md5, join(ROOT, "Models", id, rel), log);
  meta.push({ id, kind: "model", name: info.name, authors: Object.keys(info.authors ?? {}), license: "CC0 1.0", page: `https://polyhaven.com/a/${id}` });
}
for (const id of TEXTURES) {
  const [info, files] = await Promise.all([json(`https://api.polyhaven.com/info/${id}`), json(`https://api.polyhaven.com/files/${id}`)]);
  for (const [key, short] of TEX_MAPS) {
    const f = files[key][RES].jpg;
    await get(f.url, f.md5, join(ROOT, "Textures", id, `${id}_${short}_${RES}.jpg`), log);
  }
  meta.push({ id, kind: "texture", name: info.name, authors: Object.keys(info.authors ?? {}), license: "CC0 1.0", page: `https://polyhaven.com/a/${id}` });
}
await writeFile(join(ROOT, "_provenance.json"), JSON.stringify({ fetched: new Date().toISOString(), resolution: RES, assets: meta, files: log }, null, 2));
const total = log.reduce((n, f) => n + f.bytes, 0);
console.log(`ok: ${log.length} files, ${(total / 1048576).toFixed(1)} MB, all MD5 verified -> ${ROOT}`);
