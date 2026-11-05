import type { ResourceId } from "./resources";
import { WORLD } from "../core/worldConfig";

export const INTRO_MISSION_ID = "intro_first_light_v1";

export type MissionStepId =
  | "launch"
  | "land"
  | "disembark"
  | "scan"
  | "mine"
  | "takeoff"
  | "dock"
  | "deliver"
  | "complete";

export const MISSION_STEPS: MissionStepId[] = ["launch", "land", "disembark", "scan", "mine", "takeoff", "dock", "deliver", "complete"];

/** Samples required to finish the expedition. Gameplay resources only. */
export const MISSION_REQUIREMENTS: Partial<Record<ResourceId, number>> = { lumenite: 40, ferrite: 30 };

export type GameplayEvent =
  | { type: "undocked" }
  | { type: "landed" }
  | { type: "disembarked" }
  | { type: "scanned"; found: number }
  | { type: "collected"; resource: ResourceId; amount: number }
  | { type: "boarded" }
  | { type: "tookOff" }
  | { type: "docked" }
  | { type: "delivered" }
  | { type: "distance"; mode: "foot" | "flight"; metres: number };

export interface MissionTelemetry {
  distanceOnFootM: number;
  distanceFlownM: number;
  scans: number;
  collected: Record<ResourceId, number>;
}

export interface MissionSnapshot {
  missionId: string;
  step: MissionStepId;
  /** Server-issued run id when online; local id when offline. */
  runId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  stepCompletedAt: Partial<Record<MissionStepId, number>>;
  telemetry: MissionTelemetry;
  /** Set once the completion report was accepted (or queued) by the backend. */
  submission: { status: string; message?: string } | null;
}

export interface MissionObjective {
  title: string;
  detail: string;
  progress?: { label: string; current: number; target: number }[];
}

/** Pure state machine for "Expedition I: First Light". */
export class IntroMission {
  state: MissionSnapshot;
  private now: () => number;

  constructor(snapshot?: MissionSnapshot | null, now: () => number = Date.now) {
    this.now = now;
    this.state = snapshot ? IntroMission.sanitize(snapshot) : IntroMission.fresh();
  }

  static fresh(): MissionSnapshot {
    return {
      missionId: INTRO_MISSION_ID,
      step: "launch",
      runId: null,
      startedAt: null,
      completedAt: null,
      stepCompletedAt: {},
      telemetry: { distanceOnFootM: 0, distanceFlownM: 0, scans: 0, collected: { ferrite: 0, carbon: 0, lumenite: 0, voidQuartz: 0 } },
      submission: null,
    };
  }

  get step(): MissionStepId {
    return this.state.step;
  }
  get isComplete(): boolean {
    return this.state.step === "complete";
  }

  start(runId: string): void {
    if (this.state.startedAt === null) {
      this.state.startedAt = this.now();
      this.state.runId = runId;
    }
  }

  /** Returns true if the step advanced. */
  handle(ev: GameplayEvent): boolean {
    const s = this.state;
    const t = s.telemetry;
    // Telemetry only accumulates during an active run.
    const active = s.startedAt !== null && s.step !== "complete";
    if (active) {
      if (ev.type === "distance") {
        if (ev.mode === "foot") t.distanceOnFootM += ev.metres;
        else t.distanceFlownM += ev.metres;
      } else if (ev.type === "scanned") t.scans += 1;
      else if (ev.type === "collected") t.collected[ev.resource] += ev.amount;
    }

    const advance = (): boolean => {
      s.stepCompletedAt[s.step] = this.now();
      s.step = MISSION_STEPS[MISSION_STEPS.indexOf(s.step) + 1];
      if (s.step === "complete") s.completedAt = this.now();
      return true;
    };

    switch (s.step) {
      case "launch":
        return ev.type === "undocked" ? advance() : false;
      case "land":
        return ev.type === "landed" ? advance() : false;
      case "disembark":
        return ev.type === "disembarked" ? advance() : false;
      case "scan":
        if (ev.type !== "scanned" || ev.found <= 0) return false;
        advance();
        // Samples gathered before scanning still count.
        if (this.requirementsMet()) advance();
        return true;
      case "mine":
        return this.requirementsMet() ? advance() : false;
      case "takeoff":
        return ev.type === "tookOff" ? advance() : false;
      case "dock":
        return ev.type === "docked" ? advance() : false;
      case "deliver":
        return ev.type === "delivered" ? advance() : false;
      default:
        return false;
    }
  }

  requirementsMet(): boolean {
    const c = this.state.telemetry.collected;
    return Object.entries(MISSION_REQUIREMENTS).every(([id, n]) => c[id as ResourceId] >= (n ?? 0));
  }

  objective(): MissionObjective {
    const c = this.state.telemetry.collected;
    switch (this.state.step) {
      case "launch":
        return { title: "Launch", detail: `Undock the ${WORLD.shipName} from ${WORLD.station.name}.` };
      case "land":
        return { title: "Descend", detail: `Fly down to ${WORLD.surveySite.name} on ${WORLD.planetName} and land.` };
      case "disembark":
        return { title: "Step outside", detail: `Exit the ${WORLD.shipName}.` };
      case "scan":
        return { title: "Scan", detail: "Pulse your scanner to reveal mineral signatures nearby." };
      case "mine":
        return {
          title: "Collect samples",
          detail: "Mine glowing Lumenite crystals and rust-veined Ferrite boulders.",
          progress: Object.entries(MISSION_REQUIREMENTS).map(([id, n]) => ({
            label: id === "lumenite" ? "Lumenite" : "Ferrite",
            current: Math.min(c[id as ResourceId], n ?? 0),
            target: n ?? 0,
          })),
        };
      case "takeoff":
        return { title: "Return", detail: `Board the ${WORLD.shipName} and take off.` };
      case "dock":
        return { title: "Dock", detail: `Fly back up to ${WORLD.station.name} and dock on the pad.` };
      case "deliver":
        return { title: "Deliver", detail: "Open the dock terminal and deliver your samples." };
      case "complete":
        return { title: "Expedition complete", detail: "First Light is logged. Free exploration unlocked." };
    }
  }

  static sanitize(raw: MissionSnapshot): MissionSnapshot {
    const base = IntroMission.fresh();
    if (!raw || typeof raw !== "object") return base;
    const step = MISSION_STEPS.includes(raw.step) ? raw.step : "launch";
    const tel = raw.telemetry ?? base.telemetry;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
    return {
      missionId: INTRO_MISSION_ID,
      step,
      runId: typeof raw.runId === "string" ? raw.runId : null,
      startedAt: typeof raw.startedAt === "number" ? raw.startedAt : null,
      completedAt: typeof raw.completedAt === "number" ? raw.completedAt : null,
      stepCompletedAt: typeof raw.stepCompletedAt === "object" && raw.stepCompletedAt ? { ...raw.stepCompletedAt } : {},
      telemetry: {
        distanceOnFootM: num(tel.distanceOnFootM),
        distanceFlownM: num(tel.distanceFlownM),
        scans: num(tel.scans),
        collected: {
          ferrite: num(tel.collected?.ferrite),
          carbon: num(tel.collected?.carbon),
          lumenite: num(tel.collected?.lumenite),
          voidQuartz: num(tel.collected?.voidQuartz),
        },
      },
      submission: raw.submission && typeof raw.submission.status === "string" ? { ...raw.submission } : null,
    };
  }
}
