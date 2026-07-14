// 집중 라이브 표시 공용 계산 (GROMO-658) — 656·658 그리드가 공유.

// 총 집중 초 = 누적 집계(baseSeconds) + 진행 중 세션 경과(now - startedAt).
// 서버 집계엔 진행 중 세션 경과가 빠져 있어 클라가 시작시각 기반으로 이어서 올린다.
// focusStartedAt 이 없으면(미집중) 누적분만 반환한다.
export function liveTotalSeconds(
  baseSeconds: number,
  focusStartedAt: string | null | undefined,
  now: number,
): number {
  const base = baseSeconds;
  if (!focusStartedAt) return base;
  return base + Math.max(0, (now - Date.parse(focusStartedAt)) / 1000);
}
