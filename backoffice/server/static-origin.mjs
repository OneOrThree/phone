import { requireValue } from "./store.mjs";

// 꾸미기 아이템 그림은 앱이 쓰는 정적 파일(/static/customization/...)을 그대로 불러온다.
// 환경 기본값은 같은 파일을 주는 서버다. local 은 외부 요청이 없으므로 origin 이 없다(화면은 글자 자리표시).
// 소문자 DNS 이름(점 1개 이상). `*` 같은 와일드카드나 공백이 CSP img-src 를 넓히지 못하게 막는다.
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const DEFAULTS = { prod: "https://catus-api-v2.oneorthree.world", dev: "https://oneorthree-v2.dev.mooo.com" };
export function resolveStaticOrigin(mode, environment, value) {
  if (mode === "local") return null;
  if (value === undefined || value === "") return DEFAULTS[environment] ?? null;
  let parsed;
  try { parsed = new URL(value); } catch { parsed = null; }
  requireValue(parsed && parsed.protocol === "https:" && parsed.origin === value && HOST.test(parsed.hostname),
    "BACKOFFICE_STATIC_ORIGIN은 경로 없는 https 출처여야 합니다.");
  return value;
}
