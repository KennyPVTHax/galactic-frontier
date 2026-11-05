/**
 * Standalone browser preview entry. Not used by the React integration.
 *   ?quality=low|medium|high   force a preset
 *   ?touch=1                   force on-screen touch controls
 *   ?debug=1                   expose window.__GF helpers (testing only)
 *   ?start=new|continue        skip the title screen
 */
import { mountGalacticFrontier, LocalStorageSaveAdapter, OfflineBackend, type QualitySetting } from "./index";

const params = new URLSearchParams(location.search);
const app = document.getElementById("app")!;
const q = params.get("quality");
const start = params.get("start");

mountGalacticFrontier(app, {
  quality: q && ["low", "medium", "high", "basic", "enhanced", "ultra"].includes(q) ? (q as QualitySetting) : undefined,
  forceTouch: params.get("touch") === "1",
  debug: params.get("debug") === "1",
  autoStart: start === "new" || start === "continue" ? start : undefined,
  saveAdapter: new LocalStorageSaveAdapter(params.get("slot") ? `orbitbtc.galacticFrontier.${params.get("slot")}` : undefined),
  backend: new OfflineBackend(),
  onEvent: (e) => {
    if (e.type === "error") console.error("[GalacticFrontier]", e.message);
    (window as any).__GF_EVENTS = [...((window as any).__GF_EVENTS ?? []), e];
  },
}).catch((err) => {
  app.innerHTML = `<div style="color:#fff;font:14px system-ui;padding:24px">Galactic Frontier could not start: ${String(err?.message ?? err)}<br><br>This game needs WebGL. Try another browser or enable hardware acceleration.</div>`;
  console.error(err);
});
