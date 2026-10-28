import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ScreenTimeModule, {
  nativeRegistersBucketStep15,
  nativeSupportsUsageBucketEvents,
} from '@/services/ScreenTimeModule';
import type { UsageBucketEvent } from '@/services/ScreenTimeModule';
import { saveScreenTime } from '@/services/screentimeApi';
import { getHeatmap } from '@/services/statsApi';
import { getMyOpenBetSessionsWithToken } from '@/services/groupApi';
import { getFreshAccessToken, getUserIdFromToken } from '@/services/api';
import { putWindowUsage } from '@/services/windowUsageApi';
import {
  readPendingScreenTimeCelebration,
  schedulePendingScreenTimeCelebration,
} from '@/services/screentimeCelebration';
import {
  logScreentimeGoalEvaluated,
  logScreentimeWindowReported,
  logScreentimeWindowUnsupported,
} from '@/services/analyticsEvents';
import { STORAGE_KEYS } from '@/types/storage';
import type { HeatmapCellResponse } from '@/types/dto/stats';
import {
  todayStr,
  yesterdayStr,
  localDateStr,
  yesterdayStrKst,
  kstDateStr,
} from '@/utils/localDate';
import { timeStrToSeconds } from '@/utils/challengeTime';

// 스크린타임 사용량 서버 동기화(GROMO-633) — 네이티브 15분 버킷 측정값을 POST /screen-time으로
// 올려 daily_screen_time_stats(통계 화면 폰 사용량 지표의 소스)를 채운다.
// 서버는 (user, reportedAt의 KST 날짜) 기준 upsert 멱등 — 하루 여러 번 보내면 최신값으로 덮인다.
//
// 달성 여부 프로토콜:
//  - 당일 중간 동기화는 goalAchieved=false 고정. 스크린타임 달성(목표 '이내')은 하루가 끝나야
//    판정 가능하고, 중간에 true를 보내면 백엔드 false→true 전이 이벤트가 조기 발화한다(395 규칙).
//  - 날짜가 바뀐 뒤 첫 동기화에서 어제분을 마감(GROMO-627) — Monitor가 하루 경계에 보존한 전일
//    최종 눈금(버킷)으로 어제 행을 확정하고, 달성은 '버킷 사용시간 ≤ 목표'로 판정한다(GROMO-942).
//    Monitor는 앱과 무관하게 돌므로 어제 앱을 안 열었어도 마감되며, 처리한 날짜를 계정 스코프로
//    마킹해 같은 날짜 중복 전송을 막는다. 서버가 null 분값을 0으로 덮어쓰므로 분값은 반드시 함께 보낸다.
//
// reportedAt은 대상 날짜의 '로컬 정오' instant로 보낸다 — 이 모듈의 측정 축은 로컬(익스텐션이
// 로컬 하루로 버킷을 자른다)인데 서버 저장 축은 KST 고정이라(back ZonePolicy.KST, GROMO-1259 —
// 종전 주석의 'country_code 파생 존·UTC 폴백'은 그때 폐지됐다), 두 축을 잇는 값이 필요하다.
// 정오를 쓰는 이유: 자정을 쓰면 아주 작은 오프셋 차이로도 날짜가 넘어가는데, 정오는 그 여유를
// 최대로 벌어 준다. 다만 **모든 존을 덮지는 못한다** — 오프셋 X의 로컬 정오는 KST로 (21 − X)시라,
// 같은 날짜로 남는 조건은 0 ≤ 21 − X < 24, 즉 **X > UTC−3** 이다.
//   · UTC+9(KR)  정오 → KST 같은 날 12:00 ✅
//   · UTC+14     정오 → KST 같은 날 07:00 ✅  (동쪽 끝까지 안전 — 상한은 걸리지 않는다)
//   · UTC−2      정오 → KST 같은 날 23:00 ✅  (경계 직전)
//   · UTC−3      정오 → KST **다음 날** 00:00 ❌ (정확히 자정 경계)
//   · UTC−8(LA)  정오 → KST **다음 날** 05:00 ❌
// 즉 UTC−3 이하(미주 대부분)는 로컬 측정일 D의 보고가 KST D+1 버킷에 앉는다. 세 군데 쓰기 경로가
// 전부 같은 localNoonInstant를 쓰므로 **오프셋이 고정인 동안은** 시프트가 균일해 시리즈 전체가
// 하루씩 밀릴 뿐이다(수용된 한계 L5의 그림자 — docs/date-axis.md §6 G2).
// ⚠️ **다만 오프셋이 바뀌는 날에는 균일하지 않다 — 버킷 키가 단사(injective)가 아니게 된다.**
// DST 전환이나 여행으로 이웃한 두 날의 오프셋이 UTC−3 경계를 사이에 두면 **두 로컬 날짜가 같은
// KST 버킷으로 접힌다**. 예: America/St_Johns 2026-03-07 정오(UTC−3:30) → KST 03-08 00:30,
// 2026-03-08 정오(UTC−2:30) → KST 03-08 23:30 — **둘 다 03-08**이다. 서버는 (user, 날짜) upsert라
// 나중 보고가 앞 보고를 **덮어써 그 하루가 사라진다**. kstBucketDateOf 는 같은 접힘을 재현할 뿐
// 이미 덮인 셀을 되살리지 못한다 — 스트릭이 그 지점에서 끊기는 것은 조회 축이 아니라 **저장이
// 유실된** 결과다. 고치려면 reportedAt 자체가 로컬 날짜를 잃지 않아야 하고(예: 날짜를 별도 필드로
// 보내기), 그건 이 티켓 범위 밖이다(G2).
// ⚠️ 종전 주석의 'UTC-11~+12'는 검산 없이 쓴 오류였다(GROMO-1254 codex 게이트 P3): 서쪽을
// 통째로 안전하다고 했고 실제로 안전한 +13/+14를 예외로 들어 **양끝이 다 반대**였다.

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
      const owner = ownerUserId ?? '1';
      // 측정 시작일 앵커는 등록 마커와 '같은 multiSet'으로 묶는다(코드리뷰 반영) — 따로 쓰면
      // 두 쓰기 사이에 앱이 강제 종료됐을 때 마커만 남고 앵커가 없는 상태가 되고, 다음 동기화가
      // monitorPreexisted 추정 backfill(어제)을 타 이 티켓이 고치려는 오달성이 그대로 재발한다.
      const entries: [string, string][] = [
        // 등록 시그니처도 함께 기록 — 값 변경 시 Syncer가 감지해 재등록한다
        // (GROMO-871 상한 확장 → GROMO-931 눈금 세분화).
        [STORAGE_KEYS.screentimeBucketMonitorRegistered, owner],
        [STORAGE_KEYS.screentimeBucketMonitorMaxMinutes, usageBucketGrid()],
      ];
      const anchor = await nextMeasurementStartDate(owner);
      if (anchor != null) entries.push([STORAGE_KEYS.screentimeMeasurementStartDate, anchor]);
      await AsyncStorage.multiSet(entries);
    }
    return ok;
  } catch {
    return false;
  }
}

// 이번 등록으로 남길 측정 시작일 앵커 값(JSON) — 기존 앵커를 유지해야 하면 null을 돌려준다.
// 앵커를 '등록 시점'에 남기는 이유(GROMO-1083): 등록한 날이 곧 측정이 시작된 날이다. 어제분 마감은
// 이 앵커로 '어제가 실제 측정된 날인지'를 판단하는데, 앵커가 없으면 Syncer가 동기화 시점에 되짚어
// 추정할 수밖에 없고(아래 monitorPreexisted), 그 추정은 방금 등록한 모니터(온보딩 직후 가입·설정에서
// 첫 측정 시작)를 '예전부터 돌던 것'으로 오인해 어제 0분을 목표 달성으로 만든다.
// 이미 있으면 덮지 않는다(가장 이른 날 유지) — 소유 미상('1', 로그인 전 등록) 앵커도 날짜를 그대로
// 두고 Syncer 첫 실행이 현재 계정으로 귀속시킨다(모니터 소유 마커와 동일 규칙). 다른 계정의
// 앵커일 때만 이 등록 기준으로 새로 쓴다(계정 전환).
// ⚠️ 읽기 실패는 삼키지 않고 던진다(코드리뷰 반영) — 여기서 null로 눙치면 앵커만 빠진 채
// 등록 마커가 저장되고, 다음 동기화가 그 marker-only 상태를 '예전부터 돌던 모니터'로 읽어
// backfill(어제)을 타 이 티켓이 막으려는 오달성이 그대로 살아난다. 던지면 호출부가 등록
// 자체를 실패(false)로 처리해 마커도 안 남으므로, 다음 시도에서 깨끗하게 재등록된다.
async function nextMeasurementStartDate(owner: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeMeasurementStartDate);
  const start = parseMeasurementStartDate(raw);
  if (start != null && (start.userId === owner || start.userId === '1')) return null;
  return JSON.stringify({ userId: owner, date: todayStr() });
}

// 저장된 앵커 파싱 — 깨진 값은 '앵커 없음'으로 본다. 동기화 경로도 못 읽는 값이라(아래
// measuredYesterday 계산) 붙들고 있어 봐야 소용이 없고, 새로 써서 복구하는 편이 낫다.
// 읽기 실패와 달리 여기서 던지면 깨진 값이 남아 있는 한 등록이 영영 막힌다.
function parseMeasurementStartDate(raw: string | null): { userId: string; date: string } | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as { userId: string; date: string };
  } catch {
    return null;
  }
}

// (GROMO-942) 목표 판정 모니터(gromo.daily) 등록 함수는 폐지 — 달성 판정을 버킷 사용시간으로
// 일원화했다. 네이티브 startGoalMonitoring/getYesterdayResult는 더는 호출하지 않는다(휴면).

// 대상 날짜('YYYY-MM-DD')의 로컬 정오 ISO instant — reportedAt용(파일 상단 주석 참고).
function localNoonInstant(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

// 로컬 측정일('YYYY-MM-DD') → 그 날의 보고가 서버에서 앉는 **날짜 버킷**(GROMO-1254).
// 이 모듈의 측정·마감 축은 로컬(익스텐션 gregorianDayString)이지만, 서버는 우리가 보낸
// reportedAt(= localNoonInstant) instant를 **KST 고정**으로 잘라 버킷을 정한다
// (back ZonePolicy.KST — GROMO-1259가 country_code 파생 존을 폐지하고 저장·조회 축을 KST로 통일).
// 그래서 "서버 heatmap에서 이 측정일을 찾으려면 무슨 키인가"는 두 축의 합성이다.
//
// ⚠️ 존을 utils/serverZone(getServerZone)에서 읽지 않는다 — 그건 프로필 응답 캐시라
// 1259 이전에 저장된 값(예: Europe/London)이 남아 있고 콜드 스타트의 프로필 갱신이 실패하면
// 계속 그 과거 값을 돌려준다. 그 상태로 커서를 잡으면 스트릭이 엉뚱한 셀에서 시작해 1일로
// 끊긴다 — 이 함수가 고치려던 결함이 다른 원인으로 재현된다(codex pre-PR 게이트 P2).
function kstBucketDateOf(localDayKey: string): string {
  return kstDateStr(new Date(localNoonInstant(localDayKey)));
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
//
// ⚠️ 이 함수 안에는 **축이 두 개** 산다(GROMO-1254 — 하나로 합치면 반대쪽이 깨진다):
//  ① 하루 1회 가드·예약 신선도(today) = **로컬**. 달성 판정 자체가 로컬 축이기 때문이다 —
//     달성은 네이티브 버킷 분값(익스텐션 로컬 하루)을 로컬 목표와 비교해 앱이 내리고, 마감을
//     트리거하는 것도 로컬 자정 넘김(closedDate !== yesterdayStr())이다. 집중 목표 축하가
//     KST로 간 이유(goalCelebration — 달성 판정이 **서버** KST 버킷)가 여기엔 성립하지 않는다.
//     소비 측(HomeScreen p.date · screentimeLastRewardedDate)도 같은 로컬 축이라 체인이 온전하다.
//  ② 연속 달성일 카운트 = **서버 버킷 축(= KST 고정, back ZonePolicy.KST)**. 이건 서버 heatmap
//     셀을 뒤로 세는 데이터 결합 계산이라 커서·조회 창이 셀과 같은 축이어야 한다. 종전엔 로컬
//     측정일에서 그대로 후진해, 비KST 기기는 존재하는 셀을 못 찾아 스트릭이 매번 1일로 리셋됐다.
async function scheduleYesterdayScreenTimeCelebration(
  achievedDate: string,
  goalMinutes?: number,
): Promise<void> {
  const today = todayStr(); // ① 로컬 — 위 주석 참고
  // 하루 1회 가드 — 오늘 이미 노출했거나 이미 오늘 예약이 있으면 재계산·재예약하지 않는다.
  if ((await AsyncStorage.getItem(STORAGE_KEYS.screentimeLastRewardedDate)) === today) return;
  if ((await readPendingScreenTimeCelebration())?.date === today) return;

  // achievedDate(어제)는 달성 확정 → 1일. 그 전날부터 60일 창을 넓혀가며 연속 달성일을 센다.
  // ② 커서의 출발점은 로컬 측정일이 아니라 **그 보고가 서버에서 앉는 셀**이다 — 우리가 방금
  // saveScreenTime으로 올린 instant(localNoonInstant(achievedDate))를 KST로 자른 값.
  // 이후 산술은 이 문자열에 대한 순수 달력 산술이라, 아래 localDateStr는 존 변환이 아니라
  // parts 생성자로 만든 달력 Date의 포매팅이다(stats/format.heatmapRange와 같은 관례).
  let days = 1;
  const [ay, am, ad] = kstBucketDateOf(achievedDate).split('-').map(Number);
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

// 사용량 동기화 진입점 — 앱 시작·포그라운드 복귀마다 호출(ScreenTimeSyncer).
// 게스트·권한 미허용이면 아무것도 하지 않는다. 일일 동기화 실패는 그대로 던져 호출부에서 무시 —
// 서버 upsert가 멱등이라 다음 포그라운드에서 최신값으로 다시 시도하면 된다.
export async function syncScreenTimeUsage(
  userId: string | null,
  goalSeconds: number,
): Promise<void> {
  if (!userId) return; // 게스트 — 서버 통계 대상 아님
  if ((await ScreenTimeModule.getAuthorizationStatus()) !== 'approved') return;
  try {
    await syncDailyScreenTimeUsage(userId, goalSeconds);
  } finally {
    // 창 사용분 업로드(챌린지 확장 A4)는 일일 동기화와 독립 — 실패를 서로 전파하지 않는다.
    // 일일 동기화 '뒤'에 둔다: 모니터 소유 앵커('1' → 현재 계정 귀속)가 먼저 정리돼야 한다.
    await syncWindowUsage(userId).catch(() => {});
  }
}

// 일일 사용량 동기화 본체(GROMO-633) — 어제분 마감·마이그레이션·오늘 중간 동기화.
async function syncDailyScreenTimeUsage(userId: string, goalSeconds: number): Promise<void> {
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

  // 측정 시작일 기록(GROMO-942 코드리뷰 P1) — 이 계정으로 측정이 활성인 첫 시점을 남겨, 어제분
  // 마감이 '어제가 실제 측정된 날인지' 판단하는 앵커로 쓴다(신규 유저의 어제 0분 오달성 방지).
  // 앵커는 원칙적으로 등록 시점(registerUsageBucketMonitoring)에 사실대로 남는다 — 여기서는 그걸
  // 현재 계정에 귀속시키거나, 앵커가 아예 없는 옛 설치를 보정(backfill)하는 일만 한다.
  if (monitorOwner === userId) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeMeasurementStartDate);
      const start = raw ? (JSON.parse(raw) as { userId: string; date: string }) : null;
      if (start?.userId === '1') {
        // 로그인 전(온보딩) 등록이 남긴 소유 미상 앵커 — 등록 당시 날짜를 그대로 두고 현재
        // 계정으로 귀속시킨다(모니터 소유 '1' → userId 귀속과 동일 규칙). 날짜를 여기서 다시
        // 추정하지 않는 게 핵심 — 가입 직후 어제를 측정된 날로 오인해 0분을 달성으로 만들지
        // 않게 한다(GROMO-1083).
        await AsyncStorage.setItem(
          STORAGE_KEYS.screentimeMeasurementStartDate,
          JSON.stringify({ userId, date: start.date }),
        );
      } else if (start?.userId !== userId) {
        // 앵커가 없는 옛 설치 보정 — 기존 설치(monitorPreexisted)는 어제도 측정이 돌았을 수
        // 있으므로 시작일을 어제로 잡아 업그레이드 첫날 어제를 잃지 않게 한다(코드리뷰 P1).
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
        // 네이티브 최종 읽기가 실패한 경우에는 보존된 이전 값으로 서버 upsert만 시도하고,
        // GA4 평가는 다음 성공적인 읽기에서 한 번만 발행한다. closed-date 마커와 같은
        // 성공 경계를 사용해야 재시도마다 일일 평가가 중복되지 않는다.
        if (yesterdayGoalSeconds > 0 && readsOk) {
          logScreentimeGoalEvaluated({
            goal_met: achieved,
            actual_seconds: finalMinutes * 60,
            target_seconds: yesterdayGoalSeconds,
            window_date: yesterday,
            is_final: true,
          });
        }
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
  // 여부를 근사 확정한다. 성공·실패 모두 평가 이벤트를 남긴 뒤 상태를 지워 반복을 막는다.
  if (last && last.date !== today && last.date !== yesterday) {
    // 해당 날짜에 저장해 둔 목표를 우선 사용한다. 현재 목표로 판정하면 나중에 목표를
    // 변경한 사용자의 과거 달성 여부가 뒤집힌다(코드리뷰 반영).
    const backlogGoalSeconds = last.goalSeconds ?? goalSeconds;
    if (backlogGoalSeconds > 0 && last.minutes > 0) {
      const achieved = last.minutes <= backlogGoalSeconds / 60;
      // 실패 시 상태를 보존한 채 중단(throw) — 다음 포그라운드에서 재시도.
      await saveScreenTime({
        actualScreenTimeMinutes: last.minutes,
        screenTimeGoalAchieved: achieved,
        reportedAt: localNoonInstant(last.date),
        isFinal: true, // 밀린 과거분 확정 — 최종 보고
      });
      logScreentimeGoalEvaluated({
        goal_met: achieved,
        actual_seconds: last.minutes * 60,
        target_seconds: backlogGoalSeconds,
        window_date: last.date,
        is_final: true,
      });
    }
    await AsyncStorage.removeItem(STORAGE_KEYS.screentimeSyncState);
    last = null;
  }

  // 오늘 사용량 중간 동기화 — 0이면 스킵: 미측정(선택 없음·첫 15분 미도달)과 구분이 안 되므로
  // 서버에 0분 행을 만들지 않는다.
  // 측정 대상이 바뀌면 이 값은 옛 기준이 된다 — 쓰기 직전에 대조해 버린다(아래).
  const selectionStampBefore = await AsyncStorage.getItem(
    STORAGE_KEYS.screentimeSelectionChangedAt,
  );
  const minutes = await ScreenTimeModule.getTodayUsageBucketMinutes();
  if (minutes <= 0) return;
  if (last && last.date === today && last.minutes === minutes) return; // 변화 없음 — 스킵

  await saveScreenTime({
    actualScreenTimeMinutes: minutes,
    screenTimeGoalAchieved: false, // 중간 동기화는 미달성 고정 — 최종 판정은 다음날 마감에서
    reportedAt: localNoonInstant(today),
    isFinal: false, // 오늘 중간 동기화 — 서버는 total만 갱신, 달성 판정·알림 스킵
  });
  // ⚠️ 그 사이 측정 대상이 바뀌었으면 **이 값을 쓰지 않는다**(코드리뷰 10차). 위에서 잰
  //    분값은 바꾸기 전 기준이라, 여기서 쓰면 피커가 방금 지운 캐시를 되살린다. 그러면 다음날
  //    마감의 Math.max 가 그 옛 값을 채택해 최종 사용량과 목표 판정을 잘못 확정한다.
  //    (서버 중간 보고는 이미 나갔지만 isFinal:false 라 다음날 마감이 새 기준으로 덮는다.)
  const selectionStampAfter = await AsyncStorage.getItem(STORAGE_KEYS.screentimeSelectionChangedAt);
  if (selectionStampAfter !== selectionStampBefore) return;

  // 오늘 유효 목표를 함께 기록 — 내일 어제분 마감이 '어제 목표'로 판정하게 한다(GROMO-942, 코드리뷰).
  await writeSyncState({ userId, date: today, minutes, goalSeconds });
}

// ── SCREEN_TIME×TIME_WINDOW 창 사용분 계산·업로드 (그룹 챌린지 확장 A4) ─────────────
//
// N1 타임라인(getUsageBucketEvents)의 bucket은 원시 threshold 눈금이 아니라 '베이스+눈금'
// **하루 누적 환산분**(단조 증가)이다 — 분 단위 값을 그대로 쓰고 ×15 같은 변환은 금지(N1 계약).
// 임의 시각 T의 누적 사용분 f(T) = T 이하 마지막 발화의 bucket(창 시작 이전 발화 없으면 0).
// 타임라인의 날짜 키·하루 누적 리셋은 **기기 로컬** 자정 기준이다(익스텐션 gregorianDayString —
// 계약 §1 변경 금지 축). 그래서 창 사용분은 창 [S, E']를 로컬-일 세그먼트로 쪼개
// Σ(f(to)−f(from))로 합산한다 — 로컬 자정마다 누적이 0부터 다시 시작하므로 세그먼트별 차분의
// 합이 곧 창 전체 사용분이다(GROMO-1242).
//
// 축 분리(GROMO-1219 → GROMO-1242): 창(windowStart/End "HH:mm:ss")은 '매일 반복 시간대'고
// 서버 판정 축은 KST다 — 창 경계 epoch·보고 date는 KST 앵커로 만들고, 네이티브 조회 dayKey·
// 세그먼트 경계(자정)만 로컬 축을 탄다. 비KST 기기에서도 조회 키가 적재 키와 일치해
// #521 잔차였던 키 불일치 과소 측정이 해소된다.

// T(epoch초) 시점의 하루 누적 사용분 — T 이하 마지막 발화의 bucket, 발화 없으면 0.
// bucket이 단조 증가라 '마지막 발화'의 값이 곧 최댓값이지만, 기록 순서가 어긋나도 안전하게 최대로 잡는다.
export function cumulativeMinutesAt(events: UsageBucketEvent[], atEpochSec: number): number {
  let max = 0;
  for (const e of events) {
    if (e.firedAt <= atEpochSec && e.bucket > max) max = e.bucket;
  }
  return max;
}

// 한 날짜 키 타임라인의 [fromSec, toSec] 구간 사용분 — f(to) − f(from). 음수 방어 0.
function segmentMinutes(events: UsageBucketEvent[], fromSec: number, toSec: number): number {
  return Math.max(0, cumulativeMinutesAt(events, toSec) - cumulativeMinutesAt(events, fromSec));
}

// [startSec, endSec] 구간을 **기기 로컬** 날짜 경계(자정)로 쪼갠 세그먼트 목록(GROMO-1242).
// 네이티브 타임라인은 익스텐션이 기기 로컬 날짜로 적재·리셋하므로(gregorianDayString — 계약 §1
// 변경 금지 축) 조회 dayKey와 구간 경계는 반드시 이 로컬 축을 타야 한다.
//  · dayKey는 localDateStr 경유 — 익스텐션 gregorianDayString과 같은 결과(DST 포함)를 낸다.
//    (todayStr/yesterdayStr 금지 — 로컬 축 주입점을 localDateStr 하나로 통일한다.)
//  · 다음 로컬 자정은 dayKey를 파싱해 setDate 산법(new Date(y, m-1, d+1))으로 재물질화한다 —
//    epoch에 +86_400_000 가산은 DST 날(23/25h)에 경계가 어긋나므로 금지. 로컬 생성자는 자정이
//    존재하지 않는 TZ(DST 점프)도 유효 instant로 정규화한다.
//  · 종료 판정은 epoch 비교(boundary >= endSec) — 일수 카운트 없음. <24h 창은 최대 2세그먼트.
export function localDaySegments(
  startSec: number,
  endSec: number,
): { dayKey: string; fromSec: number; toSec: number }[] {
  const segments: { dayKey: string; fromSec: number; toSec: number }[] = [];
  let cursor = startSec;
  while (cursor < endSec) {
    const dayKey = localDateStr(new Date(cursor * 1000));
    const [y, m, d] = dayKey.split('-').map(Number);
    const boundarySec = Math.floor(new Date(y, m - 1, d + 1).getTime() / 1000);
    if (boundarySec >= endSec || boundarySec <= cursor) {
      // 마지막 세그먼트. boundary가 전진하지 않는 비정상(로컬 축 불일치)도 여기로 수렴시켜
      // 무한 루프를 막는다 — 실기기에선 '다음 로컬 자정 > cursor'가 항상 성립한다.
      segments.push({ dayKey, fromSec: cursor, toSec: endSec });
      break;
    }
    segments.push({ dayKey, fromSec: cursor, toSec: boundarySec });
    cursor = boundarySec;
  }
  return segments;
}

// 창 사용분 계산(순수 함수 — 단위 테스트 대상). localDaySegments가 쪼갠 세그먼트마다 해당
// 로컬 dayKey의 타임라인을 붙여 넘기면, 세그먼트별 f(to) − f(from)을 합산한다. 로컬 자정마다
// 누적이 0부터 다시 시작하므로 차분의 합이 곧 창 전체 사용분이다. 자정 정각 발화는 네이티브가
// 다음날 키에 적재하고(그 시점 누적은 리셋 직후라 ≈0) f(from)의 기준값으로만 쓰여 무해하다.
export function computeWindowUsedMinutes(p: {
  segments: { events: UsageBucketEvent[]; fromSec: number; toSec: number }[];
}): number {
  let total = 0;
  for (const seg of p.segments) total += segmentMinutes(seg.events, seg.fromSec, seg.toSec);
  return total;
}

// 'YYYY-MM-DD' **KST 자정** epoch초 + 하루 중 초 오프셋 — 창 경계 시각의 epoch초를 만든다.
// 창 날짜·시각은 서버가 KST로 판정하므로(GROMO-1219) 앵커도 KST다 — 로컬 자정을 쓰면 비KST
// 기기에서 창 경계가 몇 시간씩 밀려 남의 시간대 사용분을 보고한다. KST는 DST가 없어 고정
// 오프셋(+09:00) 파싱으로 충분하다(useLeagueRanking의 KST_OFFSET_MS와 같은 근거).
function epochSecAt(dateStr: string, secondsOfDay: number): number {
  return Date.parse(`${dateStr}T00:00:00+09:00`) / 1000 + secondsOfDay;
}

// 창 보고 상태 — 최종 보고 1회 보장(finals)과 중간 보고 무변화 스킵(last)에 쓴다.
// 디바이스 전역 키라 계정을 함께 기록한다(syncState와 같은 이유).
interface WindowReportState {
  userId: string;
  finals: string[]; // 최종 보고 완료 마커 'challengeId:date' — 이틀 지난 항목은 정리
  last: Record<string, { date: string; minutes: number }>; // 챌린지별 마지막 중간 보고
}

async function readWindowReportState(userId: string): Promise<WindowReportState> {
  const empty: WindowReportState = { userId, finals: [], last: {} };
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeWindowReports);
    if (!raw) return empty;
    const state = JSON.parse(raw) as WindowReportState;
    // 다른 계정의 기록이면 버린다 — 남의 보고 이력으로 스킵하지 않는다.
    if (state.userId !== userId) return empty;
    return { userId, finals: state.finals ?? [], last: state.last ?? {} };
  } catch {
    return empty;
  }
}

async function writeWindowReportState(
  state: WindowReportState,
  yesterdayKst: string, // prune 기준 — 보고 date와 같은 KST 축(계약 §5)
): Promise<void> {
  // 어제보다 오래된 항목은 다시 볼 일이 없다(타임라인 2일 보존과 동일 창) — 정리해 크기를 묶는다.
  const pruned: WindowReportState = {
    userId: state.userId,
    finals: state.finals.filter((key) => key.slice(key.lastIndexOf(':') + 1) >= yesterdayKst),
    last: Object.fromEntries(Object.entries(state.last).filter(([, v]) => v.date >= yesterdayKst)),
  };
  await AsyncStorage.setItem(STORAGE_KEYS.screentimeWindowReports, JSON.stringify(pruned));
}

// 구 바이너리 미지원 계측(세션당 1회) 가드 — JS 런타임 생존 동안 1회만 발행한다.
let windowUnsupportedLogged = false;

// 창 사용분 동기화 본체 — syncScreenTimeUsage 끝에서 호출된다(포그라운드/일일 sync 훅 +
// 사일런트 푸시 flush — push.ts). **보고 대상 탐색축은 내 OPEN 회차 목록**(GET /me/bet-sessions
// ?status=OPEN)이다(GROMO-1420 · N43) — 그룹 목록 순회는 탈퇴자(목록에서 즉시 사라짐)와 종료된
// 챌린지의 진행 중 회차를 놓쳐, 시작된 회차의 참가자가 마지막 보고를 영영 못 보낸다(미보고 =
// 미달성 = 돈이 걸린 패배 확정). 각 회차의 창 사용분을 타임라인 버킷 차로 계산해 PUT
// window-usage로 올린다. 창 진행 중 중간 보고 허용, 창 종료 후 최종 1회 — 회차가 OPEN인 동안
// (정산 전 그레이스 포함)은 계속 보고할 수 있다(N12·N43). 실패는 무시(upsert 멱등, 다음 sync
// 재시도 — 역전은 서버가 measuredAt으로 무시한다, N34).
export async function syncWindowUsage(userId: string): Promise<void> {
  // 창 측정 타임라인은 iOS 네이티브(N1)에만 있다 — 안드로이드는 대상 아님(계측도 하지 않는다:
  // unsupported는 'iOS 구 바이너리 업데이트 유도 규모' 지표라 안드로이드가 섞이면 오염된다).
  if (Platform.OS !== 'ios') return;
  // 구 바이너리 가드 — getUsageBucketEvents가 없으면 전체 스킵. 서버는 보고 없음 =
  // memberProgress null(판정불가)이 정상 상태다. 미지원 계측은 세션당 1회.
  if (!nativeSupportsUsageBucketEvents()) {
    if (!windowUnsupportedLogged) {
      windowUnsupportedLogged = true;
      logScreentimeWindowUnsupported();
    }
    return;
  }
  // 권한 검사(codex 리뷰 ⑥) — 포그라운드 진입점(syncScreenTimeUsage)만 권한을 보면 **사일런트
  // 푸시 직행 경로**(pushBackground.runSilentFlush → 이 함수)가 권한 철회 후 잔존 타임라인으로
  // 과소 보고할 수 있다 — 스크린타임은 낮을수록 유리라 곧 허위 달성이다. 모든 호출 경로 공통
  // 방어로 여기서 직접 확인하고, 조회 실패도 스킵한다(오보고 금지 — 다음 sync가 재시도).
  try {
    if ((await ScreenTimeModule.getAuthorizationStatus()) !== 'approved') return;
  } catch {
    return;
  }
  // 버킷 모니터가 이 계정 소유로 등록돼 있을 때만 — 미등록(측정 대상 미선택)이면 타임라인이
  // 항상 비어 '0분 사용'과 '미측정'이 구분되지 않는다(일일 동기화의 0분 스킵과 같은 취지).
  // 미보고면 서버가 판정불가로 두는 게 맞고, 0분 오보고는 스크린타임 창 내기의 오달성이 된다.
  const owner = await AsyncStorage.getItem(STORAGE_KEYS.screentimeBucketMonitorRegistered);
  if (owner !== userId) return;

  // ── 계정 박제(codex 리뷰 P1) ─────────────────────────────────────────────────────
  // 여기까지의 게이트는 전부 **userId(호출 시점의 계정)** 기준인데, 정작 아래 HTTP 요청들은
  // 인터셉터가 **전송 시점에 저장소에 있는 토큰**을 붙인다. 사일런트 푸시 flush는 백그라운드에서
  // 수 초~수십 초 돌고, 그 사이 사용자가 앱을 열어 로그아웃하거나 다른 계정으로 갈아탈 수 있다 —
  // 그러면 **A의 스크린타임 타임라인이 B의 OPEN 회차에 보고돼 B의 판정을 오염시킨다**(돈 경로).
  //
  // 그래서 시작 시점에 토큰을 확보해 신원을 대조하고(불일치면 아무것도 보내지 않는다 — 잘못된
  // 계정에 쓰느니 안 쓰는 쪽이 항상 옳다), **검증한 그 토큰을 이 sync의 모든 요청에 직접 싣는다.**
  // 대조만으로는 TOCTOU 창이 남지만(대조~전송 사이 교체), 토큰을 박제하면 그 창에서도 요청은
  // 여전히 A로 나간다 — 루프가 길어도 계정이 섞이지 않는 이유가 이것이다.
  // 토큰 조회 실패(갱신 실패 포함)도 스킵 — 다음 sync가 재시도한다(보고는 멱등).
  const accessToken = await getFreshAccessToken().catch(() => null);
  if (!accessToken || getUserIdFromToken(accessToken) !== userId) return;

  // 내 OPEN 회차 조회(참가자 스코프 — 그룹 무관, N43) — 실패는 무시하고 다음 sync에서 다시 본다.
  const sessions = await getMyOpenBetSessionsWithToken(accessToken).catch(() => null);
  if (!sessions || sessions.length === 0) return;

  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const measuredAt = now.toISOString();
  // 창 보고의 날짜 키(sessionDate)는 서버 판정 축과 같은 KST다(GROMO-1219) — putWindowUsage의
  // usageDate·finals 마커·prune 기준까지 전부 이 축을 탄다. 일일 스크린타임 업로드의 로컬 축과는
  // 별개다(그쪽은 reportedAt 정오 instant가 날짜 오귀속을 막는다 — 파일 상단 주석).
  const yesterdayKst = yesterdayStrKst();
  // 네이티브 보존 하한 = 로컬 어제(cleanupOldBucketEvents가 로컬 어제 미만 키를 삭제) — 로컬
  // 축이므로 localDateStr로 직접 계산한다(세그먼트 dayKey와 같은 단일 주입점 유지, yesterdayStr
  // 금지). setDate 산법 — +86_400_000 가산은 DST 날에 어긋난다.
  const localYesterdayDate = new Date(now);
  localYesterdayDate.setDate(localYesterdayDate.getDate() - 1);
  const retentionFloorDayKey = localDateStr(localYesterdayDate);
  const state = await readWindowReportState(userId);
  let stateDirty = false;

  // 날짜 키별 타임라인은 1회만 읽는다. 조회 실패(null)는 빈 배열과 구분한다 — 실패를 0분으로
  // 보고하면 창 내기 오달성이 되므로, 그 챌린지는 이번 sync에서 건너뛰고 다음에 재시도한다.
  // 타임라인 dayKey는 **기기 로컬** 축이다(익스텐션 appendBucketEvent — 계약 §1 변경 금지 축).
  // KST 창을 localDaySegments로 로컬-일 세그먼트로 쪼개 각 세그먼트의 로컬 dayKey를 조회하므로
  // 비KST 기기에서도 조회 키가 적재 키와 일치한다(#521 잔차였던 키 불일치 과소 측정 —
  // GROMO-1242에서 로컬-일 세그먼트 병합으로 해소).
  const eventsCache = new Map<string, UsageBucketEvent[] | null>();
  const getEvents = async (dayKey: string): Promise<UsageBucketEvent[] | null> => {
    if (eventsCache.has(dayKey)) return eventsCache.get(dayKey) ?? null;
    let events: UsageBucketEvent[] | null;
    try {
      events = await ScreenTimeModule.getUsageBucketEvents(dayKey);
    } catch {
      events = null;
    }
    eventsCache.set(dayKey, events);
    return events;
  };

  // 회차 하나 = 보고 대상 하나 — 날짜를 역산하지 않는다(sessionDate가 곧 보고 date다).
  // 그제 이전 회차가 아직 OPEN이어도(정산 지연) 타임라인이 지워졌으면 보존 게이트가 걸러
  // 미보고=미달성 수용(계약 명시 한계)으로 남는다.
  for (const session of sessions) {
    if (session.missionCategory !== 'SCREEN_TIME' || session.missionType !== 'TIME_WINDOW') {
      continue;
    }
    const startSec = timeStrToSeconds(session.windowStart);
    const endSec = timeStrToSeconds(session.windowEnd);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
    // 자정 걸침 창은 v2에서 금지다(N25 — 생성 검증 '시작 < 종료', 같은 날 최대 23:59).
    // 그 분기를 만들지 않는 것이 계약이고, 어긋난 값은 방어적으로 스킵한다(오보고 금지).
    if (endSec <= startSec) continue;

    // ── KST 축: 창 경계 epoch·보고 usageDate·finals 마커 전부 서버 판정 축(GROMO-1219 유지).
    const kstDate = session.sessionDate;
    const windowStartSec = epochSecAt(kstDate, startSec);
    const windowEndSec = epochSecAt(kstDate, endSec);
    // 보고 창은 starts_at부터다(N43·LLD §2.1) — join-next·join-week가 만든 미래 예약 회차도
    // OPEN이라, 시작 전에 보내면 아직 열리지도 않은 창에 0분이 선기록된다(서버도 무시하지만
    // 클라가 애초에 보내지 않는다).
    if (nowSec < windowStartSec) continue;
    // 종료 판정은 closes_at이 아니라 창 종료 epoch — 회차가 OPEN인 동안(정산 전 그레이스 포함)
    // 최종 보고를 받는 것이 서버 계약이라, 목록에 있는 한 마감 걱정 없이 보낸다(N43).
    const isFinal = nowSec >= windowEndSec;
    const finalKey = `${session.challengeId}:${kstDate}`;
    if (isFinal && state.finals.includes(finalKey)) continue; // 최종 보고 완료 — 1회만

    // ── 로컬 축(조회 전용): KST 창 [S, E']를 로컬-일 세그먼트로 쪼개 각 로컬 dayKey의
    // 타임라인에서 구간분을 합산한다(GROMO-1242 — 파일 상단 주석의 축 분리).
    const measureEndSec = Math.min(nowSec, windowEndSec);
    const segments = localDaySegments(windowStartSec, measureEndSec);

    // 보존 게이트 — 필요한 로컬 dayKey가 하나라도 보존 하한(로컬 어제) 미만이면 그 회차를
    // 통째로 건너뛴다. 지워진 키는 빈 배열로 돌아와 0분으로 잡히므로, 부분합을 보고하면
    // 과소 보고(=SCREEN_TIME 창 내기 허위 달성)가 재생산된다.
    // 전체 미보고는 '미보고=미달성 수용' 정책(위 주석·계약 명시 한계)과 정합이다.
    if (segments.some((seg) => seg.dayKey < retentionFloorDayKey)) continue;

    // 어느 세그먼트든 조회 실패(null)면 그 회차를 통째로 건너뛴다 — 부분합 보고 금지(보존
    // 게이트와 같은 이유). 다음 sync가 재시도한다.
    const segmentsWithEvents: { events: UsageBucketEvent[]; fromSec: number; toSec: number }[] = [];
    let readFailed = false;
    for (const seg of segments) {
      const events = await getEvents(seg.dayKey);
      if (events == null) {
        readFailed = true;
        break;
      }
      segmentsWithEvents.push({ events, fromSec: seg.fromSec, toSec: seg.toSec });
    }
    if (readFailed) continue;

    const used = computeWindowUsedMinutes({ segments: segmentsWithEvents });
    const usedMinutes = Math.min(1440, Math.max(0, used)); // 서버 검증 범위(0~1440) 클램프
    // 중간 보고는 값이 그대로면 스킵(15분 눈금이라 대부분 그대로다). 최종 보고는 값이 같아도
    // 1회 보낸다 — 서버의 '최종까지 보고된 창'과 '중간에 멈춘 창'이 같게 수렴하도록.
    if (
      !isFinal &&
      state.last[session.challengeId]?.date === kstDate &&
      state.last[session.challengeId]?.minutes === usedMinutes
    ) {
      continue;
    }
    try {
      // measuredAt 동봉(N34) — 서버가 역전 보고(사일런트 푸시 sync와 포그라운드 sync의 경합,
      // 타임아웃 지연 도착)를 measured_at 비교로 조용히 무시한다. 돈 경로라 '마지막 도착이
      // 이긴다'로 둘 수 없다.
      // 박제한 토큰을 실어 보낸다(위 '계정 박제' 주석) — 루프가 길어져 도중에 계정이 바뀌어도
      // 이 보고는 측정 주체인 그 계정으로만 나간다.
      await putWindowUsage(
        session.groupId,
        session.challengeId,
        { usageDate: kstDate, progressMinutes: usedMinutes, measuredAt },
        accessToken,
      );
    } catch {
      continue; // 실패 무시 — upsert 멱등, 다음 sync가 최신값으로 재시도
    }
    logScreentimeWindowReported({ minutes: usedMinutes, is_final: isFinal });
    if (isFinal) state.finals.push(finalKey);
    else state.last[session.challengeId] = { date: kstDate, minutes: usedMinutes };
    stateDirty = true;
  }
  if (stateDirty) await writeWindowReportState(state, yesterdayKst);
}
