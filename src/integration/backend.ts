/**
 * Backend integration boundary.
 *
 * RULES (OrbitBtc platform):
 *  - Gameplay resources are separate from Orbit Coins.
 *  - The client NEVER grants, computes or displays a coin amount of its own.
 *  - Mission completion is reported as an authenticated event; the server
 *    validates it and alone decides any reward. The client only shows the
 *    status/message string the server returns.
 */
import type { MissionSnapshot, MissionStepId, MissionTelemetry } from "../gameplay/mission";
import type { SaveData } from "../persistence/saveSystem";

declare const __GF_VERSION__: string;
export const CLIENT_VERSION: string = typeof __GF_VERSION__ !== "undefined" ? __GF_VERSION__ : "dev";

export interface MissionStartResponse {
  /** Server-issued, single-use run id. The server records when it was issued. */
  runId: string;
  serverTime?: number;
}

/** Payload sent when the intro mission completes. Telemetry is evidence, not a claim. */
export interface MissionCompletionReport {
  missionId: string;
  runId: string;
  /** Equal to runId; lets the server deduplicate retries. */
  idempotencyKey: string;
  clientStartedAt: number;
  clientCompletedAt: number;
  stepCompletedAt: Partial<Record<MissionStepId, number>>;
  telemetry: MissionTelemetry;
  clientVersion: string;
}

export type SubmissionStatus = "accepted" | "pending_review" | "rejected" | "offline" | "error";

export interface MissionSubmissionResult {
  status: SubmissionStatus;
  /** Server-authored text, shown verbatim (e.g. reward status). */
  message?: string;
}

export interface BackendClient {
  readonly mode: "offline" | "online";
  startMission(missionId: string): Promise<MissionStartResponse>;
  submitMissionCompletion(report: MissionCompletionReport): Promise<MissionSubmissionResult>;
  loadSave?(slot: string): Promise<SaveData | null>;
  storeSave?(slot: string, data: SaveData): Promise<void>;
}

export function buildCompletionReport(m: MissionSnapshot): MissionCompletionReport {
  if (!m.runId || m.startedAt === null || m.completedAt === null) {
    throw new Error("Mission is not complete");
  }
  return {
    missionId: m.missionId,
    runId: m.runId,
    idempotencyKey: m.runId,
    clientStartedAt: m.startedAt,
    clientCompletedAt: m.completedAt,
    stepCompletedAt: { ...m.stepCompletedAt },
    telemetry: JSON.parse(JSON.stringify(m.telemetry)) as MissionTelemetry,
    clientVersion: CLIENT_VERSION,
  };
}

function localId(): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `local-${r}`;
}

/** Default for the standalone prototype: no network, no rewards. */
export class OfflineBackend implements BackendClient {
  readonly mode = "offline" as const;
  readonly submitted: MissionCompletionReport[] = [];
  async startMission(): Promise<MissionStartResponse> {
    return { runId: localId() };
  }
  async submitMissionCompletion(report: MissionCompletionReport): Promise<MissionSubmissionResult> {
    this.submitted.push(report);
    return {
      status: "offline",
      message: "Offline prototype — expedition logged on this device only. No rewards are issued from the game client.",
    };
  }
}

export interface HttpBackendOptions {
  /** e.g. "https://api.orbitbtc.example/api" — host app supplies this. */
  baseUrl: string;
  /**
   * Returns the auth header(s) for the current user. For a Telegram Mini App,
   * return { "X-Telegram-Init-Data": Telegram.WebApp.initData }; for the website,
   * return { Authorization: `Bearer ${token}` }. Never hardcode secrets here.
   */
  getAuthHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Thin HTTP client for the OrbitBtc FastAPI backend. Endpoint paths match
 * integration-examples/fastapi_galactic_frontier.py.
 */
export class HttpBackendClient implements BackendClient {
  readonly mode = "online" as const;
  private readonly opts: HttpBackendOptions;

  constructor(opts: HttpBackendOptions) {
    this.opts = opts;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const f = this.opts.fetchImpl ?? fetch;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 10000) : null;
    try {
      const headers = { "Content-Type": "application/json", ...(await this.opts.getAuthHeaders()) };
      const res = await f(`${this.opts.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl?.signal,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new BackendError(res.status, text);
      }
      return (await res.json()) as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  startMission(missionId: string): Promise<MissionStartResponse> {
    return this.request("POST", "/galactic-frontier/missions/start", { missionId, clientVersion: CLIENT_VERSION });
  }

  async submitMissionCompletion(report: MissionCompletionReport): Promise<MissionSubmissionResult> {
    try {
      return await this.request<MissionSubmissionResult>("POST", "/galactic-frontier/missions/complete", report);
    } catch (e) {
      if (e instanceof BackendError && e.status >= 400 && e.status < 500) {
        return { status: "rejected", message: "The server did not accept this expedition report." };
      }
      return { status: "error", message: "Could not reach OrbitBtc servers. The report will be retried." };
    }
  }

  async loadSave(slot: string): Promise<SaveData | null> {
    const r = await this.request<{ data: SaveData | null }>("GET", `/galactic-frontier/saves/${encodeURIComponent(slot)}`);
    return r.data;
  }

  async storeSave(slot: string, data: SaveData): Promise<void> {
    await this.request("PUT", `/galactic-frontier/saves/${encodeURIComponent(slot)}`, { data });
  }
}

export class BackendError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Backend responded ${status}`);
  }
}
