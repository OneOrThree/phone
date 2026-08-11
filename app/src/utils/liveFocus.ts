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

// 내 그리드 셀의 오늘 총 집중초 (GROMO-1246) — 멤버 셀과 **같은 원천·같은 축**(서버 KST 오늘
// 버킷)으로 계산하고, 아직 서버 스냅샷에 없는 이 세션 몫만 얹는다. 멤버 셀이
// base + (now − focusStartedAt) 인 것과 같은 구조라 같은 그리드 안의 숫자가 상호 검증된다.
//
// 축은 전부 KST 하나다 — 서버는 GROMO-1259(ZonePolicy)부터 판정·저장·조회 버킷이 전부 KST
// 고정이라 기기 존과 무관하다. 그래서 기기 로컬 축 집계는 **서버 스냅샷을 못 받았을 때의
// 폴백**으로만 쓴다(로컬 축은 KST와 다른 날짜 몫일 수 있어 섞으면 안 된다).
//
//   serverBase    — 방금 폴링한 서버 스냅샷의 내 KST 오늘 집중초. 없으면 null.
//   sessionBase   — 이 세션 시작 시점(첫 스냅샷)의 같은 값. 정산분을 얹을 기준점.
//   settledServer — 이 세션이 KST 오늘로 정산한 누적 — 서버가 아직 반영 못 했을 수 있는 몫.
//   delta         — 미정산(업로드 전) 블록의 KST 오늘 몫.
//   localFallback — 서버 스냅샷 미확보 시 쓸 종전 로컬 축 집계.
//
// max가 두 국면을 모두 옳게 만든다(코덱스 리뷰 ③):
//   정산 직후·폴링 전 — serverBase는 아직 옛값, delta는 0으로 리셋 → sessionBase + settled 가 이겨
//                       방금 정산한 블록이 표시에서 사라지지 않는다.
//   폴링 반영 후     — serverBase가 그 정산분을 포함해 커진다 → serverBase가 이겨 이중 계상이 없다.
// 오프라인이라 업로드가 대기열에 남아도 sessionBase + settled 쪽이 계속 바닥을 지킨다.
export function myLiveTotalSeconds({
  serverBase,
  sessionBase,
  settledServer,
  delta,
  localFallback,
}: {
  serverBase: number | null;
  sessionBase: number | null;
  settledServer: number;
  delta: number;
  localFallback: number;
}): number {
  // 서버 스냅샷 미확보(그룹 미가입·조회 실패·자정 넘겨 무효화) — 종전 로컬 집계로 폴백
  if (serverBase == null || sessionBase == null) return localFallback;
  return Math.max(serverBase, sessionBase + settledServer) + delta;
}
