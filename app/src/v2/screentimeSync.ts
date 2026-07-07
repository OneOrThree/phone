import AsyncStorage from '@react-native-async-storage/async-storage';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { saveScreenTime } from '@/services/screentimeApi';
import { STORAGE_KEYS } from '@/types/storage';
import { todayStr, yesterdayStr } from '@/utils/localDate';

// 스크린타임 사용량 서버 동기화(GROMO-633) — 네이티브 30분 버킷 측정값을 POST /screen-time으로
// 올려 daily_screen_time_stats(통계 화면 폰 사용량 지표의 소스)를 채운다.
// 서버는 (user, reportedAt의 유저 타임존 날짜) 기준 upsert 멱등 — 하루 여러 번 보내면 최신값으로 덮인다.
//
// 달성 여부 프로토콜:
//  - 당일 중간 동기화는 goalAchieved=false 고정. 스크린타임 달성(목표 '이내')은 하루가 끝나야
//    판정 가능하고, 중간에 true를 보내면 백엔드 false→true 전이 이벤트가 조기 발화한다(395 규칙).
//  - 날짜가 바뀐 뒤 첫 동기화에서 어제분을 마감 — 네이티브 최종 판정(getYesterdayResult)을
//    achieved에 싣고, 로컬에 보관해 둔 어제 분값을 함께 보낸다. 서버가 null 분값을 0으로
//    덮어쓰므로 분값을 생략하면 어제 중간 동기화 값이 소실된다.

// 마지막 성공 동기화 상태 — 어제분 마감(분값 보존)과 무변화 스킵 판단에 쓴다.
// 디바이스 전역 키라 계정을 함께 기록해 다른 계정의 기록에 오염되지 않게 한다.
interface ScreenTimeSyncState {
  userId: string;
  date: string; // 'YYYY-MM-DD'(로컬) — 이 날짜의 오늘값으로 minutes를 업로드했음
  minutes: number;
}

// 네이티브 버킷 상한(12h = 30분 눈금 × 24개). 목표 초과 사용도 실사용치로 집계해야 하므로
// 목표값이 아니라 측정 가능 최대치로 등록한다(네이티브가 720으로 클램프).
export const USAGE_BUCKET_MAX_MINUTES = 720;

// 30분 버킷 모니터링 등록 — 권한 허용 + 측정 대상 선택(App Group selection)이 있어야 성공(없으면 false).
// threshold 이벤트는 등록 시점의 selection 토큰으로 고정되므로, 측정 대상을 바꾸면(promoteSelection)
// 반드시 재등록해야 한다. 성공 시 플래그를 남겨 Syncer의 기존 유저 1회 등록과 중복되지 않게 한다.
export async function registerUsageBucketMonitoring(): Promise<boolean> {
  try {
    if ((await ScreenTimeModule.getAuthorizationStatus()) !== 'approved') return false;
    const ok = await ScreenTimeModule.startUsageBucketMonitoring(USAGE_BUCKET_MAX_MINUTES);
    if (ok) {
      await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, '1');
    }
    return ok;
  } catch {
    return false;
  }
}

// 어제 23:59(로컬)의 ISO instant — 마감 업로드의 reportedAt.
// 서버(ScreenTimeService)가 유저 타임존 날짜로 환산하므로 어제 행에 귀속된다.
function yesterdayEndInstant(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
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

// 사용량 동기화 본체 — 앱 시작·포그라운드 복귀마다 호출(ScreenTimeSyncer).
// 게스트·권한 미허용이면 아무것도 하지 않는다. 실패는 그대로 던져 호출부에서 무시 —
// 서버 upsert가 멱등이라 다음 포그라운드에서 최신값으로 다시 시도하면 된다.
export async function syncScreenTimeUsage(userId: string | null): Promise<void> {
  if (!userId) return; // 게스트 — 서버 통계 대상 아님
  if ((await ScreenTimeModule.getAuthorizationStatus()) !== 'approved') return;

  // 기존 허용 유저 마이그레이션 — 이 기능 배포 전에 권한·선택을 이미 마친 유저는 W10/설정의
  // 등록 시점을 다시 지나지 않으므로 여기서 1회 등록한다. 재등록은 당일 누적 threshold를
  // 리셋할 수 있어 성공 플래그로 1회만 — 이후엔 측정 대상 변경 시에만 재등록한다.
  try {
    const registered = await AsyncStorage.getItem(STORAGE_KEYS.screentimeBucketMonitorRegistered);
    if (!registered) await registerUsageBucketMonitoring(); // 선택 없으면 false → 플래그 없이 다음에 재시도
  } catch {
    // 등록 실패는 동기화와 무관 — 계속 진행
  }

  const today = todayStr();
  let last = await readSyncState(userId);

  // 어제분 마감 — 어제 중간 동기화 기록이 있고 네이티브 최종 판정이 있으면 어제 행을 확정한다.
  // 판정이 없으면(모니터링 미동작 등) 마감 생략 — 어제 행은 중간 동기화 값(achieved=false) 유지.
  // 이틀 이상 지난 기록은 판정 소스가 없어 마감 불가 — 이미 업로드된 중간값을 그대로 둔다.
  if (last && last.date === yesterdayStr()) {
    let result: 'success' | 'fail' | null = null;
    try {
      result = await ScreenTimeModule.getYesterdayResult();
    } catch {
      // 판정 조회 실패 → 이번엔 마감 생략(아래에서 상태만 오늘로 넘긴다)
    }
    if (result) {
      // 실패 시 상태를 어제로 보존한 채 중단 — 다음 포그라운드에서 마감부터 재시도.
      await saveScreenTime({
        actualScreenTimeMinutes: last.minutes,
        screenTimeGoalAchieved: result === 'success',
        reportedAt: yesterdayEndInstant(),
      });
    }
    // 마감 완료(또는 판정 없음) — 오늘 0분으로 상태를 넘겨 같은 날 마감이 반복되지 않게 한다.
    last = { userId, date: today, minutes: 0 };
    await writeSyncState(last);
  }

  // 오늘 사용량 중간 동기화 — 0이면 스킵: 미측정(선택 없음·첫 30분 미도달)과 구분이 안 되므로
  // 서버에 0분 행을 만들지 않는다.
  const minutes = await ScreenTimeModule.getTodayUsageBucketMinutes();
  if (minutes <= 0) return;
  if (last && last.date === today && last.minutes === minutes) return; // 변화 없음 — 스킵

  await saveScreenTime({
    actualScreenTimeMinutes: minutes,
    screenTimeGoalAchieved: false, // 중간 동기화는 미달성 고정 — 최종 판정은 다음날 마감에서
    reportedAt: new Date().toISOString(),
  });
  await writeSyncState({ userId, date: today, minutes });
}
