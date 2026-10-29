import { digest, immutableCache } from "./core.mjs";
export function baseUrl(base, { local = false } = {}) {
  const u = new URL(base);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    (u.protocol !== "https:" &&
      !(
        local &&
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      ))
  )
    throw Error("허용되지 않은 CDN origin");
  return u.origin;
}
export async function getVerified({
  base,
  key,
  bytes,
  sha256,
  mediaType,
  cacheControl = immutableCache,
  fetcher = fetch,
  local = false,
}) {
  const origin = baseUrl(base, { local });
  if (
    !/^(assets\/[a-f0-9]{64}\.png|releases\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/manifest\.json)$/.test(
      key,
    )
  )
    throw Error("잘못된 객체 경로");
  const response = await fetcher(`${origin}/${key}`, {
    redirect: "error",
    signal: AbortSignal.timeout(60000),
    headers: { "Accept-Encoding": "identity" },
  });
  if (response.status !== 200 || response.redirected)
    throw Error("CDN GET 실패");
  if (
    response.headers.get("content-type")?.split(";")[0] !== mediaType ||
    response.headers.get("cache-control") !== cacheControl ||
    ![null, "identity"].includes(response.headers.get("content-encoding"))
  )
    throw Error("CDN 헤더 불일치");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== bytes))
    throw Error("CDN 크기 불일치");
  let total = 0;
  const chunks = [];
  if (!response.body) throw Error("CDN 본문 없음");
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > bytes) throw Error("CDN 수신 상한 초과");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  if (total !== bytes || digest(body) !== sha256)
    throw Error("CDN 무결성 실패");
  return body;
}
