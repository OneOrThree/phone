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
test("상류 통신은 고정 경로·actor별 자격·승인 payload를 사용", async () => {
  let request;
  const upstream = new Upstream({
    mode: "connected",
    notificationUrl: "http://internal:8082",
    fetchImpl: async (url, options) => {
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
  await upstream.publish(item, "member-2", { notificationToken: "secret" });
  assert.equal(
    request.url.href,
    "http://internal:8082/internal/admin/publications/publication",
  );
  assert.equal(request.options.headers["X-Console-Actor"], "member-2");
  assert.equal(request.options.headers["Idempotency-Key"], "id:3");
  assert.equal(JSON.parse(request.options.body).body, "확정본문");
  assert.equal(request.options.redirect, "error");
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
