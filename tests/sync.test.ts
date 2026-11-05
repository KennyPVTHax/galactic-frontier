import { test } from "node:test";
import assert from "node:assert/strict";
import { ReferenceServer } from "./support/referenceServer";
import { SyncLedger } from "../src/sync/ledger";
import { applyEvent, eventHash, freshAuthoritative, MIN_SECONDS_PER_OBJECTIVE, MINING_LIMITS, type SyncEvent, type SyncPayload } from "../src/sync/protocol";
import { getContract } from "../src/gameplay/contracts";
import { FARMING_RULES } from "../src/gameplay/farming";
import { rulesFingerprint } from "../src/shared/rules";

const H = 3_600_000;
const NOW = 1_700_000_000_000;
const STARTER = "aetherion_signal";

/** Server time well after the contract was accepted, so the minimum-duration check passes. */
const later = (srv: ReferenceServer, ms = 10 * 60_000) => (srv.now += ms);

async function setup() {
  const srv = new ReferenceServer();
  const tg = new SyncLedger("telegram-1");
  const an = new SyncLedger("android-1");
  return { srv, tg, an, tgT: srv.transport("acct", "telegram-1"), anT: srv.transport("acct", "android-1") };
}

/** Gives an account a starter stock of resources via plausible mining reports. */
async function mine(srv: ReferenceServer, l: SyncLedger, t: ReturnType<ReferenceServer["transport"]>, resource: "ferrite" | "carbon" | "lumenite" | "voidQuartz", amount: number) {
  l.record({ type: "minedReport", resource, amount, seconds: Math.ceil(amount / 4) + 40 }, srv.now);
  return l.flush(t);
}

test("honest flow: contract completion pays the reward defined by the SHARED rules, once", async () => {
  const { srv, tg, tgT } = await setup();
  const def = getContract(STARTER)!;
  later(srv);
  tg.record({ type: "contractComplete", contractId: STARTER, startedAt: 0, completedAt: srv.now }, srv.now);
  const r = await tg.flush(tgT);
  assert.equal(r.accepted, 1);
  const s = srv.state("acct");
  assert.ok(s.contracts.completed.includes(STARTER));
  assert.equal(s.progression.xp >= def.reward.xp, true);
  for (const [res, n] of Object.entries(def.reward.resources)) assert.equal(s.inventory[res as keyof typeof s.inventory], n);
  assert.ok(tg.pending.length === 0, "queue drained");
});

test("a client cannot choose its reward: extra fields are ignored and amounts come from the rules", async () => {
  const { srv, tg, tgT } = await setup();
  later(srv);
  const forged = { type: "contractComplete", contractId: STARTER, startedAt: 0, completedAt: srv.now, reward: { ferrite: 999999 }, xp: 1e9 } as unknown as SyncPayload;
  tg.record(forged, srv.now);
  await tg.flush(tgT);
  const s = srv.state("acct");
  assert.ok(s.inventory.ferrite < 1000, `ferrite ${s.inventory.ferrite}`);
  assert.ok(s.progression.xp < 5000, `xp ${s.progression.xp}`);
});

test("idempotency: re-sending the same event (dropped response / retry) is counted once", async () => {
  const { srv, tg, tgT } = await setup();
  later(srv);
  const ev = tg.record({ type: "contractComplete", contractId: STARTER, startedAt: 0, completedAt: srv.now }, srv.now);
  await tg.flush(tgT);
  const before = JSON.stringify(srv.state("acct"));
  // A retry of the exact same bytes (e.g. the client never saw the response).
  const r = await tgT.submit([ev]);
  assert.equal(r.verdicts[0].status, "duplicate");
  assert.equal(JSON.stringify(srv.state("acct")), before, "no state change on duplicate");
});

test("replay protection: completing a non-repeatable contract again, or re-accepting it, is refused", async () => {
  const { srv, tg, tgT } = await setup();
  later(srv);
  tg.record({ type: "contractComplete", contractId: STARTER, startedAt: 0, completedAt: srv.now }, srv.now);
  tg.record({ type: "contractComplete", contractId: STARTER, startedAt: 0, completedAt: srv.now }, srv.now);
  tg.record({ type: "contractAccept", contractId: STARTER }, srv.now);
  const r = await tg.flush(tgT);
  assert.equal(r.accepted, 1);
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ["not-active", "not-available"]);
  assert.equal(srv.state("acct").progression.xp, getContract(STARTER)!.reward.xp, "xp counted exactly once");
});

test("prerequisites are enforced server-side", async () => {
  const { srv, tg, tgT } = await setup();
  tg.record({ type: "contractAccept", contractId: "kryos_survey" }, srv.now);
  let r = await tg.flush(tgT);
  assert.equal(r.rejected[0].reason, "not-available");
  later(srv);
  tg.record({ type: "contractComplete", contractId: STARTER, startedAt: 0, completedAt: srv.now }, srv.now);
  tg.record({ type: "contractAccept", contractId: "kryos_survey" }, srv.now);
  r = await tg.flush(tgT);
  assert.equal(r.rejected.length, 0);
  assert.equal(srv.state("acct").contracts.active?.id, "kryos_survey");
});

test("instant completion is refused (minimum time per objective, measured on the SERVER clock)", async () => {
  const { srv, tg, tgT } = await setup();
  tg.record({ type: "contractAccept", contractId: STARTER }, srv.now); // already active: harmless reject
  tg.record({ type: "contractComplete", contractId: STARTER, startedAt: 0, completedAt: 0 }, srv.now);
  // The starter contract's server-side start is time 0 in a fresh account; use a contract accepted "now" instead.
  const s0 = freshAuthoritative();
  s0.contracts = { active: { id: "kryos_survey", step: 0, progress: 0, spawned: false, startedAt: srv.now }, completed: [STARTER], repeats: {} };
  srv.accounts.set("acct2", s0);
  const l = new SyncLedger("d2");
  l.record({ type: "contractComplete", contractId: "kryos_survey", startedAt: srv.now, completedAt: srv.now }, srv.now);
  const r = await l.flush(srv.transport("acct2", "d2"));
  assert.equal(r.rejected[0].reason, "too-fast");
  const need = getContract("kryos_survey")!.objectives.length * MIN_SECONDS_PER_OBJECTIVE * 1000;
  srv.now += need + 1;
  l.record({ type: "contractComplete", contractId: "kryos_survey", startedAt: srv.now, completedAt: srv.now }, srv.now);
  assert.equal((await l.flush(srv.transport("acct2", "d2"))).accepted, 1);
  void tgT;
});

test("rules mismatch: an event from a build with different gameplay rules is rejected, never silently re-priced", () => {
  const l = new SyncLedger("old-build", "0000deadbeef00");
  const ev = l.record({ type: "farmClaim" }, NOW);
  const r = applyEvent(freshAuthoritative(), ev, { now: NOW });
  assert.equal(r.verdict.status === "rejected" && r.verdict.reason, "rules-mismatch");
});

test("tampering and reordering are detected by the hash chain", () => {
  const l = new SyncLedger("d");
  const e1 = l.record({ type: "farmClaim" }, NOW);
  const e2 = l.record({ type: "farmClaim" }, NOW);
  const tampered: SyncEvent = { ...e1, payload: { type: "minedReport", resource: "ferrite", amount: 1, seconds: 10 } };
  const t = applyEvent(freshAuthoritative(), tampered, { now: NOW });
  assert.equal(t.verdict.status === "rejected" && t.verdict.reason, "bad-hash");
  const out = applyEvent(freshAuthoritative(), e2, { now: NOW });
  assert.equal(out.verdict.status === "rejected" && out.verdict.reason, "bad-sequence", "event 2 before event 1");
  const bad = { ...e1, prev: "ffff", hash: eventHash("ffff", e1.payload, e1.id, e1.rules) };
  assert.equal((applyEvent(freshAuthoritative(), bad, { now: NOW }).verdict as { reason?: string }).reason, "bad-chain");
});

test("farming claims use SERVER time and a server-computed amount", async () => {
  const { srv, tg, tgT } = await setup();
  await mine(srv, tg, tgT, "ferrite", 80);
  tg.record({ type: "farmBuild", rig: "ferriteRig" }, srv.now);
  assert.equal((await tg.flush(tgT)).rejected.length, 0);
  // The client claims "from the future": its clock is ignored. Only server-elapsed time counts.
  srv.now += 3 * H;
  const lie = tg.record({ type: "farmClaim" }, srv.now + 1000 * H);
  assert.equal(lie.at > srv.now, true);
  const before = srv.state("acct").inventory.ferrite;
  await tg.flush(tgT);
  assert.equal(srv.state("acct").inventory.ferrite - before, 30 * 3, "exactly 3 hours at 30/h");
  tg.record({ type: "farmClaim" }, srv.now);
  const b2 = srv.state("acct").inventory.ferrite;
  await tg.flush(tgT);
  assert.equal(srv.state("acct").inventory.ferrite, b2, "claiming again immediately yields nothing");
  assert.ok(FARMING_RULES.rigs.length === 4);
});

test("mining reports are bounded by plausibility", async () => {
  const { srv, tg, tgT } = await setup();
  tg.record({ type: "minedReport", resource: "carbon", amount: 1_000_000, seconds: 10 }, srv.now);
  tg.record({ type: "minedReport", resource: "carbon", amount: 50, seconds: -3 }, srv.now);
  const r = await tg.flush(tgT);
  assert.equal(r.accepted, 0);
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ["bad-payload", "implausible"]);
  assert.ok(MINING_LIMITS.maxPerSecond > 0);
  assert.equal(srv.state("acct").inventory.carbon, 0);
});

test("two devices (Telegram + Android) on one account: each event counts once, conflicts resolve deterministically", async () => {
  const { srv, tg, an, tgT, anT } = await setup();
  await mine(srv, tg, tgT, "ferrite", 80);
  await mine(srv, tg, tgT, "lumenite", 40);
  await tg.flush(tgT);
  const ferriteBefore = srv.state("acct").inventory.ferrite;
  // Both devices go offline and each tries to spend the same ferrite on a ferrite-costing action.
  srv.online = false;
  tg.record({ type: "upgradePurchase", upgrade: "hull" }, srv.now); // 60 ferrite
  an.record({ type: "upgradePurchase", upgrade: "hull" }, srv.now); // would need 60 more
  assert.equal((await tg.flush(tgT)).offline, true);
  assert.equal(tg.pending.length, 1, "queue survives being offline");
  srv.online = true;
  const r1 = await an.flush(anT); // Android reconnects first → wins
  const r2 = await tg.flush(tgT);
  assert.equal(r1.accepted, 1);
  assert.equal(r2.accepted + r2.rejected.length, 1);
  assert.equal(r2.rejected[0]?.reason, "cannot-afford", "the second spend is refused, not double-charged");
  const s = srv.state("acct");
  assert.equal(s.upgrades.hull, 1);
  assert.equal(s.inventory.ferrite, ferriteBefore - 60);
  assert.equal(tg.pending.length + an.pending.length, 0);
});

test("offline outbox survives a restart and flushing it equals playing online", async () => {
  const a = await setup();
  const b = await setup();
  const actions: SyncPayload[] = [
    { type: "minedReport", resource: "ferrite", amount: 90, seconds: 30 },
    { type: "farmBuild", rig: "ferriteRig" },
    { type: "upgradePurchase", upgrade: "scanner" },
  ];
  // online
  for (const p of actions) {
    a.tg.record(p, a.srv.now);
    await a.tg.flush(a.tgT);
  }
  // offline then restart then flush
  for (const p of actions) b.tg.record(p, b.srv.now);
  const restored = SyncLedger.restore(JSON.parse(JSON.stringify(b.tg.toJSON())))!;
  await restored.flush(b.srv.transport("acct", "telegram-1"));
  const sa = a.srv.state("acct"), sb = b.srv.state("acct");
  assert.deepEqual(sb.inventory, sa.inventory);
  assert.deepEqual(sb.upgrades, sa.upgrades);
  assert.equal(sb.revision, sa.revision);
  assert.equal(SyncLedger.restore({ nonsense: true }), null);
});

test("a device cannot submit events as another device", async () => {
  const { srv, tgT } = await setup();
  const imposter = new SyncLedger("android-1");
  const ev = imposter.record({ type: "farmClaim" }, srv.now);
  const r = await tgT.submit([ev]); // authenticated as telegram-1
  assert.equal(r.verdicts[0].status, "rejected");
});

test("the protocol carries no financial vocabulary and the rules fingerprint is part of every event", () => {
  const src = JSON.stringify([...Object.keys(freshAuthoritative())]);
  assert.ok(!/coin|wallet|token|payment|usdt|btc/i.test(src));
  const ev = new SyncLedger("x").record({ type: "farmClaim" }, NOW);
  assert.equal(ev.rules, rulesFingerprint());
});
