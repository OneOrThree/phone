import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import contract from "../server/contract.json" with { type: "json" };
import { Store, Failure } from "../server/store.mjs";
import { Upstream } from "../server/upstream.mjs";
import { CustomizationGrantStore, grantDigest, grantCanonical } from "../server/customization-grant.mjs";
import { poolDigest } from "../server/reward-pool.mjs";
import { LocalCustomizationData } from "../server/local-customization.mjs";
import { resolveStaticOrigin } from "../server/static-origin.mjs";
import { startApp } from "./customization-harness.mjs";

const U1 = "0192f5a0-0000-7000-8000-000000000001", U2 = "0192f5a0-0000-7000-8000-000000000002";
const USERS = { 귤이: U1, 고등어: U2 };
const lost = message => new Failure(502, message);

// 스텁 Data: 계약 §3 의 응답 모양만 흉내 낸다(규칙은 Data 쪽 시험이 맡는다).
function fakeData({ running = 0 } = {}) {
  const state = { calls: [], approvals: new Map(), executions: new Map(), loseApprove: 0, loseExecute: 0, revokeFails: 0, running, runs: 0 };
  const upstream = {
    customizationItems: async () => ({ pool: { revision: 1, categoryWeights: {}, productIds: [] }, items: [
      { productId: "cust.head.mandarin", title: "귤 한 알", kind: "head", category: "head", rarity: "common", imagePath: "/a.png",
        displayable: true, inPool: true, ownerCount: 1, sortOrder: 0, retiredAt: null }] }),
    previewGrant: async input => {
      state.calls.push(["preview", input]);
      const known = input.nicknames.filter(name => USERS[name]);
      const unknownNicknames = input.nicknames.filter(name => !USERS[name]);
      const targets = known.map(nickname => ({ nickname, userId: USERS[nickname] }));
      const content = { productId: input.productId, mode: input.mode, reason: input.reason,
        userIds: input.mode === "ALL" ? [] : targets.map(target => target.userId).sort() };
      return { productId: input.productId, productTitle: "귤 한 알", mode: input.mode, reason: input.reason, targets, unknownNicknames,
        targetCount: input.mode === "ALL" ? 7 : targets.length, alreadyOwnedCount: 0, newCount: targets.length,
        digest: unknownNicknames.length ? null : grantDigest(content) };
    },
    approveGrant: async (request, actor) => {
      state.calls.push(["approve", request.approvalId, actor]);
      const approval = { ...request, approvedBy: actor, approvedAt: new Date().toISOString() };
      state.approvals.set(request.approvalId, approval);
      if (state.loseApprove-- > 0) throw lost("승인 응답 유실");
      return approval;
    },
    revokeGrant: async (approvalId, actor) => {
      state.calls.push(["revoke", approvalId, actor]);
      if (state.revokeFails-- > 0) throw lost("취소 응답 유실");
      return { ok: true };
    },
    executeGrant: async (item, actor) => {
      state.calls.push(["execute", item.grantId, actor]);
      state.runs++;
      if (state.loseExecute-- > 0) throw lost("실행 응답 유실");
      const done = state.runs > state.running;
      const execution = { grantId: item.grantId, approvalId: item.approvalId, productId: item.productId, mode: item.mode, reason: item.reason,
        status: done ? "COMPLETED" : "RUNNING", targetCount: 2, grantedCount: done ? 2 : state.runs, alreadyOwnedCount: 0, skippedCount: 0,
        approvedBy: "member-1", actor, startedAt: "2026-11-09T00:00:00.000Z", completedAt: done ? "2026-11-09T00:00:01.000Z" : null };
      state.executions.set(item.grantId, execution);
      return execution;
    },
    grantExecutions: async () => [...state.executions.values()],
  };
  return { upstream, state };
}
const draftBody = { productId: "cust.head.mandarin", mode: "USERS", nicknamesText: "귤이\n고등어", reason: "11월 출석 감사" };
async function reviewed(app, one, body = draftBody) {
  let item = (await app.send("/api/customization/grants", body, one)).body;
  item = (await app.send(`/api/customization/grants/${item.id}/preview`, { revision: item.revision }, one)).body;
  const response = await app.send(`/api/customization/grants/${item.id}/review`, { revision: item.revision }, one);
  return response.body;
}

test("지문 시험 값 3개는 계약의 정규 문자열·SHA-256 과 같다", () => {
  const users = { productId: "cust.head.mandarin", mode: "USERS", userIds: [U1, U2], reason: '11월 출석 감사 선물 "귤"' };
  assert.equal(grantCanonical(users), '{"productId":"cust.head.mandarin","mode":"USERS","userIds":["0192f5a0-0000-7000-8000-000000000001","0192f5a0-0000-7000-8000-000000000002"],"reason":"11월 출석 감사 선물 \\"귤\\""}');
  assert.equal(grantDigest(users), "f11221233c1eac14b901dff59c694fa29ecb00a58c8142db861ebfdb6fff5cd8");
  assert.equal(grantDigest({ productId: "cust.neck.bell", mode: "ALL", userIds: [], reason: "전체 지급" }),
    "e9330e1d94d92be4eacf6f7570725d2c79acc2d6bd5ffd84eaa16d359c61d506");
  assert.equal(poolDigest(["cust.head.bun", "cust.head.mandarin", "cust.neck.bell"]),
    "e7c9781ed14a0461f6b88b1a70438621e457e6f42ae1fd98709832e728fe66b1");
});

test("지급 HTTP 흐름: 승인자는 실행할 수 없고 다른 운영자가 실행하면 completed", async t => {
  const { upstream, state } = fakeData();
  const app = await startApp(t, upstream);
  const one = await app.login("member-1"), two = await app.login("member-2");
  assert.equal((await app.get("/api/customization/items", one)).body.staticOrigin, "https://oneorthree-v2.dev.mooo.com");
  let item = await reviewed(app, one);
  assert.equal(item.status, "review");
  item = (await app.send(`/api/customization/grants/${item.id}/approve`, { revision: item.revision }, one)).body;
  assert.equal(item.status, "approved");
  let response = await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, one);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /다른 운영자/);
  assert.equal(state.calls.filter(call => call[0] === "execute").length, 0);
  response = await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, two);
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "completed");
  assert.equal(response.body.receipt.grantedCount, 2);
  assert.equal(state.calls.find(call => call[0] === "execute")[1], response.body.grantId);
});

test("찾지 못한 닉네임이 있으면 검토 요청을 거부하고, 고치면 미리 계산이 지워진다", async t => {
  const { upstream } = fakeData();
  const app = await startApp(t, upstream);
  const one = await app.login("member-1");
  let item = (await app.send("/api/customization/grants", { ...draftBody, nicknamesText: "귤이\n없는냥" }, one)).body;
  assert.equal((await app.send(`/api/customization/grants/${item.id}/review`, { revision: item.revision }, one)).status, 409);
  item = (await app.send(`/api/customization/grants/${item.id}/preview`, { revision: item.revision }, one)).body;
  assert.deepEqual(item.preview.unknownNicknames, ["없는냥"]);
  assert.equal(item.preview.digest, null);
  const rejected = await app.send(`/api/customization/grants/${item.id}/review`, { revision: item.revision }, one);
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /찾지 못한 닉네임/);
  item = (await app.send(`/api/customization/grants/${item.id}`, { ...draftBody, revision: item.revision }, one, "PATCH")).body;
  assert.equal(item.preview, undefined);
  assert.equal((await app.send(`/api/customization/grants/${item.id}/review`, { revision: item.revision }, one)).status, 409);
});

test("승인 응답 유실은 approval_uncertain 이고 최초 승인자만 같은 approvalId 로 재시도한다", async t => {
  const { upstream, state } = fakeData();
  const app = await startApp(t, upstream);
  const one = await app.login("member-1"), two = await app.login("member-2");
  let item = await reviewed(app, one);
  state.loseApprove = 1;
  item = (await app.send(`/api/customization/grants/${item.id}/approve`, { revision: item.revision }, one)).body;
  assert.equal(item.status, "approval_uncertain");
  const approvalId = item.approvalId;
  assert.equal((await app.send(`/api/customization/grants/${item.id}/approve`, { revision: item.revision }, two)).status, 409);
  item = (await app.send(`/api/customization/grants/${item.id}/approve`, { revision: item.revision }, one)).body;
  assert.equal(item.status, "approved");
  assert.equal(item.approvalId, approvalId);
  assert.deepEqual(state.calls.filter(call => call[0] === "approve").map(call => call[1]), [approvalId, approvalId]);
});

test("실행 응답 유실은 uncertain 이고 다른 운영자는 재시도할 수 없으며 같은 grantId 를 쓴다", async t => {
  const { upstream, state } = fakeData();
  const app = await startApp(t, upstream);
  const one = await app.login("member-1"), two = await app.login("member-2"), three = await app.login("member-3");
  let item = await reviewed(app, one);
  item = (await app.send(`/api/customization/grants/${item.id}/approve`, { revision: item.revision }, one)).body;
  state.loseExecute = 1;
  item = (await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, two)).body;
  assert.equal(item.status, "uncertain");
  const grantId = item.grantId;
  const other = await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, three);
  assert.equal(other.status, 409);
  assert.match(other.body.error, /최초/);
  const again = await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, two);
  assert.equal(again.body.status, "completed");
  assert.equal(again.body.grantId, grantId);
  assert.deepEqual(state.calls.filter(call => call[0] === "execute").map(call => call[1]), [grantId, grantId]);
});

test("RUNNING 이 20번 넘게 오면 executing 으로 남고 같은 실행자만 이어 간다", async t => {
  const { upstream, state } = fakeData({ running: 25 });
  const app = await startApp(t, upstream);
  const one = await app.login("member-1"), two = await app.login("member-2"), three = await app.login("member-3");
  let item = await reviewed(app, one);
  item = (await app.send(`/api/customization/grants/${item.id}/approve`, { revision: item.revision }, one)).body;
  item = (await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, two)).body;
  assert.equal(item.status, "executing");
  assert.equal(state.runs, 20);
  assert.equal(item.progress.status, "RUNNING");
  assert.equal((await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, one)).status, 409);
  assert.equal((await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, three)).status, 409);
  assert.equal(state.runs, 20);
  item = (await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, two)).body;
  assert.equal(item.status, "completed");
  assert.equal(state.runs, 26);
  assert.equal(new Set(state.calls.filter(call => call[0] === "execute").map(call => call[1])).size, 1);
});

test("수정하면 Data 승인 취소를 먼저 부르고, 취소가 실패하면 수정도 실패한다", async t => {
  const { upstream, state } = fakeData();
  const app = await startApp(t, upstream);
  const one = await app.login("member-1");
  let item = await reviewed(app, one);
  item = (await app.send(`/api/customization/grants/${item.id}/approve`, { revision: item.revision }, one)).body;
  const approvalId = item.approvalId;
  state.revokeFails = 1;
  const failed = await app.send(`/api/customization/grants/${item.id}`, { ...draftBody, reason: "다른 사유", revision: item.revision }, one, "PATCH");
  assert.equal(failed.status, 502);
  const same = (await app.get(`/api/customization/grants/${item.id}`, one)).body;
  assert.equal(same.status, "approved");
  assert.equal(same.reason, "11월 출석 감사");
  const edited = await app.send(`/api/customization/grants/${item.id}`, { ...draftBody, reason: "다른 사유", revision: item.revision }, one, "PATCH");
  assert.equal(edited.status, 200);
  assert.equal(edited.body.status, "draft");
  assert.equal(edited.body.approvalId, undefined);
  const order = state.calls.map(call => call[0]);
  assert.deepEqual(order.slice(-2), ["revoke", "revoke"]);
  assert.equal(state.calls.at(-1)[1], approvalId);
});

test("재시작하면 approving 은 approval_uncertain, executing 은 uncertain 이 되고 ID 와 운영자를 유지한다", t => {
  const dir = mkdtempSync(join(tmpdir(), "grant-restart-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "state.sqlite");
  let db = new Store(path), grants = new CustomizationGrantStore(db);
  const preview = id => ({ productId: "cust.head.mandarin", productTitle: "귤", mode: "USERS", targets: [{ nickname: "귤이", userId: U1 }],
    unknownNicknames: [], targetCount: 1, alreadyOwnedCount: 0, newCount: 1,
    digest: grantDigest({ productId: "cust.head.mandarin", mode: "USERS", userIds: [U1], reason: id }) });
  const make = reason => {
    let item = grants.create({ productId: "cust.head.mandarin", mode: "USERS", nicknamesText: "귤이", reason }, "member-1");
    item = grants.savePreview(item.id, item.revision, preview(reason), "member-1");
    return grants.transition(item.id, item.revision, "member-1", "review");
  };
  const approving = make("승인 중");
  const request = grants.beginApproval(approving.id, approving.revision, "member-1");
  const executing = make("실행 중");
  const executingRequest = grants.beginApproval(executing.id, executing.revision, "member-1");
  grants.transition(executing.id, executing.revision, "member-1", "approve",
    { ...executingRequest, approvedBy: "member-1", approvedAt: new Date().toISOString() });
  const running = grants.transition(executing.id, executing.revision, "member-2", "run");
  assert.equal(running.status, "executing");
  db.close();
  db = new Store(path); grants = new CustomizationGrantStore(db);
  t.after(() => db.close());
  const recoveredApproval = grants.get(approving.id);
  assert.equal(recoveredApproval.status, "approval_uncertain");
  assert.equal(recoveredApproval.approvalId, request.approvalId);
  assert.equal(recoveredApproval.approvalActor, "member-1");
  const recovered = grants.get(executing.id);
  assert.equal(recovered.status, "uncertain");
  assert.equal(recovered.grantId, running.grantId);
  assert.throws(() => grants.transition(recovered.id, recovered.revision, "member-3", "run"), /최초/);
  assert.equal(grants.transition(recovered.id, recovered.revision, "member-2", "run").grantId, running.grantId);
});

test("상류 지급 요청의 경로·메서드·Idempotency-Key·토큰이 계약과 같다", async () => {
  const calls = [];
  const identity = service => ({ environment: "prod", fcmProjectId: "catus-prod", contractVersion: contract.contractVersion, capabilities: contract[service] });
  const upstream = new Upstream({ mode: "connected", environment: "prod", expectedFcmProjectId: "catus-prod",
    dataUrl: "https://data.internal", notificationUrl: "https://notification.internal",
    fetchImpl: async (url, options) => {
      if (url.pathname.endsWith("/environment")) return Response.json(identity(url.hostname.startsWith("data") ? "data" : "notification"));
      calls.push({ path: url.pathname + url.search, method: options.method, headers: options.headers, body: options.body });
      return options.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({});
    } });
  const operator = { dataToken: "data-secret", notificationToken: "noti-secret" };
  await upstream.customizationItems("member-1", operator);
  await upstream.previewGrant({ productId: "p", mode: "USERS", nicknames: ["a"], reason: "r" }, "member-1", operator);
  await upstream.approveGrant({ approvalId: "ap1", productId: "p", mode: "USERS", userIds: [U1], reason: "r", digest: "d" }, "member-1", operator);
  await upstream.revokeGrant("ap1", "member-2", operator);
  await upstream.executeGrant({ id: "draft", revision: 3, grantId: "g1", approvalId: "ap1", approvedDigest: "d" }, "member-2", operator);
  await upstream.grantExecutions("member-2", operator);
  assert.deepEqual(calls.map(call => [call.method, call.path, call.headers["Idempotency-Key"]]), [
    ["GET", "/internal/admin/customization/items", undefined],
    ["POST", "/internal/admin/customization/grants/previews", undefined],
    ["POST", "/internal/admin/customization/grants/approvals/ap1", "ap1"],
    ["DELETE", "/internal/admin/customization/grants/approvals/ap1", undefined],
    ["PUT", "/internal/admin/customization/grants/executions/g1", "draft:3"],
    ["GET", "/internal/admin/customization/grants/executions?limit=50", undefined],
  ]);
  assert.ok(calls.every(call => call.headers.Authorization === "Bearer data-secret"));
  assert.deepEqual(JSON.parse(calls[2].body), { productId: "p", mode: "USERS", userIds: [U1], reason: "r", digest: "d" });
  assert.deepEqual(JSON.parse(calls[4].body), { approvalId: "ap1", digest: "d" });
  assert.equal(calls[3].body, undefined);
});

test("CSP img-src 는 prod 기본 origin 을 포함하고 local 은 그대로다", async t => {
  const prod = await startApp(t, {}, { environment: "prod" });
  const csp = (await prod.get("/api/session")).headers.get("content-security-policy");
  assert.match(csp, /img-src 'self' data: https:\/\/catus-api-v2\.oneorthree\.world;/);
  const custom = await startApp(t, {}, { environment: "prod", staticOrigin: "https://cdn.example.com" });
  assert.match((await custom.get("/api/session")).headers.get("content-security-policy"), /img-src 'self' data: https:\/\/cdn\.example\.com;/);
  const local = await startApp(t, {}, { mode: "local" });
  assert.match((await local.get("/api/session")).headers.get("content-security-policy"), /img-src 'self' data:; connect-src/);
  assert.equal(resolveStaticOrigin("local", "local", "https://x.example"), null);
  assert.equal(resolveStaticOrigin("connected", "dev"), "https://oneorthree-v2.dev.mooo.com");
  for (const bad of ["http://x.example", "https://x.example/path", "not a url"])
    assert.throws(() => resolveStaticOrigin("connected", "prod", bad), /BACKOFFICE_STATIC_ORIGIN/);
});

test("로컬 모드 Data 흉내도 2인 규칙을 지키고 청크 실행을 끝까지 돈다", async t => {
  const db = new Store(":memory:");
  const upstream = new Upstream({ mode: "local", localData: new LocalCustomizationData(db, { chunkSize: 1 }) });
  const app = await startApp(t, upstream, { db, mode: "local" });
  const one = await app.login("member-1"), two = await app.login("member-2");
  const catalog = (await app.get("/api/customization/items", one)).body;
  assert.equal(catalog.staticOrigin, null);
  assert.ok(catalog.items.length >= 6);
  let item = await reviewed(app, one, { productId: "cust.head.mandarin", mode: "ALL", nicknamesText: "", reason: "전체 선물" });
  item = (await app.send(`/api/customization/grants/${item.id}/approve`, { revision: item.revision }, one)).body;
  assert.equal(item.status, "approved");
  assert.equal((await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, one)).status, 409);
  item = (await app.send(`/api/customization/grants/${item.id}/execute`, { revision: item.revision }, two)).body;
  assert.equal(item.status, "completed");
  assert.equal(item.receipt.targetCount, 3);
  assert.equal(item.receipt.grantedCount + item.receipt.alreadyOwnedCount, 3);
  const owner = (await app.get("/api/customization/items", one)).body.items.find(value => value.productId === "cust.head.mandarin").ownerCount;
  assert.equal(owner, 3);
  const retired = (await app.send("/api/customization/grants", { productId: "cust.head.old", mode: "ALL", nicknamesText: "", reason: "지급 불가" }, one)).body;
  assert.equal((await app.send(`/api/customization/grants/${retired.id}/preview`, { revision: retired.revision }, one)).status, 400);
});
