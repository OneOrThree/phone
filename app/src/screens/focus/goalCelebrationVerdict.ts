// 집중 목표 달성 축하 판정(GROMO-630) — 결과 화면은 판정·예약만 하고, 모달은 결과 화면을 닫은 뒤
// 홈 진입 시 뜬다(오스카 결정).
//
// (종전 FocusResultScreen의 익명 async IIFE effect를 테스트 가능하게 이곳으로 옮겼다 —
//  GROMO-1254. format.thisWeekDates와 같은 취지: 부를 진입점이 없는 effect는 축 회귀가
//  회귀 그물 없이 착지한다. GROMO-1236의 KST 이전이 정확히 그랬다.)
//
// 축(docs/date-axis.md):
//  · 하루 1회 가드 키·예약 date = **KST**(celebrationDayKey) — 달성 판정이 서버 KST 일 버킷으로
//    내려지므로 dedup 키도 같은 축이어야 한다. 소비 측(HomeScreen)·노출 완료 기록까지 한 축.
//  · 연속 달성일 커서·heatmap 조회 창 = **KST**(kstTodayDate 앵커) — 서버 셀을 뒤로 세는
//    데이터 결합 계산이다. 아래 localDateStr는 존 변환이 아니라 parts 생성자로 만든 달력 Date의
//    포매팅이다(stats/format의 관례 — 앵커가 KST면 이후 산술은 순수 달력 산술).
//  · 로컬 하루 누적(todayFocusSeconds) = **측정 축(로컬)** — 축이 갈린 날(로컬≠KST)엔 KST 집계와
//    합치지 않는다(kstLocalSameDay 공용 게이트, GROMO-1236 P2 5→6라운드. KR 기기는 행동 불변).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { getHeatmap, getTodayStats } from '@/services/statsApi';
import type { HeatmapCellResponse } from '@/types/dto/stats';
import { kstLocalSameDay, localDateStr } from '@/utils/localDate';
import { kstTodayDate } from '@/screens/stats/format';
import {
  celebrationDayKey,
  readPendingCelebration,
  schedulePendingCelebration,
  type PendingCelebration,
} from '@/services/goalCelebration';

// 연속 달성일 조회 창 — 어제부터 뒤로 60일 단위로 넓혀가며 센다. 고정 60일 창은 장기 스트릭을
// 최대 61일로 잘라먹는다(PR 225 리뷰). 창 안이 전부 달성이면 다음 창을 이어 조회하고, 빈 날을
// 만나면 멈춘다. 상한 12창(약 2년) — 과호출 방지.
const CHUNK_DAYS = 60;
const MAX_CHUNKS = 12;

/**
 * 오늘 목표 달성이면 축하를 예약하고 그 payload를 돌려준다. 예약하지 않았으면 null.
 *
 * 누적은 로컬(FocusContext — 방금 세션 포함)과 서버 중 큰 값, 목표는 서버 우선·실패 시 로컬 —
 * 방금 세션 업로드가 서버 집계에 늦어도(레이스) 놓치지 않는다. '연속 목표달성'은 일별 달성
 * 플래그(heatmap)를 어제부터 뒤로 세어 오늘을 더한다 — '연속 공부'(하루 10분 스트릭)와 다른
 * 값이므로 getStreak을 쓰지 않는다.
 *
 * 상태를 건드리지 않는 순수 저장 작업이라 호출부에 언마운트 가드가 없다 — "홈으로"를 서버
 * 응답보다 빨리 눌러 화면이 닫혀도 예약 저장은 끝까지 수행되고, 저장 완료는 goalCelebration
 * 구독으로 홈에 전달돼 이미 홈에 도착한 뒤에도 모달이 뜬다(PR 225 리뷰).
 *
 * 실패는 전부 삼켜 null — 축하는 다음 결과 화면 진입에서 재판정된다.
 */
export async function evaluateGoalCelebration(
  todayFocusSeconds: number,
  userGoalSeconds: number,
): Promise<PendingCelebration | null> {
  try {
    const dayKey = celebrationDayKey();
    if ((await AsyncStorage.getItem(STORAGE_KEYS.focusGoalCelebratedDate)) === dayKey) return null;
    // 오늘 예약이 이미 있으면 재판정 불필요
    if ((await readPendingCelebration())?.date === dayKey) return null;
    const stats = await getTodayStats().catch(() => null);
    const goalMin = stats ? stats.focus.goalMinutes : Math.round(userGoalSeconds / 60);
    const localAccumMin = kstLocalSameDay() ? Math.floor(todayFocusSeconds / 60) : 0;
    const todayMin = Math.max(stats?.focus.todayMinutes ?? 0, localAccumMin);
    const achieved = goalMin > 0 && ((stats?.focus.goalAchieved ?? false) || todayMin >= goalMin);
    if (!achieved) return null;
    const days = await countGoalStreakDays();
    const pending: PendingCelebration = { date: dayKey, days, goalMinutes: goalMin };
    await schedulePendingCelebration(pending);
    return pending;
  } catch {
    // 판정 실패 시 축하 생략 — 다음 결과 화면 진입에서 재판정된다
    return null;
  }
}

// 오늘(방금 달성)을 1일로 두고 어제부터 heatmap 달성 플래그를 뒤로 세어 연속 달성일을 구한다.
// 커서는 KST 달력 날짜로 후진한다 — 비KST 기기에서 하루씩 어긋난 셀을 읽지 않게(GROMO-1236 P2).
async function countGoalStreakDays(): Promise<number> {
  let days = 1;
  const cursor = kstTodayDate();
  cursor.setDate(cursor.getDate() - 1);
  for (let chunk = 0; chunk < MAX_CHUNKS; chunk += 1) {
    const to = new Date(cursor);
    const from = new Date(cursor);
    from.setDate(from.getDate() - (CHUNK_DAYS - 1));
    const cells = await getHeatmap(localDateStr(from), localDateStr(to)).catch(
      () => [] as HeatmapCellResponse[],
    );
    const achievedByDate = new Map(cells.map((c) => [c.date, c.focusGoalAchieved]));
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
  return days;
}
