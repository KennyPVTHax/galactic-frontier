/**
 * Standalone browser preview entry. Not used by the React integration.
 *   ?quality=low|medium|high   force a preset
 *   ?touch=1                   force on-screen touch controls
 *   ?perf=1                    show the real-device performance recorder
 *   ?debug=1                   expose window.__GF helpers (test builds only; ignored by release builds)
 *   ?start=new|continue        skip the title screen
 */
import { mountGalacticFrontier, LocalStorageSaveAdapter, OfflineBackend, type QualitySetting } from "./index";

declare const __GF_DEBUG__: boolean | undefined;
const params = new URLSearchParams(location.search);
// Debug/test only: serve hero models from another base URL (compiled out of release bundles with the rest of the debug surface).
if ((typeof __GF_DEBUG__ === "undefined" || __GF_DEBUG__) && params.get("models")) (window as unknown as { gfModelsBase?: string }).gfModelsBase = params.get("models") as string;
const app = document.getElementById("app")!;
const q = params.get("quality");
const start = params.get("start");

mountGalacticFrontier(app, {
  quality: q && ["low", "medium", "high", "basic", "enhanced", "ultra"].includes(q) ? (q as QualitySetting) : undefined,
  forceTouch: params.get("touch") === "1",
  cinematic: params.get("cinematic") ?? undefined,
  perfOverlay: params.get("perf") === "1",
  debug: (typeof __GF_DEBUG__ === "undefined" || __GF_DEBUG__) && params.get("debug") === "1",
  autoStart: start === "new" || start === "continue" ? start : undefined,
  saveAdapter: new LocalStorageSaveAdapter(params.get("slot") ? `orbitbtc.galacticFrontier.${params.get("slot")}` : undefined),
  backend: new OfflineBackend(),
  onEvent: (e) => {
    if (e.type === "error") console.error("[GalacticFrontier]", e.message);
    if (typeof __GF_DEBUG__ === "undefined" || __GF_DEBUG__) (window as any).__GF_EVENTS = [...((window as any).__GF_EVENTS ?? []), e];
  },
}).catch((err) => {
  app.innerHTML = `<div style="color:#fff;font:14px system-ui;padding:24px">Galactic Frontier could not start: ${String(err?.message ?? err)}<br><br>This game needs WebGL. Try another browser or enable hardware acceleration.</div>`;
  console.error(err);
});
