import AsyncStorage from '@react-native-async-storage/async-storage';
import ScreenTimeModule from '@/services/ScreenTimeModule';
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
//    최종 눈금과 최종 판정(getYesterdayResult, 없으면 분값 근사 폴백)으로 어제 행을 확정한다.
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
}

// 네이티브 버킷 상한(15h = 15분 눈금 × 60개). 목표 초과 사용도 실사용치로 집계해야 하므로
// 목표값이 아니라 측정 가능 최대치로 등록한다(네이티브가 900으로 클램프).
export const USAGE_BUCKET_MAX_MINUTES = 900;

// 버킷 눈금(분) — 실제 눈금은 네이티브(ScreenTimeModule.swift의 step)가 정하므로 반드시 함께
// 바꾼다. 여기 값은 아래 등록 시그니처용 — 바뀌면 기존 설치가 새 눈금으로 1회 재등록된다(GROMO-931).
const USAGE_BUCKET_STEP_MINUTES = 15;

// 등록 시그니처(상한@눈금) — 등록 당시 값과 달라지면 Syncer가 감지해 재등록한다.
const USAGE_BUCKET_GRID = `${USAGE_BUCKET_MAX_MINUTES}@${USAGE_BUCKET_STEP_MINUTES}`;

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
        [STORAGE_KEYS.screentimeBucketMonitorMaxMinutes, USAGE_BUCKET_GRID],
      ]);
    }
    return ok;
  } catch {
    return false;
  }
}

// 목표 판정 모니터링(gromo.daily) 등록 — 어제 달성 판정(getYesterdayResult)의 소스.
// 선택 앱 누적이 목표초 threshold에 도달하면 Monitor가 초과 플래그를 세우고, 하루 종료 시
// success/fail을 기록한다. 등록된 목표초를 저장해 두고 값이 바뀔 때만 재등록한다 —
// 재등록은 당일 누적 threshold를 리셋하지만, 목표 변경은 발효일(내일) 첫 실행 직후라 손실이 미미.
export async function registerGoalMonitoring(goalSeconds: number): Promise<boolean> {
  if (goalSeconds <= 0) return false;
  try {
    if ((await ScreenTimeModule.getAuthorizationStatus()) !== 'approved') return false;
    const ok = await ScreenTimeModule.startGoalMonitoring(goalSeconds);
    if (ok) {
      await AsyncStorage.setItem(STORAGE_KEYS.screentimeGoalMonitorSeconds, String(goalSeconds));
    }
    return ok;
  } catch {
    return false;
  }
}

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
  if ((await ScreenTimeModule.getAuthorizationStatus()) !== 'approved') return;

  // 기존 허용 유저 마이그레이션 — 이 기능 배포 전에 권한·선택을 이미 마친 유저는 W10/설정의
  // 등록 시점을 다시 지나지 않으므로 여기서 1회 등록한다. 재등록은 당일 누적 threshold를
  // 리셋할 수 있어 등록 기록으로 1회만 — 이후엔 측정 대상 변경 시에만 재등록한다.
  // 기록 값 = 모니터 소유 계정. 소유 미상('1' — 구버전/로그인 전 등록)이면 현재 계정으로
  // 귀속시킨다(1기기 1계정 가정) — 어제분 마감의 계정 앵커로 쓰인다.
  let monitorOwner: string | null = null;
  try {
    monitorOwner = await AsyncStorage.getItem(STORAGE_KEYS.screentimeBucketMonitorRegistered);
    if (!monitorOwner) {
      // 선택 없으면 false → 기록 없이 다음에 재시도
      if (await registerUsageBucketMonitoring(userId)) monitorOwner = userId;
    } else if (monitorOwner === '1') {
      await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, userId);
      monitorOwner = userId;
    }
    // 눈금 변경 마이그레이션(GROMO-871 상한 12h→15h, GROMO-931 눈금 30분→15분) — 등록 당시
    // 시그니처가 현재와 다르면 재등록해 새 눈금을 적용한다. 구버전 마커('720'·'900')도 시그니처와
    // 달라 자연히 재등록된다. 재등록 직후 iOS의 threshold 연쇄 오발화는 네이티브 등록 시각
    // 가드가 걸러 안전. 재등록이 당일 누적 카운트를 리셋하는 손실은 1회성으로 감수한다.
    if (monitorOwner) {
      const registeredGrid = await AsyncStorage.getItem(
        STORAGE_KEYS.screentimeBucketMonitorMaxMinutes,
      );
      if (registeredGrid !== USAGE_BUCKET_GRID) {
        await registerUsageBucketMonitoring(monitorOwner); // 선택 없으면 false → 다음에 재시도
      }
    }
  } catch {
    // 등록 실패는 동기화와 무관 — 계속 진행
  }

  // 목표 판정 모니터링 등록/재등록 — 미등록이거나 목표가 바뀌었으면. 이게 없으면 gromo.daily가
  // 안 돌아 getYesterdayResult()가 영영 null → 어제 마감이 분값 근사 폴백으로만 동작한다.
  // (신규 유저는 목표가 온보딩 W12에서 정해지므로 W10이 아니라 여기서 첫 등록된다.)
  // 재등록 전에 읽은 등록 목표 = 어제 네이티브 판정에 쓰인 목표. 오늘 목표를 바꿔도 축하 문구가
  // 어제 기준으로 나오게 보관한다(코드리뷰 P2).
  let yesterdayGoalSeconds: number | null = null;
  try {
    const registeredGoal = await AsyncStorage.getItem(STORAGE_KEYS.screentimeGoalMonitorSeconds);
    yesterdayGoalSeconds = registeredGoal ? Number(registeredGoal) : null;
    if (goalSeconds > 0 && registeredGoal !== String(goalSeconds)) {
      await registerGoalMonitoring(goalSeconds); // 선택 없으면 false → 저장 없이 다음에 재시도
    }
  } catch {
    // 등록 실패는 동기화와 무관 — 계속 진행
  }

  const today = todayStr();
  const yesterday = yesterdayStr();
  let last = await readSyncState(userId);

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
      let result: 'success' | 'fail' | null = null;
      try {
        result = await ScreenTimeModule.getYesterdayResult();
      } catch {
        readsOk = false; // 판정 조회 실패 → 아래 분값 근사 폴백
      }
      // 판정도 사용 기록도 없으면 보낼 것이 없다 — 전송 없이 (읽기 성공 시) 마킹만.
      if (result !== null || finalMinutes > 0) {
        // 네이티브 판정이 없으면(목표 모니터링 미등록 기간 등) 분값 근사로 폴백 — 15분 눈금이라
        // 목표 직전 초과가 달성으로 후하게 잡힐 수 있고 목표도 오늘 값 기준인 근사지만,
        // 미달성으로 고정해 두는 것보다 정확하다.
        const achieved =
          result !== null
            ? result === 'success'
            : goalSeconds > 0 && finalMinutes <= goalSeconds / 60;
        // 실패 시 마킹 없이 중단(throw) — 다음 포그라운드에서 마감부터 재시도.
        await saveScreenTime({
          actualScreenTimeMinutes: finalMinutes,
          screenTimeGoalAchieved: achieved,
          reportedAt: localNoonInstant(yesterday),
          isFinal: true, // 어제분 마감 — 최종 보고(서버가 achieved 신뢰·395 발사)
        });
        // 마감도 동기화의 일종 — 설정 화면 '마지막 동기화' 표시를 갱신한다.
        await AsyncStorage.setItem(STORAGE_KEYS.screentimeLastSyncedDate, today);
        // 축하는 네이티브 '확정 성공'(result==='success')일 때만 예약(GROMO-629) — 오늘 첫 홈 진입에
        // 1회 노출. 분값 근사(result null·조회 실패)로는 예약하지 않는다 — 오판 방지(코드리뷰 P2).
        // 문구 'N시간 이내'의 목표는 어제 판정 기준 목표(yesterdayGoalSeconds)를 쓴다.
        if (result === 'success') {
          const goalMin =
            yesterdayGoalSeconds && yesterdayGoalSeconds > 0
              ? Math.round(yesterdayGoalSeconds / 60)
              : undefined;
          await scheduleYesterdayScreenTimeCelebration(yesterday, goalMin).catch(() => {});
        }
      }
      // 마킹은 읽기가 모두 성공했을 때만 — 부분 데이터로 보냈다면(위 upsert는 멱등) 다음
      // 포그라운드에서 온전한 값으로 한 번 더 확정한 뒤 마킹된다.
      if (readsOk) {
        await writeClosedDate(userId, yesterday);
      }
    }
  }

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
  await writeSyncState({ userId, date: today, minutes });
}
