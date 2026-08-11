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
//   delta         — 미정산(업로드 전) 블록의 KST 오늘 몫.
//   localFallback — 로컬 축 집계. 스냅샷 미확보 시의 대체값이자, 동축일 때의 하한 후보.
//   shownFloor    — 같은 KST 날짜에 이미 표시했던 최대값(호출부가 ref로 들고 있다가 넘긴다).
//   sameAxis      — 기기 로컬 하루와 KST 하루의 경계가 겹치는가(kstLocalSameDay).
//
// 되밀림 방지는 **표시값의 단조성**으로 한다(코덱스 리뷰 ③·④). 블록이 정산되면 delta가 0으로
// 리셋되는데 그 몫이 서버 스냅샷에 반영되기까지는 폴링 한 주기(업로드가 대기열로 가면 더)가
// 걸린다 — 그 구간에 raw 값이 뒤로 밀리므로 직전 표시값을 바닥으로 깐다.
// 정산분을 따로 누적해 더하지 않는 이유: 그 방식은 "서버가 이 정산분을 이미 반영했는가"를
// 알아야 하는데 알 수 없어서, 첫 스냅샷이 정산 뒤에 도착하면 같은 블록을 두 번 센다(④).
// 단조 바닥값은 후보가 항상 raw 아니면 과거의 raw라 구조적으로 이중 계상이 불가능하다.
// 오늘 집중시간이 뒤로 가는 서버 정정은 없다고 본다 — 날짜가 바뀌면 호출부가 바닥을 0으로 리셋한다.
export function myLiveTotalSeconds({
  serverBase,
  delta,
  localFallback,
  shownFloor,
  sameAxis,
}: {
  serverBase: number | null;
  delta: number;
  localFallback: number;
  shownFloor: number;
  sameAxis: boolean;
}): number {
  // 서버 스냅샷 미확보(그룹 미가입·조회 실패·자정 넘겨 무효화) — 종전 로컬 집계로 폴백.
  // ⚠️ 폴백에는 바닥을 적용하지 않고, 호출부도 이 값을 바닥에 되먹이지 않는다(코덱스 리뷰 ⑥):
  // 로컬 축 값은 KST 날짜와 다른 몫이라 KST 바닥에 섞이면 안 된다. 비KST 기기가 KST 자정을
  // 넘긴 직후엔 스냅샷 기준일이 아직 전날이라 이 경로를 타는데, 그때 로컬 당일 누적(예: 5시간)이
  // 새 KST 날의 바닥으로 굳으면 다음 폴링이 올바른 작은 값을 줘도 max가 계속 이겨 과대 표시된다.
  // 폴백 값 자체는 로컬 축에서 이미 단조라 바닥 없이도 뒤로 밀리지 않는다.
  if (serverBase == null) return localFallback;
  // 동축이면 로컬 집계도 하한 후보다(코덱스 리뷰 ⑦) — 서버는 분 내림(GroupService `/ 60`)이라
  // 스냅샷이 도착하는 순간 초 단위 나머지가 잘려 타일이 최대 59초 뒤로 간다(첫 응답 전엔 초까지
  // 정확한 폴백을 보여주고 있었으므로 눈에 띄는 되밀림이다).
  // 경계가 겹칠 때만 섞는다 — 갈린 축의 로컬 누적은 다른 KST 날짜 몫이라 ⑥의 과대 표시가 된다.
  const floor = sameAxis ? Math.max(shownFloor, localFallback) : shownFloor;
  return Math.max(serverBase + delta, floor);
}
