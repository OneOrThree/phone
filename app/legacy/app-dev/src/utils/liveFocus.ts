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

// 랭킹 멤버의 '화면 축' 총 집중초 (GROMO-1606) — 확정 주간초 + (집중 중이면 진행 경과).
// 서버 랭킹 정렬이 이 값 기준이 되면서(정렬 키 = 확정 집계 + 진행 경과), 순서에서 파생되는
// 계산(나 대비 격차, 상위 100 평균)도 같은 값으로 해야 목록 순서·행 표시와 모순되지 않는다.
// 확정값끼리 빼면 라이브로 올라온 행(확정 600초 + 경과 3,600초)이 위에 있는데 격차가 음수로
// 계산돼 hms가 00:00:00으로 누르는 식으로 어긋난다(GROMO-1606 코덱스 리뷰).
// focusStartedAt은 서버가 정렬에 실제로 쓴 앵커(주 경계 세션은 주 시작으로 클램프된 값)라
// base + (now − focusStartedAt)이 정렬 점수와 정확히 같다.
export function memberLiveSeconds(
  member: {
    totalFocusSeconds: number;
    isFocusing?: boolean;
    focusStartedAt?: string | null;
  },
  now: number,
): number {
  return liveTotalSeconds(
    member.totalFocusSeconds,
    member.isFocusing === true ? member.focusStartedAt : null,
    now,
  );
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
//   settledFloor  — 마지막 정산 직후 확정된 KST 오늘 총합(호출부가 ref로 들고 있다가 넘긴다).
//   localFallback — 로컬 축 집계. 스냅샷 미확보 시의 대체값이자, 동축일 때의 하한 후보.
//   sameAxis      — 기기 로컬 하루와 KST 하루의 경계가 겹치는가(kstLocalSameDay).
//
// 되밀림 방지의 축은 settledFloor다(코덱스 리뷰 ③·④·⑧). 블록이 정산되면 delta가 0으로 리셋되는데
// 그 몫이 서버 스냅샷에 반영되기까지 폴링 한 주기(업로드가 대기열로 가면 더)가 걸린다.
// 호출부는 정산 **그 시점에** `max(그때의 serverBase, 직전 settledFloor) + 이번 블록의 KST 몫`으로
// 기준점을 확정한다. 그래서 이 값은 '정산분'이 아니라 '정산 직후의 총합'이고, 두 성질을 함께 만족한다.
//   ③·⑧ 새 블록의 delta가 이 총합 **위에** 쌓인다 — 뽀모도로 2번째 블록 진행이 그대로 보인다.
//   ④    서버가 그 정산분을 반영하면 serverBase가 같은 총합으로 수렴한다 — max라 이중 계상이 없다.
//        (정산 시점에 serverBase를 읽어 기준점을 잡으므로, 첫 스냅샷이 정산 뒤에 도착해도 부풀지 않는다.)
// 오늘 집중시간이 뒤로 가는 서버 정정은 없다고 본다 — 날짜가 바뀌면 호출부가 기준점을 0으로 리셋한다.
export function myLiveTotalSeconds({
  serverBase,
  delta,
  settledFloor,
  localFallback,
  sameAxis,
}: {
  serverBase: number | null;
  delta: number;
  settledFloor: number;
  localFallback: number;
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
  const floor = Math.max(settledFloor + delta, sameAxis ? localFallback : 0);
  return Math.max(serverBase + delta, floor);
}
