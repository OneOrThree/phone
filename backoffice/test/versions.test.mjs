import test from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { Upstream } from "../server/upstream.mjs";
import { exceedsStoreVersion } from "../src/versions.ts";
import contract from "../server/contract.json" with { type: "json" };
const apiContract = { contractVersion: contract.contractVersion, capabilities: [...contract.data, ...contract.notification] };
const APPLE = "https://itunes.apple.com/lookup?id=6813004121&country=kr";
const salt = "ab".repeat(16);
async function serve(t, mode, upstream) {
  const store = new Store(":memory:"), origin = "http://127.0.0.1:4310";
  const app = createApp({ store, origin, mode, environment: mode === "local" ? "local" : "dev", upstream,
    operators: { "member-1": { passwordHash: `${salt}:${scryptSync("pw", salt, 64).toString("hex")}`, dataToken: "d", notificationToken: "n" } } });
  await new Promise(r => app.listen(0, "127.0.0.1", r));
  t.after(async () => { await new Promise(r => app.close(r)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ actor: "member-1", password: "pw" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  return () => fetch(`${base}/api/system/versions`, { headers: { Cookie: cookie } }).then(async r => [r.status, await r.json()]);
}
function connected(apple, extra = {}) {
  const calls = [];
  const upstream = new Upstream({ mode: "connected", environment: "dev", expectedFcmProjectId: "gromo-dev",
    dataUrl: "http://data.internal", notificationUrl: "http://notification.internal",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), headers: options?.headers ?? {} });
      if (String(url) === APPLE) return apple();
      const base = { ...apiContract, environment: "dev", fcmProjectId: "gromo-dev" };
      return Response.json(String(url).startsWith("http://data") ? { ...base, ...extra.data } : { ...base, ...extra.notification });
    } });
  return { upstream, calls };
}
const ok = () => Response.json({ resultCount: 1, results: [{ version: "1.0.2" }] });
test("로컬 모드는 외부를 부르지 않는다", async t => {
  const calls = [];
  const get = await serve(t, "local", new Upstream({ mode: "local", fetchImpl: async u => { calls.push(u); throw new Error("no"); } }));
  assert.deepEqual(await get(), [200, { local: true, data: null, notification: null, iosStore: { version: null, status: "local" } }]);
  assert.equal(calls.length, 0);
});
test("연결 모드는 두 서비스 버전을 주고 구버전 서버는 null", async t => {
  const { upstream, calls } = connected(ok, { data: { serverVersion: "abc1234def", schemaVersion: "9" } });
  const [status, body] = await (await serve(t, "connected", upstream))();
  assert.equal(status, 200);
  assert.deepEqual(body.data, { serverVersion: "abc1234def", schemaVersion: "9" });
  assert.equal(body.notification, null);
  assert.deepEqual(body.iosStore, { version: "1.0.2", status: "ok" });
  // Apple 요청에는 운영자 헤더가 없고 URL이 계약과 같다.
  const apple = calls.filter(c => c.url.startsWith("https://"));
  assert.equal(apple.length, 1);
  assert.equal(apple[0].url, APPLE);
  assert.deepEqual(apple[0].headers, {});
});
test("iOS 스토어 조회 결과 분류, 실패해도 라우트는 성공", async t => {
  const cases = [
    [() => Response.json({ resultCount: 0, results: [] }), "unpublished"],
    [() => new Response("x", { status: 500 }), "unavailable"],
    [() => { throw new Error("net"); }, "unavailable"],
    [() => new Response("not json"), "unavailable"],
  ];
  for (const [apple, status] of cases) {
    const { upstream } = connected(apple, { data: { serverVersion: "s", schemaVersion: "1" } });
    const [code, body] = await (await serve(t, "connected", upstream))();
    assert.equal(code, 200);
    assert.deepEqual(body.iosStore, { version: null, status });
    assert.equal(body.data.serverVersion, "s");
  }
});
test("최소 버전 비교", () => {
  assert.equal(exceedsStoreVersion("1.0.3", "1.0.2"), true);
  assert.equal(exceedsStoreVersion("1.10.0", "1.9.9"), true);
  assert.equal(exceedsStoreVersion("1.0.2", "1.0.2"), false);
  assert.equal(exceedsStoreVersion("2.1.0", "1.0.2"), true);
  assert.equal(exceedsStoreVersion("1.0.1", "1.0.2"), false);
  assert.equal(exceedsStoreVersion("abc", "1.0.2"), false);
  assert.equal(exceedsStoreVersion("", "1.0.2"), false);
  assert.equal(exceedsStoreVersion("2.1.0", "2.0"), true);
  assert.equal(exceedsStoreVersion("2.0.0", "2.0"), false);
  assert.equal(exceedsStoreVersion("1.9.9", "2"), false);
  assert.equal(exceedsStoreVersion("1.0.0.1", "1.0.2"), false);
});
test("문자열이 아닌 버전 값은 null 로 버린다", async t => {
  const { upstream } = connected(ok, { data: { serverVersion: 123, schemaVersion: "9" } });
  const [code, body] = await (await serve(t, "connected", upstream))();
  assert.equal(code, 200);
  assert.deepEqual(body.data, { serverVersion: null, schemaVersion: "9" });
});
