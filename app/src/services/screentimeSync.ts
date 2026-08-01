import AsyncStorage from '@react-native-async-storage/async-storage';
import ScreenTimeModule, { nativeRegistersBucketStep15 } from '@/services/ScreenTimeModule';
import { saveScreenTime } from '@/services/screentimeApi';
import { getHeatmap } from '@/services/statsApi';
import {
  readPendingScreenTimeCelebration,
  schedulePendingScreenTimeCelebration,
} from '@/services/screentimeCelebration';
import { STORAGE_KEYS } from '@/types/storage';
import type { HeatmapCellResponse } from '@/types/dto/stats';
import { todayStr, yesterdayStr, localDateStr } from '@/utils/localDate';

// 스크린타임 사용량 서버 동기화(GROMO-633) — 네이티브 15분 버킷 측정값을 POST /screen-time으로
// 올려 daily_screen_time_stats(통계 화면 폰 사용량 지표의 소스)를 채운다.
// 서버는 (user, reportedAt의 유저 타임존 날짜) 기준 upsert 멱등 — 하루 여러 번 보내면 최신값으로 덮인다.
//
// 달성 여부 프로토콜:
//  - 당일 중간 동기화는 goalAchieved=false 고정. 스크린타임 달성(목표 '이내')은 하루가 끝나야
//    판정 가능하고, 중간에 true를 보내면 백엔드 false→true 전이 이벤트가 조기 발화한다(395 규칙).
//  - 날짜가 바뀐 뒤 첫 동기화에서 어제분을 마감(GROMO-627) — Monitor가 하루 경계에 보존한 전일
//    최종 눈금(버킷)으로 어제 행을 확정하고, 달성은 '버킷 사용시간 ≤ 목표'로 판정한다(GROMO-942).
//    Monitor는 앱과 무관하게 돌므로 어제 앱을 안 열었어도 마감되며, 처리한 날짜를 계정 스코프로
//    마킹해 같은 날짜 중복 전송을 막는다. 서버가 null 분값을 0으로 덮어쓰므로 분값은 반드시 함께 보낸다.
//
// reportedAt은 대상 날짜의 '로컬 정오' instant로 보낸다 — 서버는 reportedAt을 유저 타임존
// (country_code 파생, 미설정 시 UTC 폴백)의 날짜로 환산하는데 현재 앱은 countryCode를 보내지
// 않아 UTC 폴백 유저가 존재한다. 정오 instant는 기기 오프셋 UTC-11~+12 범위에서 UTC로 환산해도
// 같은 날짜라, 자정 경계(예: KST 아침 = UTC 전날 밤)의 날짜 오귀속을 막는다.

// 마지막 성공 동기화 상태 — 어제분 마감(분값 보존)과 무변화 스킵 판단에 쓴다.
// 디바이스 전역 키라 계정을 함께 기록해 다른 계정의 기록에 오염되지 않게 한다.
interface ScreenTimeSyncState {
  userId: string;
  date: string; // 'YYYY-MM-DD'(로컬) — 이 날짜의 오늘값으로 minutes를 업로드했음
  minutes: number;
  goalSeconds?: number; // 이 날짜에 유효했던 목표초 — 어제 마감을 '어제 목표'로 판정하기 위함(GROMO-942)
}

// 네이티브 버킷 상한(15h = 15분 눈금 × 60개). 목표 초과 사용도 실사용치로 집계해야 하므로
// 목표값이 아니라 측정 가능 최대치로 등록한다(네이티브가 900으로 클램프).
export const USAGE_BUCKET_MAX_MINUTES = 900;

// 네이티브 목표 쓰기 토큰 — '마지막 등록자만 쓴다'(GROMO-997 코드리뷰). 겹치는 쓰기 레이스가
// 둘 있다: (1) 로그아웃·계정 전환 teardown의 setGoalSeconds(0) '뒤'에 in-flight sync가 완료돼
// 이전 계정 목표·초과 알림 워커를 복원, (2) 목표 변경(PendingGoalApplier)으로 새 sync가
// 시작됐는데 늦게 끝난 구 sync가 새 목표를 옛값으로 덮음. 두 경우 모두 '나중에 시작한 쪽이
// 최신'이므로 카운터 하나로 처리한다 — sync는 진입 시 카운터를 올려 자기 토큰을 등록하고,
// 네이티브 목표 쓰기 직전에 자기 토큰이 여전히 최신일 때만 쓴다. teardown은 카운터만 올려
// (자기 등록 없이) 진행 중인 모든 sync의 쓰기를 무효화한 뒤 0을 쓴다. 스킵된 최신 목표는
// 다음 sync(새 토큰)가 다시 전달하므로 잃는 것이 없다.
let nativeGoalWriteToken = 0;

// 계정 teardown(로그아웃·계정 전환)이 setGoalSeconds(0)을 쓰기 '직전'에 호출 — 카운터만 올려
// 진행 중인 sync의 네이티브 목표 쓰기를 전부 무효화한다. 반드시 0 쓰기 '전'이어야 한다:
// 뒤에 올리면 구 토큰 sync가 그 사이에 0을 덮어쓰는 창이 남는다.
export function invalidateNativeGoalWrites(): void {
  nativeGoalWriteToken += 1;
}

// 버킷 눈금(분) — 실제 눈금은 네이티브(ScreenTimeModule.swift의 step)가 정하므로 반드시 함께
// 바꾼다. 여기 값은 아래 등록 시그니처용 — 바뀌면 기존 설치가 새 눈금으로 1회 재등록된다(GROMO-931).
const USAGE_BUCKET_STEP_MINUTES = 15;

// 등록 시그니처(상한@눈금) — 등록 당시 값과 달라지면 Syncer가 감지해 재등록한다.
// 실제 등록되는 눈금은 '네이티브 바이너리'가 정한다 — OTA로 새 JS만 받은 구 바이너리는 여전히
// 30분 눈금을 등록하므로 구 형식('900')을 그대로 써서 마커가 실제 눈금과 어긋나지 않게 하고,
// 새 바이너리 설치 후 첫 실행이 불일치를 감지해 재등록하게 한다(코드리뷰 반영).
const usageBucketGrid = (): string =>
  nativeRegistersBucketStep15()
    ? `${USAGE_BUCKET_MAX_MINUTES}@${USAGE_BUCKET_STEP_MINUTES}`
    : String(USAGE_BUCKET_MAX_MINUTES);

// 15분 버킷 모니터링 등록 — 권한 허용 + 측정 대상 선택(App Group selection)이 있어야 성공(없으면 false).
// threshold 이벤트는 등록 시점의 selection 토큰으로 고정되므로, 측정 대상을 바꾸면(promoteSelection)
// 반드시 재등록해야 한다. 성공 시 등록 기록을 남겨 Syncer의 1회 등록과 중복되지 않게 하고,
// 값에는 소유 계정(userId)을 기록한다 — 동기화 이력이 아직 없는 날(첫날 0분·업로드 실패)에도
// 이 계정의 측정으로 믿고 어제분을 마감할 앵커가 된다(리뷰 반영). 로그인 전(온보딩 W10) 등록은
// 소유 미상('1')으로 남기고 Syncer 첫 실행이 현재 계정으로 귀속시킨다.
export async function registerUsageBucketMonitoring(ownerUserId: string | null): Promise<boolean> {
  try {
    if ((await ScreenTimeModule.getAuthorizationStatus()) !== 'approved') return false;
    const ok = await ScreenTimeModule.startUsageBucketMonitoring(USAGE_BUCKET_MAX_MINUTES);
    if (ok) {
      // 등록 시그니처도 함께 기록 — 값 변경 시 Syncer가 감지해 재등록한다
      // (GROMO-871 상한 확장 → GROMO-931 눈금 세분화).
      await AsyncStorage.multiSet([
        [STORAGE_KEYS.screentimeBucketMonitorRegistered, ownerUserId ?? '1'],
        [STORAGE_KEYS.screentimeBucketMonitorMaxMinutes, usageBucketGrid()],
      ]);
    }
    return ok;
  } catch {
    return false;
  }
}

// (GROMO-942) 목표 판정 모니터(gromo.daily) 등록 함수는 폐지 — 달성 판정을 버킷 사용시간으로
// 일원화했다. 네이티브 startGoalMonitoring/getYesterdayResult는 더는 호출하지 않는다(휴면).

// 대상 날짜('YYYY-MM-DD')의 로컬 정오 ISO instant — reportedAt용(파일 상단 주석 참고).
function localNoonInstant(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

async function readSyncState(userId: string): Promise<ScreenTimeSyncState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeSyncState);
    if (!raw) return null;
    const state = JSON.parse(raw) as ScreenTimeSyncState;
    // 다른 계정의 기록이면 없는 것으로 취급 — 남의 분값으로 마감하거나 스킵하지 않는다.
    return state.userId === userId ? state : null;
  } catch {
    return null;
  }
}

async function writeSyncState(state: ScreenTimeSyncState): Promise<void> {
  // 표시용 키(설정 화면 '마지막 동기화')도 함께 갱신 — syncLabel()이 앞 10자리 날짜부를 읽는다.
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.screentimeSyncState, JSON.stringify(state)],
    [STORAGE_KEYS.screentimeLastSyncedDate, state.date],
  ]);
}

// 어제분 마감 처리 완료 마킹 — 계정 스코프 {userId, date}. 마킹된 날짜는 다시 마감하지 않는다.
async function readClosedDate(userId: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeLastClosedDate);
    if (!raw) return null;
    const mark = JSON.parse(raw) as { userId: string; date: string };
    return mark.userId === userId ? mark.date : null;
  } catch {
    return null;
  }
}

async function writeClosedDate(userId: string, date: string): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEYS.screentimeLastClosedDate,
    JSON.stringify({ userId, date }),
  );
}

// 어제 스크린타임 목표 달성 축하 예약(GROMO-629). '연속 목표달성'은 heatmap의
// screenTimeGoalAchieved를 어제(달성일)부터 뒤로 세어 계산한다 — 포커스 목표 스트릭과 동일 방식
// (별도 API 불필요, 실패한 날은 heatmap 갭이라 자연히 리셋). 조회 실패 시 연속 1일로 폴백.
async function scheduleYesterdayScreenTimeCelebration(
  achievedDate: string,
  goalMinutes?: number,
): Promise<void> {
  const today = todayStr();
  // 하루 1회 가드 — 오늘 이미 노출했거나 이미 오늘 예약이 있으면 재계산·재예약하지 않는다.
  if ((await AsyncStorage.getItem(STORAGE_KEYS.screentimeLastRewardedDate)) === today) return;
  if ((await readPendingScreenTimeCelebration())?.date === today) return;

  // achievedDate(어제)는 달성 확정 → 1일. 그 전날부터 60일 창을 넓혀가며 연속 달성일을 센다.
  let days = 1;
  const [ay, am, ad] = achievedDate.split('-').map(Number);
  const cursor = new Date(ay, am - 1, ad);
  cursor.setDate(cursor.getDate() - 1);
  const CHUNK_DAYS = 60;
  const MAX_CHUNKS = 12; // 상한 약 2년 — 과호출 방지
  for (let chunk = 0; chunk < MAX_CHUNKS; chunk += 1) {
    const to = new Date(cursor);
    const from = new Date(cursor);
    from.setDate(from.getDate() - (CHUNK_DAYS - 1));
    const cells = await getHeatmap(localDateStr(from), localDateStr(to)).catch(
      () => [] as HeatmapCellResponse[],
    );
    const achievedByDate = new Map(cells.map((c) => [c.date, c.screenTimeGoalAchieved]));
    let gapFound = false;
    for (let i = 0; i < CHUNK_DAYS; i += 1) {
      if (!achievedByDate.get(localDateStr(cursor))) {
        gapFound = true;
        break;
      }
      days += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    if (gapFound) break;
  }
  // 예약 payload의 date = 노출 대상일(오늘) — 홈의 'p.date === 오늘' 신선도 판정·닫기 기록 기준.
  await schedulePendingScreenTimeCelebration({ date: today, days, goalMinutes });
}

// 사용량 동기화 본체 — 앱 시작·포그라운드 복귀마다 호출(ScreenTimeSyncer).
// 게스트·권한 미허용이면 아무것도 하지 않는다. 실패는 그대로 던져 호출부에서 무시 —
// 서버 upsert가 멱등이라 다음 포그라운드에서 최신값으로 다시 시도하면 된다.
export async function syncScreenTimeUsage(
  userId: string | null,
  goalSeconds: number,
): Promise<void> {
  if (!userId) return; // 게스트 — 서버 통계 대상 아님
  // 자기 토큰 등록(첫 await 전 동기 실행 — 시작 순서 = 등록 순서) — 이후 새 sync나 teardown이
  // 카운터를 올리면 이 호출의 네이티브 목표 쓰기는 stale로 스킵된다(마지막 등록자만 쓴다).
  const myGoalWriteToken = ++nativeGoalWriteToken;
  if ((await ScreenTimeModule.getAuthorizationStatus()) !== 'approved') return;

  // gromo.daily 폐지 마이그레이션(GROMO-942) — 기존 설치에 남아있는 목표 판정 모니터를 1회 중지한다.
  // 달성 판정은 이제 버킷 사용시간으로 하므로 gromo.daily는 불필요(슬롯·RAM 낭비 제거). 멱등하지만
  // 플래그로 1회만. 신규 설치는 애초에 등록된 적 없어 중지가 no-op이고 플래그만 남는다.
  try {
    if (!(await AsyncStorage.getItem(STORAGE_KEYS.screentimeGoalMonitorStopped))) {
      // 실제 중지 성공(true) 시에만 마커 기록 — 구 바이너리(메서드 없음, false)는 새 바이너리
      // 설치 후 재시도하게 남겨둔다(코드리뷰 반영).
      if (await ScreenTimeModule.stopGoalMonitoring()) {
        await AsyncStorage.setItem(STORAGE_KEYS.screentimeGoalMonitorStopped, '1');
      }
    }
  } catch {
    // 중지 실패는 동기화와 무관 — 플래그 미기록으로 다음에 재시도
  }

  // 기존 허용 유저 마이그레이션 — 이 기능 배포 전에 권한·선택을 이미 마친 유저는 W10/설정의
  // 등록 시점을 다시 지나지 않으므로 여기서 1회 등록한다. 재등록은 당일 누적 threshold를
  // 리셋할 수 있어 등록 기록으로 1회만 — 이후엔 측정 대상 변경 시에만 재등록한다.
  // 기록 값 = 모니터 소유 계정. 소유 미상('1' — 구버전/로그인 전 등록)이면 현재 계정으로
  // 귀속시킨다(1기기 1계정 가정) — 어제분 마감의 계정 앵커로 쓰인다.
  let monitorOwner: string | null = null;
  // 이 sync '전'에 이미 버킷 모니터가 등록돼 있었는지 — 기존 설치는 어제도 측정이 돌았을 수 있어
  // 측정 시작일을 today가 아니라 어제로 잡는다(코드리뷰 P1: 업그레이드 첫날 어제 손실 방지).
  let monitorPreexisted = false;
  try {
    monitorOwner = await AsyncStorage.getItem(STORAGE_KEYS.screentimeBucketMonitorRegistered);
    monitorPreexisted = monitorOwner != null;
    if (!monitorOwner) {
      // 선택 없으면 false → 기록 없이 다음에 재시도
      if (await registerUsageBucketMonitoring(userId)) monitorOwner = userId;
    } else if (monitorOwner === '1') {
      await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, userId);
      monitorOwner = userId;
    }
  } catch {
    // 등록 실패는 동기화와 무관 — 계속 진행
  }
  // ⚠️ '눈금 변경 재등록'은 여기서 하지 않는다 — 재등록의 stopMonitoring이 한낮 intervalDidEnd를
  // 울려 어제 보존값(단일 슬롯)을 오늘 값으로 덮으므로, 아래 '어제분 마감'이 먼저 읽은 뒤에
  // 수행한다(코드리뷰 반영). 위 최초 등록은 기존 모니터가 없어 중지 콜백이 울리지 않아 안전.

  const today = todayStr();
  const yesterday = yesterdayStr();
  let last = await readSyncState(userId);

  // 어제 판정에 쓸 '어제 유효 목표'를 사용량 업로드와 분리해 영속한다(GROMO-942 코드리뷰 P1).
  // 매 sync마다 오늘 유효 목표를 {userId,today,goalSeconds}로 갱신 — 앱을 하루 한 번만 열어도
  // 그날 목표가 남는다. 아래 어제분 마감은 '갱신 전에 읽은' 이 값(어제분)으로 판정한다.
  let priorEffectiveGoal: { userId: string; date: string; goalSeconds: number } | null = null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeEffectiveGoal);
    priorEffectiveGoal = raw ? JSON.parse(raw) : null;
    await AsyncStorage.setItem(
      STORAGE_KEYS.screentimeEffectiveGoal,
      JSON.stringify({ userId, date: today, goalSeconds }),
    );
  } catch {
    // 기록 실패는 동기화와 무관 — 계속 진행
  }
  // 네이티브에도 오늘 유효 목표를 전달(GROMO-997) — 안드로이드는 날짜별 스냅샷으로 남겨
  // 목표 초과 알림(WorkManager 주기 체크)·어제 판정(getYesterdayResult)이 '그날 목표'
  // 기준으로 동작한다(매 sync 호출이라 앱을 하루 한 번만 열어도 그날 스냅샷이 남는 것도
  // 위 effectiveGoal과 같은 이유). iOS는 기존 App Group 기록의 동일값 재기록이라 무해.
  // 위 AsyncStorage 블록과 분리한 독립 가드(코드리뷰 반영) — 저장된 JSON이 깨져 위 catch로
  // 빠져도 네이티브 목표·워커 갱신은 매 sync 시도돼 스냅샷이 낡은 채 남지 않는다.
  // 토큰 확인(코드리뷰 반영) — 이 sync가 진행되는 동안 teardown이 0을 썼거나(로그아웃·계정
  // 전환) 더 새 sync가 등록됐다면(목표 변경) 여기서 쓰는 건 최신 목표를 덮는 stale 쓰기다.
  try {
    if (myGoalWriteToken === nativeGoalWriteToken) {
      await ScreenTimeModule.setGoalSeconds(goalSeconds);
    }
  } catch {
    // 전달 실패는 동기화와 무관 — 다음 sync에서 재시도
  }

  // 측정 시작일 기록(GROMO-942 코드리뷰 P1) — 이 계정으로 측정이 활성인 첫 시점을 남겨, 어제분
  // 마감이 '어제가 실제 측정된 날인지' 판단하는 앵커로 쓴다(신규 유저의 어제 0분 오달성 방지).
  // 이미 있으면 덮지 않는다(가장 이른 날 유지). 기존 설치(monitorPreexisted)는 어제도 측정이
  // 돌았을 수 있으므로 시작일을 어제로 잡아 업그레이드 첫날 어제를 잃지 않게 한다(코드리뷰 P1).
  if (monitorOwner === userId) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeMeasurementStartDate);
      const start = raw ? (JSON.parse(raw) as { userId: string; date: string }) : null;
      if (start?.userId !== userId) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.screentimeMeasurementStartDate,
          JSON.stringify({ userId, date: monitorPreexisted ? yesterday : today }),
        );
      }
    } catch {
      // 기록 실패는 동기화와 무관 — 계속 진행
    }
  }

  // 어제분 마감(GROMO-627) — 어제 동기화 기록이 없어도(하루 종일 앱 미실행·첫 15분 미도달)
  // Monitor는 앱과 무관하게 판정·최종 눈금을 남기므로 그것만으로 어제 행을 확정한다.
  // 분값은 max(하루 경계에 보존된 전일 최종 눈금, 어제 마지막 동기화 값) — 마지막 포그라운드
  // 이후 늘어난 사용분까지 반영.
  // Monitor 값은 기기 전역이라 현재 계정 앵커(동기화 이력 또는 모니터 등록 소유)가 있을 때만
  // 마감한다 — 계정 전환 직후 남의 사용 기록을 새 계정으로 올리지 않게(리뷰 반영). 등록 소유
  // 앵커 덕에 동기화 이력이 아직 없는 첫날(0분·업로드 실패)도 다음날 마감된다(리뷰 반영).
  const closedDate = await readClosedDate(userId);
  if (closedDate !== yesterday && (last !== null || monitorOwner === userId)) {
    if (last && last.date === today && last.minutes === 0) {
      // 구버전(633) 마감 직후 시그니처 — 옛 코드는 마감 후 상태를 {오늘, 0분}으로 덮었고
      // 마커는 없었다. OTA 직후 어제를 재전송하지 않게 마킹만 하고 넘어간다(리뷰 반영).
      // 새 코드는 {오늘, 0분}을 쓰지 않으므로(중간 동기화는 0분 스킵) 오탐 없음.
      await writeClosedDate(userId, yesterday);
    } else {
      // 네이티브 읽기가 하나라도 실패하면 마킹하지 않는다 — "보낼 것 없음"과 "조회 실패"를
      // 구분해, 일시 오류로 그 날이 영영 누락되지 않게(리뷰 반영). 다음 포그라운드에서 재시도.
      let readsOk = true;
      let finalMinutes = last && last.date === yesterday ? last.minutes : 0;
      try {
        finalMinutes = Math.max(
          finalMinutes,
          await ScreenTimeModule.getYesterdayUsageBucketMinutes(),
        );
      } catch {
        readsOk = false; // 보존값 조회 실패 — 어제 동기화 값(있다면)으로 일단 마감 시도
      }
      // 목표 달성 판정을 gromo.daily 네이티브 모니터에서 '버킷 사용시간 ≤ 목표'로 일원화(GROMO-942)
      // — 화면에 뜨는 값(버킷)과 판정 근거를 통일하고, gromo.daily 재등록 타이밍 문제(측정 대상
      // 변경 시 목표 전환 갭·한낮 콜백 오염)를 제거한다. 서버는 이미 클라가 보낸 achieved를 신뢰한다.
      //  · 목표는 '어제 유효 목표'로 판정한다 — 사용량과 분리 영속한 effectiveGoal(어제분)을
      //    우선 쓰고, 없으면 어제 sync state의 goalSeconds, 그것도 없으면 현재값으로 폴백.
      //    오늘부터 목표가 바뀌었어도 어제를 어제 기준으로 본다(코드리뷰).
      //  · 버킷 0분 = '측정 중 15분 미만 사용' = 달성이지만, '어제 실제로 측정된 날'일 때만 그렇게
      //    본다 — 오늘 처음 측정 시작한 신규 유저의 어제(측정 안 됨)를 0분 달성으로 조작하지 않게,
      //    측정 시작일(measurementStartDate)이 어제 이하이거나 사용분>0일 때만 마감한다(코드리뷰 P1).
      //  · 목표 미설정(0)이어도 사용량은 기록한다(통계 소스). 이땐 achieved=false 중립.
      let yesterdayGoalSeconds = goalSeconds;
      if (
        priorEffectiveGoal != null &&
        priorEffectiveGoal.userId === userId &&
        priorEffectiveGoal.date === yesterday
      ) {
        yesterdayGoalSeconds = priorEffectiveGoal.goalSeconds;
      } else if (last != null && last.date === yesterday && last.goalSeconds != null) {
        yesterdayGoalSeconds = last.goalSeconds;
      }
      let measuredYesterday = finalMinutes > 0;
      if (!measuredYesterday) {
        try {
          const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeMeasurementStartDate);
          const start = raw ? (JSON.parse(raw) as { userId: string; date: string }) : null;
          measuredYesterday = start != null && start.userId === userId && start.date <= yesterday;
        } catch {
          measuredYesterday = false;
        }
      }
      const haveFinal = readsOk || (last != null && last.date === yesterday);
      if (haveFinal && measuredYesterday && (finalMinutes > 0 || yesterdayGoalSeconds > 0)) {
        const achieved = yesterdayGoalSeconds > 0 && finalMinutes <= yesterdayGoalSeconds / 60;
        // 실패 시 마킹 없이 중단(throw) — 다음 포그라운드에서 마감부터 재시도.
        await saveScreenTime({
          actualScreenTimeMinutes: finalMinutes,
          screenTimeGoalAchieved: achieved,
          reportedAt: localNoonInstant(yesterday),
          isFinal: true, // 어제분 마감 — 최종 보고(서버가 achieved 신뢰·395 발사)
        });
        // 마감도 동기화의 일종 — 설정 화면 '마지막 동기화' 표시를 갱신한다.
        await AsyncStorage.setItem(STORAGE_KEYS.screentimeLastSyncedDate, today);
        // 달성이면 어제 달성 축하 예약(GROMO-629) — 오늘 첫 홈 진입에 1회. 판정이 곧 버킷 기준이라
        // achieved면 바로 예약한다(별도 확정 조건 불필요). 문구 목표는 어제 목표 기준.
        if (achieved) {
          await scheduleYesterdayScreenTimeCelebration(
            yesterday,
            Math.round(yesterdayGoalSeconds / 60),
          ).catch(() => {});
        }
      }
      // 마킹은 읽기가 모두 성공했을 때만 — 부분 데이터로 보냈다면(위 upsert는 멱등) 다음
      // 포그라운드에서 온전한 값으로 한 번 더 확정한 뒤 마킹된다.
      if (readsOk) {
        await writeClosedDate(userId, yesterday);
      }
    }
  }

  // A안(GROMO-942) 측정 대상 변경 '다음날 적용' 처리 — 익스텐션 자정 콜백이 pending을 승격·버킷
  // 재등록했거나(대개), 자정을 놓쳐 아직 pending이면 여기서 승격한다. 적용 예정일(로컬)이 도래한
  // 경우에만. 어제분 마감 '뒤'에 둔다 — 승격이 버킷을 재등록하면 한낮 intervalDidEnd가 어제
  // 보존값을 건드릴 수 있어서(GROMO-931과 같은 이유). 목표 달성 판정은 버킷 사용시간으로 일원화돼
  // 별도 목표 모니터 재등록이 없다(버킷만 새 선택으로 살아있으면 판정도 새 대상 기준이 됨).
  try {
    const applyDate = await AsyncStorage.getItem(STORAGE_KEYS.selectionApplyDate);
    if (applyDate && applyDate <= today) {
      // 익스텐션이 자정에 승격했으면(pending 없음) promoteSelection은 false, 놓쳤으면 여기서 승격.
      await ScreenTimeModule.promoteSelection();
      // 익스텐션이 자정에 승격+버킷 등록에 성공했는지 확인 — 성공했으면(promotedOkDate == applyDate)
      // 그 깨끗한 자정 등록(base=0)을 건드리지 않는다. 여기서 재등록하면 자정 이후 자투리(최대
      // 14분)가 유실되기 때문(코드리뷰 반영). 익스텐션이 놓쳤거나(pending 남아 앱이 승격) 자정
      // startMonitoring이 실패한 경우에만 앱이 복구 재등록한다(옛 모니터는 이미 중지됨).
      const debug = await ScreenTimeModule.getUsageBucketDebugInfo().catch(() => null);
      const extPromotedOk = debug?.promotedOkDate === applyDate;
      const bucketOk = extPromotedOk
        ? true // 자정 등록이 이미 깨끗함 — 재등록 불필요
        : monitorOwner
          ? await registerUsageBucketMonitoring(monitorOwner)
          : false;
      if (bucketOk) {
        await AsyncStorage.removeItem(STORAGE_KEYS.selectionApplyDate);
        await ScreenTimeModule.setPendingSelectionApplyDate(''); // App Group 예약도 정리(멱등)
      }
    }
  } catch {
    // 승격/재등록 실패 — 마커를 안 지웠으면 다음 포그라운드에서 자동 재시도
  }

  // 눈금 변경 마이그레이션(GROMO-871 상한 12h→15h, GROMO-931 눈금 30분→15분) — 등록 당시
  // 시그니처가 현재(네이티브가 등록할 눈금)와 다르면 재등록해 새 눈금을 적용한다. 구버전
  // 마커('720'·'900')도 자연히 걸린다. 반드시 어제분 마감 '뒤'에 수행 — 재등록의 stopMonitoring이
  // 한낮 intervalDidEnd로 어제 보존값을 덮기 때문(코드리뷰 반영). 재등록 직후 iOS의 threshold
  // 연쇄 오발화는 네이티브 등록 시각 가드가 걸러 안전하고, 당일 누적 리셋 손실은 1회성으로
  // 감수한다(베이스 합산으로 보존).
  try {
    if (monitorOwner) {
      const registeredGrid = await AsyncStorage.getItem(
        STORAGE_KEYS.screentimeBucketMonitorMaxMinutes,
      );
      if (registeredGrid !== usageBucketGrid()) {
        await registerUsageBucketMonitoring(monitorOwner); // 선택 없으면 false → 다음에 재시도
      }
    }
  } catch {
    // 등록 실패는 동기화와 무관 — 계속 진행
  }

  // 목표 판정 모니터(gromo.daily)는 폐지됐다(GROMO-942) — 달성 판정을 버킷 사용시간으로 일원화하고
  // 별도 목표 모니터를 두지 않는다. 그래서 여기서 목표 모니터를 등록/재등록하지 않는다.

  // 지난 중간 동기화 행 확정 — 며칠 만의 실행이면 last.date가 어제보다 과거일 수 있다. 그 날의
  // 네이티브 판정·보존 눈금은 이미 다음 날들로 덮여 없으므로, 업로드해 둔 분값 그대로 달성
  // 여부만 근사 확정한다(리뷰 반영 — 영영 미달성으로 남는 것 방지). 달성으로 뒤집히는 경우만
  // 전송 — 아니면 이미 저장된 false가 곧 결과다. 처리 후 상태를 지워 반복을 막는다.
  if (last && last.date !== today && last.date !== yesterday) {
    if (goalSeconds > 0 && last.minutes > 0 && last.minutes <= goalSeconds / 60) {
      // 실패 시 상태를 보존한 채 중단(throw) — 다음 포그라운드에서 재시도.
      await saveScreenTime({
        actualScreenTimeMinutes: last.minutes,
        screenTimeGoalAchieved: true,
        reportedAt: localNoonInstant(last.date),
        isFinal: true, // 밀린 과거분 확정 — 최종 보고
      });
    }
    await AsyncStorage.removeItem(STORAGE_KEYS.screentimeSyncState);
    last = null;
  }

  // 오늘 사용량 중간 동기화 — 0이면 스킵: 미측정(선택 없음·첫 15분 미도달)과 구분이 안 되므로
  // 서버에 0분 행을 만들지 않는다.
  const minutes = await ScreenTimeModule.getTodayUsageBucketMinutes();
  if (minutes <= 0) return;
  if (last && last.date === today && last.minutes === minutes) return; // 변화 없음 — 스킵

  await saveScreenTime({
    actualScreenTimeMinutes: minutes,
    screenTimeGoalAchieved: false, // 중간 동기화는 미달성 고정 — 최종 판정은 다음날 마감에서
    reportedAt: localNoonInstant(today),
    isFinal: false, // 오늘 중간 동기화 — 서버는 total만 갱신, 달성 판정·알림 스킵
  });
  // 오늘 유효 목표를 함께 기록 — 내일 어제분 마감이 '어제 목표'로 판정하게 한다(GROMO-942, 코드리뷰).
  await writeSyncState({ userId, date: today, minutes, goalSeconds });
}
