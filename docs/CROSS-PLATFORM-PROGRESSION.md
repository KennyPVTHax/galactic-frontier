# Cross-platform progression (Telegram ⇄ Android) — design and client implementation

Status: **client-side protocol, reducer, offline ledger and tests are implemented. No backend is deployed and the OrbitBTC
production backend was not touched.** Nothing connects farming or any reward to Orbit Coins, balances, wallets or payments.

## Goal
One account, one universe. A player can start on Telegram (Galactic Frontier Lite) and continue on Android (Galactic Frontier) with the
same contracts, inventory, upgrades, ranks, achievements and Orbital Harvesters — and cannot duplicate rewards by switching devices,
replaying requests, editing a save, or going offline on both.

## Principles
1. **Clients report actions, never outcomes.** The event schema has no reward/amount field for contracts or farming. The server computes
   every reward, cost and prerequisite with the *same shared rules* (`src/sync/protocol.ts → applyEvent`).
2. **One reducer.** `applyEvent` is pure and shared: servers port/run it, clients use it for optimistic local play, tests pin it.
3. **Idempotent.** Event ids are unique (`deviceId:seq`); applying one twice is a recorded no-op (`duplicate`).
4. **Ordered and tamper-evident.** Per-device sequence numbers and a hash chain. Gaps/reorders/edits are rejected.
   (The chain detects corruption and reordering; *authenticity* comes from the authenticated TLS channel.)
5. **Rules-versioned.** Every event carries the client's `rulesFingerprint`. A different fingerprint is rejected — a stale build is
   never silently re-priced, and Lite and Full builds provably run the same rules (see "Parity").
6. **Server clock.** Farming accrual and contract duration use server time; client time is informational.

## Event types (`SyncPayload`)
| Event | Server decides | Rejected when |
|---|---|---|
| `contractAccept {contractId}` | availability, prerequisites | `unknown-contract`, `not-available` |
| `contractComplete {contractId,…}` | active contract, minimum time (8 s × objectives, server clock), reward + XP from the rules | `not-active`, `too-fast` |
| `upgradePurchase {upgrade}` | cost from the rules, affordability, maximum level | `cannot-afford`, `at-maximum` |
| `farmBuild {rig}` | cost, level cap | `cannot-afford`, `at-maximum` |
| `farmClaim {}` | amount = server-clock accrual, capped by storage and cargo capacity | — (claiming nothing yields nothing) |
| `minedReport {resource,amount,seconds}` | plausibility only: ≤ 14 units/s ×1.25 and ≤ 6000/h | `implausible`, `bad-payload` |

Common rejections: `rules-mismatch`, `bad-sequence`, `bad-chain`, `bad-hash`.

**Honest limit.** The server cannot observe real play. Mining and combat happen on the device; `minedReport` is bounded by plausibility, not
proven. Contract completion is bounded by prerequisites, active-contract state and minimum duration — **not** proof of play (the same caveat as
M1's `MissionCompletionReport`). If stronger guarantees are needed, add server-side telemetry checks or authoritative combat later.

## Conflicts (two devices, offline)
There is no client-side merging of balances. The server applies events in arrival order and returns an authoritative snapshot.
Example: both devices queue the same 60-ferrite upgrade; the second is answered `cannot-afford`, dropped from its queue (the ledger re-chains
what remains and never resends a rejected action), and that device rebases on the snapshot. Tested in `tests/sync.test.ts`.

## Offline
`SyncLedger` is an outbox: record actions as they happen, persist `toJSON()`, `flush(transport)` when online. A dropped response is safe (the
retry is a `duplicate`). A stale chain (another device advanced the account) is repaired by adopting the server's head and re-chaining.
Local-only play (no account) works exactly as before; sync is opt-in.

## Suggested HTTP contract (for the backend team — not implemented here)
`POST /gf/v1/sync` (authenticated: Bearer session or Telegram `initData`, validated server-side) body `{ events: SyncEvent[] }` →
`{ verdicts: Verdict[], snapshot: AuthoritativeState, device: {seq, hash} }`. `GET /gf/v1/state` returns the snapshot for first sign-in.
Requirements: apply events for one account **serially** inside a transaction (compare-and-set on `revision`); persist `applied` ids and per-device
chain heads; rate-limit per account; reject events whose `deviceId` is not bound to the authenticated session; log rejections for abuse review.
`tests/support/referenceServer.ts` is an in-memory reference of exactly this loop. Any production port must pass `tests/sync.test.ts`.

## Parity guarantee
Both bundles embed `rulesFingerprint()` (hash of contracts, rewards, upgrade costs/effects, resources, farming, combat stats and AI tables,
planet gameplay data and the save schema; presentation data is excluded). `tests/golden/rules-fingerprint.json` makes any rules change an explicit,
reviewed diff, and the parity test runs the real Lite and Full bundles and compares fingerprints and a scripted contract/farming outcome.

## Farming (Orbital Harvesters)
Four rigs (ferrite, carbon, lumenite, void quartz), levels 1–4, six hours of storage, bounded catch-up. Backward clock moves never re-earn a period.
Locally the clock is untrusted; with sync the server clock settles claims. Output is in-game resources only.

## Enabling it later (checklist)
- Approve and build the backend above (separate repository/service; **not** the production reward/payment system).
- Bind devices to accounts; add an account-link flow for Telegram ⇄ Android sign-in.
- Add a `SyncTransport` over HTTPS and call `ledger.record` from the existing gameplay hooks (contract/farm/upgrade/mining paths).
- Decide policy for first link when both devices already have local progress (recommended: server keeps the account with more completed
  contracts as base, the other device's *unclaimed* actions are replayed through the reducer; never sum balances).
