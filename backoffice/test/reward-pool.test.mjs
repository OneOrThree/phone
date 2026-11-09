import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import contract from "../server/contract.json" with { type: "json" };
import { Store, Failure } from "../server/store.mjs";
import { Upstream } from "../server/upstream.mjs";
import { RewardPoolStore, poolDigest } from "../server/reward-pool.mjs";
import { LocalCustomizationData } from "../server/local-customization.mjs";
import { startApp } from "./customization-harness.mjs";

const POOL = ["cust.head.bun", "cust.head.mandarin", "cust.neck.bell"];
const lost = message => new Failure(502, message);

function fakeData() {
  const state = { calls: [], loseApprove: 0, losePublish: 0, revokeFails: 0, history: [], revision: 1, conflict: false };
  const upstream = {
    customizationItems: async () => ({ pool: { revision: state.revision, categoryWeights: {}, productIds: POOL }, items: [] }),
    rewardPool: async () => ({ current: { revision: state.revision, productIds: POOL, publishedAt: null }, history: state.history }),
    approveRewardPool: async (request, actor) => {
      state.calls.push(["approve", request.approvalId, actor]);
      const approval = { ...request, approvedBy: actor, approvedAt: new Date().toISOString() };
      if (state.loseApprove-- > 0) throw lost("승인 응답 유실");
      return approval;
    },
    revokeRewardPool: async (approvalId, actor) => {
      state.calls.push(["revoke", approvalId, actor]);
      if (state.revokeFails-- > 0) throw lost("취소 응답 유실");
      return { ok: true };
    },
    publishRewardPool: async (item, actor) => {
      state.calls.push(["publish", item.publicationId, actor, item.approvedContent.productIds]);
      if (state.losePublish-- > 0) throw lost("발행 응답 유실");
      if (state.conflict) throw Object.assign(new Failure(409, "revision 충돌"), { definite: true });
      return { publicationId: item.publicationId, approvalId: item.approvalId, revision: 2, previousRevision: 1,
        productIds: item.approvedContent.productIds, approvedDigest: item.approvedDigest, actor, approvedBy: item.approvedBy };
    },
  };
  return { upstream, state };
}
const body = { productIds: POOL, expectedRevision: 1 };
async function approved(app, one, input = body) {
  let item = (await app.send("/api/customization/pool/drafts", input, one)).body;
  item = (await app.send(`/api/customization/pool/drafts/${item.id}/review`, { revision: item.revision }, one)).body;
  return (await app.send(`/api/customization/pool/drafts/${item.id}/approve`, { revision: item.revision }, one)).body;
}
const act = (app, item, action, auth) => app.send(`/api/customization/pool/drafts/${item.id}/${action}`, { revision: item.revision }, auth);

test("풀 HTTP 흐름: 승인자는 발행할 수 없고 다른 운영자가 발행하면 published", async t => {
  const { upstream, state } = fakeData();
  const app = await startApp(t, upstream);
  const one = await app.login("member-1"), two = await app.login("member-2");
  let item = await approved(app, one, { productIds: [...POOL].reverse(), expectedRevision: 1 });
  assert.equal(item.status, "approved");
  assert.deepEqual(item.productIds, POOL);
  assert.equal(item.approvedDigest, poolDigest(POOL));
  const same = await act(app, item, "publish", one);
  assert.equal(same.status, 409);
  assert.match(same.body.error, /다른 운영자/);
  assert.equal(state.calls.filter(call => call[0] === "publish").length, 0);
  const done = await act(app, item, "publish", two);
  assert.equal(done.status, 200);
  assert.equal(done.body.status, "published");
  assert.equal(done.body.receipt.revision, 2);
});

test("승인 응답 유실은 approval_uncertain 이고 최초 승인자만 같은 approvalId 로 재시도한다", async t => {
  const { upstream, state } = fakeData();
  const app = await startApp(t, upstream);
  const one = await app.login("member-1"), two = await app.login("member-2");
  let item = (await app.send("/api/customization/pool/drafts", body, one)).body;
  item = (await act(app, item, "review", one)).body;
  state.loseApprove = 1;
  item = (await act(app, item, "approve", one)).body;
  assert.equal(item.status, "approval_uncertain");
  assert.equal((await act(app, item, "approve", two)).status, 409);
  const retry = (await act(app, item, "approve", one)).body;
  assert.equal(retry.status, "approved");
  assert.equal(retry.approvalId, item.approvalId);
  assert.deepEqual(state.calls.filter(call => call[0] === "approve").map(call => call[1]), [item.approvalId, item.approvalId]);
});

test("발행 응답 유실은 uncertain 이고 다른 운영자는 재시도할 수 없으며 같은 publicationId 를 쓴다", async t => {
  const { upstream, state } = fakeData();
  const app = await startApp(t, upstream);
  const one = await app.login("member-1"), two = await app.login("member-2"), three = await app.login("member-3");
  let item = await approved(app, one);
  state.losePublish = 1;
  item = (await act(app, item, "publish", two)).body;
  assert.equal(item.status, "uncertain");
  assert.equal((await act(app, item, "publish", three)).status, 409);
  const retry = (await act(app, item, "publish", two)).body;
  assert.equal(retry.status, "published");
  assert.equal(retry.publicationId, item.publicationId);
  assert.deepEqual(state.calls.filter(call => call[0] === "publish").map(call => call[1]), [item.publicationId, item.publicationId]);
});

test("응답 유실 뒤 409 는 Data 발행 원장으로 정산한다", async t => {
  const { upstream, state } = fakeData();
  const app = await startApp(t, upstream);
  const one = await app.login("member-1"), two = await app.login("member-2");
  let item = await approved(app, one);
  state.losePublish = 1;
  item = (await act(app, item, "publish", two)).body;
  state.conflict = true;
  state.revision = 2;
  state.history.push({ publicationId: item.publicationId, approvedDigest: item.approvedDigest, productIds: POOL, revision: 2 });
  const settled = (await act(app, item, "publish", two)).body;
  assert.equal(settled.status, "published");
  assert.equal(settled.receipt.revision, 2);
});

test("수정하면 Data 승인 취소를 먼저 부르고, 취소가 실패하면 수정도 실패한다", async t => {
  const { upstream, state } = fakeData();
  const app = await startApp(t, upstream);
  const one = await app.login("member-1");
  const item = await approved(app, one);
  const edit = { productIds: ["cust.head.bun", "cust.neck.bell"], expectedRevision: 1, revision: item.revision };
  state.revokeFails = 1;
  assert.equal((await app.send(`/api/customization/pool/drafts/${item.id}`, edit, one, "PATCH")).status, 502);
  const unchanged = (await app.get(`/api/customization/pool/drafts/${item.id}`, one)).body;
  assert.equal(unchanged.status, "approved");
  assert.deepEqual(unchanged.productIds, POOL);
  const edited = await app.send(`/api/customization/pool/drafts/${item.id}`, edit, one, "PATCH");
  assert.equal(edited.status, 200);
  assert.equal(edited.body.status, "draft");
  assert.equal(edited.body.approvalId, undefined);
  assert.deepEqual(state.calls.map(call => call[0]).slice(-2), ["revoke", "revoke"]);
  assert.equal(state.calls.at(-1)[1], item.approvalId);
});

test("재시작하면 approving 은 approval_uncertain, publishing 은 uncertain 이 되고 ID 와 운영자를 유지한다", t => {
  const dir = mkdtempSync(join(tmpdir(), "pool-restart-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "state.sqlite");
  let db = new Store(path), pools = new RewardPoolStore(db);
  const review = () => {
    const item = pools.create(body, "member-1");
    return pools.transition(item.id, item.revision, "member-1", "review");
  };
  const first = review();
  const request = pools.beginApproval(first.id, first.revision, "member-1");
  const second = review();
  const secondRequest = pools.beginApproval(second.id, second.revision, "member-1");
  pools.transition(second.id, second.revision, "member-1", "approve", { ...secondRequest, approvedBy: "member-1", approvedAt: "2026-11-09T00:00:00.000Z" });
  const running = pools.transition(second.id, second.revision, "member-2", "run");
  assert.equal(running.status, "publishing");
  db.close();
  db = new Store(path); pools = new RewardPoolStore(db);
  t.after(() => db.close());
  const recoveredApproval = pools.get(first.id);
  assert.equal(recoveredApproval.status, "approval_uncertain");
  assert.equal(recoveredApproval.approvalId, request.approvalId);
  assert.equal(recoveredApproval.approvalActor, "member-1");
  const recovered = pools.get(second.id);
  assert.equal(recovered.status, "uncertain");
  assert.throws(() => pools.transition(recovered.id, recovered.revision, "member-3", "run"), /최초/);
  assert.equal(pools.transition(recovered.id, recovered.revision, "member-2", "run").publicationId, running.publicationId);
  assert.throws(() => db.db.prepare("UPDATE reward_pool_snapshots SET digest='x'").run(), /immutable/);
  assert.throws(() => db.db.prepare("DELETE FROM reward_pool_snapshots").run(), /immutable/);
});

test("상류 풀 요청의 경로·메서드·Idempotency-Key·본문이 계약과 같다", async () => {
  const calls = [];
  const identity = service => ({ environment: "prod", fcmProjectId: "catus-prod", contractVersion: contract.contractVersion, capabilities: contract[service] });
  const upstream = new Upstream({ mode: "connected", environment: "prod", expectedFcmProjectId: "catus-prod",
    dataUrl: "https://data.internal", notificationUrl: "https://notification.internal",
    fetchImpl: async (url, options) => {
      if (url.pathname.endsWith("/environment")) return Response.json(identity(url.hostname.startsWith("data") ? "data" : "notification"));
      calls.push({ path: url.pathname, method: options.method, headers: options.headers, body: options.body });
      return options.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({});
    } });
  const operator = { dataToken: "data-secret", notificationToken: "noti-secret" };
  await upstream.rewardPool("member-1", operator);
  await upstream.approveRewardPool({ approvalId: "ap1", expectedRevision: 1, productIds: POOL, approvedDigest: poolDigest(POOL) }, "member-1", operator);
  await upstream.revokeRewardPool("ap1", "member-2", operator);
  await upstream.publishRewardPool({ id: "draft", revision: 2, publicationId: "pub1", approvalId: "ap1", expectedRevision: 1,
    approvedContent: { productIds: POOL }, approvedDigest: poolDigest(POOL) }, "member-2", operator);
  assert.deepEqual(calls.map(call => [call.method, call.path, call.headers["Idempotency-Key"]]), [
    ["GET", "/internal/admin/customization/reward-pool", undefined],
    ["POST", "/internal/admin/customization/reward-pool/approvals/ap1", "ap1"],
    ["DELETE", "/internal/admin/customization/reward-pool/approvals/ap1", undefined],
    ["PUT", "/internal/admin/customization/reward-pool/publications/pub1", "draft:2"],
  ]);
  assert.deepEqual(JSON.parse(calls[1].body), { expectedRevision: 1, productIds: POOL, approvedDigest: poolDigest(POOL) });
  assert.deepEqual(JSON.parse(calls[3].body), { approvalId: "ap1", expectedRevision: 1, productIds: POOL, approvedDigest: poolDigest(POOL) });
  assert.ok(calls.every(call => call.headers.Authorization === "Bearer data-secret" && call.headers["X-Backoffice-Environment"] === "prod"));
});

test("로컬 모드 Data 흉내: 등급 칸 검증 400, 2인 규칙 409, 오래된 revision 409, 멱등 재발행", async t => {
  const db = new Store(":memory:");
  const upstream = new Upstream({ mode: "local", localData: new LocalCustomizationData(db) });
  const app = await startApp(t, upstream, { db, mode: "local" });
  const one = await app.login("member-1"), two = await app.login("member-2");
  const items = (await app.get("/api/customization/items", one)).body;
  const pool = items.pool.productIds;
  const without = pool.filter(id => id !== "cust.head.halo");
  let item = (await app.send("/api/customization/pool/drafts", { productIds: without, expectedRevision: items.pool.revision }, one)).body;
  item = (await act(app, item, "review", one)).body;
  const empty = await act(app, item, "approve", one);
  assert.equal(empty.body.status, "review");
  assert.match(empty.body.error, /거부했습니다|등급|legendary/);
  item = await approved(app, one, { productIds: [...pool, "cust.neck.pearl"], expectedRevision: items.pool.revision });
  assert.equal(item.status, "approved");
  assert.equal((await act(app, item, "publish", one)).status, 409);
  const published = (await act(app, item, "publish", two)).body;
  assert.equal(published.status, "published");
  assert.equal((await app.get("/api/customization/pool", one)).body.current.revision, items.pool.revision + 1);
  assert.equal((await app.get("/api/customization/items", one)).body.items.find(value => value.productId === "cust.neck.pearl").inPool, true);
  const stale = await approved(app, one, { productIds: pool, expectedRevision: items.pool.revision });
  assert.equal(stale.status, "review");
  assert.equal(stale.error !== undefined, true);
  const replay = upstream.localData.publishPool(published.publicationId, { approvalId: item.approvalId, expectedRevision: item.expectedRevision,
    productIds: item.approvedContent.productIds, approvedDigest: item.approvedDigest }, "member-2");
  assert.equal(replay.revision, published.receipt.revision);
});
