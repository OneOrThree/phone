import { requireValue } from "./store.mjs";

export function validateOperators(operators, mode) {
  requireValue(operators && typeof operators === "object" && !Array.isArray(operators),
    "BACKOFFICE_OPERATORS 형식을 확인하세요.");
  const entries = Object.entries(operators);
  requireValue(entries.length >= (mode === "connected" ? 2 : 1),
    mode === "connected" ? "정책 2인 승인을 위해 연결 모드에는 운영자 2명 이상이 필요합니다."
      : "BACKOFFICE_OPERATORS에 운영자 암호 해시를 설정하세요. README를 참고하세요.");
  for (const [actor, operator] of entries) {
    requireValue(
      (mode === "local" ? actor === "test" || /^member-[1-3]$/.test(actor) : /^member-[1-3]$/.test(actor)) &&
        /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(operator?.passwordHash ?? ""),
      "운영자 계정 또는 비밀번호 해시 형식을 확인하세요.",
    );
    requireValue(
      mode !== "connected" || (typeof operator?.notificationToken === "string"
        && operator.notificationToken.length > 0
        && typeof operator?.dataToken === "string" && operator.dataToken.length > 0),
      "연결 모드에는 운영자별 두 서비스 토큰이 필요합니다.",
    );
  }
  return entries;
}

export async function verifyOperatorEnvironments(upstream, environment, entries) {
  for (const [actor, operator] of entries)
    await upstream.verifyEnvironment(environment, actor, operator);
}
