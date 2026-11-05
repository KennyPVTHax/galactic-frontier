// Build script for Galactic Frontier (esbuild).
//
//   node scripts/build.mjs lib      -> dist/lib/galactic-frontier.js  (ESM module for the React host)
//   node scripts/build.mjs preview  -> dist/preview/index.html        (single self-contained playable file)
//   node scripts/build.mjs serve    -> dev server on http://localhost:5173
//
// Babylon.js is resolved from node_modules/@babylonjs/core as normal. For offline builds
// against a Babylon source checkout, set BABYLON_CORE_SRC=/path/to/Babylon.js/packages/dev/core/src
// (shader .fx files must be pre-generated to .ts in that checkout).
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "preview";

function loadEsbuild() {
  const candidates = ["esbuild", "/opt/npm-tools/node_modules/esbuild"];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* try next */
    }
  }
  throw new Error("esbuild not found. Run `npm install`.");
}
const esbuild = loadEsbuild();

const alias = {};
const babylonSrc = process.env.BABYLON_CORE_SRC;
if (babylonSrc && !existsSync(join(root, "node_modules/@babylonjs/core"))) {
  alias["@babylonjs/core"] = babylonSrc;
  console.log(`[build] Using Babylon.js source checkout: ${babylonSrc}`);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const common = {
  bundle: true,
  format: "esm",
  target: ["es2020"],
  alias,
  define: {
    __GF_VERSION__: JSON.stringify(pkg.version),
  },
  logLevel: "info",
  legalComments: "none",
  tsconfigRaw: undefined,
};

async function buildLib() {
  await esbuild.build({
    ...common,
    entryPoints: [join(root, "src/index.ts")],
    outfile: join(root, "dist/lib/galactic-frontier.js"),
    minify: true,
    sourcemap: true,
  });
}

async function buildPreviewBundle(minify = true) {
  const result = await esbuild.build({
    ...common,
    entryPoints: [join(root, "src/main.ts")],
    write: false,
    minify,
    format: "iife",
    metafile: true,
  });
  return { js: result.outputFiles[0].text, meta: result.metafile };
}

function htmlShell(inlineJs) {
  const tpl = readFileSync(join(root, "index.html"), "utf8");
  // Avoid closing the inline <script> early.
  const safe = inlineJs.replace(/<\/script/gi, "<\\/script");
  return tpl.replace('<script type="module" src="/src/main.ts"></script>', () => `<script>${safe}</script>`);
}

async function buildPreview() {
  const { js, meta } = await buildPreviewBundle(true);
  const out = join(root, "dist/preview/index.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, htmlShell(js));
  writeFileSync(join(root, "dist/preview/meta.json"), JSON.stringify(meta));
  // Body-only variant for hosts that supply their own document skeleton (e.g. claude.ai artifacts).
  const safe = js.replace(/<\/script/gi, "<\\/script");
  writeFileSync(
    join(root, "dist/preview/embed.html"),
    `<title>Galactic Frontier</title>\n<style>:root{color-scheme:dark}html,body{height:100%;margin:0;background:#05040b;overflow:hidden;overscroll-behavior:none}#app{position:fixed;inset:0}</style>\n<div id="app"></div>\n<script>${safe}</script>\n`,
  );
  const kb = (Buffer.byteLength(js) / 1024).toFixed(0);
  console.log(`[build] preview -> ${out} (${kb} KB JS inlined)`);
}

async function serve() {
  const ctx = await esbuild.context({
    ...common,
    entryPoints: [join(root, "src/main.ts")],
    outdir: join(root, ".dev"),
    format: "iife",
    sourcemap: true,
  });
  await ctx.watch();
  const tpl = readFileSync(join(root, "index.html"), "utf8").replace(
    '<script type="module" src="/src/main.ts"></script>',
    '<script src="/main.js"></script>',
  );
  mkdirSync(join(root, ".dev"), { recursive: true });
  writeFileSync(join(root, ".dev/index.html"), tpl);
  const { port } = await ctx.serve({ servedir: join(root, ".dev"), port: 5173, host: "0.0.0.0" });
  console.log(`[dev] http://localhost:${port}`);
}

if (mode === "lib") await buildLib();
else if (mode === "preview") await buildPreview();
else if (mode === "serve") await serve();
else throw new Error(`Unknown mode ${mode}`);
