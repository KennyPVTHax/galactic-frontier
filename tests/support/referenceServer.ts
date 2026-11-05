/**
 * In-memory REFERENCE implementation of the sync backend, for tests only (it is not in src/ and ships in no bundle).
 * It shows the contract a real trusted backend must implement: authenticate the account, apply events in order with the
 * shared reducer using the SERVER clock, persist the resulting state atomically, answer with verdicts + snapshot.
 * It is NOT the OrbitBTC backend and has no connection to it.
 */
import { applyEvent, freshAuthoritative, type AuthoritativeState, type SyncEvent, type Verdict } from "../../src/sync/protocol";
import type { SubmitResponse, SyncTransport } from "../../src/sync/ledger";

export class ReferenceServer {
  /** accountId -> authoritative state */
  readonly accounts = new Map<string, AuthoritativeState>();
  now = 1_700_000_000_000;
  online = true;
  requests = 0;

  state(account: string): AuthoritativeState {
    let s = this.accounts.get(account);
    if (!s) {
      s = freshAuthoritative();
      this.accounts.set(account, s);
    }
    return s;
  }

  /** A transport bound to one authenticated account and one device. */
  transport(account: string, deviceId: string): SyncTransport {
    return {
      submit: async (events: SyncEvent[]): Promise<SubmitResponse> => {
        this.requests++;
        if (!this.online) throw new Error("offline");
        let s = this.state(account);
        const verdicts: Verdict[] = [];
        for (const ev of events) {
          // A device may only submit events for itself (the authenticated device id is the source of truth).
          if (ev.deviceId !== deviceId) {
            verdicts.push({ id: ev.id, status: "rejected", reason: "bad-payload" });
            continue;
          }
          const r = applyEvent(s, ev, { now: this.now });
          if (r.state) {
            s = r.state;
            this.accounts.set(account, s);
          }
          verdicts.push(r.verdict);
        }
        return { verdicts, snapshot: JSON.parse(JSON.stringify(s)), device: s.devices[deviceId] ?? { seq: 0, hash: "" } };
      },
    };
  }
}
