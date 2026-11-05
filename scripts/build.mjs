// Build script for Galactic Frontier (esbuild).
//
//   node scripts/build.mjs lib      -> dist/lib/galactic-frontier.js  (ESM module for the React host)
//   node scripts/build.mjs preview  -> dist/preview/index.html        (single self-contained playable file)
//   node scripts/build.mjs serve    -> dev server on http://localhost:5173
//   node scripts/build.mjs release  -> dist/web/index.html  (single playable file, test hooks compiled out)
//   node scripts/build.mjs android  -> android/app/src/main/assets/www/index.html (Galactic Frontier FULL: the Android package)
//   node scripts/build.mjs telegram -> dist/telegram/index.html (Galactic Frontier LITE: the Telegram Mini App package)
//   node scripts/build.mjs telegram-test -> dist/telegram-test/index.html (LITE + window.__GF test hooks; CI only, never shipped)
//
// `lib`, `preview` and `serve` keep the window.__GF test hooks (used by the browser tests). `release` and
// `android` define __GF_DEBUG__=false so src/core/debugHooks.ts is dropped from the bundle.
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
const releaseMode = mode === "release" || mode === "android" || mode === "telegram";
// Presentation package. LITE is the Telegram Mini App; FULL is everything else (Android, desktop, preview).
// Both run the identical shared gameplay core (see tests/architecture.test.ts + tests/package-parity.test.ts).
const pkgName = mode === "telegram" || mode === "telegram-test" ? "lite" : "full";

/**
 * esbuild plugin shared by all packages: Babylon ships every shader twice (GLSL + WGSL). This game only creates a WebGL
 * Engine, so the WGSL copies are dead weight (~420 KB). They are replaced by an empty module.
 * LITE additionally swaps the engine facade for src/engine/babylon.lite.ts, which stubs the heavyweight features
 * (PBR, post-process pipeline, cascaded shadows, reflection probes, ...) so their code and shaders never enter the bundle.
 */
const packagePlugin = {
  name: "gf-package",
  setup(b) {
    b.onLoad({ filter: /[\\/]@babylonjs[\\/]core[\\/]ShadersWGSL[\\/].*\.js$/ }, () => ({ contents: "export {};", loader: "js" }));
    if (pkgName === "lite") {
      const lite = join(root, "src/engine/babylon.lite.ts");
      b.onResolve({ filter: /(^|\/)engine\/babylon$/ }, (a) => (a.importer === lite ? undefined : { path: lite }));
      // Presentation facades that have a Lite stand-in (src/presentation/<name>.lite.ts).
      b.onResolve({ filter: /(^|\/)presentation\/(cinematic|astronaut)$/ }, (a) => ({ path: join(root, `src/presentation/${a.path.split("/").pop()}.lite.ts`) }));
    }
  },
};
const common = {
  bundle: true,
  format: "esm",
  target: ["es2020"],
  alias,
  define: {
    __GF_VERSION__: JSON.stringify(pkg.version),
    __GF_DEBUG__: releaseMode ? "false" : "true",
    __GF_PACKAGE__: JSON.stringify(pkgName),
  },
  plugins: [packagePlugin],
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

// Release pages get a strict CSP: only the inline bundle runs, nothing can be fetched from the network.
const RELEASE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src data: blob:; worker-src blob:; base-uri 'none'; form-action 'none'";

function htmlShell(inlineJs, release = false) {
  let tpl = readFileSync(join(root, "index.html"), "utf8");
  if (release) tpl = tpl.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${RELEASE_CSP}" />`);
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

async function buildTelegramTest() {
  // Same Lite bundle (same engine facade, same stubs), but with debug hooks so the real Lite code can be driven by the browser tests.
  const { js } = await buildPreviewBundle(true);
  const out = join(root, "dist/telegram-test/index.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, htmlShell(js));
  console.log(`[build] telegram-test -> ${out} (${(Buffer.byteLength(js) / 1024).toFixed(0)} KB JS, debug hooks: ON — not for distribution)`);
}

async function buildRelease(outFile) {
  const { js, meta } = await buildPreviewBundle(true);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, htmlShell(js, true));
  // Bundle composition (inputs → bytes). Kept outside the shipped HTML; tests/package-boundary.test.ts reads it.
  if (mode !== "android") writeFileSync(join(dirname(outFile), "meta.json"), JSON.stringify(meta));
  console.log(`[build] ${mode} -> ${outFile} (${(Buffer.byteLength(js) / 1024).toFixed(0)} KB JS inlined, debug hooks: off)`);
}

if (mode === "release") await buildRelease(join(root, "dist/web/index.html"));
else if (mode === "android") await buildRelease(join(root, "android/app/src/main/assets/www/index.html"));
else if (mode === "telegram") await buildRelease(join(root, "dist/telegram/index.html"));
else if (mode === "telegram-test") await buildTelegramTest();
else if (mode === "lib") await buildLib();
else if (mode === "preview") await buildPreview();
else if (mode === "serve") await serve();
else throw new Error(`Unknown mode ${mode}`);
