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
  const records = { app: "catus-v2.0.3-V2", backoffice: "backoffice-v1.0.5-V2", kafka: "kafka-v1.0.0-V2", redis: "redis-v1.0.0-V2" };
  const fetchImpl = async (url, options) => {
    // 배포 기록(raw.githubusercontent.com)은 API 한도와 무관하므로 calls(API 호출)에 세지 않는다.
    const record = String(url).match(/^https:\/\/raw\.githubusercontent\.com\/OneOrThree\/phone\/deployment-status\/prod-V2\/(\w+)\.json$/);
    if (record) {
      const value = override[`rec:${record[1]}`] ?? { message: records[record[1]] };
      if (value instanceof Error) throw value;
      if (value instanceof Response) return value;
      return Response.json(value);
    }
    calls.push({ url: String(url), options });
    const path = String(url).replace("https://api.github.com/repos/OneOrThree/phone", "");
    const key = Object.keys(override).find(k => path.startsWith(k));
    if (key) { const value = override[key]; if (value instanceof Error) throw value; if (value instanceof Response) return value; return Response.json(value); }
    if (path.startsWith("/compare/")) return Response.json(compare([file("server/data-api/src/main/java/A.java")]));
    if (path.startsWith("/tags")) return Response.json([
      { name: "catus-v2.0.3-V2", commit: { sha: SV } }, { name: "backoffice-v1.0.5-V2", commit: { sha: HEAD } },
      { name: "backoffice-v1.0.4-V2", commit: { sha: "e".repeat(40) } }, { name: "catus-v2.0.2-V2", commit: { sha: "f".repeat(40) } }]);
    if (path.includes("branch=release")) return Response.json({ workflow_runs: [{ status: "completed", conclusion: "success" }] });
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
test("잘못된 기준 커밋과 비정상 compare 는 unknown", () => {
  for (const bad of [null, "", "main", "ABCDEF1", "abc12", `${SV}0`]) assert.deepEqual(releaseVerdict(bad, compare([])), { status: "unknown" });
  for (const bad of [null, {}, { ahead_by: "3" }, { ahead_by: 2 }]) assert.deepEqual(releaseVerdict(SV, bad), { status: "unknown" });
});

test("판정은 기록 태그의 커밋으로 compare 를 호출한다", async () => {
  const run = async override => {
    const { fetchImpl, calls } = fakeGithub(override);
    const result = await createReleaseStatus({ fetchImpl, androidStoreVersion: android })();
    return { result, compares: calls.filter(c => c.url.includes("/compare/")) };
  };
  const ok = await run({});
  assert.equal(ok.result.verdict.status, "server-first");
  assert.deepEqual(ok.compares.map(c => c.url), [`https://api.github.com/repos/OneOrThree/phone/compare/${SV}...main`]);
  assert.equal((await run({ "/compare/": compare([file("docs/a.md")]) })).result.verdict.status, "ship");
  assert.equal((await run({ "/compare/": new Response("{}", { status: 404 }) })).result.verdict.status, "unknown");
  // 이전 태그가 배포된 상태면 그 태그의 커밋이 기준이다(최신 실행·서버 보고 버전과 무관).
  const old = await run({ "rec:app": { message: "catus-v2.0.2-V2" } });
  assert.match(old.compares[0].url, new RegExp(`compare/${"f".repeat(40)}\\.\\.\\.main`));
});

test("최신 운영 CD 실행이 성공이 아니면 compare 없이 unknown이고 표 값은 유지된다", async () => {
  const latest = "/actions/workflows/prod-cd-V2.yml/runs?branch=release";
  for (const value of [{ workflow_runs: [{ status: "completed", conclusion: "failure" }] },
    { workflow_runs: [{ status: "in_progress", conclusion: null }] }, { workflow_runs: [{ status: "completed", conclusion: "cancelled" }] },
    { workflow_runs: [] }, {}, new Error("down"), new Response("x", { status: 500 })]) {
    const { fetchImpl, calls } = fakeGithub({ [latest]: value });
    const result = await createReleaseStatus({ fetchImpl, androidStoreVersion: android })();
    assert.deepEqual(result.verdict, { status: "unknown" });
    assert.equal(calls.filter(c => c.url.includes("/compare/")).length, 0);
    assert.equal(result.units.server.tag, "catus-v2.0.3-V2");
    assert.equal(result.units.server.deployedAt, RUN.run_started_at);
    assert.equal(result.units.server.runUrl, RUN.html_url);
  }
});

test("기록을 못 읽거나 태그가 목록에 없으면 compare 없이 unknown", async () => {
  for (const override of [{ "rec:app": new Error("down") }, { "rec:app": { message: "catus-v2.0.4" } },
    { "rec:app": { message: "catus-v9.9.9-V2" } }, { "/tags": new Error("down") }]) {
    const { fetchImpl, calls } = fakeGithub(override);
    const result = await createReleaseStatus({ fetchImpl, androidStoreVersion: android })();
    assert.deepEqual(result.verdict, { status: "unknown" });
    assert.equal(calls.filter(c => c.url.includes("/compare/")).length, 0);
  }
});

test("배포 단위는 기록 태그를 커밋으로 찾는다(서버도 같다)", async () => {
  const { fetchImpl } = fakeGithub();
  const { units, androidStore, local } = await createReleaseStatus({ fetchImpl, androidStoreVersion: android })();
  assert.equal(local, false);
  assert.deepEqual(units.server, { commit: SV, tag: "catus-v2.0.3-V2", runUrl: RUN.html_url, deployedAt: RUN.run_started_at });
  assert.equal(units.backoffice.tag, "backoffice-v1.0.5-V2");
  assert.equal(units.backoffice.commit, HEAD);
  assert.deepEqual(units.kafka, { commit: null, tag: "kafka-v1.0.0-V2", runUrl: RUN.html_url, deployedAt: RUN.run_started_at });
  assert.deepEqual(androidStore, { version: "2.3.1", status: "ok" });
});

test("fetch 실패·비정상 JSON·낯선 링크에도 던지지 않는다", async () => {
  const fail = fakeGithub({ "/compare/": new Error("down"), "/tags": new Error("down"), "/actions/workflows/kafka": new Error("down"),
    "rec:kafka": new Error("down"), "rec:redis": { message: "redis-v1.0.0" }, "rec:backoffice": { message: "catus-v1.0.0-V2" },
    "/actions/workflows/redis": new Response("<html>", { status: 200 }), "/actions/workflows/backoffice": { workflow_runs: [] },
    "/actions/workflows/prod": { workflow_runs: [{ ...RUN, html_url: "javascript:alert(1)" }] } });
  const result = await createReleaseStatus({ fetchImpl: fail.fetchImpl, androidStoreVersion: async () => { throw new Error("x"); } })();
  assert.deepEqual(result.verdict, { status: "unknown" });
  assert.equal(result.units.kafka, null);
  assert.equal(result.units.redis, null);
  assert.equal(result.units.backoffice, null);
  assert.equal(result.units.server.tag, "catus-v2.0.3-V2");
  assert.equal(result.units.server.runUrl, null);
  assert.equal(result.androidStore, null);
});

test("10분 캐시: 안에서는 재호출 없음, 지나면 다시, 동시 요청은 합치고 실패 결과도 캐시", async () => {
  let clock = 1000;
  const { fetchImpl, calls } = fakeGithub();
  const status = createReleaseStatus({ fetchImpl, androidStoreVersion: android, now: () => clock });
  const first = await status();
  assert.equal(calls.length, 7);
  assert.equal(await status(), first);
  clock += 9 * 60000;
  await status();
  assert.equal(calls.length, 7);
  clock += 2 * 60000;
  await status();
  assert.equal(calls.length, 14);
  const [x, y] = await Promise.all([status(), status()]);
  assert.equal(x, y);
  assert.equal(calls.length, 14);

  const down = fakeGithub({ "/": new Error("down") });
  const failing = createReleaseStatus({ fetchImpl: down.fetchImpl, androidStoreVersion: android, now: () => clock });
  await failing(); await failing();
  assert.equal(down.calls.length, 6); // compare 는 기준 커밋이 없어 부르지 않는다
});

test("배포 기록이 정본이다: 이전 태그 배포면 그 태그의 커밋, 기록 실패·형식 이상이면 null", async () => {
  // 마지막 성공 실행(head_sha=HEAD)과 달리 운영은 이전 태그를 배포한 상태.
  const old = fakeGithub({ "rec:backoffice": { message: "backoffice-v1.0.4-V2" }, "rec:app": { message: "catus-v2.0.2-V2" } });
  const { units } = await createReleaseStatus({ fetchImpl: old.fetchImpl, androidStoreVersion: android })("not-a-sha");
  assert.equal(units.backoffice.tag, "backoffice-v1.0.4-V2");
  assert.equal(units.backoffice.commit, "e".repeat(40));
  assert.equal(units.server.tag, "catus-v2.0.2-V2");
  assert.equal(units.server.commit, "f".repeat(40));
  const bad = fakeGithub({ "rec:backoffice": new Error("down"), "rec:app": { message: "catus-v2.0.2" }, "rec:kafka": { message: 7 }, "rec:redis": new Response("x", { status: 404 }) });
  const result = await createReleaseStatus({ fetchImpl: bad.fetchImpl, androidStoreVersion: android })();
  for (const name of ["backoffice", "kafka", "redis"]) {
    assert.equal(result.units[name].tag, null, name);
    assert.equal(result.units[name].commit, null, name);
    // 기록을 못 읽어도 마지막 성공 실행의 시각·링크는 유지한다(화면은 태그·커밋을 「확인 불가」로 표시).
    assert.equal(result.units[name].deployedAt, RUN.run_started_at, name);
    assert.equal(result.units[name].runUrl, RUN.html_url, name);
  }
  assert.equal(result.units.server.tag, null);
  assert.equal(result.units.server.commit, null);
});

test("GitHub 요청에는 운영자 토큰도 Authorization 도 없다", async () => {
  const { fetchImpl, calls } = fakeGithub();
  await createReleaseStatus({ fetchImpl, androidStoreVersion: android })();
  for (const { url, options } of calls) {
    assert.ok(url.startsWith("https://api.github.com/repos/OneOrThree/phone/"));
    assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "User-Agent"]);
    assert.equal(options.redirect, "error");
  }
});

test("이름이 바뀌어 서버 밖으로 나간 파일도 server-first", () => {
  const moved = { filename: "docs/Old.java", previous_filename: "server/data-api/src/main/java/Old.java", status: "renamed" };
  assert.equal(releaseVerdict(SV, compare([moved])).status, "server-first");
  assert.equal(releaseVerdict(SV, compare([{ filename: "docs/a.md", previous_filename: 5 }])).status, "ship");
});

test("링크는 github.com 의 이 저장소 경로만 통과한다", () => {
  const fallback = `https://github.com/OneOrThree/phone/compare/${SV}...main`;
  for (const bad of ["https://github.com/OneOrThree/phone/../../x", "https://evil.example/OneOrThree/phone/x",
    "https://github.com.evil.example/OneOrThree/phone/x", "javascript:alert(1)", "not a url", "https://github.com/OneOrThree/phone2/x"])
    assert.equal(releaseVerdict(SV, compare([], { html_url: bad })).compareUrl, fallback, bad);
  const good = `https://github.com/OneOrThree/phone/compare/a...b`;
  assert.equal(releaseVerdict(SV, compare([], { html_url: good })).compareUrl, good);
});

test("checkedAt 은 계산 시각이고 캐시 히트에서 유지된다", async () => {
  let clock = Date.parse("2026-11-02T00:00:00Z");
  const { fetchImpl } = fakeGithub();
  const status = createReleaseStatus({ fetchImpl, androidStoreVersion: android, now: () => clock });
  const first = await status();
  assert.equal(first.checkedAt, "2026-11-02T00:00:00.000Z");
  clock += 5 * 60000;
  assert.equal((await status()).checkedAt, first.checkedAt);
  clock += 6 * 60000;
  assert.equal((await status()).checkedAt, "2026-11-02T00:11:00.000Z");
});

test("문자열이 아닌 태그 이름은 던지지 않는다", async () => {
  const { fetchImpl } = fakeGithub({ "/tags": [null, { name: 5, commit: { sha: SV } }, { name: { x: 1 }, commit: { sha: SV } }] });
  const result = await createReleaseStatus({ fetchImpl, androidStoreVersion: android })();
  assert.equal(result.units.backoffice.commit, null);
  assert.equal(result.units.backoffice.tag, "backoffice-v1.0.5-V2");
});

test("거부된 promise 는 캐시에 남지 않고 다시 시도한다", async () => {
  let calls = 0;
  const now = () => { calls++; if (calls === 2) throw new Error("clock"); return 1000; };
  const { fetchImpl } = fakeGithub();
  const status = createReleaseStatus({ fetchImpl, androidStoreVersion: android, now });
  await assert.rejects(status(), /clock/);
  const result = await status();
  assert.equal(result.local, false);
});

// ---- 라우트 ----
const salt = "ab".repeat(16);
async function serve(t, mode, upstream, releaseStatus, environment = mode === "local" ? "local" : "prod") {
  const store = new Store(":memory:"), origin = "http://127.0.0.1:4310";
  const app = createApp({ store, origin, mode, environment, upstream, releaseStatus,
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
test("연결 모드(prod)는 인증 뒤 verifyEnvironment 없이 결과를 준다", async t => {
  let calls = 0;
  const releaseStatus = async (...args) => { calls++; assert.equal(args.length, 0); return { local: false, verdict: { status: "unknown" }, units: {}, androidStore: null }; };
  const upstream = { verifyEnvironment: async () => { throw new Error("서버 버전에 의존하지 않는다"); } };
  const { get } = await serve(t, "connected", upstream, releaseStatus);
  const [status, body] = await get();
  assert.equal(status, 200);
  assert.equal(body.local, false);
  assert.equal(calls, 1);
});

test("dev 연결 모드는 조회 없이 local 만 준다", async t => {
  let called = 0;
  const upstream = { verifyEnvironment: async () => { called++; return { data: { serverVersion: SV } }; } };
  const { get } = await serve(t, "connected", upstream, async () => { called++; return {}; }, "dev");
  assert.deepEqual(await get(), [200, { local: true }]);
  assert.equal(called, 0);
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
