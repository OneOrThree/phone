import test from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { Upstream } from "../server/upstream.mjs";
import { createReleaseStatus, releaseVerdict } from "../server/release-status.mjs";
import { kst, verdictText } from "../src/releaseText.ts";

const SV = "c".repeat(40), HEAD = "d".repeat(40);
const file = filename => ({ filename });
const compare = (files, extra = {}) => ({ ahead_by: files.length ? 3 : 0, html_url: `https://github.com/OneOrThree/phone/compare/${SV}...main`, files, ...extra });
const RUN = { head_sha: HEAD, run_started_at: "2026-10-31T08:04:18Z", html_url: "https://github.com/OneOrThree/phone/actions/runs/1" };

// 호출을 기록하는 가짜 GitHub. override 로 경로별 응답을 바꾼다.
function fakeGithub(override = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const path = String(url).replace("https://api.github.com/repos/OneOrThree/phone", "");
    const key = Object.keys(override).find(k => path.startsWith(k));
    if (key) { const value = override[key]; if (value instanceof Error) throw value; if (value instanceof Response) return value; return Response.json(value); }
    if (path.startsWith("/compare/")) return Response.json(compare([file("server/data-api/src/main/java/A.java")]));
    if (path.startsWith("/tags")) return Response.json([
      { name: "catus-v2.0.3-V2", commit: { sha: SV } }, { name: "backoffice-v1.0.5-V2", commit: { sha: HEAD } }]);
    return Response.json({ workflow_runs: [RUN] });
  };
  return { fetchImpl, calls };
}
const android = async () => ({ version: "2.3.1", status: "ok" });

test("서버 실행 코드가 있으면 server-first, 없으면 ship", () => {
  const first = releaseVerdict(SV, compare([file("README.md"), file("server/realtime/src/main/java/B.java")]));
  assert.deepEqual(first, { status: "server-first", changedFiles: 1, aheadBy: 3, compareUrl: `https://github.com/OneOrThree/phone/compare/${SV}...main` });
  assert.equal(releaseVerdict(SV, compare([file("app/app-dev/App.tsx")])).status, "ship");
  assert.equal(releaseVerdict(SV, compare([])).changedFiles, 0);
});
test("서버 테스트·관측 설정만 바뀌면 ship", () => {
  const verdict = releaseVerdict(SV, compare([file("server/data-api/src/test/java/ATest.java"), file("server/observability/prometheus.yml"),
    file("server/business-api/src/mainline/x"), file("docs/a.md")]));
  assert.equal(verdict.status, "ship");
});
test("잘린 목록에 일치 파일이 없으면 unknown, 있으면 server-first", () => {
  const many = Array.from({ length: 300 }, (_, i) => file(`docs/${i}.md`));
  assert.deepEqual(releaseVerdict(SV, compare(many)), { status: "unknown" });
  assert.equal(releaseVerdict(SV, compare([...many.slice(1), file("server/notification/src/main/A.java")])).status, "server-first");
});
test("잘못된 serverVersion 과 비정상 compare 는 unknown", () => {
  for (const bad of [null, "", "main", "ABCDEF1", "abc12", `${SV}0`]) assert.deepEqual(releaseVerdict(bad, compare([])), { status: "unknown" });
  for (const bad of [null, {}, { ahead_by: "3" }, { ahead_by: 2 }]) assert.deepEqual(releaseVerdict(SV, bad), { status: "unknown" });
});

test("판정은 compare 호출 결과를 따르고 잘못된 serverVersion 은 compare 를 부르지 않는다", async () => {
  const run = async (serverVersion, override) => {
    const { fetchImpl, calls } = fakeGithub(override);
    const result = await createReleaseStatus({ fetchImpl, androidStoreVersion: android })(serverVersion);
    return { result, compares: calls.filter(c => c.url.includes("/compare/")) };
  };
  assert.equal((await run(SV, {})).result.verdict.status, "server-first");
  assert.equal((await run(SV, { "/compare/": compare([file("docs/a.md")]) })).result.verdict.status, "ship");
  assert.equal((await run(SV, { "/compare/": new Response("{}", { status: 404 }) })).result.verdict.status, "unknown");
  const bad = await run("main", {});
  assert.equal(bad.compares.length, 0);
  assert.deepEqual(bad.result.verdict, { status: "unknown" });
  assert.equal((await run(null, {})).compares.length, 0);
});

test("배포 단위는 태그를 커밋으로 찾고 서버는 serverVersion 기준", async () => {
  const { fetchImpl } = fakeGithub();
  const { units, androidStore, local } = await createReleaseStatus({ fetchImpl, androidStoreVersion: android })(SV);
  assert.equal(local, false);
  assert.deepEqual(units.server, { commit: SV, tag: "catus-v2.0.3-V2", runUrl: RUN.html_url, deployedAt: RUN.run_started_at });
  assert.equal(units.backoffice.tag, "backoffice-v1.0.5-V2");
  assert.equal(units.backoffice.commit, HEAD);
  assert.equal(units.kafka.tag, null);
  assert.deepEqual(androidStore, { version: "2.3.1", status: "ok" });
});

test("fetch 실패·비정상 JSON·낯선 링크에도 던지지 않는다", async () => {
  const fail = fakeGithub({ "/compare/": new Error("down"), "/tags": new Error("down"), "/actions/workflows/kafka": new Error("down"),
    "/actions/workflows/redis": new Response("<html>", { status: 200 }), "/actions/workflows/backoffice": { workflow_runs: [] },
    "/actions/workflows/prod": { workflow_runs: [{ ...RUN, html_url: "javascript:alert(1)" }] } });
  const result = await createReleaseStatus({ fetchImpl: fail.fetchImpl, androidStoreVersion: async () => { throw new Error("x"); } })(SV);
  assert.deepEqual(result.verdict, { status: "unknown" });
  assert.equal(result.units.kafka, null);
  assert.equal(result.units.redis, null);
  assert.equal(result.units.backoffice, null);
  assert.equal(result.units.server.tag, null);
  assert.equal(result.units.server.runUrl, null);
  assert.equal(result.androidStore, null);
});

test("10분 캐시: 안에서는 재호출 없음, 지나거나 serverVersion 이 바뀌면 다시, 실패도 캐시", async () => {
  let clock = 1000;
  const { fetchImpl, calls } = fakeGithub();
  const status = createReleaseStatus({ fetchImpl, androidStoreVersion: android, now: () => clock });
  const first = await status(SV);
  assert.equal(calls.length, 6);
  assert.equal(await status(SV), first);
  clock += 9 * 60000;
  await status(SV);
  assert.equal(calls.length, 6);
  clock += 2 * 60000;
  await status(SV);
  assert.equal(calls.length, 12);
  await status("e".repeat(40));
  assert.equal(calls.length, 18);

  const down = fakeGithub({ "/": new Error("down") });
  const failing = createReleaseStatus({ fetchImpl: down.fetchImpl, androidStoreVersion: android, now: () => clock });
  await failing(SV); await failing(SV);
  assert.equal(down.calls.length, 6);
});

test("GitHub 요청에는 운영자 토큰도 Authorization 도 없다", async () => {
  const { fetchImpl, calls } = fakeGithub();
  await createReleaseStatus({ fetchImpl, androidStoreVersion: android })(SV);
  for (const { url, options } of calls) {
    assert.ok(url.startsWith("https://api.github.com/repos/OneOrThree/phone/"));
    assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "User-Agent"]);
    assert.equal(options.redirect, "error");
  }
});

// ---- 라우트 ----
const salt = "ab".repeat(16);
async function serve(t, mode, upstream, releaseStatus) {
  const store = new Store(":memory:"), origin = "http://127.0.0.1:4310";
  const app = createApp({ store, origin, mode, environment: mode === "local" ? "local" : "prod", upstream, releaseStatus,
    operators: { "member-1": { passwordHash: `${salt}:${scryptSync("pw", salt, 64).toString("hex")}`, dataToken: "d", notificationToken: "n" } } });
  await new Promise(r => app.listen(0, "127.0.0.1", r));
  t.after(async () => { await new Promise(r => app.close(r)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ actor: "member-1", password: "pw" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  return { base, cookie, get: () => fetch(`${base}/api/system/release-status`, { headers: { Cookie: cookie } }).then(async r => [r.status, await r.json()]) };
}
test("release-status 는 비로그인을 거부한다", async t => {
  const { base } = await serve(t, "local", new Upstream({ mode: "local" }));
  assert.equal((await fetch(`${base}/api/system/release-status`)).status, 401);
});
test("로컬 모드는 외부를 부르지 않고 local 만 준다", async t => {
  const calls = [];
  const { get } = await serve(t, "local", new Upstream({ mode: "local", fetchImpl: async u => { calls.push(u); throw new Error("no"); } }));
  assert.deepEqual(await get(), [200, { local: true }]);
  assert.equal(calls.length, 0);
});
test("연결 모드는 서버 버전을 trim 해 넘기고 unknown 은 null", async t => {
  const seen = [];
  const releaseStatus = async version => { seen.push(version); return { local: false, verdict: { status: "unknown" }, units: {}, androidStore: null }; };
  for (const serverVersion of [` ${SV} `, "unknown", undefined]) {
    const upstream = { verifyEnvironment: async () => ({ data: { serverVersion }, notification: {} }) };
    const { get } = await serve(t, "connected", upstream, releaseStatus);
    const [status, body] = await get();
    assert.equal(status, 200);
    assert.equal(body.local, false);
  }
  assert.deepEqual(seen, [SV, null, null]);
});

// ---- Android Play ----
const PLAY = "https://play.google.com/store/apps/details?id=com.oneorthree.gromo&hl=ko&gl=KR";
test("Android 버전: 정규식 일치·불일치·실패·로컬", async () => {
  const calls = [];
  const make = (mode, impl) => new Upstream({ mode, fetchImpl: async (u, o) => { calls.push({ u, o }); return impl(); } });
  const page = make("connected", () => new Response('x [[["2.3.1"]] y'));
  assert.deepEqual(await page.androidStoreVersion(), { version: "2.3.1", status: "ok" });
  assert.equal(calls[0].u, PLAY);
  assert.deepEqual(calls[0].o.headers, { "User-Agent": "Mozilla/5.0" });
  assert.deepEqual(await make("connected", () => new Response("<html>변경된 페이지</html>")).androidStoreVersion(), { version: null, status: "unavailable" });
  assert.deepEqual(await make("connected", () => new Response("", { status: 500 })).androidStoreVersion(), { version: null, status: "unavailable" });
  assert.deepEqual(await make("connected", () => { throw new Error("down"); }).androidStoreVersion(), { version: null, status: "unavailable" });
  const before = calls.length;
  assert.deepEqual(await make("local", () => { throw new Error("no"); }).androidStoreVersion(), { version: null, status: "local" });
  assert.equal(calls.length, before);
});

// ---- 화면 문구 ----
test("판정 문구와 KST 시각", () => {
  assert.deepEqual(verdictText({ status: "server-first", changedFiles: 4, aheadBy: 2, compareUrl: "u" }),
    { title: "서버 먼저 배포", detail: "main에 운영에 없는 서버 변경 4파일", tone: "warn" });
  assert.equal(verdictText({ status: "ship", changedFiles: 0, aheadBy: 0, compareUrl: "u" }).title, "앱 출시 가능");
  assert.equal(verdictText({ status: "unknown" }).title, "판정 불가");
  assert.equal(verdictText(null).title, "판정 불가");
  assert.equal(kst("2026-10-31T08:04:18Z"), "2026-10-31 17:04 KST");
  assert.equal(kst("2026-10-31T16:00:00Z"), "2026-11-01 01:00 KST");
  assert.equal(kst("nope"), null);
  assert.equal(kst(null), null);
});
