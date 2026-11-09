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
import { createReleaseStatus } from "./release-status.mjs";
import { FocusPolicyStore, focusDigest, normalizeFocusPolicy } from "./focus-policy.mjs";
import { RewardPoolStore, poolDigest, normalizePool } from "./reward-pool.mjs";
import { CustomizationGrantStore, normalizeGrantInput } from "./customization-grant.mjs";
import { resolveStaticOrigin } from "./static-origin.mjs";
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
  staticOrigin = resolveStaticOrigin(mode, environment),
  secureCookie = mode === "connected",
  clock = Date.now,
  // 결과를 10분 캐시하므로 앱 생성 때 한 번만 만든다. 테스트는 대체 함수를 넣는다.
  releaseStatus = createReleaseStatus({ androidStoreVersion: () => upstream.androidStoreVersion() }),
}) {
  const sessions = new Map(),
    attempts = new Map();
  const policies = new FocusPolicyStore(store);
  const pools = new RewardPoolStore(store);
  const grants = new CustomizationGrantStore(store);
  const policyActions = new Set();
  const itemActions = new Set();
  async function withItemAction(id, work) {
    requireValue(!itemActions.has(id), "다른 항목 요청이 처리 중입니다. 잠시 후 다시 시도하세요.", 409);
    itemActions.add(id);
    try { return await work(); }
    finally { itemActions.delete(id); }
  }
  async function withPolicyAction(id, work) {
    requireValue(!policyActions.has(id), "다른 정책 요청이 처리 중입니다. 잠시 후 다시 시도하세요.", 409);
    policyActions.add(id);
    try { return await work(); }
    finally { policyActions.delete(id); }
  }
  function localPolicyCatalog() {
    const published = policies.list().filter(item => item.status === "published")
      .sort((a, b) => b.receipt.revision - a.receipt.revision);
    return published;
  }
  async function reconcileFocusPublication(item, actor, operator, error) {
    if (!item.publicationUncertain || error.status !== 409) return null;
    try {
      const catalog = await upstream.focusPolicy(actor, operator);
      const receipt = catalog.history?.find(entry => entry.publicationId === item.publicationId);
      if (receipt && receipt.approvedDigest === item.approvedDigest
        && focusDigest(receipt.policy) === item.approvedDigest) return { receipt };
      if (!receipt && Number.isInteger(catalog.current?.revision)
        && catalog.current.revision !== item.expectedRevision)
        return { error: Object.assign(error, { reconciled: true }) };
    } catch { /* 조회가 실패하거나 불일치하면 적용 결과를 단정하지 않는다. */ }
    return null;
  }
  // Data 승인 기록(발행 원장)과 현재 revision 으로 응답 유실 뒤 409 를 정산한다(집중 정책과 같다).
  async function reconcilePoolPublication(item, actor, operator, error) {
    if (!item.runUncertain || error.status !== 409) return null;
    try {
      const catalog = await upstream.rewardPool(actor, operator);
      const receipt = catalog.history?.find(entry => entry.publicationId === item.publicationId);
      if (receipt && receipt.approvedDigest === item.approvedDigest
        && poolDigest(receipt.productIds) === item.approvedDigest) return { receipt };
      if (!receipt && Number.isInteger(catalog.current?.revision)
        && catalog.current.revision !== item.expectedRevision)
        return { error: Object.assign(error, { reconciled: true }) };
    } catch { /* 조회가 실패하거나 불일치하면 발행 결과를 단정하지 않는다. */ }
    return null;
  }
  async function reconcileGrantExecution(item, actor, operator, error) {
    if (!item.runUncertain || error.status !== 409) return null;
    try {
      const entry = (await upstream.grantExecutions(actor, operator, 50)).find(value => value.grantId === item.grantId);
      if (entry?.approvalId === item.approvalId && entry.status === "COMPLETED") return { receipt: entry };
      if (entry?.approvalId === item.approvalId && entry.status === "RUNNING") return { running: entry };
      // 목록에 없다고 실행되지 않았다는 증거는 아니다. 최근 50건만 돌려주는 창이라, 그 뒤에 시작한 지급이 50건 이상이면
      // 실제로 실행된 grantId 도 빠진다. 그래서 없음은 판정하지 않고 uncertain 을 유지해 최초 실행자가 같은 grantId 로 재시도하게 한다.
    } catch { /* 조회가 실패하면 실행 결과를 단정하지 않는다. */ }
    return null;
  }
  // 같은 grantId 로 Data 가 COMPLETED 를 줄 때까지 최대 20번 부른다. 그래도 RUNNING 이면 executing 으로 두고 같은 실행자가 이어 간다.
  async function runGrant(id, revision, actor, operator) {
    let item = grants.transition(id, revision, actor, "run");
    try {
      let receipt;
      for (let attempt = 0; attempt < 20; attempt++) {
        receipt = await upstream.executeGrant(item, actor, operator);
        if (receipt?.grantId !== item.grantId || receipt.approvalId !== item.approvalId
          || !["RUNNING", "COMPLETED"].includes(receipt.status))
          throw new Failure(502, "지급 실행 응답이 요청과 다릅니다. 같은 요청으로 재시도하세요.");
        if (receipt.status === "COMPLETED") break;
        item = grants.progress(id, receipt);
      }
      return receipt.status === "COMPLETED" ? grants.finish(id, receipt) : item;
    } catch (error) {
      const resolution = await reconcileGrantExecution(grants.get(id), actor, operator, error);
      if (resolution?.receipt) return grants.finish(id, resolution.receipt);
      if (resolution?.running) return grants.progress(id, resolution.running);
      return grants.finish(id, null, resolution?.error ?? error);
    }
  }
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
        `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:${staticOrigin ? ` ${staticOrigin}` : ""}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
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
      if (path === "/api/system/versions" && req.method === "GET") {
        if (mode === "local") {
          send(200, { local: true, data: null, notification: null, infraRevision: null,
            iosStore: await upstream.iosStoreVersion() });
          return;
        }
        // 구버전 서버는 이 키들이 없다 -> null. iOS 조회는 실패해도 던지지 않는다.
        const [identity, iosStore] = await Promise.all([
          upstream.verifyEnvironment(environment, auth.actor, operator), upstream.iosStoreVersion()]);
        // 표시 전용 값이라 문자열이 아니면 버린다(앱 화면이 slice 로 죽지 않게).
        const str = v => { const t = typeof v === "string" ? v.trim() : ""; return t && t.toLowerCase() !== "unknown" ? t : null; };
        const pick = value => str(value?.serverVersion) || str(value?.schemaVersion)
          ? { serverVersion: str(value.serverVersion), schemaVersion: str(value.schemaVersion) } : null;
        // 운영에 적용된 Infra 구성 커밋은 Data 만 알려 준다(운영 배포가 Data 컨테이너에만 넣는다).
        send(200, { local: false, data: pick(identity.data), notification: pick(identity.notification),
          infraRevision: str(identity.data?.infraRevision), iosStore });
        return;
      }
      if (path === "/api/system/release-status" && req.method === "GET") {
        // dev 환경에서 운영 출시를 판정하면 안 되므로 prod 연결 모드에서만 조회한다.
        if (mode === "local" || environment !== "prod") { send(200, { local: true }); return; }
        send(200, await releaseStatus());
        return;
      }
      if (path === "/api/session" && req.method === "GET") {
        send(200, { actor: auth.actor, csrfToken: auth.csrfToken, mode, environment });
        return;
      }
      if (path === "/api/logout" && req.method === "POST") {
        sessions.delete(auth.key);
        send(200, { ok: true }, { "Set-Cookie": cookie("", 0) });
        return;
      }
      if (path === "/api/policies/focus" && req.method === "GET") {
        const catalog = await upstream.focusPolicy(auth.actor, operator);
        if (mode !== "local") { send(200, catalog); return; }
        const published = localPolicyCatalog();
        send(200, published.length ? { ...catalog,
          current: { revision: published[0].receipt.revision, policy: published[0].approvedPolicy,
            publishedAt: published[0].updatedAt },
          history: published.map(item => ({ publicationId: item.publicationId,
            revision: item.receipt.revision, previousRevision: item.expectedRevision,
            actor: item.dispatchActor, approvedBy: item.approvedBy,
            approvedDigest: item.approvedDigest, publishedAt: item.updatedAt,
            policy: item.approvedPolicy })),
        } : catalog);
        return;
      }
      if (path === "/api/policies/focus/drafts" && req.method === "GET") {
        send(200, { items: policies.list() });
        return;
      }
      if (path === "/api/policies/focus/drafts" && req.method === "POST") {
        send(201, policies.create(await bodyOf(req), auth.actor));
        return;
      }
      const focusMatch = path.match(/^\/api\/policies\/focus\/drafts\/([0-9a-f-]+)(?:\/(versions|review|approve|publish|cancel))?$/);
      if (focusMatch) {
        const [, id, action] = focusMatch;
        if (req.method === "GET" && !action) { send(200, policies.get(id)); return; }
        if (req.method === "GET" && action === "versions") { send(200, { items: policies.versions(id) }); return; }
        if (req.method === "PATCH" && !action) {
          const input = await bodyOf(req);
          send(200, await withPolicyAction(id, async () => {
            const approvalId = policies.changeRequest(id, input.revision);
            normalizeFocusPolicy(input.policy);
            requireValue(Number.isInteger(input.expectedRevision) && input.expectedRevision > 0,
              "현재 정책 revision을 확인하세요.");
            if (approvalId) await upstream.revokeFocusPolicy(approvalId, auth.actor, operator);
            return policies.edit(id, input, auth.actor);
          }));
          return;
        }
        if (req.method === "POST" && ["review", "approve", "publish", "cancel"].includes(action)) {
          const revision = (await bodyOf(req)).revision;
          const item = await withPolicyAction(id, async () => {
            if (action === "cancel") {
              const approvalId = policies.changeRequest(id, revision);
              if (approvalId) await upstream.revokeFocusPolicy(approvalId, auth.actor, operator);
              return policies.cancel(id, revision, auth.actor);
            }
            if (action === "approve") {
              const request = policies.beginApproval(id, revision, auth.actor);
              try {
                const approval = await upstream.approveFocusPolicy(request, auth.actor, operator);
                return policies.transition(id, revision, auth.actor, action, approval);
              } catch (error) {
                return policies.failApproval(id, error);
              }
            }
            let item = policies.transition(id, revision, auth.actor, action);
            if (action === "publish") {
              try {
                if (mode === "local") {
                  const current = localPolicyCatalog()[0]?.receipt.revision ?? 1;
                  if (item.expectedRevision !== current)
                    throw Object.assign(new Failure(409,
                      "현재 정책 revision이 변경되었습니다. 최신값으로 다시 검토하세요."), { definite: true });
                }
                item = policies.finish(id, await upstream.publishFocusPolicy(item, auth.actor, operator));
              }
              catch (error) {
                const resolution = await reconcileFocusPublication(item, auth.actor, operator, error);
                item = resolution?.receipt ? policies.finish(id, resolution.receipt)
                  : policies.finish(id, null, resolution?.error ?? error);
              }
            }
            return item;
          });
          send(200, item);
          return;
        }
      }
      if (path === "/api/customization/items" && req.method === "GET") {
        send(200, { ...await upstream.customizationItems(auth.actor, operator), staticOrigin });
        return;
      }
      if (path === "/api/customization/pool" && req.method === "GET") {
        send(200, await upstream.rewardPool(auth.actor, operator));
        return;
      }
      if (path === "/api/customization/pool/drafts" && req.method === "GET") {
        send(200, { items: pools.list() });
        return;
      }
      if (path === "/api/customization/pool/drafts" && req.method === "POST") {
        send(201, pools.create(await bodyOf(req), auth.actor));
        return;
      }
      const poolMatch = path.match(/^\/api\/customization\/pool\/drafts\/([0-9a-f-]+)(?:\/(review|approve|publish|cancel))?$/);
      if (poolMatch) {
        const [, id, action] = poolMatch;
        if (req.method === "GET" && !action) { send(200, pools.get(id)); return; }
        if (req.method === "PATCH" && !action) {
          const input = await bodyOf(req);
          send(200, await withPolicyAction(id, async () => {
            const approvalId = pools.changeRequest(id, input.revision);
            normalizePool(input.productIds);
            requireValue(Number.isInteger(input.expectedRevision) && input.expectedRevision > 0,
              "현재 추첨 풀 revision을 확인하세요.");
            // Data 승인 취소가 실패하면 수정도 하지 않는다(승인이 남은 채 내용만 바뀌면 안 된다).
            if (approvalId) await upstream.revokeRewardPool(approvalId, auth.actor, operator);
            return pools.edit(id, input, auth.actor);
          }));
          return;
        }
        if (req.method === "POST" && ["review", "approve", "publish", "cancel"].includes(action)) {
          const revision = (await bodyOf(req)).revision;
          send(200, await withPolicyAction(id, async () => {
            if (action === "cancel") {
              const approvalId = pools.changeRequest(id, revision);
              if (approvalId) await upstream.revokeRewardPool(approvalId, auth.actor, operator);
              return pools.cancel(id, revision, auth.actor);
            }
            if (action === "review") return pools.transition(id, revision, auth.actor, "review");
            if (action === "approve") {
              const request = pools.beginApproval(id, revision, auth.actor);
              try {
                const approval = await upstream.approveRewardPool(request, auth.actor, operator);
                return pools.transition(id, revision, auth.actor, "approve", approval);
              } catch (error) {
                return pools.failApproval(id, error);
              }
            }
            const item = pools.transition(id, revision, auth.actor, "run");
            try {
              return pools.finish(id, await upstream.publishRewardPool(item, auth.actor, operator));
            } catch (error) {
              const resolution = await reconcilePoolPublication(item, auth.actor, operator, error);
              return resolution?.receipt ? pools.finish(id, resolution.receipt)
                : pools.finish(id, null, resolution?.error ?? error);
            }
          }));
          return;
        }
      }
      if (path === "/api/customization/grants" && req.method === "GET") {
        send(200, { items: grants.list() });
        return;
      }
      if (path === "/api/customization/grants" && req.method === "POST") {
        send(201, grants.create(await bodyOf(req), auth.actor));
        return;
      }
      const grantMatch = path.match(/^\/api\/customization\/grants\/([0-9a-f-]+)(?:\/(preview|review|approve|execute|cancel))?$/);
      if (grantMatch) {
        const [, id, action] = grantMatch;
        if (req.method === "GET" && !action) { send(200, grants.get(id)); return; }
        if (req.method === "PATCH" && !action) {
          const input = await bodyOf(req);
          send(200, await withPolicyAction(id, async () => {
            const approvalId = grants.changeRequest(id, input.revision);
            normalizeGrantInput(input);
            if (approvalId) await upstream.revokeGrant(approvalId, auth.actor, operator);
            return grants.edit(id, input, auth.actor);
          }));
          return;
        }
        if (req.method === "POST" && ["preview", "review", "approve", "execute", "cancel"].includes(action)) {
          const revision = (await bodyOf(req)).revision;
          send(200, await withPolicyAction(id, async () => {
            if (action === "preview") {
              const input = grants.previewInput(id, revision);
              const result = await upstream.previewGrant(input, auth.actor, operator);
              return grants.savePreview(id, revision, result, auth.actor);
            }
            if (action === "cancel") {
              const approvalId = grants.changeRequest(id, revision);
              if (approvalId) await upstream.revokeGrant(approvalId, auth.actor, operator);
              return grants.cancel(id, revision, auth.actor);
            }
            if (action === "review") return grants.transition(id, revision, auth.actor, "review");
            if (action === "approve") {
              const request = grants.beginApproval(id, revision, auth.actor);
              try {
                const approval = await upstream.approveGrant(request, auth.actor, operator);
                return grants.transition(id, revision, auth.actor, "approve", approval);
              } catch (error) {
                return grants.failApproval(id, error);
              }
            }
            return runGrant(id, revision, auth.actor, operator);
          }));
          return;
        }
      }
      if (path === "/api/items" && req.method === "GET") {
        const archived = url.searchParams.get("archived");
        requireValue(archived === null || archived === "true", "목록 조건이 올바르지 않습니다.");
        send(200, { items: store.list({ archived: archived === "true" }) });
        return;
      }
      const historyKind = path.match(/^\/api\/history\/(fcm|notice|magazine)$/);
      if (historyKind && req.method === "GET") {
        const cursor = url.searchParams.get("cursor") ?? "";
        requireValue(cursor.length <= 200,
          "이력 페이지 번호가 올바르지 않습니다.");
        send(200, await upstream.history(historyKind[1], cursor, auth.actor, operator));
        return;
      }
      const magazineContent = path.match(/^\/api\/history\/magazine\/([^/]+)$/);
      if (magazineContent && req.method === "GET") {
        requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(magazineContent[1]),
          "잡지 번호가 올바르지 않습니다.");
        const cursor = url.searchParams.get("cursor") ?? "";
        requireValue(cursor.length <= 200, "잡지 페이지 번호가 올바르지 않습니다.");
        send(200, await upstream.magazineContent(magazineContent[1], cursor, auth.actor, operator));
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
        const cursor = url.searchParams.get("cursor") ?? "";
        requireValue(cursor.length <= 200,
          "알림 설정 페이지 번호가 올바르지 않습니다.");
        send(200, await upstream.catalog(auth.actor, operator, cursor));
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
        /^\/api\/items\/([0-9a-f-]+)(?:\/(review|approve|publish|cancel|cancel-delivery|withdraw|archive))?$/,
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
          const input = await bodyOf(req);
          const item = await withItemAction(id, async () => {
            if (["cancel", "cancel-delivery", "withdraw", "archive"].includes(action)) {
              const current = store.get(id);
              store.checkRevision(current, input);
              if (action === "cancel" || action === "archive")
                return store.lifecycle(id, input, auth.actor, action);
              if (action === "cancel-delivery") {
                requireValue(current.kind === "fcm" && current.status === "published",
                  "발송 요청된 운영 공지만 취소할 수 있습니다.", 409);
                const receipt = await upstream.cancelFcm(current.publicationId, auth.actor, operator);
                return store.lifecycle(id, input, auth.actor, action, receipt);
              }
              requireValue(current.kind === "notice" && current.status === "published",
                "게시된 개발자 공지만 노출 종료할 수 있습니다.", 409);
              const receipt = await upstream.withdrawNotice(current.publicationId, auth.actor, operator);
              return store.lifecycle(id, input, auth.actor, action, receipt);
            }
            let current = store.transition(id, input, auth.actor, action);
            if (action === "publish") {
              try {
                const receipt = current.kind === "construction" && mode === "local"
                  ? store.applyLocalConstructionPolicy(current, auth.actor)
                  : await upstream.publish(current, auth.actor, operator);
                current = store.finish(id, receipt);
              } catch (error) {
                if (current.kind === "construction" && mode === "local") error.definite = true;
                current = store.finish(id, null, error);
              }
            }
            return current;
          });
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
