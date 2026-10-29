import test from "node:test";
import assert from "node:assert/strict";
import { createHash, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, Failure } from "../server/store.mjs";
import { FocusPolicyStore, focusDigest } from "../server/focus-policy.mjs";
import { Upstream } from "../server/upstream.mjs";
import { createApp } from "../server/app.mjs";
import { validateOperators, verifyOperatorEnvironments } from "../server/operators.mjs";

const policy = { secondsPerFish: 60, dailyCapFish: 480, personalSharePercent: 0,
  goldenFishReward: 50, goldenMaxMembers: 5, goldenChancePpm: [4000, 12000, 24000, 40000] };
test("연결 모드는 운영자 2명과 각자의 서비스 환경 검증이 필요하다", async () => {
  const hash = `${"a".repeat(32)}:${"b".repeat(128)}`;
  const one = { "member-1": { passwordHash: hash, dataToken: "data-1", notificationToken: "notification-1" } };
  assert.throws(() => validateOperators(one, "connected"), /2명 이상/);
  const entries = validateOperators({ ...one,
    "member-2": { passwordHash: hash, dataToken: "data-2", notificationToken: "notification-2" } }, "connected");
  const checked = [];
  await verifyOperatorEnvironments({ verifyEnvironment: async (environment, actor, operator) => {
    checked.push({ environment, actor, token: operator.dataToken });
  } }, "prod", entries);
  assert.deepEqual(checked, [
    { environment: "prod", actor: "member-1", token: "data-1" },
    { environment: "prod", actor: "member-2", token: "data-2" },
  ]);
  await assert.rejects(verifyOperatorEnvironments({ verifyEnvironment: async (_environment, actor) => {
    if (actor === "member-2") throw new Error("두 번째 운영자 환경 불일치");
  } }, "prod", entries), /두 번째 운영자/);
});
function approve(store, item, actor) {
  const request = store.beginApproval(item.id, item.revision, actor);
  return store.transition(item.id, item.revision, actor, "approve",
    { ...request, approvedBy: actor, approvedAt: new Date().toISOString() });
}

test("정책 digest는 고정 필드 순서의 공백 없는 JSON SHA256이다", () => {
  const shuffled = { goldenChancePpm: policy.goldenChancePpm, goldenMaxMembers: 5,
    goldenFishReward: 50, personalSharePercent: 0, dailyCapFish: 480, secondsPerFish: 60 };
  const expected = createHash("sha256").update(JSON.stringify(policy)).digest("hex");
  assert.equal(focusDigest(shuffled), expected);
});

test("정책 변경은 승인 snapshot만 적용하며 수정 시 재승인하고 2인 분리한다", () => {
  const db = new Store(":memory:");
  const store = new FocusPolicyStore(db);
  let item = store.create({ policy, expectedRevision: 1 }, "member-1");
  assert.throws(() => store.transition(item.id, item.revision, "member-2", "publish"), /승인된/);
  item = store.transition(item.id, item.revision, "member-1", "review");
  const request = store.beginApproval(item.id, item.revision, "member-1");
  assert.throws(() => store.transition(item.id, item.revision, "member-1", "approve",
    { ...request, approvedBy: "member-2" }), /Data 승인 기록/);
  item = store.transition(item.id, item.revision, "member-1", "approve",
    { ...request, approvedBy: "member-1", approvedAt: new Date().toISOString() });
  assert.equal(item.approvedDigest, focusDigest(policy));
  assert.equal(item.approvalId, request.approvalId);
  assert.throws(() => store.transition(item.id, item.revision, "member-1", "publish"), /다른 운영자/);
  const approved = item;
  item = store.edit(item.id, { revision: item.revision, expectedRevision: 1,
    policy: { ...policy, goldenChancePpm: [5000, 12000, 24000, 40000] } }, "member-1");
  assert.equal(item.status, "draft");
  assert.equal(item.approvedDigest, undefined);
  assert.deepEqual(store.versions(item.id).map(version => version.revision), [2, 1]);
  assert.equal(store.versions(item.id)[1].digest, approved.approvedDigest);
  assert.throws(() => db.db.prepare("UPDATE focus_policy_snapshots SET digest='x' WHERE draft_id=? AND revision=1")
    .run(item.id), /immutable/);
  assert.throws(() => db.db.prepare("DELETE FROM focus_policy_snapshots WHERE draft_id=? AND revision=1")
    .run(item.id), /immutable/);
  assert.throws(() => store.transition(item.id, approved.revision, "member-2", "publish"), /다른 변경/);
  assert.throws(() => store.transition(item.id, item.revision, "member-2", "publish"), /승인된/);
  item = store.transition(item.id, item.revision, "member-1", "review");
  item = approve(store, item, "member-2");
  item = store.transition(item.id, item.revision, "member-3", "publish");
  assert.equal(item.publicationId.length, 36);
  item = store.finish(item.id, { revision: 2 });
  assert.equal(item.status, "published");
  assert.throws(() => store.edit(item.id, { revision: item.revision, policy }, "member-1"), /수정하거나 철회할 수/);
  db.close();
});

test("확률표 범위와 인원별 길이를 검증한다", () => {
  const db = new Store(":memory:");
  const store = new FocusPolicyStore(db);
  assert.throws(() => store.create({ expectedRevision: 1, policy: { ...policy, personalSharePercent: 10 } }, "member-1"), /0으로 고정/);
  assert.throws(() => store.create({ expectedRevision: 1, policy: { ...policy, secondsPerFish: 1 } }, "member-1"), /30~86400/);
  assert.throws(() => store.create({ expectedRevision: 1, policy: { ...policy, dailyCapFish: 961 } }, "member-1"), /0~960/);
  assert.throws(() => store.create({ expectedRevision: 1, policy: { ...policy, goldenChancePpm: [1] } }, "member-1"), /확률표/);
  assert.throws(() => store.create({ expectedRevision: 1, policy: { ...policy, goldenChancePpm: [1, 2, 3, 1_000_001] } }, "member-1"), /확률표/);
  db.close();
});

test("저장된 검토 수정본과 다른 문서는 승인할 수 없다", () => {
  const db = new Store(":memory:");
  const store = new FocusPolicyStore(db);
  let item = store.create({ policy, expectedRevision: 1 }, "member-1");
  item = store.transition(item.id, item.revision, "member-1", "review");
  store.save({ ...item, policy: { ...policy, goldenFishReward: 999 } });
  assert.throws(() => approve(store, item, "member-2"), /수정본이 다릅니다/);
  db.close();
});

test("응답 유실과 재시작은 같은 publicationId를 유지하고 최초 적용자만 재시도한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "backoffice-policy-"));
  const path = join(dir, "test.sqlite");
  let db = new Store(path);
  let store = new FocusPolicyStore(db);
  let item = store.create({ policy, expectedRevision: 1 }, "member-1");
  item = store.transition(item.id, item.revision, "member-1", "review");
  item = approve(store, item, "member-1");
  item = store.transition(item.id, item.revision, "member-2", "publish");
  const id = item.publicationId;
  db.close();
  db = new Store(path);
  store = new FocusPolicyStore(db);
  item = store.get(item.id);
  assert.equal(item.status, "uncertain");
  assert.throws(() => store.transition(item.id, item.revision, "member-3", "publish"), /최초 적용자/);
  item = store.transition(item.id, item.revision, "member-2", "publish");
  assert.equal(item.publicationId, id);
  item = store.finish(item.id, null, Object.assign(new Error("인증 거부"), { definite: true }));
  assert.equal(item.status, "uncertain");
  db.close();
  rmSync(dir, { recursive: true });
});

test("상류 정책 조회·발행은 환경 확인과 승인 payload, 운영자별 Data 토큰을 쓴다", async () => {
  const calls = [];
  const upstream = new Upstream({ mode: "connected", environment: "dev", expectedFcmProjectId: "gromo-dev",
    dataUrl: "http://data.internal", notificationUrl: "http://notification.internal",
    fetchImpl: async (url, options) => {
      calls.push({ path: url.pathname, method: options.method, headers: options.headers, body: options.body });
      if (url.pathname.endsWith("/environment")) return new Response(JSON.stringify({ environment: "dev", fcmProjectId: "gromo-dev" }));
      if (options.method === "GET") return new Response(JSON.stringify({ current: { revision: 1, policy }, history: [] }));
      if (url.pathname.includes("/approvals/") && options.method === "DELETE") return new Response(null, { status: 204 });
      if (url.pathname.includes("/approvals/")) return new Response(JSON.stringify({ approvalId: "approval-id", expectedRevision: 1,
        policy, approvedDigest: focusDigest(policy), approvedBy: "member-1", approvedAt: new Date().toISOString() }));
      return new Response(JSON.stringify({ publicationId: "id", revision: 2, policy }));
    } });
  const operator = { dataToken: "data-secret", notificationToken: "noti-secret" };
  const current = await upstream.focusPolicy("member-1", operator);
  assert.equal(current.current.revision, 1);
  await upstream.approveFocusPolicy({ approvalId: "approval-id", expectedRevision: 1,
    policy, approvedDigest: focusDigest(policy) }, "member-1", operator);
  assert.deepEqual(await upstream.revokeFocusPolicy("approval-id", "member-2", operator), { ok: true });
  await upstream.publishFocusPolicy({ id: "draft", revision: 2, publicationId: "publication-id", expectedRevision: 1,
    approvalId: "approval-id", approvedPolicy: policy, approvedDigest: focusDigest(policy), approvedBy: "member-1" }, "member-2", operator);
  const approval = calls.find(call => call.path === "/internal/admin/policies/focus/approvals/approval-id");
  assert.equal(approval.headers.Authorization, "Bearer data-secret");
  assert.equal(approval.headers["X-Console-Actor"], "member-1");
  assert.deepEqual(JSON.parse(approval.body), { expectedRevision: 1, policy, approvedDigest: focusDigest(policy) });
  const revoke = calls.find(call => call.path === "/internal/admin/policies/focus/approvals/approval-id" && call.method === "DELETE");
  assert.equal(revoke.headers.Authorization, "Bearer data-secret");
  assert.equal(revoke.headers["X-Console-Actor"], "member-2");
  assert.equal(revoke.body, undefined);
  const put = calls.find(call => call.method === "PUT");
  assert.equal(put.path, "/internal/admin/policies/focus/publications/publication-id");
  assert.equal(put.headers.Authorization, "Bearer data-secret");
  assert.equal(put.headers["X-Console-Actor"], "member-2");
  assert.equal(put.headers["Idempotency-Key"], "draft:2");
  assert.deepEqual(JSON.parse(put.body), { approvalId: "approval-id", expectedRevision: 1, policy, approvedDigest: focusDigest(policy) });
  assert.equal(calls.filter(call => call.path.endsWith("/environment")).length, 8);
});

test("Data revision 충돌은 확정 실패로 분류해 새 수정본·재승인이 가능하다", async () => {
  const db = new Store(":memory:");
  const store = new FocusPolicyStore(db);
  let item = store.create({ policy, expectedRevision: 1 }, "member-1");
  item = store.transition(item.id, item.revision, "member-1", "review");
  item = approve(store, item, "member-1");
  item = store.transition(item.id, item.revision, "member-2", "publish");
  const upstream = new Upstream({ mode: "connected", environment: "dev", expectedFcmProjectId: "gromo-dev",
    dataUrl: "http://data.internal", notificationUrl: "http://notification.internal",
    fetchImpl: async (url) => url.pathname.endsWith("/environment")
      ? new Response(JSON.stringify({ environment: "dev", fcmProjectId: "gromo-dev" }))
      : new Response(JSON.stringify({ error: "REVISION_CONFLICT" }), { status: 409 }) });
  let error;
  try { await upstream.publishFocusPolicy(item, "member-2", { dataToken: "data", notificationToken: "noti" }); }
  catch (cause) { error = cause; }
  assert.equal(error.status, 409);
  assert.equal(error.definite, true);
  item = store.finish(item.id, null, error);
  assert.equal(item.status, "failed");
  item = store.edit(item.id, { revision: item.revision, expectedRevision: 2, policy }, "member-1");
  assert.equal(item.status, "draft");
  assert.equal(item.expectedRevision, 2);
  db.close();
});

test("정책 HTTP 흐름은 로그인·CSRF와 승인자/적용자 분리를 지킨다", async t => {
  const db = new Store(":memory:");
  const origin = "http://127.0.0.1:4310";
  const salt = "ac".repeat(16);
  const revocations = [];
  const revoked = new Set();
  let loseRevokeResponse = false;
  const operators = Object.fromEntries(["member-1", "member-2"].map(actor =>
    [actor, { passwordHash: `${salt}:${scryptSync(actor, salt, 64).toString("hex")}` }]));
  const app = createApp({ store: db, upstream: {
    focusPolicy: async () => ({ current: { revision: 1, policy, publishedAt: null }, history: [] }),
    approveFocusPolicy: async (request, actor) => ({ ...request, approvedBy: actor, approvedAt: new Date().toISOString() }),
    revokeFocusPolicy: async (approvalId, actor) => {
      revocations.push({ approvalId, actor });
      revoked.add(approvalId);
      if (loseRevokeResponse) {
        loseRevokeResponse = false;
        throw new Failure(502, "Data 취소 응답 유실");
      }
      return { ok: true };
    },
    publishFocusPolicy: async item => ({ publicationId: item.publicationId, revision: 2, policy: item.approvedPolicy, local: true }),
  }, operators, origin, mode: "connected", environment: "dev" });
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  async function login(actor) {
    const response = await fetch(base + "/api/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ actor, password: actor }) });
    assert.equal(response.status, 200);
    return { Cookie: response.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": (await response.json()).csrfToken };
  }
  const one = await login("member-1"), two = await login("member-2");
  async function post(path, body, auth, method = "POST") {
    return fetch(base + path, { method, headers: { Origin: origin, "Content-Type": "application/json", ...auth }, body: JSON.stringify(body) });
  }
  const current = await fetch(base + "/api/policies/focus", { headers: one });
  assert.equal((await current.json()).current.revision, 1);
  assert.equal((await post("/api/policies/focus/drafts", { expectedRevision: 1, policy },
    { Cookie: one.Cookie })).status, 403);
  let response = await post("/api/policies/focus/drafts", { expectedRevision: 1, policy }, one);
  assert.equal(response.status, 201);
  let item = await response.json();
  for (const action of ["review", "approve"]) {
    response = await post(`/api/policies/focus/drafts/${item.id}/${action}`, { revision: item.revision }, one);
    assert.equal(response.status, 200);
    item = await response.json();
  }
  response = await post(`/api/policies/focus/drafts/${item.id}/publish`, { revision: item.revision }, one);
  assert.equal(response.status, 409);
  response = await post(`/api/policies/focus/drafts/${item.id}/publish`, { revision: item.revision }, two);
  assert.equal(response.status, 200);
  item = await response.json();
  assert.equal(item.status, "published");
  assert.equal(item.receipt.local, true);
  const versions = await fetch(`${base}/api/policies/focus/drafts/${item.id}/versions`, { headers: one });
  assert.equal((await versions.json()).items[0].digest, focusDigest(policy));

  response = await post("/api/policies/focus/drafts", { expectedRevision: 1, policy }, one);
  let change = await response.json();
  for (const action of ["review", "approve"]) {
    response = await post(`/api/policies/focus/drafts/${change.id}/${action}`, { revision: change.revision }, one);
    assert.equal(response.status, 200);
    change = await response.json();
  }
  loseRevokeResponse = true;
  response = await post(`/api/policies/focus/drafts/${change.id}`, { revision: change.revision,
    expectedRevision: 1, policy: { ...policy, goldenFishReward: 10 } }, two, "PATCH");
  assert.equal(response.status, 502);
  assert.equal(db.db.prepare("SELECT document FROM focus_policy_drafts WHERE id=?").get(change.id).document,
    JSON.stringify(change));
  assert.equal((await (await fetch(`${base}/api/policies/focus/drafts/${change.id}`, { headers: one })).json()).status, "approved");
  response = await post(`/api/policies/focus/drafts/${change.id}`, { revision: change.revision,
    expectedRevision: 1, policy: { ...policy, goldenFishReward: 1001 } }, two, "PATCH");
  assert.equal(response.status, 400);
  assert.equal(revocations.length, 1);
  response = await post(`/api/policies/focus/drafts/${change.id}`, { revision: change.revision,
    expectedRevision: 1, policy: { ...policy, goldenFishReward: 10 } }, two, "PATCH");
  assert.equal(response.status, 200);
  change = await response.json();
  assert.equal(change.status, "draft");
  assert.equal(change.approvalId, undefined);
  assert.equal(revocations.at(-1).approvalId.length, 36);
  assert.equal(revoked.size, 1);
  response = await post(`/api/policies/focus/drafts/${change.id}/cancel`, { revision: change.revision }, one);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "cancelled");
  assert.equal(revocations.length, 2);

  response = await post("/api/policies/focus/drafts", { expectedRevision: 1, policy }, one);
  let withdrawn = await response.json();
  for (const action of ["review", "approve"]) {
    response = await post(`/api/policies/focus/drafts/${withdrawn.id}/${action}`, { revision: withdrawn.revision }, one);
    withdrawn = await response.json();
  }
  loseRevokeResponse = true;
  response = await post(`/api/policies/focus/drafts/${withdrawn.id}/cancel`, { revision: withdrawn.revision }, two);
  assert.equal(response.status, 502);
  assert.equal((await (await fetch(`${base}/api/policies/focus/drafts/${withdrawn.id}`, { headers: one })).json()).status, "approved");
  response = await post(`/api/policies/focus/drafts/${withdrawn.id}/cancel`, { revision: withdrawn.revision }, two);
  assert.equal(response.status, 200);
  withdrawn = await response.json();
  assert.equal(withdrawn.status, "cancelled");
  assert.equal(revocations.length, 4);
  assert.equal(revoked.size, 2);
  assert.equal(revocations.at(-1).approvalId, withdrawn.approvalId);
  assert.equal(revocations.at(-1).actor, "member-2");
});

test("응답 유실 뒤 409는 Data 발행 원장과 현재 revision으로 정산한다", async t => {
  const db = new Store(":memory:");
  const origin = "http://127.0.0.1:4311";
  const salt = "ad".repeat(16);
  const operators = Object.fromEntries(["member-1", "member-2"].map(actor =>
    [actor, { passwordHash: `${salt}:${scryptSync(actor, salt, 64).toString("hex")}` }]));
  let currentRevision = 1;
  const history = [], attempts = new Map();
  const app = createApp({ store: db, upstream: {
    focusPolicy: async () => ({ current: { revision: currentRevision, policy, publishedAt: null }, history }),
    approveFocusPolicy: async (request, actor) => ({ ...request, approvedBy: actor, approvedAt: new Date().toISOString() }),
    publishFocusPolicy: async item => {
      const count = (attempts.get(item.id) ?? 0) + 1;
      attempts.set(item.id, count);
      if (count === 1) throw new Failure(502, "응답 유실");
      throw Object.assign(new Failure(409, "revision 충돌"), { definite: true });
    },
  }, operators, origin, mode: "connected", environment: "dev" });
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  async function login(actor) {
    const response = await fetch(`${base}/api/login`, { method: "POST", headers: { Origin: origin,
      "Content-Type": "application/json" }, body: JSON.stringify({ actor, password: actor }) });
    return { Cookie: response.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": (await response.json()).csrfToken };
  }
  const one = await login("member-1"), two = await login("member-2");
  async function post(path, body, auth) {
    const response = await fetch(base + path, { method: "POST", headers: { Origin: origin,
      "Content-Type": "application/json", ...auth }, body: JSON.stringify(body) });
    assert.ok([200, 201].includes(response.status));
    return response.json();
  }
  async function approvedDraft(expectedRevision) {
    let item = await post("/api/policies/focus/drafts", { expectedRevision, policy }, one);
    for (const action of ["review", "approve"])
      item = await post(`/api/policies/focus/drafts/${item.id}/${action}`, { revision: item.revision }, one);
    return item;
  }
  let item = await approvedDraft(1);
  item = await post(`/api/policies/focus/drafts/${item.id}/publish`, { revision: item.revision }, two);
  assert.equal(item.status, "uncertain");
  history.push({ publicationId: item.publicationId, revision: 2, previousRevision: 1,
    policy, approvedDigest: item.approvedDigest, actor: "member-2", approvedBy: "member-1", publishedAt: new Date().toISOString() });
  currentRevision = 2;
  item = await post(`/api/policies/focus/drafts/${item.id}/publish`, { revision: item.revision }, two);
  assert.equal(item.status, "published");
  assert.equal(item.receipt.publicationId, item.publicationId);

  item = await approvedDraft(2);
  item = await post(`/api/policies/focus/drafts/${item.id}/publish`, { revision: item.revision }, two);
  assert.equal(item.status, "uncertain");
  currentRevision = 3;
  item = await post(`/api/policies/focus/drafts/${item.id}/publish`, { revision: item.revision }, two);
  assert.equal(item.status, "failed");
});

test("승인 전 저장한 ID와 운영자는 재시작 뒤에도 유지되고 확정 거부로 잠금이 풀리지 않는다", t => {
  const dir = mkdtempSync(join(tmpdir(), "focus-approval-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "state.sqlite");
  let db = new Store(path), store = new FocusPolicyStore(db);
  let item = store.create({ policy, expectedRevision: 1 }, "member-1");
  item = store.transition(item.id, item.revision, "member-1", "review");
  const request = store.beginApproval(item.id, item.revision, "member-1");
  assert.equal(store.get(item.id).status, "approving");
  assert.throws(() => store.changeRequest(item.id, item.revision), /수정하거나 철회/);
  db.close();
  db = new Store(path); store = new FocusPolicyStore(db);
  t.after(() => db.close());
  item = store.get(item.id);
  assert.equal(item.status, "approval_uncertain");
  assert.equal(item.approvalId, request.approvalId);
  assert.equal(item.approvalActor, "member-1");
  assert.throws(() => store.beginApproval(item.id, item.revision, "member-2"), /최초 승인자/);
  assert.deepEqual(store.beginApproval(item.id, item.revision, "member-1"), request);
  item = store.failApproval(item.id, Object.assign(new Failure(409, "재시도 거부"), { definite: true }));
  assert.equal(item.status, "approval_uncertain");
  assert.equal(store.changeRequest(item.id, item.revision), request.approvalId);
  assert.throws(() => store.transition(item.id, item.revision, "member-2", "publish"), /승인된/);
  item = approve(store, item, "member-1");
  assert.equal(item.status, "approved");
  assert.equal(item.approvalId, request.approvalId);
  assert.equal(item.error, undefined);
});

test("첫 승인 요청이 확정 거부되면 검토 상태로 돌아가 새 수정본을 만들 수 있다", t => {
  const db = new Store(":memory:"); t.after(() => db.close());
  const store = new FocusPolicyStore(db);
  let item = store.create({ policy, expectedRevision: 1 }, "member-1");
  item = store.transition(item.id, item.revision, "member-1", "review");
  store.beginApproval(item.id, item.revision, "member-1");
  item = store.failApproval(item.id, Object.assign(new Failure(409, "정책 변경"), { definite: true }));
  assert.equal(item.status, "review");
  assert.equal(store.changeRequest(item.id, item.revision), null);
  item = store.edit(item.id, { revision: item.revision, expectedRevision: 2, policy }, "member-1");
  assert.equal(item.status, "draft");
  assert.equal(item.revision, 2);
});

test("Data 승인 성공 후 응답 유실은 같은 ID 재시도 또는 서버 취소 뒤에만 수정·철회된다", async t => {
  const db = new Store(":memory:"), store = new FocusPolicyStore(db);
  const approvals = new Map(), revoked = new Set();
  const origin = "http://127.0.0.1:4310", salt = "approval-loss";
  let denyRevoke = false;
  const upstream = {
    approveFocusPolicy: async (request, actor) => {
      const saved = store.list().find(item => item.approvalId === request.approvalId);
      assert.equal(saved.status, "approving");
      assert.equal(saved.approvalActor, actor);
      if (approvals.has(request.approvalId)) return approvals.get(request.approvalId);
      const receipt = { ...request, approvedBy: actor, approvedAt: new Date().toISOString() };
      approvals.set(request.approvalId, receipt);
      throw new Failure(502, "Data 승인 후 응답 유실");
    },
    revokeFocusPolicy: async id => {
      assert.ok(approvals.has(id));
      if (denyRevoke) throw new Failure(502, "승인 취소 미확인");
      revoked.add(id);
      return { ok: true };
    },
  };
  const operators = Object.fromEntries(["member-1", "member-2"].map(actor =>
    [actor, { passwordHash: `${salt}:${scryptSync(actor, salt, 64).toString("hex")}` }]));
  const app = createApp({ store: db, upstream, origin, operators, mode: "connected", environment: "dev" });
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const auth = {};
  for (const actor of Object.keys(operators)) {
    const response = await fetch(base + "/api/login", { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ actor, password: actor }) });
    assert.equal(response.status, 200);
    auth[actor] = { Cookie: response.headers.get("set-cookie").split(";")[0], "X-CSRF-Token": (await response.json()).csrfToken };
  }
  const call = (item, action, actor = "member-1", extra = {}, method = "POST") => fetch(
    `${base}/api/policies/focus/drafts/${item.id}${action ? '/' + action : ''}`,
    { method, headers: { Origin: origin, "Content-Type": "application/json", ...auth[actor] },
      body: JSON.stringify({ revision: item.revision, ...extra }) });
  for (const action of ["retry", "cancel", "edit"]) {
    let item = store.create({ policy, expectedRevision: 1 }, "member-1");
    item = store.transition(item.id, item.revision, "member-1", "review");
    let response = await call(item, "approve");
    assert.equal(response.status, 200);
    item = await response.json();
    assert.equal(item.status, "approval_uncertain");
    assert.ok(approvals.has(item.approvalId));
    assert.equal((await call(item, "approve", "member-2")).status, 409);
    assert.equal((await call(item, "publish", "member-2")).status, 409);
    if (action === "retry") {
      response = await call(item, "approve");
      assert.equal(response.status, 200);
      const approved = await response.json();
      assert.equal(approved.status, "approved");
      assert.equal(approved.approvalId, item.approvalId);
    } else {
      const invoke = () => action === "cancel" ? call(item, "cancel", "member-2")
        : call(item, "", "member-2", { expectedRevision: 1, policy: { ...policy, goldenFishReward: 20 } }, "PATCH");
      denyRevoke = true;
      assert.equal((await invoke()).status, 502);
      assert.equal(store.get(item.id).status, "approval_uncertain");
      assert.equal(revoked.has(item.approvalId), false);
      denyRevoke = false;
      response = await invoke();
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, action === "cancel" ? "cancelled" : "draft");
      assert.equal(revoked.has(item.approvalId), true);
    }
  }
  assert.equal(approvals.size, 3);
});
