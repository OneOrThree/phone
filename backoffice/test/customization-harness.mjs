import { scryptSync } from "node:crypto";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";

// focus-policy.test.mjs 와 같은 준비: 실제 Store·createApp·실제 HTTP 서버·scrypt 운영자, Data 만 스텁이다.
export const origin = "http://127.0.0.1:4310";
const salt = "ae".repeat(16);
export const operators = Object.fromEntries(["member-1", "member-2", "member-3"].map(actor =>
  [actor, { passwordHash: `${salt}:${scryptSync(actor, salt, 64).toString("hex")}` }]));
export async function startApp(t, upstream, { db = new Store(":memory:"), mode = "connected", environment = "dev", ...options } = {}) {
  const app = createApp({ store: db, upstream, operators, origin, mode, environment, ...options });
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { await new Promise(resolve => app.close(resolve)); db.close(); });
  async function login(actor) {
    const response = await fetch(`${base}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ actor, password: actor }) });
    return { Cookie: response.headers.get("set-cookie").split(";")[0], "X-CSRF-Token": (await response.json()).csrfToken };
  }
  const send = async (path, body, auth, method = "POST") => {
    const response = await fetch(base + path, { method, headers: { Origin: origin, "Content-Type": "application/json", ...auth },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  const get = async (path, auth) => {
    const response = await fetch(base + path, { headers: auth });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  return { base, db, login, send, get };
}
