/**
 * Client-side sync ledger (M8): the offline-safe outbox.
 *
 * Gameplay on either platform records ACTIONS here as it happens (offline or online). When the player is online and
 * signed in, `flush()` sends the queue to the trusted backend in order. The ledger guarantees:
 *   - every event has a unique idempotency id (`deviceId:seq`) so a retry after a dropped connection can never be
 *     counted twice;
 *   - events form a hash chain per device, so the server detects loss, reordering and corruption;
 *   - if the server rejects an event (e.g. it could no longer afford an upgrade after the other device spent
 *     the resources), the ledger drops it and RE-CHAINS what is left, then continues — it never loops or resends a
 *     rejected action;
 *   - the queue serialises to plain JSON so it survives an app restart or going offline.
 */
import { eventHash, type AuthoritativeState, type SyncEvent, type SyncPayload, type Verdict } from "./protocol";
import { rulesFingerprint } from "../shared/rules";

export interface LedgerSnapshot {
  deviceId: string;
  /** Last sequence number the SERVER has accepted for this device, and its chain hash. */
  acked: { seq: number; hash: string };
  pending: SyncEvent[];
}

export interface SubmitResponse {
  verdicts: Verdict[];
  /** Authoritative state after processing. */
  snapshot: AuthoritativeState;
  /** The server's record of this device's chain head. */
  device: { seq: number; hash: string };
}

/** Network boundary. Implemented over HTTPS to the trusted backend in production; in tests by an in-memory server. */
export interface SyncTransport {
  submit(events: SyncEvent[]): Promise<SubmitResponse>;
}

export interface FlushResult {
  accepted: number;
  duplicates: number;
  rejected: { id: string; reason: string }[];
  snapshot: AuthoritativeState | null;
  /** True if the transport failed (offline): the queue is untouched and can be retried. */
  offline: boolean;
}

export class SyncLedger {
  private acked = { seq: 0, hash: "" };
  private queue: SyncEvent[] = [];

  constructor(
    readonly deviceId: string,
    private readonly rules: string = rulesFingerprint(),
  ) {}

  get pending(): readonly SyncEvent[] {
    return this.queue;
  }

  private head(): { seq: number; hash: string } {
    const last = this.queue[this.queue.length - 1];
    return last ? { seq: last.seq, hash: last.hash } : this.acked;
  }

  /** Records an action. `now` is the client clock — informational only. */
  record(payload: SyncPayload, now: number): SyncEvent {
    const h = this.head();
    const seq = h.seq + 1;
    const id = `${this.deviceId}:${seq}`;
    const ev: SyncEvent = { id, deviceId: this.deviceId, seq, at: now, rules: this.rules, prev: h.hash, hash: eventHash(h.hash, payload, id, this.rules), payload };
    this.queue.push(ev);
    return ev;
  }

  /** Re-numbers and re-hashes the queue on top of a (possibly different) server chain head. */
  private rechain(base: { seq: number; hash: string }, drop: Set<string>): void {
    let prev = base.hash;
    let seq = base.seq;
    const out: SyncEvent[] = [];
    for (const e of this.queue) {
      if (drop.has(e.id)) continue;
      seq += 1;
      const id = `${this.deviceId}:${seq}`;
      out.push({ ...e, id, seq, prev, hash: eventHash(prev, e.payload, id, this.rules) });
      prev = out[out.length - 1].hash;
    }
    this.acked = base;
    this.queue = out;
  }

  /**
   * Sends the queue. Handles: offline (leave queue), duplicates (already counted: drop), rejections (drop + re-chain
   * + continue), and a stale chain (adopt the server's head, re-chain, retry once).
   */
  async flush(transport: SyncTransport): Promise<FlushResult> {
    const result: FlushResult = { accepted: 0, duplicates: 0, rejected: [], snapshot: null, offline: false };
    for (let attempt = 0; attempt < 3 && this.queue.length > 0; attempt++) {
      let res: SubmitResponse;
      try {
        res = await transport.submit(this.queue.map((e) => ({ ...e })));
      } catch {
        result.offline = true;
        return result;
      }
      result.snapshot = res.snapshot;
      const byId = new Map(res.verdicts.map((v) => [v.id, v]));
      const settled = new Set<string>();
      let chainBroken = false;
      for (const e of this.queue) {
        const v = byId.get(e.id);
        if (!v) continue;
        if (v.status === "accepted") {
          result.accepted++;
          settled.add(e.id);
        } else if (v.status === "duplicate") {
          result.duplicates++;
          settled.add(e.id);
        } else {
          settled.add(e.id);
          if (v.reason === "bad-sequence" || v.reason === "bad-chain") chainBroken = true;
          else result.rejected.push({ id: e.id, reason: v.reason });
        }
      }
      if (chainBroken) {
        // Our view of the chain is stale: adopt the server's head and resend what was not genuinely settled.
        const unsettled = new Set<string>();
        for (const e of this.queue) {
          const v = byId.get(e.id);
          if (v && (v.status === "accepted" || v.status === "duplicate" || (v.status === "rejected" && v.reason !== "bad-sequence" && v.reason !== "bad-chain"))) unsettled.add(e.id);
        }
        this.rechain(res.device, unsettled);
        continue;
      }
      this.rechain(res.device, settled);
    }
    return result;
  }

  toJSON(): LedgerSnapshot {
    return { deviceId: this.deviceId, acked: { ...this.acked }, pending: this.queue.map((e) => ({ ...e })) };
  }

  static restore(raw: unknown, rules: string = rulesFingerprint()): SyncLedger | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Partial<LedgerSnapshot>;
    if (typeof r.deviceId !== "string" || !r.deviceId || !r.acked || typeof r.acked.seq !== "number" || typeof r.acked.hash !== "string" || !Array.isArray(r.pending)) return null;
    const l = new SyncLedger(r.deviceId, rules);
    l.acked = { seq: Math.max(0, Math.floor(r.acked.seq)), hash: r.acked.hash };
    l.queue = r.pending.filter((e): e is SyncEvent => !!e && typeof e.id === "string" && typeof e.seq === "number" && !!e.payload).map((e) => ({ ...e }));
    return l;
  }
}
