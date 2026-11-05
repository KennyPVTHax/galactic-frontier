import type { Theme } from "../core/quality";
import { RESOURCES, RESOURCE_IDS, type ResourceId, formatCost } from "../gameplay/resources";
import type { InventoryCounts } from "../gameplay/inventory";
import type { MissionObjective, MissionSnapshot } from "../gameplay/mission";
import { MISSION_REQUIREMENTS } from "../gameplay/mission";
import { UPGRADES, nextCost, type UpgradeId, type UpgradeLevels } from "../gameplay/upgrades";
import type { GameSettings } from "../persistence/saveSystem";
import { hudCss } from "./styles";
import { frontierCss } from "./frontierUi";
import type { DevicePrefs } from "../persistence/devicePrefs";
import { PROFILES, type GraphicsTier } from "../graphics/profiles";

export interface ScreenMarker {
  id: string;
  x: number;
  y: number;
  label: string;
  sub?: string;
  color: string;
  waypoint?: boolean;
}

export interface CompassMarker {
  bearing: number;
  color: string;
}

export interface HudHandlers {
  onBuy(id: UpgradeId): void;
  onDeliver(): void;
  onLaunch(): void;
  onClosePanel(): void;
  onOpenPanel(p: PanelId): void;
  onSetting<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void;
  onResetSave(): void;
  onDevicePref<K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]): void;
  onFullscreen(): void;
  onDismissRotate(): void;
}

export type PanelId = "inventory" | "terminal" | "settings" | "complete" | "starmap" | "frontier";
export type HudMode = "foot" | "flight" | "parked";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const ICON_BAG = `<svg viewBox="0 0 24 24"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`;
const ICON_FS = `<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>`;
const ICON_MAP = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="7" r="1.6"/><circle cx="18.5" cy="6" r="1.3"/><circle cx="17" cy="18" r="1.8"/><path d="M6.4 7.8l3.6 2.8M14.3 11l3.3-4M13.8 13.8l2 2.6"/></svg>`;
const ICON_LOG = `<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>`;
const ICON_GEAR = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>`;

export class Hud {
  readonly root: HTMLDivElement;
  handlers: HudHandlers | null = null;
  private el: Record<string, HTMLElement> = {};
  private markerEls = new Map<string, HTMLDivElement>();
  private styleEl: HTMLStyleElement;
  private openPanelId: PanelId | null = null;
  private terminalTab: "upgrades" | "expedition" = "expedition";
  private missionHtml = "";
  private contractHtml = "";
  private missionCollapsed = false;
  private dmgTimer = 0;
  private last: Record<string, string> = {};

  constructor(
    container: HTMLElement,
    private readonly theme: Theme,
  ) {
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = hudCss(theme) + frontierCss(theme);
    document.head.appendChild(this.styleEl);

    const root = document.createElement("div");
    root.className = "gf-hud";
    root.innerHTML = `
      <div class="gf-markers" data-el="markers"></div>
      <div class="gf-cross gf-hidden" data-el="cross"><i></i></div>
      <div class="gf-target gf-card gf-hidden" data-el="target"></div>
      <div class="gf-frame" data-el="frame">
      <div class="gf-mission gf-card" data-el="mission"></div>
      <div class="gf-compass" data-el="compass"></div>
      <div class="gf-toasts" data-el="toasts"></div>
      <div class="gf-topright">
        <div class="gf-iconrow">
          <button class="gf-ibtn gf-hidden" data-fs title="Full screen">${ICON_FS}</button>
          <button class="gf-ibtn" data-act="starmap" title="Star map (M)">${ICON_MAP}</button>
          <button class="gf-ibtn" data-act="frontier" title="Contracts & pilot log (J)">${ICON_LOG}</button>
          <button class="gf-ibtn" data-act="inventory" title="Inventory (Tab)">${ICON_BAG}</button>
          <button class="gf-ibtn" data-act="settings" title="Settings (Esc)">${ICON_GEAR}</button>
        </div>
        <div class="gf-res" data-el="res"></div>
        <div class="gf-fps gf-hidden" data-el="fps"></div>
      </div>
      <div class="gf-bottom">
        <div class="gf-prompt gf-card gf-hidden" data-el="prompt"></div>
        <div class="gf-card" data-el="footbars" style="width:100%">
          <div class="gf-bars">
            <div class="gf-bar" data-el="b-energy"><div class="gf-label">Laser energy</div><div class="track"><div class="fill" style="background:${theme.accent2}"></div></div></div>
            <div class="gf-bar" data-el="b-heat"><div class="gf-label">Heat</div><div class="track"><div class="fill" style="background:${theme.warn}"></div></div></div>
            <div class="gf-bar" data-el="b-jet"><div class="gf-label">Jetpack</div><div class="track"><div class="fill" style="background:${theme.accent}"></div></div></div>
            <div class="gf-bar gf-suit gf-hidden" data-el="b-suit"><div class="gf-label">Suit</div><div class="track"><div class="fill" style="background:${theme.accent2}"></div></div></div>
          </div>
        </div>
        <div class="gf-card gf-hidden" data-el="shipbars" style="width:100%">
          <div class="gf-shipbar">
            <div><div class="gf-label">Speed</div><div class="v" data-el="s-speed">0</div></div>
            <div><div class="gf-label">Altitude</div><div class="v" data-el="s-alt">0</div></div>
            <div class="gf-bar"><div class="gf-label">Throttle</div><div class="track"><div class="fill" data-el="s-thr" style="background:${theme.accent2}"></div></div></div>
            <div class="gf-bar"><div class="gf-label">Hull</div><div class="track"><div class="fill" data-el="s-hull" style="background:${theme.accent}"></div></div></div>
          </div>
          <div class="gf-shipstatus" data-el="s-status"></div>
        </div>
      </div>
      </div>
      <div class="gf-rotate gf-hidden" data-el="rotate"><div class="gf-phone"></div><b>Rotate your device</b><span>Galactic Frontier plays in landscape.</span><button class="gf-btn ghost" data-portrait>Play in portrait</button></div>
      <div class="gf-dmg" data-el="dmg"></div>
      <div class="gf-warp" data-el="warp"><div><b data-el="warptitle"></b><span data-el="warpsub"></span></div></div>
      <div class="gf-panelwrap" data-el="panelwrap"><div class="gf-panel gf-card" data-el="panel"></div></div>
      <div class="gf-title gf-hidden" data-el="title"></div>
      <div class="gf-loading" data-el="loading"><div data-el="loadtext">Preparing expedition…</div><div class="track"><i data-el="loadbar"></i></div></div>
    `;
    container.appendChild(root);
    this.root = root;
    root.querySelectorAll<HTMLElement>("[data-el]").forEach((e) => (this.el[e.dataset.el!] = e));
    root.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = b.dataset.act as PanelId;
        if (this.openPanelId === act) this.handlers?.onClosePanel();
        else this.handlers?.onOpenPanel(act);
      }),
    );
    root.querySelector("[data-fs]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers?.onFullscreen();
    });
    root.querySelector("[data-portrait]")?.addEventListener("click", () => this.handlers?.onDismissRotate());
    this.el.panelwrap.addEventListener("pointerdown", (e) => {
      if (e.target === this.el.panelwrap) this.handlers?.onClosePanel();
    });
    this.buildCompass();
  }

  private set(key: string, html: string, el: HTMLElement): void {
    if (this.last[key] === html) return;
    this.last[key] = html;
    el.innerHTML = html;
  }

  private show(el: HTMLElement, v: boolean): void {
    el.classList.toggle("gf-hidden", !v);
  }

  // ------------------------------------------------------------- loading/title

  setLoading(text: string, progress: number): void {
    this.el.loadtext.textContent = text;
    (this.el.loadbar as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  }

  hideLoading(): void {
    this.show(this.el.loading, false);
  }

  showTitle(opts: { hasSave: boolean; touch: boolean; onNew: () => void; onContinue: () => void }): void {
    const t = this.theme;
    const help = opts.touch
      ? `<span>Left thumb</span><span>Move / steer</span><span>Right thumb</span><span>Look</span><span>Buttons</span><span>Mine, scan, jump, use</span>`
      : `<kbd>WASD</kbd><span>Move · ship throttle/turn</span><kbd>Mouse</kbd><span>Look · steer (click to lock)</span><kbd>Hold LMB</kbd><span>Mining laser</span><kbd>F</kbd><span>Scan</span><kbd>Space</kbd><span>Jump · hold for jetpack · ship lift</span><kbd>Shift</kbd><span>Sprint · boost</span><kbd>E</kbd><span>Board · exit · land · dock · terminal</span><kbd>Tab</kbd><span>Inventory</span><kbd>Arrows</kbd><span>Look (if mouse lock unavailable)</span>`;
    this.el.title.innerHTML = `
      <div class="brand">${esc(t.brandName)}</div>
      <h1>${esc(t.gameTitle.toUpperCase())}</h1>
      <div class="sub">Expedition I · First Light</div>
      <div class="btns">
        ${opts.hasSave ? `<button class="gf-btn" data-t="continue">Continue</button>` : ""}
        <button class="gf-btn ${opts.hasSave ? "ghost" : ""}" data-t="new">${opts.hasSave ? "New expedition" : "Begin expedition"}</button>
      </div>
      <div class="gf-help">${help}</div>
      <div class="gf-legal">Prototype build. In-game resources are gameplay items only and are not Orbit Coins.</div>`;
    this.show(this.el.title, true);
    this.el.title.querySelector('[data-t="new"]')?.addEventListener("click", () => {
      if (opts.hasSave && !confirmReset(this.el.title)) return;
      opts.onNew();
    });
    this.el.title.querySelector('[data-t="continue"]')?.addEventListener("click", () => opts.onContinue());
  }

  hideTitle(): void {
    this.show(this.el.title, false);
  }

  // ------------------------------------------------------------- frame updates

  setMode(mode: HudMode): void {
    this.show(this.el.footbars, mode === "foot");
    this.show(this.el.shipbars, mode !== "foot");
    this.show(this.el.cross, mode === "foot");
    if (mode !== "foot") this.show(this.el.target, false);
  }

  setMission(obj: MissionObjective, stepIndex: number, stepCount: number): void {
    const steps = Array.from({ length: stepCount - 1 }, (_, i) => `<i class="${i < stepIndex ? "done" : i === stepIndex ? "now" : ""}"></i>`).join("");
    const prog = obj.progress
      ? `<div class="gf-prog">${obj.progress.map((p) => `<div><span>${esc(p.label)}</span><b>${p.current} / ${p.target}</b></div>`).join("")}</div>`
      : "";
    this.missionHtml = `<div class="gf-label">Expedition I · First Light</div><div class="gf-steps">${steps}</div><h3>${esc(obj.title)}</h3><p>${esc(obj.detail)}</p>${prog}`;
    this.renderMissionCard();
  }

  /** Shows only the frontier contract (after First Light is complete the expedition card collapses). */
  setMissionCollapsed(collapsed: boolean): void {
    if (this.missionCollapsed === collapsed) return;
    this.missionCollapsed = collapsed;
    this.renderMissionCard();
  }

  /** M6: secondary objective line for the active frontier contract. */
  setContract(c: { contract: string; title: string; detail: string; current: number; target: number; step: number; steps: number } | null): void {
    this.contractHtml = c
      ? `<div class="gf-contract"><div class="gf-label">Contract · ${esc(c.contract)} · ${c.step + 1}/${c.steps}</div><h4>${esc(c.title)}${c.target > 1 ? ` <b>${c.current} / ${c.target}</b>` : ""}</h4><p>${esc(c.detail)}</p></div>`
      : "";
    this.renderMissionCard();
  }

  private renderMissionCard(): void {
    const main = this.missionCollapsed && this.contractHtml ? "" : this.missionHtml;
    this.set("mission", main + this.contractHtml, this.el.mission);
  }

  /** M4: suit integrity under environmental hazards (null hides the bar). */
  setSuit(ratio: number | null, label = "Suit"): void {
    const el = this.el["b-suit"];
    this.show(el, ratio !== null);
    if (ratio === null) return;
    (el.querySelector(".fill") as HTMLElement).style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    (el.querySelector(".fill") as HTMLElement).style.background = ratio < 0.35 ? this.theme.danger : this.theme.accent2;
    this.set("suitlabel", esc(label), el.querySelector(".gf-label") as HTMLElement);
  }

  /** Brief red vignette when the hull takes damage (strength 0..1). */
  flashDamage(strength: number): void {
    const d = this.el.dmg;
    d.style.opacity = String(0.25 + 0.6 * Math.max(0, Math.min(1, strength)));
    clearTimeout(this.dmgTimer);
    this.dmgTimer = window.setTimeout(() => (d.style.opacity = "0"), 160);
  }

  /** M4: warp transition overlay. phase null hides it. */
  setWarp(phase: "spool" | "tunnel" | "flash" | null, title = "", sub = ""): void {
    const w = this.el.warp;
    w.classList.toggle("on", phase !== null);
    w.classList.toggle("flash", phase === "flash");
    this.set("warptitle", esc(title), this.el.warptitle);
    this.set("warpsub", esc(sub), this.el.warpsub);
  }

  setBars(energy: number, heat: number, overheated: boolean, jet: number): void {
    const w = (key: string, v: number) => ((this.el[key].querySelector(".fill") as HTMLElement).style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`);
    w("b-energy", energy);
    w("b-heat", heat);
    w("b-jet", jet);
    this.el["b-heat"].classList.toggle("hot", overheated);
    (this.el["b-heat"].querySelector(".gf-label") as HTMLElement).textContent = overheated ? "Overheated" : "Heat";
  }

  setShip(speed: number, altitude: number, throttle: number, hull: number, status: string): void {
    this.el["s-speed"].innerHTML = `${Math.round(speed)}<small>m/s</small>`;
    this.el["s-alt"].innerHTML = `${Math.round(altitude)}<small>m</small>`;
    (this.el["s-thr"] as HTMLElement).style.width = `${Math.round(throttle * 100)}%`;
    (this.el["s-hull"] as HTMLElement).style.width = `${Math.round(hull * 100)}%`;
    (this.el["s-hull"] as HTMLElement).style.background = hull < 0.3 ? this.theme.danger : this.theme.accent;
    this.set("sstatus", esc(status), this.el["s-status"]);
  }

  setPrompt(key: string | null, text: string | null): void {
    this.show(this.el.prompt, !!text);
    if (text) this.set("prompt", `${key ? `<kbd>${esc(key)}</kbd>` : ""}${esc(text)}`, this.el.prompt);
  }

  setTarget(text: string | null, frac = 0, locked = false): void {
    this.el.cross.classList.toggle("on", locked);
    this.show(this.el.target, !!text);
    if (text) this.set("target", `${esc(text)}<div class="bar"><i style="width:${Math.round(frac * 100)}%"></i></div>`, this.el.target);
  }

  setResources(c: InventoryCounts, capacity: number): void {
    const html = RESOURCE_IDS.map(
      (id) => `<div class="gf-chip" title="${esc(RESOURCES[id].name)}"><span class="gf-gem" style="color:${RESOURCES[id].color}"></span>${c[id]}</div>`,
    ).join("");
    this.set("res", html, this.el.res);
    void capacity;
  }

  setFps(fps: number | null): void {
    this.show(this.el.fps, fps !== null);
    if (fps !== null) this.el.fps.textContent = `${Math.round(fps)} fps`;
  }

  /** Multi-line performance overlay (replaces the plain fps readout). */
  setPerf(lines: string[] | null): void {
    this.show(this.el.fps, !!lines);
    if (lines) this.set("perf", lines.map((l) => esc(l)).join("<br>"), this.el.fps);
  }

  /** Ultrawide-safe HUD frame, safe-area insets and orientation state. */
  layout(w: number, h: number, insets: { top: number; right: number; bottom: number; left: number }, landscape: boolean): void {
    const frameX = Math.max(0, (w - h * 2.25) / 2);
    const st = this.root.style;
    st.setProperty("--frame-x", `${Math.round(frameX)}px`);
    st.setProperty("--gf-inset-top", `${insets.top}px`);
    st.setProperty("--gf-inset-right", `${insets.right}px`);
    st.setProperty("--gf-inset-bottom", `${insets.bottom}px`);
    st.setProperty("--gf-inset-left", `${insets.left}px`);
    this.root.classList.toggle("gf-landscape", landscape);
    this.root.classList.toggle("gf-portrait", !landscape);
    this.root.classList.toggle("gf-ultrawide", frameX > 0);
  }

  showRotate(on: boolean): void {
    this.show(this.el.rotate, on);
  }

  showFullscreenButton(on: boolean): void {
    const b = this.root.querySelector<HTMLElement>("[data-fs]");
    if (b) this.show(b, on);
  }

  toast(text: string, kind: "info" | "good" | "warn" | "bad" = "info"): void {
    const t = document.createElement("div");
    t.className = `gf-toast gf-card ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), 3700);
  }

  private buildCompass(): void {
    const c = this.el.compass;
    const labels: [number, string][] = [
      [0, "N"], [45, "NE"], [90, "E"], [135, "SE"], [180, "S"], [225, "SW"], [270, "W"], [315, "NW"],
    ];
    for (const [deg, l] of labels) {
      const s = document.createElement("span");
      s.className = `tick${l.length === 1 ? " card" : ""}`;
      s.dataset.deg = String(deg);
      s.textContent = l;
      c.appendChild(s);
    }
  }

  /** yaw: camera heading (radians, 0 = +Z "north"). */
  setCompass(yaw: number, markers: CompassMarker[]): void {
    const c = this.el.compass;
    const span = Math.PI * 0.9;
    const place = (el: HTMLElement, bearing: number) => {
      let d = bearing - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const vis = Math.abs(d) < span / 2;
      el.style.display = vis ? "" : "none";
      if (vis) el.style.left = `${50 + (d / span) * 100}%`;
    };
    c.querySelectorAll<HTMLElement>(".tick").forEach((t) => place(t, (Number(t.dataset.deg) * Math.PI) / 180));
    const existing = Array.from(c.querySelectorAll<HTMLElement>(".mk"));
    markers.forEach((m, i) => {
      let el = existing[i];
      if (!el) {
        el = document.createElement("span");
        el.className = "mk";
        c.appendChild(el);
      }
      el.style.background = m.color;
      el.style.boxShadow = `0 0 6px ${m.color}`;
      place(el, m.bearing);
    });
    for (let i = markers.length; i < existing.length; i++) existing[i].remove();
  }

  setMarkers(list: ScreenMarker[]): void {
    const seen = new Set<string>();
    for (const m of list) {
      seen.add(m.id);
      let el = this.markerEls.get(m.id);
      if (!el) {
        el = document.createElement("div");
        el.className = `gf-mk${m.waypoint ? " wp" : ""}`;
        el.innerHTML = `<span class="lab"></span><span class="sub"></span><span class="dia"></span>`;
        this.el.markers.appendChild(el);
        this.markerEls.set(m.id, el);
      }
      el.style.left = `${m.x}px`;
      el.style.top = `${m.y}px`;
      el.style.color = m.color;
      (el.children[0] as HTMLElement).textContent = m.label;
      (el.children[1] as HTMLElement).textContent = m.sub ?? "";
    }
    for (const [id, el] of this.markerEls) {
      if (!seen.has(id)) {
        el.remove();
        this.markerEls.delete(id);
      }
    }
  }

  // ------------------------------------------------------------- panels

  get panel(): PanelId | null {
    return this.openPanelId;
  }

  closePanel(): void {
    this.openPanelId = null;
    this.el.panelwrap.classList.remove("open");
  }

  private openWith(id: PanelId, html: string): void {
    this.openPanelId = id;
    this.el.panel.classList.remove("gf-wide");
    this.el.panel.innerHTML = html;
    this.el.panelwrap.classList.add("open");
    this.el.panel.querySelector(".gf-x")?.addEventListener("click", () => this.handlers?.onClosePanel());
  }

  /** Opens a panel with caller-rendered HTML (star map, frontier log). Returns the panel element for binding. */
  showCustom(id: PanelId, html: string, wide = false): HTMLElement {
    this.openWith(id, html);
    this.el.panel.classList.toggle("gf-wide", wide);
    return this.el.panel;
  }

  showInventory(c: InventoryCounts, capacity: number, levels: UpgradeLevels): void {
    const slots = RESOURCE_IDS.map((id) => {
      const r = RESOURCES[id];
      return `<div class="gf-slot"><div style="display:flex;align-items:center;gap:7px"><span class="gf-gem" style="color:${r.color}"></span><b style="font-size:13px">${esc(r.name)}</b></div>
        <div class="n">${c[id]}</div><div class="cap">of ${capacity}</div><div class="d">${esc(r.description)}<br><i>Source: ${esc(r.source)}</i></div></div>`;
    }).join("");
    const ups = UPGRADES.map((u) => `<div class="gf-row"><span>${esc(u.name)}</span><span style="color:${this.theme.muted}">${esc(u.effects[levels[u.id]])}</span></div>`).join("");
    this.openWith(
      "inventory",
      `<header><h2>Inventory</h2><button class="gf-x" aria-label="Close">✕</button></header>
       <div class="gf-grid">${slots}</div>
       <div class="gf-label" style="margin-top:16px">Installed upgrades</div>${ups}
       <p class="gf-note">Gameplay resources stay inside Galactic Frontier. They are not Orbit Coins and cannot be exchanged for them.</p>`,
    );
  }

  showTerminal(c: InventoryCounts, levels: UpgradeLevels, mission: MissionSnapshot, tab?: "upgrades" | "expedition"): void {
    if (tab) this.terminalTab = tab;
    const t = this.theme;
    const upgrades = UPGRADES.map((u) => {
      const lvl = levels[u.id];
      const cost = nextCost(levels, u.id);
      const affordable = !!cost && RESOURCE_IDS.every((id) => c[id] >= (cost[id] ?? 0));
      const pips = u.costs.map((_, i) => `<i class="${i < lvl ? "on" : ""}"></i>`).join("");
      return `<div class="gf-up"><div class="t">${esc(u.name)}<span class="lv">${pips}</span></div>
        <button class="gf-btn" data-buy="${u.id}" ${cost && affordable ? "" : "disabled"}>${cost ? "Install" : "Max"}</button>
        <div class="s">${esc(u.description)} ${esc(u.effects[lvl])}${cost ? ` → ${esc(u.effects[lvl + 1])}` : ""}</div>
        <div class="c ${cost && !affordable ? "no" : ""}">${cost ? esc(formatCost(cost)) : "Fully upgraded"}</div></div>`;
    }).join("");

    const req = Object.entries(MISSION_REQUIREMENTS) as [ResourceId, number][];
    const canDeliver = mission.step === "deliver" && req.every(([id, n]) => c[id] >= n);
    let exp = "";
    if (mission.step === "complete") {
      exp = `<p>Expedition <b>First Light</b> is complete. Free exploration is unlocked: keep mining, upgrading and scouting ${esc("Veyra-7")}.</p>
        <div class="gf-server"><b>Server status:</b> ${esc(mission.submission?.message ?? mission.submission?.status ?? "Not submitted")}</div>`;
    } else if (mission.step === "deliver") {
      exp = `<p>Deliver your survey samples to complete the expedition.</p>
        ${req.map(([id, n]) => `<div class="gf-row"><span>${esc(RESOURCES[id].name)}</span><span style="color:${c[id] >= n ? t.accent2 : t.danger}">${c[id]} / ${n}</span></div>`).join("")}
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="gf-btn" data-deliver ${canDeliver ? "" : "disabled"}>Deliver samples</button></div>
        ${canDeliver ? "" : `<p class="gf-note">You no longer hold enough samples (upgrades may have used them). Mine more on the surface and return.</p>`}`;
    } else {
      exp = `<p>Current objective: <b>${esc(mission.step)}</b>. Launch to continue the expedition.</p>`;
    }

    this.openWith(
      "terminal",
      `<header><h2>Halcyon Dock Terminal</h2><button class="gf-x" aria-label="Close">✕</button></header>
       <div class="gf-tabs"><button class="gf-tab ${this.terminalTab === "expedition" ? "on" : ""}" data-tab="expedition">Expedition</button><button class="gf-tab ${this.terminalTab === "upgrades" ? "on" : ""}" data-tab="upgrades">Upgrades</button></div>
       <div>${this.terminalTab === "upgrades" ? upgrades : exp}</div>
       <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap"><button class="gf-btn ghost" data-open="frontier">Contracts</button><button class="gf-btn ghost" data-open="starmap">Star map</button><button class="gf-btn cy" data-launch>Launch ship</button></div>`,
    );
    const p = this.el.panel;
    p.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => this.showTerminal(c, levels, mission, b.dataset.tab as "upgrades" | "expedition")),
    );
    p.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((b) => b.addEventListener("click", () => this.handlers?.onOpenPanel(b.dataset.open as PanelId)));
    p.querySelectorAll<HTMLButtonElement>("[data-buy]").forEach((b) => b.addEventListener("click", () => this.handlers?.onBuy(b.dataset.buy as UpgradeId)));
    p.querySelector("[data-deliver]")?.addEventListener("click", () => this.handlers?.onDeliver());
    p.querySelector("[data-launch]")?.addEventListener("click", () => this.handlers?.onLaunch());
  }

  showSettings(s: GameSettings, prefs: DevicePrefs, active: { tier: GraphicsTier; reason: string; platform: string }, backendMode: string): void {
    const m = this.theme.muted;
    const opt = (v: string, l: string) => `<option value="${v}" ${prefs.graphics === v ? "selected" : ""}>${l}</option>`;
    this.openWith(
      "settings",
      `<header><h2>Settings</h2><button class="gf-x" aria-label="Close">✕</button></header>
       <div class="gf-label">Graphics · this device</div>
       <div class="gf-row"><span>Graphics preset<br><small style="color:${m}">Active: ${esc(PROFILES[active.tier].label)} (${esc(active.reason)})</small></span>
         <select id="gf-graphics" data-s="graphics">${opt("auto", "Auto")}${opt("basic", PROFILES.basic.label)}${opt("enhanced", PROFILES.enhanced.label)}${opt("ultra", PROFILES.ultra.label)}</select></div>
       <div class="gf-row"><span>Render resolution<br><small style="color:${m}" data-resl>${Math.round(prefs.resolution * 100)}%</small></span><input id="gf-res" type="range" min="0.5" max="1" step="0.05" value="${prefs.resolution}" data-s="resolution"></div>
       <div class="gf-row"><span>Adaptive quality<br><small style="color:${m}">Lowers resolution, then effects, to hold the frame rate</small></span><input id="gf-adaptive" type="checkbox" ${prefs.adaptive ? "checked" : ""} data-s="adaptive"></div>
       <div class="gf-row"><span>Performance stats</span><input id="gf-perf" type="checkbox" ${prefs.perfStats ? "checked" : ""} data-s="perfStats"></div>
       <div class="gf-label" style="margin-top:12px">Controls · your account</div>
       <div class="gf-row"><span>Look sensitivity</span><input id="gf-sens" type="range" min="0.3" max="2.5" step="0.1" value="${s.lookSensitivity}" data-s="lookSensitivity"></div>
       <div class="gf-row"><span>Invert look Y</span><input id="gf-inv" type="checkbox" ${s.invertY ? "checked" : ""} data-s="invertY"></div>
       <div class="gf-row"><span>Show FPS</span><input id="gf-fps" type="checkbox" ${s.showFps ? "checked" : ""} data-s="showFps"></div>
       <div class="gf-row"><span>Progress</span><button class="gf-btn ghost" data-reset>Reset save</button></div>
       <p class="gf-note">Platform: ${esc(active.platform)} · Backend: ${esc(backendMode)}. Graphics never change resources, mission difficulty or rewards. Progress autosaves every 20 seconds.</p>`,
    );
    const p = this.el.panel;
    const H = () => this.handlers;
    p.querySelector<HTMLSelectElement>('[data-s="graphics"]')?.addEventListener("change", (e) => H()?.onDevicePref("graphics", (e.target as HTMLSelectElement).value as DevicePrefs["graphics"]));
    p.querySelector<HTMLInputElement>('[data-s="resolution"]')?.addEventListener("change", (e) => H()?.onDevicePref("resolution", Number((e.target as HTMLInputElement).value)));
    p.querySelector<HTMLInputElement>('[data-s="resolution"]')?.addEventListener("input", (e) => {
      const l = p.querySelector("[data-resl]");
      if (l) l.textContent = `${Math.round(Number((e.target as HTMLInputElement).value) * 100)}%`;
    });
    p.querySelector<HTMLInputElement>('[data-s="adaptive"]')?.addEventListener("change", (e) => H()?.onDevicePref("adaptive", (e.target as HTMLInputElement).checked));
    p.querySelector<HTMLInputElement>('[data-s="perfStats"]')?.addEventListener("change", (e) => H()?.onDevicePref("perfStats", (e.target as HTMLInputElement).checked));
    p.querySelector<HTMLInputElement>('[data-s="lookSensitivity"]')?.addEventListener("input", (e) => H()?.onSetting("lookSensitivity", Number((e.target as HTMLInputElement).value)));
    p.querySelector<HTMLInputElement>('[data-s="invertY"]')?.addEventListener("change", (e) => H()?.onSetting("invertY", (e.target as HTMLInputElement).checked));
    p.querySelector<HTMLInputElement>('[data-s="showFps"]')?.addEventListener("change", (e) => H()?.onSetting("showFps", (e.target as HTMLInputElement).checked));
    p.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      if (b.dataset.armed) H()?.onResetSave();
      else {
        b.dataset.armed = "1";
        b.textContent = "Tap again to confirm";
      }
    });
  }

  showComplete(mission: MissionSnapshot): void {
    const tel = mission.telemetry;
    const mins = mission.startedAt && mission.completedAt ? Math.max(1, Math.round((mission.completedAt - mission.startedAt) / 60000)) : 0;
    this.openWith(
      "complete",
      `<header><h2>Expedition logged</h2><button class="gf-x" aria-label="Close">✕</button></header>
       <div class="gf-complete"><div class="gf-label">Expedition I</div><div class="big">First Light — complete</div>
       <div class="gf-stats"><div>Time<b>${mins} min</b></div><div>Walked<b>${Math.round(tel.distanceOnFootM)} m</b></div><div>Flown<b>${(tel.distanceFlownM / 1000).toFixed(1)} km</b></div><div>Scans<b>${tel.scans}</b></div></div>
       <div class="gf-server" data-el2="server">${esc(mission.submission?.message ?? "Submitting expedition report to OrbitBtc…")}</div>
       <p class="gf-note">Any reward for this expedition is decided and issued by OrbitBtc's servers, never by the game client.</p>
       <div style="margin-top:12px"><button class="gf-btn" data-close2>Continue exploring</button></div></div>`,
    );
    this.el.panel.querySelector("[data-close2]")?.addEventListener("click", () => this.handlers?.onClosePanel());
  }

  updateServerStatus(text: string): void {
    const s = this.el.panel.querySelector<HTMLElement>('[data-el2="server"]');
    if (s) s.textContent = text;
  }

  dispose(): void {
    this.root.remove();
    this.styleEl.remove();
  }
}

function confirmReset(host: HTMLElement): boolean {
  const b = host.querySelector<HTMLButtonElement>('[data-t="new"]');
  if (!b) return true;
  if (b.dataset.armed) return true;
  b.dataset.armed = "1";
  b.textContent = "Overwrite save? Tap again";
  return false;
}
