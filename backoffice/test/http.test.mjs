import test from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { Upstream } from "../server/upstream.mjs";
const salt = "ab".repeat(16),
  password = "local-test-password";
async function setup(t) {
  const store = new Store(":memory:");
  const origin = "http://127.0.0.1:4310";
  const app = createApp({
    store,
    origin,
    mode: "local",
    operators: {
      "member-1": {
        passwordHash: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      },
    },
    upstream: new Upstream({ mode: "local" }),
  });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => app.close(r));
    store.close();
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  return { base, origin };
}
test("인증/Origin/CSRF 경계와 세션 종료", async (t) => {
  const { base, origin } = await setup(t);
  assert.equal((await fetch(`${base}/api/items`)).status, 401);
  const post = (path, body, extra = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, ...extra },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await post(
        "/api/login",
        { actor: "member-1", password },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  const login = await post("/api/login", { actor: "member-1", password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  const { csrfToken } = await login.json();
  const headers = { Cookie: cookie, "X-CSRF-Token": csrfToken };
  assert.equal(
    (await post("/api/items", { kind: "notice" }, { Cookie: cookie })).status,
    403,
  );
  const created = await post(
    "/api/items",
    {
      kind: "notice",
      title: "공지",
      body: "내용",
      startsAt: "2026-10-29T00:00:00Z",
    },
    headers,
  );
  assert.equal(created.status, 201);
  let item = await created.json();
  for (const action of ["review", "approve", "publish"]) {
    const r = await post(
      `/api/items/${item.id}/${action}`,
      { revision: item.revision },
      headers,
    );
    assert.equal(r.status, 200);
    item = await r.json();
  }
  assert.equal(item.status, "published");
  assert.equal(item.receipt.local, true);
  await post("/api/logout", {}, headers);
  assert.equal(
    (await fetch(base + "/api/items", { headers: { Cookie: cookie } })).status,
    401,
  );
});
test("test 계정은 로컬에서만 로그인할 수 있다", async (t) => {
  for (const mode of ["local", "connected"]) {
    const store = new Store(":memory:");
    const app = createApp({
      store,
      upstream: {},
      operators: {
        test: {
          passwordHash: `${salt}:${scryptSync("test", salt, 64).toString("hex")}`,
        },
      },
      origin: "http://127.0.0.1:4310",
      mode,
    });
    await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      await new Promise((resolve) => app.close(resolve));
      store.close();
    });
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:4310" },
      body: JSON.stringify({ actor: "test", password: "test" }),
    });
    assert.equal(response.status, mode === "local" ? 200 : 401);
  }
});
test("상류 통신은 고정 경로·actor별 자격·승인 payload를 사용", async () => {
  let request;
  const checked = [];
  const upstream = new Upstream({
    mode: "connected",
    environment: "dev",
    expectedFcmProjectId: "gromo-dev",
    notificationUrl: "http://internal:8082",
    dataUrl: "http://data:8080",
    fetchImpl: async (url, options) => {
      if (options.method === "GET") {
        checked.push(url.pathname);
        return new Response(JSON.stringify({ environment: "dev", fcmProjectId: "gromo-dev" }));
      }
      request = { url, options };
      return new Response(JSON.stringify({ status: "PENDING" }), {
        status: 200,
      });
    },
  });
  const item = {
    id: "id",
    revision: 3,
    publicationId: "publication",
    kind: "fcm",
    title: "확정제목",
    body: "확정본문",
    targets: ["user"],
    data: {
      fcm: { kind: "ADMIN_ANNOUNCEMENT", locale: "ko", silent: false },
      payload: { route: "/home" },
    },
  };
  await upstream.publish(item, "member-2", { notificationToken: "secret", dataToken: "data-secret" });
  assert.deepEqual(checked, [
    "/internal/admin/content/environment",
    "/internal/admin/publications/environment",
  ]);
  assert.equal(
    request.url.href,
    "http://internal:8082/internal/admin/publications/publication",
  );
  assert.equal(request.options.headers["X-Console-Actor"], "member-2");
  assert.equal(request.options.headers["X-Backoffice-Environment"], "dev");
  assert.equal(request.options.headers["X-Backoffice-Fcm-Project"], "gromo-dev");
  assert.equal(request.options.headers["Idempotency-Key"], "id:3");
  assert.equal(JSON.parse(request.options.body).body, "확정본문");
  assert.equal(request.options.redirect, "error");
});
test("dev·prod 연결이 어긋나면 발행 전에 멈춘다", async () => {
  const requests = [];
  const operator = { dataToken: "data-secret", notificationToken: "notification-secret" };
  const upstream = new Upstream({
    mode: "connected",
    environment: "dev",
    expectedFcmProjectId: "gromo-dev",
    dataUrl: "http://data.internal",
    notificationUrl: "http://notification.internal",
    fetchImpl: async (url, options) => {
      requests.push({ path: url.pathname, method: options.method });
      return new Response(JSON.stringify({ environment: url.hostname === "data.internal" ? "prod" : "dev",
        fcmProjectId: "gromo-dev" }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const item = { id: "draft", revision: 1, publicationId: "publication", kind: "notice",
    title: "공지", body: "본문", startsAt: "2026-10-29T00:00:00Z" };
  await assert.rejects(upstream.publish(item, "member-1", operator), (error) =>
    error.status === 503 && error.definite === true && /환경/.test(error.message));
  await assert.rejects(upstream.preview({ issueDate: "2026-10-29" }, "member-1", operator), /환경/);
  assert.deepEqual(requests.map((request) => request.method), ["GET", "GET", "GET", "GET"]);
  assert.ok(requests.every((request) => request.path.endsWith("/environment")));
});
test("FCM 프로젝트가 다르면 알림 발송 전에 멈춘다", async () => {
  const methods = [];
  const upstream = new Upstream({
    mode: "connected", environment: "dev", expectedFcmProjectId: "gromo-dev",
    dataUrl: "http://data.internal", notificationUrl: "http://notification.internal",
    fetchImpl: async (url, options) => {
      methods.push(options.method);
      return new Response(JSON.stringify({ environment: "dev",
        fcmProjectId: url.hostname === "notification.internal" ? "gromo-prod" : undefined }));
    },
  });
  await assert.rejects(upstream.publish({ kind: "fcm" }, "member-1",
    { dataToken: "data", notificationToken: "notification" }), /FCM 프로젝트/);
  assert.deepEqual(methods, ["GET", "GET"]);
});
test("운영 이력은 환경을 확인한 뒤 원장과 게시 DB에서 읽는다", async () => {
  const paths = [];
  const upstream = new Upstream({
    mode: "connected", environment: "prod", expectedFcmProjectId: "gromo-prod",
    dataUrl: "http://data.internal", notificationUrl: "http://notification.internal",
    fetchImpl: async (url, options) => {
      paths.push(`${options.method} ${url.pathname}${url.search}`);
      if (url.pathname.endsWith("/environment"))
        return new Response(JSON.stringify({ environment: "prod", fcmProjectId: "gromo-prod" }));
      if (url.pathname.endsWith("/publications/history"))
        return new Response(JSON.stringify({ items: [{ id: "delivery", kind: "FRIEND_ACCEPTED", status: "SENT" }], nextCursor: null }));
      return new Response(JSON.stringify({ items: [{ id: "notice" }], total: 1, nextCursor: null }));
    },
  });
  const operator = { dataToken: "data-token", notificationToken: "notification-token" };
  const fcm = await upstream.history("fcm", "", "member-1", operator);
  const notice = await upstream.history("notice", "", "member-1", operator);
  assert.equal(fcm.items[0].notificationKind, "FRIEND_ACCEPTED");
  assert.equal(fcm.items[0].kind, "fcm");
  assert.equal(notice.total, 1);
  assert.ok(paths.includes("GET /internal/admin/publications/history?limit=50"));
  assert.ok(paths.includes("GET /internal/admin/content/history/notices?limit=50"));
  assert.equal(paths.filter(path => path.endsWith("/environment")).length, 4);
  assert.deepEqual(await new Upstream({ mode: "local" }).history("magazine", "", "test", {}),
    { items: [], total: 0, nextCursor: null });
});
test("정적 루트 제공과 경로 이탈 거부", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "backoffice-static-"));
  await writeFile(join(directory, "index.html"), "<h1>콘텐츠</h1>");
  const store = new Store(":memory:");
  const app = createApp({
    store,
    upstream: {},
    operators: {},
    origin: "http://localhost",
    mode: "local",
    staticDir: directory,
  });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => app.close(r));
    store.close();
    await rm(directory, { recursive: true });
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const root = await fetch(base + "/");
  assert.equal(root.status, 200);
  assert.match(await root.text(), /콘텐츠/);
  assert.equal((await fetch(base + "/%2e%2e%2fsecret")).status, 404);
});

test("건설 정책 조회·CSRF·승인 적용은 로컬 정책을 한 번만 전환한다", async t => {
  const { base, origin } = await setup(t);
  assert.equal((await fetch(base + "/api/construction/policy")).status, 401);
  let headers = { "Content-Type": "application/json", Origin: origin };
  const post = (path, body, override = headers) => fetch(base + path,
    { method: "POST", headers: override, body: JSON.stringify(body) });
  const login = await post("/api/login", { actor: "member-1", password });
  headers.Cookie = login.headers.get("set-cookie").split(";")[0];
  headers["X-CSRF-Token"] = (await login.json()).csrfToken;
  const policy = await (await fetch(base + "/api/construction/policy", { headers })).json();
  const input = { kind: "construction", title: "건설 정책 변경", data: { construction: {
    snapshotId: policy.snapshotId, digest: policy.digest,
    items: policy.items.map(row => ({ buildingId: row.buildingId, cost: row.cost + 10, buildSeconds: 0 })),
  } } };
  assert.equal((await post("/api/items", input, { ...headers, "X-CSRF-Token": "wrong" })).status, 403);
  let item = await (await post("/api/items", input)).json();
  assert.equal((await post(`/api/items/${item.id}/publish`, { revision: item.revision })).status, 409);
  for (const action of ["review", "approve", "publish"]) {
    const response = await post(`/api/items/${item.id}/${action}`, { revision: item.revision });
    assert.equal(response.status, 200);
    item = await response.json();
  }
  assert.equal(item.status, "published");
  assert.equal(item.receipt.local, true);
  assert.equal(item.receipt.costPolicyVersion, 2);
  const current = await (await fetch(base + "/api/construction/policy", { headers })).json();
  assert.equal(current.items[0].cost, 70);
  assert.equal(current.items[0].buildSeconds, 0);
  assert.equal((await post(`/api/items/${item.id}/publish`, { revision: item.revision })).status, 409);
});
