/**
 * Performance recorder UI: a small pill with live FPS and Start/Stop, and a result card with the
 * measured numbers plus Copy / Share / Save. Shown when "Performance stats" is on in Settings (or ?perf=1).
 * Release-safe: it only reads timings and writes a report the user chooses to export.
 */
import { summarize, type PerfReport } from "../core/perfRecorder";

export interface PerfOverlayHandlers {
  onStart(): void;
  onStop(): void;
  /** Returns the exported report as JSON text (or null if nothing was recorded). */
  getReportJson(): string | null;
}

interface AndroidReportBridge {
  shareReport?(text: string): void;
  saveReport?(text: string): string;
}

const CSS = `
.gf-pf{position:absolute;left:50%;transform:translateX(-50%);top:calc(40px + var(--sat,0px));display:none;z-index:6;pointer-events:auto;font:600 11px/1 system-ui,sans-serif;color:#fff}
.gf-pf.on{display:flex;gap:6px;align-items:center;padding:5px 8px;border-radius:999px;background:rgba(12,9,28,.82);border:1px solid rgba(155,120,255,.4)}
.gf-pf button{font:inherit;color:#fff;background:#8b5cf6;border:0;border-radius:999px;padding:5px 11px;min-height:28px}
.gf-pf button.rec{background:#e5484d}
.gf-pf .dot{width:8px;height:8px;border-radius:50%;background:#e5484d;animation:gfpf 1s infinite}
@keyframes gfpf{50%{opacity:.2}}
.gf-pf-card{position:absolute;inset:0;display:none;place-items:center;z-index:7;background:rgba(0,0,0,.55);pointer-events:auto}
.gf-pf-card.on{display:grid}
.gf-pf-card>div{width:min(560px,94%);max-height:92%;overflow:auto;padding:14px 16px;border-radius:12px;background:rgba(12,9,28,.96);border:1px solid rgba(155,120,255,.45);color:#ece9ff;font:13px/1.5 system-ui,sans-serif}
.gf-pf-card h3{margin:0 0 8px;font-size:16px}
.gf-pf-card pre{margin:8px 0;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace}
.gf-pf-card .warn{color:#ffd37a}
.gf-pf-card .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.gf-pf-card button{font:600 13px system-ui,sans-serif;color:#fff;background:#8b5cf6;border:0;border-radius:9px;padding:9px 14px;min-height:40px}
.gf-pf-card button.ghost{background:transparent;border:1px solid rgba(155,120,255,.5)}
.gf-pf-card .msg{font-size:12px;color:#8fe3b0;min-height:16px;margin-top:6px}
`;

export class PerfOverlay {
  private readonly style: HTMLStyleElement;
  private readonly pill: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly live: HTMLElement;
  private readonly btn: HTMLButtonElement;
  private readonly dot: HTMLElement;
  private recording = false;
  private lastLive = "";

  constructor(
    parent: HTMLElement,
    private readonly h: PerfOverlayHandlers,
  ) {
    this.style = document.createElement("style");
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.pill = document.createElement("div");
    this.pill.className = "gf-pf";
    this.pill.innerHTML = `<span class="dot" hidden></span><span data-live>— fps</span><button data-rec>Record</button>`;
    this.card = document.createElement("div");
    this.card.className = "gf-pf-card";
    parent.appendChild(this.pill);
    parent.appendChild(this.card);
    this.live = this.pill.querySelector("[data-live]")!;
    this.btn = this.pill.querySelector("[data-rec]")!;
    this.dot = this.pill.querySelector(".dot")!;
    this.btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.recording) this.h.onStop();
      else this.h.onStart();
    });
    // Keep taps on the overlay away from the game's touch layer.
    for (const el of [this.pill, this.card]) el.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  setVisible(v: boolean): void {
    this.pill.classList.toggle("on", v);
  }

  setRecording(on: boolean): void {
    this.recording = on;
    this.btn.textContent = on ? "Stop" : "Record";
    this.btn.classList.toggle("rec", on);
    this.dot.hidden = !on;
  }

  /** Cheap live readout; only touches the DOM when the text changes. */
  setLive(text: string): void {
    if (text === this.lastLive) return;
    this.lastLive = text;
    this.live.textContent = text;
  }

  showResult(r: PerfReport): void {
    const lines = summarize(r);
    const body = lines.map((l) => (l.startsWith("⚠") ? `<span class="warn">${esc(l)}</span>` : esc(l))).join("\n");
    this.card.innerHTML = `<div><h3>Performance report</h3>
      <pre>${body}</pre>
      <div class="gf-note" style="font-size:12px;opacity:.8">Device: ${esc(deviceLine(r))}<br>GPU: ${esc(r.context.gl.renderer ?? "unknown")}</div>
      <div class="row"><button data-copy>Copy JSON</button><button data-share>Share…</button><button data-save>Save file</button><button class="ghost" data-close>Close</button></div>
      <div class="msg" data-msg></div></div>`;
    this.card.classList.add("on");
    const msg = (t: string) => ((this.card.querySelector("[data-msg]") as HTMLElement).textContent = t);
    const bridge = (): AndroidReportBridge | undefined => (window as unknown as { OrbitBtcGame?: AndroidReportBridge }).OrbitBtcGame;
    this.card.querySelector("[data-close]")!.addEventListener("click", () => this.card.classList.remove("on"));
    this.card.querySelector("[data-copy]")!.addEventListener("click", async () => {
      const json = this.h.getReportJson();
      if (!json) return;
      try {
        await navigator.clipboard.writeText(json);
        msg("Copied to clipboard.");
      } catch {
        msg("Clipboard blocked — use Save or Share.");
      }
    });
    this.card.querySelector("[data-share]")!.addEventListener("click", async () => {
      const json = this.h.getReportJson();
      if (!json) return;
      const b = bridge();
      if (b?.shareReport) return b.shareReport(json);
      try {
        await navigator.share({ title: "Galactic Frontier performance report", text: json });
      } catch {
        msg("Sharing is not available here — use Copy or Save.");
      }
    });
    this.card.querySelector("[data-save]")!.addEventListener("click", () => {
      const json = this.h.getReportJson();
      if (!json) return;
      const b = bridge();
      if (b?.saveReport) {
        msg(`Saved: ${b.saveReport(json)}`);
        return;
      }
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `gf-perf-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      msg("Downloaded.");
    });
  }

  dispose(): void {
    this.pill.remove();
    this.card.remove();
    this.style.remove();
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function deviceLine(r: PerfReport): string {
  const n = r.context.nativeDevice as { manufacturer?: string; model?: string; soc?: string; webView?: string } | undefined;
  if (n?.model) return `${n.manufacturer ?? ""} ${n.model}${n.soc ? ` (${n.soc})` : ""}${n.webView ? ` · WebView ${n.webView}` : ""}`.trim();
  return `${r.context.platform} · ${r.context.userAgent.slice(0, 80)}`;
}
