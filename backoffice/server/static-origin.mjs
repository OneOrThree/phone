import { requireValue } from "./store.mjs";

// 꾸미기 아이템 그림은 앱이 쓰는 정적 파일(/static/customization/...)을 그대로 불러온다.
// 환경 기본값은 같은 파일을 주는 서버다. local 은 외부 요청이 없으므로 origin 이 없다(화면은 글자 자리표시).
const DEFAULTS = { prod: "https://catus-api-v2.oneorthree.world", dev: "https://oneorthree-v2.dev.mooo.com" };
export function resolveStaticOrigin(mode, environment, value) {
  if (mode === "local") return null;
  if (value === undefined || value === "") return DEFAULTS[environment] ?? null;
  let parsed;
  try { parsed = new URL(value); } catch { parsed = null; }
  requireValue(parsed && parsed.protocol === "https:" && parsed.origin === value,
    "BACKOFFICE_STATIC_ORIGIN은 경로 없는 https 출처여야 합니다.");
  return value;
}
