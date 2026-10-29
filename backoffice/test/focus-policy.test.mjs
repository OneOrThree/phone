import test from "node:test";
import assert from "node:assert/strict";
import { createHash, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { FocusPolicyStore, focusDigest } from "../server/focus-policy.mjs";
import { Upstream } from "../server/upstream.mjs";
import { createApp } from "../server/app.mjs";

const policy = { secondsPerFish: 60, dailyCapFish: 480, personalSharePercent: 0,
  goldenFishReward: 50, goldenMaxMembers: 5, goldenChancePpm: [4000, 12000, 24000, 40000] };

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
  item = store.transition(item.id, item.revision, "member-1", "approve");
  assert.equal(item.approvedDigest, focusDigest(policy));
  assert.throws(() => store.transition(item.id, item.revision, "member-1", "publish"), /다른 운영자/);
  const approved = item;
  item = store.edit(item.id, { revision: item.revision, expectedRevision: 1,
    policy: { ...policy, goldenChancePpm: [5000, 12000, 24000, 40000] } }, "member-1");
  assert.equal(item.status, "draft");
  assert.equal(item.approvedDigest, undefined);
  assert.deepEqual(store.versions(item.id).map(version => version.revision), [2, 1]);
  assert.equal(store.versions(item.id)[1].digest, approved.approvedDigest);
  assert.throws(() => store.transition(item.id, approved.revision, "member-2", "publish"), /다른 변경/);
  assert.throws(() => store.transition(item.id, item.revision, "member-2", "publish"), /승인된/);
  item = store.transition(item.id, item.revision, "member-1", "review");
  item = store.transition(item.id, item.revision, "member-2", "approve");
  item = store.transition(item.id, item.revision, "member-3", "publish");
  assert.equal(item.publicationId.length, 36);
  item = store.finish(item.id, { revision: 2 });
  assert.equal(item.status, "published");
  assert.throws(() => store.edit(item.id, { revision: item.revision, policy }, "member-1"), /수정할 수/);
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

test("응답 유실과 재시작은 같은 publicationId를 유지하고 최초 적용자만 재시도한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "backoffice-policy-"));
  const path = join(dir, "test.sqlite");
  let db = new Store(path);
  let store = new FocusPolicyStore(db);
  let item = store.create({ policy, expectedRevision: 1 }, "member-1");
  item = store.transition(item.id, item.revision, "member-1", "review");
  item = store.transition(item.id, item.revision, "member-1", "approve");
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
      return new Response(JSON.stringify({ publicationId: "id", revision: 2, policy }));
    } });
  const operator = { dataToken: "data-secret", notificationToken: "noti-secret" };
  const current = await upstream.focusPolicy("member-1", operator);
  assert.equal(current.current.revision, 1);
  await upstream.publishFocusPolicy({ id: "draft", revision: 2, publicationId: "publication-id", expectedRevision: 1,
    approvedPolicy: policy, approvedDigest: focusDigest(policy), approvedBy: "member-1" }, "member-2", operator);
  const put = calls.find(call => call.method === "PUT");
  assert.equal(put.path, "/internal/admin/policies/focus/publications/publication-id");
  assert.equal(put.headers.Authorization, "Bearer data-secret");
  assert.equal(put.headers["X-Console-Actor"], "member-2");
  assert.equal(put.headers["Idempotency-Key"], "draft:2");
  assert.deepEqual(JSON.parse(put.body), { expectedRevision: 1, policy, approvedDigest: focusDigest(policy), approvedBy: "member-1" });
  assert.equal(calls.filter(call => call.path.endsWith("/environment")).length, 4);
});

test("정책 HTTP 흐름은 로그인·CSRF와 승인자/적용자 분리를 지킨다", async t => {
  const db = new Store(":memory:");
  const origin = "http://127.0.0.1:4310";
  const salt = "ac".repeat(16);
  const operators = Object.fromEntries(["member-1", "member-2"].map(actor =>
    [actor, { passwordHash: `${salt}:${scryptSync(actor, salt, 64).toString("hex")}` }]));
  const app = createApp({ store: db, upstream: {
    focusPolicy: async () => ({ current: { revision: 1, policy, publishedAt: null }, history: [] }),
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
});
