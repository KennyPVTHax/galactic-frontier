/**
 * Combat HUD (DOM). Created once, nodes are reused every frame (no per-frame allocation of elements).
 * Fed by CombatSystem.hudView() and a world→screen projector supplied by the game.
 */
import type { CombatHudView } from "./hudView";
import type { Vec3 } from "./vec";

export type Projector = (p: Vec3) => { x: number; y: number; behind: boolean };

const CSS = `
.gf-ch{position:absolute;inset:0;pointer-events:none;display:none;z-index:2}
.gf-ch.on{display:block}
.gf-ch *{box-sizing:border-box}
.gf-ch-bars{position:absolute;left:calc(12px + var(--sal,0px));top:calc(212px + var(--sat,0px));width:min(210px,34vw);padding:7px 10px;border-radius:10px;background:rgba(12,9,28,.78);border:1px solid rgba(155,120,255,.35);display:grid;gap:4px}
.gf-ch-row{display:grid;grid-template-columns:48px 1fr;align-items:center;gap:8px;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:#a39cc8}
.gf-ch-track{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}
.gf-ch-fill{height:100%;width:100%;transition:width .12s linear}
.gf-ch-host{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#ff9a9a;text-align:center}
.gf-ch-ret{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px;border:1.5px solid rgba(255,255,255,.5);border-radius:50%}
.gf-ch-ret::before{content:"";position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;border-radius:50%;background:#fff}
.gf-ch-ret.hit{border-color:#fff;transform:scale(1.25);transition:transform .08s}
.gf-ch-tgt{position:absolute;display:none;transform:translate(-50%,-50%);border:2px solid var(--c,#ff5a5a);border-radius:6px}
.gf-ch-tgt.lock{border-style:solid;box-shadow:0 0 10px var(--c,#ff5a5a)}
.gf-ch-tgt:not(.lock){border-style:dashed}
.gf-ch-tag{position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:4px;width:120px;text-align:center;font-size:10.5px;font-weight:600;text-shadow:0 1px 3px #000;color:#fff}
.gf-ch-tag i{display:block;height:3px;border-radius:2px;margin-top:2px;background:rgba(255,255,255,.18);overflow:hidden}
.gf-ch-tag i b{display:block;height:100%}
.gf-ch-tag small{display:block;font-weight:500;font-size:9px;color:#cfc8ff}
.gf-ch-lead{position:absolute;display:none;width:14px;height:14px;margin:-7px;border:1.5px solid #ffd37a;border-radius:50%;transform:rotate(45deg)}
.gf-ch-thr{position:absolute;display:none;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:16px solid #ff5a5a;margin:-8px;filter:drop-shadow(0 0 4px #ff5a5a)}
.gf-ch-thr.atk{animation:gfch-blink .5s infinite}
@keyframes gfch-blink{50%{opacity:.25}}
.gf-ch-warn{position:absolute;left:50%;top:calc(50% + 48px);transform:translateX(-50%);padding:3px 12px;border-radius:999px;background:rgba(255,60,60,.85);font-size:11px;font-weight:700;letter-spacing:.2em;display:none}
.gf-ch-warn.on{display:block;animation:gfch-blink .45s infinite}
.gf-ch-boss{position:absolute;left:50%;transform:translateX(-50%);top:calc(34px + var(--sat,0px));width:min(360px,44vw);display:none;text-align:center;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
.gf-ch-boss .gf-ch-track{height:8px;margin-top:3px}
.gf-ch.touch .gf-ch-tag{font-size:12px;width:140px}
.gf-ch.touch .gf-ch-bars{top:calc(134px + var(--sat,0px));width:min(180px,22vw)}
`;

const el = (cls: string, html = ""): HTMLDivElement => {
  const d = document.createElement("div");
  d.className = cls;
  if (html) d.innerHTML = html;
  return d;
};

export class CombatHud {
  private readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly fills: Record<"shield" | "hull" | "heat", HTMLElement>;
  private readonly host: HTMLElement;
  private readonly ret: HTMLElement;
  private readonly tgt: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly warn: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly threats: HTMLElement[] = [];
  private visible = false;
  private hitT = 0;
  private lastTag = "";

  constructor(parent: HTMLElement) {
    this.style = document.createElement("style");
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = el("gf-ch");
    this.root.innerHTML = `
      <div class="gf-ch-bars">
        <div class="gf-ch-row">Shield<div class="gf-ch-track"><div class="gf-ch-fill" data-f="shield" style="background:#3fd8ff"></div></div></div>
        <div class="gf-ch-row">Hull<div class="gf-ch-track"><div class="gf-ch-fill" data-f="hull" style="background:#8b5cf6"></div></div></div>
        <div class="gf-ch-row">Guns<div class="gf-ch-track"><div class="gf-ch-fill" data-f="heat" style="background:#ffb347"></div></div></div>
        <div class="gf-ch-host" data-host></div>
      </div>
      <div class="gf-ch-ret" data-ret></div>
      <div class="gf-ch-tgt" data-tgt><div class="gf-ch-tag" data-tag></div></div>
      <div class="gf-ch-lead" data-lead></div>
      <div class="gf-ch-warn" data-warn>INCOMING FIRE</div>
      <div class="gf-ch-boss" data-boss></div>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.fills = { shield: q('[data-f="shield"]'), hull: q('[data-f="hull"]'), heat: q('[data-f="heat"]') };
    this.host = q("[data-host]");
    this.ret = q("[data-ret]");
    this.tgt = q("[data-tgt]");
    this.tag = q("[data-tag]");
    this.lead = q("[data-lead]");
    this.warn = q("[data-warn]");
    this.boss = q("[data-boss]");
    for (let i = 0; i < 6; i++) {
      const t = el("gf-ch-thr");
      this.root.appendChild(t);
      this.threats.push(t);
    }
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle("on", v);
  }

  setTouch(on: boolean): void {
    this.root.classList.toggle("touch", on);
  }

  /** `w`/`h` = the HUD's client size, used to clamp off-screen threat arrows to the edge. */
  update(view: CombatHudView, project: Projector, w: number, h: number): void {
    if (!this.visible) return;
    const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
    this.fills.shield.style.width = pct(view.maxShield > 0 ? view.shield / view.maxShield : 0);
    this.fills.hull.style.width = pct(view.maxHull > 0 ? view.hull / view.maxHull : 0);
    this.fills.heat.style.width = pct(view.heat);
    this.fills.heat.style.background = view.overheated ? "#ff4d4d" : "#ffb347";
    this.fills.hull.style.background = view.hull / Math.max(1, view.maxHull) < 0.3 ? "#ff4d4d" : "#8b5cf6";
    const hostTxt = view.hostiles > 0 ? `Hostiles: ${view.hostiles}` : "";
    if (this.host.textContent !== hostTxt) this.host.textContent = hostTxt;

    if (view.hits > 0) this.hitT = 0.12;
    this.ret.classList.toggle("hit", this.hitT > 0);
    this.hitT = Math.max(0, this.hitT - 1 / 30);
    this.warn.classList.toggle("on", view.incoming);

    // Target bracket + lead marker.
    const t = view.target;
    if (t) {
      const p = project(t.position);
      const onScreen = !p.behind && p.x > 0 && p.y > 0 && p.x < w && p.y < h;
      this.tgt.style.display = onScreen ? "block" : "none";
      if (onScreen) {
        const size = Math.max(34, Math.min(150, (t.radius * 900) / Math.max(40, t.distance)));
        this.tgt.style.left = `${p.x}px`;
        this.tgt.style.top = `${p.y}px`;
        this.tgt.style.width = this.tgt.style.height = `${size}px`;
        this.tgt.style.setProperty("--c", t.color);
        this.tgt.classList.toggle("lock", t.locked);
        const tagHtml = `${t.name}${t.hardpoint ? ` · ${t.hardpoint}` : ""}<small>${Math.round(t.distance)} m · ${t.locked ? "LOCKED" : `locking ${Math.round(t.lock * 100)}%`}</small><i><b style="width:${pct(t.hull)};background:#ff7a7a"></b></i>${t.hasShield ? `<i><b style="width:${pct(t.shield)};background:#3fd8ff"></b></i>` : ""}`;
        if (tagHtml !== this.lastTag) {
          this.lastTag = tagHtml;
          this.tag.innerHTML = tagHtml;
        }
      }
    } else this.tgt.style.display = "none";
    if (view.lead && t) {
      const lp = project(view.lead);
      const ok = !lp.behind && lp.x > 0 && lp.y > 0 && lp.x < w && lp.y < h;
      this.lead.style.display = ok ? "block" : "none";
      if (ok) {
        this.lead.style.left = `${lp.x}px`;
        this.lead.style.top = `${lp.y}px`;
      }
    } else this.lead.style.display = "none";

    // Off-screen threat arrows, clamped to an inset rectangle.
    let ti = 0;
    for (const th of view.threats) {
      if (ti >= this.threats.length) break;
      const p = project(th.position);
      const inside = !p.behind && p.x > 30 && p.y > 30 && p.x < w - 30 && p.y < h - 30;
      if (inside) continue;
      let dx = p.x - w / 2, dy = p.y - h / 2;
      if (p.behind) {
        dx = -dx;
        dy = -dy || 1;
      }
      const k = Math.min((w / 2 - 40) / Math.max(1, Math.abs(dx)), (h / 2 - 50) / Math.max(1, Math.abs(dy)));
      const node = this.threats[ti++];
      node.style.display = "block";
      node.style.left = `${w / 2 + dx * k}px`;
      node.style.top = `${h / 2 + dy * k}px`;
      node.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI + 90}deg)`;
      node.classList.toggle("atk", th.attacking);
    }
    for (; ti < this.threats.length; ti++) this.threats[ti].style.display = "none";

    // Boss bar.
    const b = view.boss;
    if (b) {
      this.boss.style.display = "block";
      this.boss.innerHTML = `${b.name} · phase ${b.phase}/${b.phases}${b.enraged ? " · ENRAGED" : ""} · guns ${b.hardpointsAlive}/${b.hardpointsTotal}<div class="gf-ch-track"><div class="gf-ch-fill" style="width:${pct(b.hull)};background:#ff5a5a"></div></div>${b.shield > 0 ? `<div class="gf-ch-track"><div class="gf-ch-fill" style="width:${pct(b.shield)};background:#3fd8ff"></div></div>` : ""}`;
    } else this.boss.style.display = "none";
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
