import { createServer } from "node:http";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { Failure, requireValue } from "./store.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const safeEqual = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
function verify(password, encoded) {
  if (
    typeof password !== "string" ||
    password.length > 1024 ||
    typeof encoded !== "string"
  )
    return false;
  const [salt, key] = encoded.split(":");
  if (!salt || !key) return false;
  return safeEqual(scryptSync(password, salt, 64).toString("hex"), key);
}
async function bodyOf(req) {
  requireValue(
    (req.headers["content-type"] ?? "").split(";")[0] === "application/json",
    "JSON 요청이 필요합니다.",
    415,
  );
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireValue(size <= 2 * 1024 * 1024, "요청이 너무 큽니다.", 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requireValue(
      body && typeof body === "object" && !Array.isArray(body),
      "JSON 객체가 필요합니다.",
    );
    return body;
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure(400, "JSON 형식이 올바르지 않습니다.");
  }
}
export function createApp({
  store,
  upstream,
  operators,
  origin,
  mode,
  environment = mode === "local" ? "local" : undefined,
  staticDir,
  secureCookie = mode === "connected",
  clock = Date.now,
}) {
  const sessions = new Map(),
    attempts = new Map();
  const cookie = (token, maxAge) =>
    `backoffice_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`;
  function session(req) {
    const raw = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("backoffice_session="))
      ?.slice(19);
    const key = raw ? hash(raw) : "";
    const value = sessions.get(key);
    if (!value || value.expires <= clock()) {
      sessions.delete(key);
      throw new Failure(401, "로그인이 필요합니다.");
    }
    return { ...value, key };
  }
  function rateLimit(req, actor) {
    const key = `${req.socket.remoteAddress}:${actor}`;
    const current = attempts.get(key);
    if (current && current.until > clock()) {
      requireValue(
        current.count < 10,
        "로그인 시도가 많습니다. 잠시 후 다시 시도하세요.",
        429,
      );
      current.count++;
    } else {
      if (attempts.size > 10000) attempts.clear();
      attempts.set(key, { count: 1, until: clock() + 15 * 60000 });
    }
    return key;
  }
  return createServer(async (req, res) => {
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    };
    const send = (status, value, extra = {}) => {
      res.writeHead(status, { ...headers, ...extra });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;
      if (!path.startsWith("/api/")) {
        requireValue(
          req.method === "GET" && staticDir,
          "찾을 수 없습니다.",
          404,
        );
        const asset = resolve(
          staticDir,
          path === "/" ? "index.html" : `.${decodeURIComponent(path)}`,
        );
        requireValue(
          asset.startsWith(resolve(staticDir) + sep),
          "찾을 수 없습니다.",
          404,
        );
        let file;
        let type;
        try {
          file = await readFile(asset);
          type = extname(asset);
        } catch {
          requireValue(!extname(path), "찾을 수 없습니다.", 404);
          file = await readFile(resolve(staticDir, "index.html"));
          type = ".html";
        }
        res.writeHead(200, {
          ...headers,
          "Content-Type":
            {
              ".html": "text/html; charset=utf-8",
              ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".svg": "image/svg+xml",
            }[type] ?? "application/octet-stream",
        });
        res.end(file);
        return;
      }
      const mutation = !["GET", "HEAD"].includes(req.method);
      if (mutation)
        requireValue(
          req.headers.origin === origin,
          "요청 출처가 올바르지 않습니다.",
          403,
        );
      if (path === "/api/login" && req.method === "POST") {
        const input = await bodyOf(req);
        const actor = typeof input.actor === "string" ? input.actor : "";
        requireValue(
          (mode === "local" && actor === "test") || /^member-[1-3]$/.test(actor),
          "운영자 계정을 확인하세요.",
          401,
        );
        const key = rateLimit(req, actor);
        const operator = operators[actor];
        // 존재하지 않는 계정도 같은 비용의 암호 검증을 수행한다.
        const valid = verify(
          input.password,
          operator?.passwordHash ?? `invalid:${"0".repeat(128)}`,
        );
        requireValue(
          operator && valid,
          "계정 또는 비밀번호가 올바르지 않습니다.",
          401,
        );
        attempts.delete(key);
        for (const [key, value] of sessions)
          if (value.expires <= clock()) sessions.delete(key);
        const token = randomBytes(32).toString("hex"),
          csrfToken = randomBytes(32).toString("hex");
        sessions.set(hash(token), {
          actor,
          csrfToken,
          expires: clock() + 8 * 3600000,
        });
        send(
          200,
          { actor, csrfToken, mode, environment },
          { "Set-Cookie": cookie(token, 8 * 3600) },
        );
        return;
      }
      const auth = session(req);
      if (mutation)
        requireValue(
          typeof req.headers["x-csrf-token"] === "string" &&
            safeEqual(req.headers["x-csrf-token"], auth.csrfToken),
          "요청 검증에 실패했습니다. 새로고침하세요.",
          403,
        );
      const operator = operators[auth.actor];
      if (path === "/api/session" && req.method === "GET") {
        send(200, { actor: auth.actor, csrfToken: auth.csrfToken, mode, environment });
        return;
      }
      if (path === "/api/logout" && req.method === "POST") {
        sessions.delete(auth.key);
        send(200, { ok: true }, { "Set-Cookie": cookie("", 0) });
        return;
      }
      if (path === "/api/items" && req.method === "GET") {
        send(200, { items: store.list() });
        return;
      }
      if (path === "/api/items" && req.method === "POST") {
        send(201, store.create(await bodyOf(req), auth.actor));
        return;
      }
      if (path === "/api/construction/policy" && req.method === "GET") {
        const value = mode === "local" ? store.localConstructionPolicy()
          : await upstream.constructionPolicy(auth.actor, operator);
        send(200, store.constructionSnapshot(value));
        return;
      }
      if (path === "/api/fcm/catalog" && req.method === "GET") {
        send(200, await upstream.catalog(auth.actor, operator));
        return;
      }
      if (path === "/api/magazine/preview" && req.method === "POST") {
        const input = await bodyOf(req);
        requireValue(
          typeof input.issueDate === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(input.issueDate) &&
            Number.isFinite(Date.parse(input.issueDate)),
          "발행 날짜를 확인하세요.",
        );
        requireValue(
          input.editorialBody === undefined ||
            (typeof input.editorialBody === "string" &&
              [...input.editorialBody].length <= 80),
          "편집부 소식은 80자 이내여야 합니다.",
        );
        const normalized = {
          issueDate: input.issueDate,
          ...(input.editorialBody
            ? { editorialBody: input.editorialBody }
            : {}),
        };
        send(
          200,
          store.snapshot(
            await upstream.preview(normalized, auth.actor, operator),
            normalized,
          ),
        );
        return;
      }
      const match = path.match(
        /^\/api\/items\/([0-9a-f-]+)(?:\/(review|approve|publish))?$/,
      );
      if (match) {
        const [, id, action] = match;
        if (!action && req.method === "GET") {
          send(200, store.get(id));
          return;
        }
        if (!action && req.method === "PATCH") {
          send(200, store.edit(id, await bodyOf(req), auth.actor));
          return;
        }
        if (action && req.method === "POST") {
          let item = store.transition(
            id,
            await bodyOf(req),
            auth.actor,
            action,
          );
          if (action === "publish") {
            try {
              const receipt = item.kind === "construction" && mode === "local"
                ? store.applyLocalConstructionPolicy(item, auth.actor)
                : await upstream.publish(item, auth.actor, operator);
              item = store.finish(id, receipt);
            } catch (error) {
              if (item.kind === "construction" && mode === "local") error.definite = true;
              item = store.finish(id, null, error);
            }
          }
          send(200, item);
          return;
        }
      }
      throw new Failure(404, "찾을 수 없습니다.");
    } catch (error) {
      send(error.status ?? 500, {
        error:
          error instanceof Failure
            ? error.message
            : "서버 처리 중 오류가 발생했습니다.",
      });
    }
  });
}
