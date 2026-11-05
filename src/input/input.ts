/**
 * Unified input: keyboard + mouse (pointer lock when available, right-drag
 * otherwise) and on-screen touch controls. Produces one InputFrame per tick.
 */
export interface InputFrame {
  moveX: number;
  moveY: number;
  /** Camera look delta in radians this frame. */
  lookX: number;
  lookY: number;
  zoom: number;
  jumpHeld: boolean;
  jumpPressed: boolean;
  sprint: boolean;
  fire: boolean;
  scanPressed: boolean;
  interactPressed: boolean;
  inventoryPressed: boolean;
  menuPressed: boolean;
  /** M5/M6: star map (M), cycle combat target (T / touch Target), contracts & pilot log (J). */
  mapPressed: boolean;
  targetPressed: boolean;
  contractsPressed: boolean;
  // Ship
  shipThrottle: number;
  shipYaw: number;
  shipPitch: number;
  lift: number;
  boost: boolean;
  /** Absolute throttle (0..1) from the touch throttle slider, or null. */
  shipThrottleTarget: number | null;
  /** True if the last meaningful input came from touch. */
  touch: boolean;
}

export type InputMode = "foot" | "ship" | "ui";

const MOUSE_SENS = 0.0024;

/** setPointerCapture throws for unknown/synthetic pointer ids on some browsers. */
function capture(el: Element, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    /* ignore */
  }
}
const TOUCH_SENS = 0.0062;
const KEY_LOOK_RATE = 2.2;

export interface InputOptions {
  forceTouch?: boolean;
  /** Touch feedback callback (Telegram / Android / vibrate). */
  haptic?: (kind: "tick" | "light" | "medium" | "heavy") => void;
  sensitivity?: number;
  invertY?: boolean;
}

export class InputManager {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  private lmb = false;
  private rmb = false;
  private pointerLocked = false;
  private skipMoves = 0;
  private disposers: (() => void)[] = [];
  mode: InputMode = "ui";
  sensitivity = 1;
  invertY = false;
  touchActive = false;

  // touch state
  private joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private look = { id: -1, lx: 0, ly: 0, dx: 0, dy: 0 };
  private touchButtons = new Map<string, boolean>();
  private touchPressed = new Set<string>();
  private sprintToggle = false;
  private touchRoot: HTMLDivElement | null = null;
  private joyBase: HTMLDivElement | null = null;
  private joyKnob: HTMLDivElement | null = null;
  private interactBtn: HTMLButtonElement | null = null;
  private throttleTarget: number | null = null;
  private thrFill: HTMLDivElement | null = null;
  private thrLabel: HTMLSpanElement | null = null;
  private thrId = -1;
  private lastThrTick = -1;
  private haptic: NonNullable<InputOptions["haptic"]> = () => undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLElement,
    opts: InputOptions = {},
  ) {
    this.sensitivity = opts.sensitivity ?? 1;
    if (opts.haptic) this.haptic = opts.haptic;
    this.invertY = opts.invertY ?? false;
    this.bindKeyboardMouse();
    const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
    if (opts.forceTouch || coarse || "ontouchstart" in window) this.buildTouchControls();
    if (opts.forceTouch || coarse) this.setTouchActive(true);
  }

  private on<K extends keyof WindowEventMap>(target: Window | HTMLElement | Document, ev: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) {
    target.addEventListener(ev, fn, opts);
    this.disposers.push(() => target.removeEventListener(ev, fn, opts));
  }

  private isTextInput(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
  }

  private bindKeyboardMouse(): void {
    this.on(window, "keydown", (e: KeyboardEvent) => {
      if (this.isTextInput(e)) return;
      if (["Space", "ArrowUp", "ArrowDown", "Tab", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (this.touchActive && !e.repeat) this.setTouchActive(false);
    });
    this.on(window, "keyup", (e: KeyboardEvent) => this.keys.delete(e.code));
    this.on(window, "blur", () => {
      this.keys.clear();
      this.lmb = this.rmb = false;
    });
    this.on(this.canvas, "contextmenu", (e: Event) => e.preventDefault());
    this.on(this.canvas, "pointerdown", (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.button === 0) this.lmb = true;
      if (e.button === 2) this.rmb = true;
      if (this.mode !== "ui" && !this.pointerLocked && e.button === 0) this.requestLock();
    });
    this.on(window, "pointerup", (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    this.on(window, "pointermove", (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (this.pointerLocked || this.rmb) {
        const dx = e.movementX || 0;
        const dy = e.movementY || 0;
        // Browsers can report a large bogus jump right after pointer lock engages.
        if (this.skipMoves > 0) {
          this.skipMoves--;
          return;
        }
        if (Math.abs(dx) > 250 || Math.abs(dy) > 250) return;
        this.mouseDX += dx;
        this.mouseDY += dy;
      }
    });
    this.on(this.canvas, "wheel", (e: WheelEvent) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    this.on(document, "pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.skipMoves = 2;
    });
  }

  requestLock(): void {
    try {
      const r = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === "function") r.catch(() => undefined);
    } catch {
      /* sandboxed iframes may forbid pointer lock: right-drag look still works */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  setMode(mode: InputMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "ui") this.releaseLock();
    if (this.touchRoot) this.touchRoot.dataset.mode = mode;
    this.joy.id = -1;
    this.look.id = -1;
    this.throttleTarget = null;
    this.joyBase?.classList.remove("active");
    this.touchButtons.clear();
  }

  setInteractLabel(label: string | null): void {
    if (!this.interactBtn) return;
    this.interactBtn.textContent = label ?? "Use";
    this.interactBtn.classList.toggle("dim", !label);
  }

  /** Mirrors the ship's real throttle on the slider (0..1). */
  setThrottleDisplay(v: number): void {
    if (this.thrFill) this.thrFill.style.height = `${Math.round(v * 100)}%`;
    if (this.thrLabel) this.thrLabel.textContent = `${Math.round(v * 100)}%`;
  }

  setTouchActive(on: boolean): void {
    if (!this.touchRoot) this.buildTouchControls();
    this.touchActive = on;
    if (this.touchRoot) this.touchRoot.style.display = on ? "block" : "none";
    this.overlay.classList.toggle("gf-touch-on", on);
  }

  private buildTouchControls(): void {
    if (this.touchRoot) return;
    const root = document.createElement("div");
    root.className = "gf-touch";
    root.dataset.mode = this.mode;
    root.style.display = "none";
    root.innerHTML = `
      <div class="gf-joyzone"></div>
      <div class="gf-lookzone"></div>
      <div class="gf-joy"><div class="gf-joy-knob"></div></div>
      <div class="gf-tbtns gf-foot">
        <button data-b="interact" class="gf-tb gf-tb-use" data-pos="use">Use</button>
        <button data-b="scan" class="gf-tb" data-pos="scan">Scan</button>
        <button data-b="sprint" class="gf-tb" data-toggle="1" data-pos="sprint">Sprint</button>
        <button data-b="jump" class="gf-tb gf-tb-big" data-pos="jump">Jump<br><small>hold: jet</small></button>
        <button data-b="fire" class="gf-tb gf-tb-big gf-tb-fire" data-pos="fire">Mine</button>
      </div>
      <div class="gf-tbtns gf-ship">
        <button data-b="interact" class="gf-tb gf-tb-use" data-pos="suse">Use</button>
        <button data-b="boost" class="gf-tb" data-pos="boost">Boost</button>
        <button data-b="liftDown" class="gf-tb" data-pos="down">Down</button>
        <button data-b="liftUp" class="gf-tb" data-pos="up">Up</button>
        <button data-b="thrDown" class="gf-tb gf-tb-big" data-pos="thrdown">Thr −</button>
        <button data-b="thrUp" class="gf-tb gf-tb-big" data-pos="thrup">Thr +</button>
        <button data-b="fire" class="gf-tb gf-tb-big gf-tb-fire" data-pos="sfire">Fire</button>
        <button data-b="target" class="gf-tb" data-pos="starget">Target</button>
        <button data-b="map" class="gf-tb" data-pos="smap">Map</button>
        <div class="gf-thr" data-pos="thr" aria-label="Throttle"><div class="gf-thr-track"><div class="gf-thr-fill"></div></div><span class="gf-thr-label">0%</span></div>
      </div>`;
    this.overlay.appendChild(root);
    this.touchRoot = root;
    this.joyBase = root.querySelector(".gf-joy");
    this.joyKnob = root.querySelector(".gf-joy-knob");
    this.interactBtn = root.querySelector(".gf-foot .gf-tb-use");
    const shipUse = root.querySelector<HTMLButtonElement>(".gf-ship .gf-tb-use");

    const joyZone = root.querySelector<HTMLDivElement>(".gf-joyzone")!;
    const lookZone = root.querySelector<HTMLDivElement>(".gf-lookzone")!;

    this.on(joyZone, "pointerdown", (e: PointerEvent) => {
      if (this.joy.id !== -1) return;
      capture(joyZone, e.pointerId);
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      const r = this.overlay.getBoundingClientRect();
      if (this.joyBase) {
        this.joyBase.style.left = `${e.clientX - r.left}px`;
        this.joyBase.style.top = `${e.clientY - r.top}px`;
        this.joyBase.classList.add("active");
      }
      this.setTouchActive(true);
      e.preventDefault();
    });
    this.on(joyZone, "pointermove", (e: PointerEvent) => {
      if (e.pointerId !== this.joy.id) return;
      const R = 52;
      let dx = e.clientX - this.joy.ox;
      let dy = e.clientY - this.joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx *= R / len;
        dy *= R / len;
      }
      this.joy.x = dx / R;
      this.joy.y = -dy / R;
      if (this.joyKnob) this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const endJoy = (e: PointerEvent) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
      if (this.joyKnob) this.joyKnob.style.transform = "";
      this.joyBase?.classList.remove("active");
    };
    this.on(joyZone, "pointerup", endJoy);
    this.on(joyZone, "pointercancel", endJoy);

    this.on(lookZone, "pointerdown", (e: PointerEvent) => {
      if (this.look.id !== -1) return;
      capture(lookZone, e.pointerId);
      this.look = { id: e.pointerId, lx: e.clientX, ly: e.clientY, dx: 0, dy: 0 };
      this.setTouchActive(true);
      e.preventDefault();
    });
    this.on(lookZone, "pointermove", (e: PointerEvent) => {
      if (e.pointerId !== this.look.id) return;
      this.look.dx += e.clientX - this.look.lx;
      this.look.dy += e.clientY - this.look.ly;
      this.look.lx = e.clientX;
      this.look.ly = e.clientY;
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.look.id) this.look.id = -1;
    };
    this.on(lookZone, "pointerup", endLook);
    this.on(lookZone, "pointercancel", endLook);

    root.querySelectorAll<HTMLButtonElement>("button[data-b]").forEach((btn) => {
      const b = btn.dataset.b!;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        capture(btn, e.pointerId);
        this.setTouchActive(true);
        if (btn.dataset.toggle) {
          this.sprintToggle = !this.sprintToggle;
          btn.classList.toggle("on", this.sprintToggle);
          this.haptic("tick");
          return;
        }
        this.touchButtons.set(b, true);
        this.touchPressed.add(b);
        btn.classList.add("on");
        if (b === "thrUp" || b === "thrDown") this.throttleTarget = null;
        this.haptic(b === "fire" || b === "boost" ? "medium" : "light");
      };
      const up = (e: PointerEvent) => {
        e.preventDefault();
        if (btn.dataset.toggle) return;
        this.touchButtons.set(b, false);
        btn.classList.remove("on");
      };
      this.on(btn, "pointerdown", down);
      this.on(btn, "pointerup", up);
      this.on(btn, "pointercancel", up);
      this.on(btn, "contextmenu", (e: Event) => e.preventDefault());
    });
    // Throttle slider: drag sets an absolute throttle with 10% haptic detents.
    const thr = root.querySelector<HTMLDivElement>(".gf-thr");
    this.thrFill = root.querySelector(".gf-thr-fill");
    this.thrLabel = root.querySelector(".gf-thr-label");
    if (thr) {
      const setFrom = (e: PointerEvent) => {
        const r = thr.querySelector(".gf-thr-track")!.getBoundingClientRect();
        const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / Math.max(1, r.height)));
        this.throttleTarget = v;
        this.setThrottleDisplay(v);
        const tick = Math.round(v * 10);
        if (tick !== this.lastThrTick) {
          this.lastThrTick = tick;
          this.haptic(tick === 0 || tick === 10 ? "medium" : "tick");
        }
      };
      this.on(thr, "pointerdown", (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        capture(thr, e.pointerId);
        this.thrId = e.pointerId;
        thr.classList.add("on");
        this.setTouchActive(true);
        setFrom(e);
      });
      this.on(thr, "pointermove", (e: PointerEvent) => {
        if (e.pointerId === this.thrId) setFrom(e);
      });
      const end = (e: PointerEvent) => {
        if (e.pointerId !== this.thrId) return;
        this.thrId = -1;
        thr.classList.remove("on");
      };
      this.on(thr, "pointerup", end);
      this.on(thr, "pointercancel", end);
    }
    if (shipUse) {
      const sync = new MutationObserver(() => {
        shipUse.textContent = this.interactBtn?.textContent ?? "Use";
        shipUse.className = this.interactBtn?.className ?? shipUse.className;
      });
      if (this.interactBtn) sync.observe(this.interactBtn, { childList: true, attributes: true });
      this.disposers.push(() => sync.disconnect());
    }
  }

  private k(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }
  private p(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }
  private tb(b: string): boolean {
    return this.touchButtons.get(b) === true;
  }

  /** Read and reset per-frame input. */
  consume(dt: number): InputFrame {
    const ui = this.mode === "ui";
    const ax = (neg: boolean, pos: boolean) => (pos ? 1 : 0) - (neg ? 1 : 0);
    let moveX = ax(this.k("KeyA"), this.k("KeyD"));
    let moveY = ax(this.k("KeyS"), this.k("KeyW"));
    const keyLookX = ax(this.k("ArrowLeft"), this.k("ArrowRight"));
    const keyLookY = ax(this.k("ArrowUp"), this.k("ArrowDown"));
    const inv = this.invertY ? -1 : 1;
    let lookX = this.mouseDX * MOUSE_SENS * this.sensitivity;
    let lookY = this.mouseDY * MOUSE_SENS * this.sensitivity * inv;

    let shipYaw = moveX;
    let shipPitch = 0;
    let shipThrottle = moveY;
    if (moveY !== 0) this.throttleTarget = null;
    if (this.mode === "ship") {
      shipYaw += keyLookX;
      shipPitch = -keyLookY;
    } else {
      lookX += keyLookX * KEY_LOOK_RATE * dt;
      lookY += keyLookY * KEY_LOOK_RATE * dt * inv;
    }

    // Touch
    if (this.joy.id !== -1) {
      moveX += this.joy.x;
      moveY += this.joy.y;
      shipYaw += this.joy.x;
      shipPitch += this.joy.y * inv;
    }
    lookX += this.look.dx * TOUCH_SENS * this.sensitivity;
    lookY += this.look.dy * TOUCH_SENS * this.sensitivity * inv;
    if (this.tb("thrUp")) shipThrottle += 1;
    if (this.tb("thrDown")) shipThrottle -= 1;

    const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
    const tp = (b: string) => this.touchPressed.has(b);
    const frame: InputFrame = {
      moveX: ui ? 0 : clamp1(moveX),
      moveY: ui ? 0 : clamp1(moveY),
      lookX: ui ? 0 : lookX,
      lookY: ui ? 0 : lookY,
      zoom: this.wheel,
      jumpHeld: !ui && (this.k("Space") || this.tb("jump")),
      jumpPressed: !ui && (this.p("Space") || tp("jump")),
      sprint: !ui && (this.k("ShiftLeft", "ShiftRight") || this.sprintToggle),
      fire: !ui && ((this.lmb && (this.pointerLocked || !this.rmb)) || this.tb("fire")),
      scanPressed: !ui && (this.p("KeyF") || tp("scan")),
      interactPressed: this.p("KeyE") || tp("interact"),
      inventoryPressed: this.p("Tab", "KeyI"),
      menuPressed: this.p("Escape", "KeyP"),
      mapPressed: this.p("KeyM") || tp("map"),
      targetPressed: !ui && (this.p("KeyT") || tp("target")),
      contractsPressed: this.p("KeyJ"),
      shipThrottle: ui ? 0 : clamp1(shipThrottle),
      shipYaw: ui ? 0 : clamp1(shipYaw),
      shipPitch: ui ? 0 : clamp1(shipPitch),
      lift: ui ? 0 : clamp1(ax(this.k("ControlLeft", "KeyC") || this.tb("liftDown"), this.k("Space") || this.tb("liftUp"))),
      boost: !ui && (this.k("ShiftLeft", "ShiftRight") || this.tb("boost")),
      shipThrottleTarget: ui ? null : this.throttleTarget,
      touch: this.touchActive,
    };
    this.pressed.clear();
    this.touchPressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.look.dx = this.look.dy = 0;
    this.wheel = 0;
    return frame;
  }

  dispose(): void {
    this.releaseLock();
    for (const d of this.disposers) d();
    this.disposers = [];
    this.touchRoot?.remove();
  }
}
