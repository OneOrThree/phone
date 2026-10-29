import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { Upstream } from "../server/upstream.mjs";
import { policyRequest } from "../server/construction.mjs";

function draft(store, snapshot = store.constructionSnapshot(store.localConstructionPolicy())) {
  return { kind: "construction", title: "건설 정책 변경", data: { construction: {
    snapshotId: snapshot.snapshotId, digest: snapshot.digest,
    items: snapshot.items.map(row => ({ buildingId: row.buildingId, cost: row.cost + 1,
      buildSeconds: row.buildSeconds + 60 })),
  } } };
}
function approve(store, input) {
  let item = store.create(input, "member-1");
  item = store.transition(item.id, item, "member-1", "review");
  return store.transition(item.id, item, "member-2", "approve");
}

test("건설 정책은 서버 보관 기준으로 검토하며 수정하면 승인이 해제된다", t => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const input = draft(store);
  input.data.construction.base = { costPolicyVersion: 999, items: [] };
  let item = store.create(input, "member-1");
  assert.equal(item.data.construction.base.costPolicyVersion, 1);
  assert.throws(() => store.transition(item.id, item, "member-1", "publish"), /승인된/);
  item = store.transition(item.id, item, "member-1", "review");
  item = store.transition(item.id, item, "member-2", "approve");
  item = store.edit(item.id, { revision: item.revision, body: "변경 사유 수정" }, "member-1");
  assert.equal(item.status, "draft");
  assert.equal(item.approvedBy, undefined);
  assert.throws(() => store.transition(item.id, item, "member-1", "publish"), /승인된/);
});

test("건설 정책의 누락·중복·소수·0 비용·잘못된 검토 기준을 거절한다", t => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const input = draft(store);
  for (const invalid of [0, -1, 0.5, 2147483648, null]) {
    const changed = structuredClone(input);
    changed.data.construction.items[0].cost = invalid;
    assert.throws(() => store.create(changed, "member-1"), /32비트 정수/);
  }
  for (const transform of [rows => rows.slice(1), rows => [...rows, rows[0]]]) {
    const changed = structuredClone(input);
    changed.data.construction.items = transform(changed.data.construction.items);
    assert.throws(() => store.create(changed, "member-1"), /32비트 정수/);
  }
  input.data.construction.digest = "forged";
  assert.throws(() => store.create(input, "member-1"), /검토 기준/);
});

test("로컬 정책 적용과 영수증은 재시작·응답 유실 뒤 같은 요청으로 복구된다", t => {
  const dir = mkdtempSync(join(tmpdir(), "construction-policy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "local.sqlite");
  let store = new Store(path);
  let item = approve(store, draft(store));
  item = store.transition(item.id, item, "member-1", "publish");
  const first = store.applyLocalConstructionPolicy(item, "member-1");
  assert.equal(first.costPolicyVersion, 2);
  assert.equal(first.before[0].cost, 60);
  assert.equal(first.items[0].cost, 61);
  store.close();
  store = new Store(path);
  t.after(() => store.close());
  item = store.get(item.id);
  assert.equal(item.status, "uncertain");
  assert.throws(() => store.edit(item.id, { revision: item.revision, title: "교체" }, "member-1"), /수정할 수/);
  assert.throws(() => store.transition(item.id, item, "member-2", "publish"), /최초 발송자/);
  item = store.transition(item.id, item, "member-1", "publish");
  const replay = store.applyLocalConstructionPolicy(item, "member-1");
  assert.deepEqual(replay, first);
  assert.equal(store.localConstructionPolicy().costPolicyVersion, 2);
  item = store.finish(item.id, replay);
  assert.equal(item.status, "published");
  assert.equal(item.receipt.local, true);
});

test("다른 변경안이 먼저 적용되면 오래된 기준의 적용을 거절한다", t => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const snapshot = store.constructionSnapshot(store.localConstructionPolicy());
  const a = approve(store, draft(store, snapshot));
  const b = approve(store, draft(store, snapshot));
  store.applyLocalConstructionPolicy(store.transition(a.id, a, "member-1", "publish"), "member-1");
  const second = store.transition(b.id, b, "member-1", "publish");
  assert.throws(() => store.applyLocalConstructionPolicy(second, "member-1"), /다시 불러와 검토/);
  assert.equal(store.localConstructionPolicy().costPolicyVersion, 2);
});

test("연결 모드는 환경 검증 뒤 고정 경로와 기준 버전으로 정책을 전송한다", async t => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  let item = approve(store, draft(store));
  item = store.transition(item.id, item, "member-1", "publish");
  const calls = [];
  const upstream = new Upstream({ mode: "connected", environment: "dev", expectedFcmProjectId: "local-test",
    dataUrl: "http://data.invalid", notificationUrl: "http://notification.invalid",
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), ...options });
      return Response.json(url.pathname.endsWith("/environment")
        ? { environment: "dev", fcmProjectId: "local-test" } : { costPolicyVersion: 2 });
    } });
  await upstream.publish(item, "member-1", { dataToken: "test-data", notificationToken: "test-notification" });
  const call = calls.at(-1);
  assert.equal(call.method, "PUT");
  assert.equal(call.url, `http://data.invalid/internal/admin/content/construction-policy/${item.publicationId}`);
  assert.equal(call.headers["X-Console-Actor"], "member-1");
  assert.equal(call.headers["X-Backoffice-Environment"], "dev");
  assert.deepEqual(JSON.parse(call.body), policyRequest(item));
});
