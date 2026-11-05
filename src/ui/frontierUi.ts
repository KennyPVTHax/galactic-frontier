/**
 * M4–M6 panels: star map, frontier contracts and pilot log.
 * Pure HTML renderers + small binders, shown through Hud.showCustom().
 */
import type { PlanetId } from "../universe/types";
import { RESOURCES, formatCost, type ResourceId } from "../gameplay/resources";
import type { ContractDef } from "../gameplay/contracts";
import { objectiveText } from "../gameplay/contracts";
import { ACHIEVEMENTS, PAINTS, RANKS, rankOf, unlockedPaints, type ProgressionState } from "../gameplay/progression";
import { ENEMY_TYPE_IDS } from "../combat/ids";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface StarMapPlanet {
  id: PlanetId;
  name: string;
  tagline: string;
  description: string;
  danger: number;
  hazard: string;
  x: number;
  y: number;
  color: string;
  size: number;
  ring: boolean;
  visited: boolean;
  current: boolean;
  contractTarget: boolean;
  hasStation: boolean;
  resources: ResourceId[];
}

export interface StarMapView {
  planets: StarMapPlanet[];
  selected: PlanetId;
  warp: { ok: boolean; reason?: string };
  contract: string | null;
}

const DANGER = ["Safe", "Calm", "Guarded", "Contested", "Dangerous", "Deadly"];

export function starMapHtml(v: StarMapView): string {
  const sel = v.planets.find((p) => p.id === v.selected) ?? v.planets[0];
  const dots = v.planets
    .map((p) => {
      const left = 50 + p.x * 42;
      const top = 50 + p.y * 42;
      const sz = Math.round(14 + p.size * 16);
      return `<button class="gf-sm-p${p.id === sel.id ? " sel" : ""}${p.current ? " cur" : ""}${p.contractTarget ? " tgt" : ""}" data-sel="${p.id}" style="left:${left}%;top:${top}%;--c:${p.color};--sz:${sz}px" aria-label="${esc(p.name)}">
        <i class="orb${p.ring ? " ring" : ""}"></i><span>${esc(p.name)}</span>${p.current ? `<em>You are here</em>` : p.contractTarget ? `<em>Contract</em>` : ""}</button>`;
    })
    .join("");
  const cur = v.planets.find((p) => p.current);
  const lanes = cur
    ? v.planets
        .filter((p) => !p.current)
        .map((p) => `<line x1="${50 + cur.x * 42}" y1="${50 + cur.y * 42}" x2="${50 + p.x * 42}" y2="${50 + p.y * 42}"${p.id === sel.id ? ' class="on"' : ""}/>`)
        .join("")
    : "";
  const res = sel.resources.map((r) => `<span class="gf-chip"><span class="gf-gem" style="color:${RESOURCES[r].color}"></span>${esc(RESOURCES[r].name)}</span>`).join("");
  const btn = sel.current
    ? `<button class="gf-btn" disabled>Current location</button>`
    : `<button class="gf-btn" data-warp="${sel.id}" ${v.warp.ok ? "" : "disabled"}>Warp to ${esc(sel.name)}</button>`;
  return `<header><h2>Star Map</h2><button class="gf-x" aria-label="Close">✕</button></header>
    <div class="gf-sm">
      <div class="gf-sm-map"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${lanes}</svg><div class="gf-sm-sun"></div>${dots}</div>
      <div class="gf-sm-info">
        <div class="gf-label">${esc(sel.tagline)}</div>
        <h3>${esc(sel.name)}${sel.visited ? "" : ` <small>uncharted</small>`}</h3>
        <p>${esc(sel.description)}</p>
        <div class="gf-row"><span>Threat</span><b class="gf-danger d${sel.danger}">${DANGER[sel.danger] ?? sel.danger}</b></div>
        <div class="gf-row"><span>Hazard</span><span>${esc(sel.hazard)}</span></div>
        <div class="gf-row"><span>Station</span><span>${sel.hasStation ? "Halcyon Dock" : "None — no repairs"}</span></div>
        <div class="gf-sm-res">${res}</div>
        ${v.contract ? `<p class="gf-note">Contract: ${esc(v.contract)}</p>` : ""}
        <div class="gf-sm-act">${btn}</div>
        ${v.warp.ok || sel.current ? "" : `<p class="gf-note">${esc(v.warp.reason ?? "")}</p>`}
      </div>
    </div>`;
}

export function bindStarMap(el: HTMLElement, onSelect: (id: PlanetId) => void, onWarp: (id: PlanetId) => void): void {
  el.querySelectorAll<HTMLButtonElement>("[data-sel]").forEach((b) => b.addEventListener("click", () => onSelect(b.dataset.sel as PlanetId)));
  el.querySelectorAll<HTMLButtonElement>("[data-warp]").forEach((b) => b.addEventListener("click", () => onWarp(b.dataset.warp as PlanetId)));
}

export interface FrontierView {
  tab: "contracts" | "pilot";
  active: { def: ContractDef; step: number; progress: number } | null;
  available: ContractDef[];
  completed: number;
  progression: ProgressionState;
}

function contractCard(c: ContractDef, active: { step: number; progress: number } | null): string {
  const steps = c.objectives
    .map((o, i) => {
      const t = objectiveText(o);
      const st = active ? (i < active.step ? "done" : i === active.step ? "now" : "") : "";
      const prog = active && i === active.step && t.target > 1 ? ` <b>${Math.min(active.progress, t.target)} / ${t.target}</b>` : "";
      return `<li class="${st}">${esc(t.title)}${prog}</li>`;
    })
    .join("");
  const reward = `${formatCost(c.reward.resources)} · ${c.reward.xp} XP`;
  return `<div class="gf-ct${active ? " on" : ""}"><div class="gf-label">${esc(c.category)} · ${esc(c.giver)}</div><h3>${esc(c.title)}</h3><p>${esc(c.brief)}</p><ol>${steps}</ol>
    <div class="gf-ct-f"><span class="gf-note" style="margin:0">Reward: ${esc(reward)}</span>${active ? `<button class="gf-btn ghost" data-abandon>Abandon</button>` : `<button class="gf-btn" data-accept="${c.id}">Accept</button>`}</div></div>`;
}

export function frontierHtml(v: FrontierView): string {
  const tabs = `<div class="gf-tabs"><button class="gf-tab ${v.tab === "contracts" ? "on" : ""}" data-ftab="contracts">Contracts</button><button class="gf-tab ${v.tab === "pilot" ? "on" : ""}" data-ftab="pilot">Pilot log</button></div>`;
  let body = "";
  if (v.tab === "contracts") {
    const act = v.active ? contractCard(v.active.def, v.active) : `<p class="gf-note">No active contract. Accept one below.</p>`;
    const avail = v.available.length ? v.available.map((c) => contractCard(c, null)).join("") : `<p class="gf-note">No other contracts right now. Complete your active work to unlock more.</p>`;
    body = `<div class="gf-label">Active</div>${act}<div class="gf-label" style="margin-top:14px">Available</div>${v.active ? `<p class="gf-note">Accepting a new contract replaces the active one.</p>` : ""}${avail}
      <p class="gf-note">${v.completed} contract${v.completed === 1 ? "" : "s"} completed. Rewards are gameplay resources and XP only — not Orbit Coins.</p>`;
  } else {
    const p = v.progression;
    const r = rankOf(p.xp);
    const kills = ENEMY_TYPE_IDS.map((t) => `<div class="gf-row"><span>${esc({ scout: "Scout drones", interceptor: "Interceptors", raider: "Heavy raiders", hunter: "Hunter fighters", dreadnought: "Dreadnoughts" }[t])}</span><b>${p.kills[t]}</b></div>`).join("");
    const ach = ACHIEVEMENTS.map((a) => {
      const got = p.achievements.includes(a.id);
      return `<div class="gf-ach${got ? " got" : ""}"><b>${got ? "★" : "☆"} ${esc(a.name)}</b><span>${esc(a.description)}${a.unlocksPaint ? ` · unlocks paint` : ""}</span></div>`;
    }).join("");
    const unlocked = unlockedPaints(p);
    const paints = PAINTS.map((pt) => `<button class="gf-tab ${p.paint === pt.id ? "on" : ""}" data-paint="${pt.id}" ${unlocked.includes(pt.id) ? "" : "disabled"}>${esc(pt.name)}${unlocked.includes(pt.id) ? "" : " 🔒"}</button>`).join("");
    body = `<div class="gf-rank"><div class="gf-label">Rank ${r.index + 1} of ${RANKS.length}</div><h3>${esc(r.title)}</h3>
      <div class="track"><i style="width:${Math.round(r.progress * 100)}%"></i></div><span class="gf-note">${p.xp} XP${r.next ? ` · ${r.next.xp - p.xp} to ${esc(r.next.title)}` : " · top rank"}</span></div>
      <div class="gf-label" style="margin-top:12px">Wayfarer paint</div><div class="gf-tabs">${paints}</div>
      <div class="gf-label" style="margin-top:8px">Combat record</div>${kills}
      <div class="gf-row"><span>Worlds visited</span><b>${p.visited.length} / 6</b></div><div class="gf-row"><span>Warp jumps</span><b>${p.warps}</b></div><div class="gf-row"><span>Sites inspected</span><b>${p.inspected}</b></div>
      <div class="gf-label" style="margin-top:12px">Achievements (${p.achievements.length}/${ACHIEVEMENTS.length})</div><div class="gf-achs">${ach}</div>`;
  }
  return `<header><h2>Frontier Log</h2><button class="gf-x" aria-label="Close">✕</button></header>${tabs}${body}`;
}

export function bindFrontier(
  el: HTMLElement,
  cb: { tab(t: "contracts" | "pilot"): void; accept(id: string): void; abandon(): void; paint(id: string): void },
): void {
  el.querySelectorAll<HTMLButtonElement>("[data-ftab]").forEach((b) => b.addEventListener("click", () => cb.tab(b.dataset.ftab as "contracts" | "pilot")));
  el.querySelectorAll<HTMLButtonElement>("[data-accept]").forEach((b) => b.addEventListener("click", () => cb.accept(b.dataset.accept!)));
  el.querySelector<HTMLButtonElement>("[data-abandon]")?.addEventListener("click", () => cb.abandon());
  el.querySelectorAll<HTMLButtonElement>("[data-paint]").forEach((b) => b.addEventListener("click", () => cb.paint(b.dataset.paint!)));
}

export function frontierCss(t: { accent: string; accent2: string; muted: string; border: string; panel: string; danger: string; warn: string; text: string }): string {
  return `
.gf-panel.gf-wide{width:min(860px,100%)}
.gf-sm{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:14px}
@media (max-width:640px),(max-height:430px){.gf-sm{grid-template-columns:1fr 1fr;gap:10px}.gf-sm-info p{font-size:11.5px}}
.gf-sm-map{position:relative;aspect-ratio:1/1;max-height:62vh;border-radius:12px;border:1px solid ${t.border};background:radial-gradient(circle at 50% 50%,rgba(255,200,140,.10),transparent 30%),radial-gradient(ellipse at 30% 70%,rgba(139,92,246,.22),transparent 55%),radial-gradient(ellipse at 75% 25%,rgba(46,230,255,.14),transparent 50%),#07051a;overflow:hidden}
.gf-sm-map svg{position:absolute;inset:0;width:100%;height:100%}
.gf-sm-map line{stroke:rgba(255,255,255,.14);stroke-width:.35;stroke-dasharray:1.2 1.2}
.gf-sm-map line.on{stroke:${t.accent2};stroke-width:.6}
.gf-sm-sun{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px;border-radius:50%;background:radial-gradient(circle,#fff6d8,#ffb35c 55%,transparent 72%);box-shadow:0 0 30px #ffb35c}
.gf-sm-p{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:0;cursor:pointer;padding:4px;min-width:44px;min-height:44px}
.gf-sm-p .orb{display:block;width:var(--sz);height:var(--sz);border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff 0,var(--c) 30%,rgba(0,0,0,.85) 100%);box-shadow:0 0 12px var(--c)}
.gf-sm-p .orb.ring{outline:2px solid rgba(255,255,255,.35);outline-offset:3px}
.gf-sm-p span{font-size:11px;font-weight:600;text-shadow:0 1px 3px #000;white-space:nowrap}
.gf-sm-p em{font-style:normal;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:${t.accent2}}
.gf-sm-p.tgt em{color:#ffd37a}
.gf-sm-p.sel .orb{box-shadow:0 0 0 2px #fff,0 0 18px var(--c)}
.gf-sm-info h3{margin:4px 0 6px;font-size:18px}
.gf-sm-info h3 small{font-size:11px;color:${t.muted};font-weight:500}
.gf-sm-info p{margin:0 0 6px;font-size:12.5px;line-height:1.45}
.gf-sm-res{display:flex;gap:4px;flex-wrap:wrap;margin:8px 0}
.gf-sm-act{margin-top:10px;display:flex;gap:8px}
.gf-danger.d0,.gf-danger.d1{color:${t.accent2}}.gf-danger.d2,.gf-danger.d3{color:${t.warn}}.gf-danger.d4,.gf-danger.d5{color:${t.danger}}
.gf-ct{border:1px solid ${t.border};border-radius:10px;padding:10px 12px;margin:6px 0}
.gf-ct.on{border-color:${t.accent2}}
.gf-ct h3{margin:2px 0 4px;font-size:15px}
.gf-ct p{margin:0 0 6px;font-size:12.5px;line-height:1.4}
.gf-ct ol{margin:0 0 8px;padding-left:18px;font-size:12.5px;line-height:1.6}
.gf-ct li.done{opacity:.5;text-decoration:line-through}
.gf-ct li.now{color:${t.accent2};font-weight:600}
.gf-ct-f{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.gf-rank h3{margin:2px 0 6px}
.gf-rank .track,.gf-suit .track{height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden;margin-bottom:4px}
.gf-rank .track i{display:block;height:100%;background:${t.accent2}}
.gf-achs{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px}
.gf-ach{border:1px solid ${t.border};border-radius:8px;padding:7px 9px;font-size:12px;opacity:.55;display:flex;flex-direction:column;gap:2px}
.gf-ach.got{opacity:1;border-color:${t.accent}}
.gf-ach span{color:${t.muted}}
.gf-mission .gf-contract{margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1)}
.gf-mission .gf-contract h4{margin:2px 0 2px;font-size:13.5px;font-weight:650}
.gf-mission .gf-contract p{font-size:11.5px}
.gf-mission .gf-contract b{color:#ffd37a;font-variant-numeric:tabular-nums}
.gf-warp{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity .35s ease;background:radial-gradient(circle,transparent 35%,rgba(10,6,30,.65));z-index:5}
.gf-warp.on{opacity:1}
.gf-warp.flash{background:radial-gradient(circle,rgba(255,255,255,.95),rgba(180,220,255,.5) 40%,rgba(10,6,30,.4));transition:opacity .12s ease}
.gf-warp div{text-align:center;text-shadow:0 2px 10px #000}
.gf-warp b{display:block;font-size:22px;letter-spacing:.2em;text-transform:uppercase}
.gf-warp span{font-size:13px;color:${t.accent2};letter-spacing:.12em;text-transform:uppercase}
.gf-suit .fill{transition:width .2s linear}
`;
}
