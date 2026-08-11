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

// 내 그리드 셀의 오늘 총 집중초 (GROMO-1246) — 멤버 셀과 **같은 원천**(서버 오늘 버킷)을 기준으로
// 삼고, 거기에 아직 서버에 없는 진행 중 세션 몫만 얹는다. 멤버 셀이 base + (now − focusStartedAt)
// 인 것과 같은 구조라 같은 그리드 안의 숫자가 상호 검증된다.
//   serverBase   — 서버 스냅샷의 내 오늘 집중초(멤버 목록과 같은 응답에서 뽑는다). 없으면 null.
//   serverDelta  — 미정산(업로드 전) 블록 중 서버 날짜 축의 오늘 몫.
//   localTotal   — 종전 로컬 집계(세션 전 몫 + 이 세션 정산분 + 미정산 몫, 기기 로컬 축).
//   sameAxis     — 서버 날짜 버킷과 기기 로컬 하루의 경계가 겹치는가(serverZoneAlignedWithLocal).
// 동축이면 max로 바닥을 깐다 — 정산 직후엔 그 블록이 serverDelta에서 빠지지만 다음 폴링 전까지는
// serverBase에도 없어, 서버 값만 쓰면 표시가 한 번 뒤로 밀린다(로컬 집계엔 이미 들어 있다).
// max라 이중 집계는 없고, 서버가 따라잡으면 서버 값이 그대로 이긴다(홈·결과 화면과 같은 관례).
// 축이 갈린 날의 로컬 집계는 다른 날짜 몫이라 섞지 않는다(GROMO-1236 P2 공용 규칙).
export function myLiveTotalSeconds({
  serverBase,
  serverDelta,
  localTotal,
  sameAxis,
}: {
  serverBase: number | null;
  serverDelta: number;
  localTotal: number;
  sameAxis: boolean;
}): number {
  if (serverBase == null) return localTotal; // 서버 스냅샷 미확보(그룹 미가입·조회 실패) — 종전 동작
  const serverTotal = serverBase + serverDelta;
  return sameAxis ? Math.max(serverTotal, localTotal) : serverTotal;
}
