// 비교 3축(친구/전체/같은 카테고리) 평균 조회 — 집중 결과(603)·내 통계 ST1(604) 공용.
// GROMO-755: 친구 축은 서버 평균 집계 API(GROMO-753) 단일 호출로 전환(N+1·상한 10명 표본 편향 제거).
// 전체·같은 카테고리의 "이번 주"(fetchGlobal/CategoryAverage)는 리그 랭킹 기반 기존 방식 유지 —
// 내 통계 화면(558) 전환은 범위 외(755). 집중 결과의 "오늘" 축은 fetchFocusAverage를 쓴다.
// 축별로 독립 함수 — 호출부가 각자 로딩/도착 시점을 다르게 처리할 수 있다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { occupationForCategory } from '@/constants/focusCategories';
import { getGlobalRanking, getMyRanking } from '@/services/leagueApi';
import { getFocusAverage } from '@/services/statsApi';
import type { FocusAverageScope, StatsPeriod } from '@/types/dto/stats';

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

// 전체 평균 — 이번 주 전체 랭킹(상위 100) 집중시간 평균(분). null = 리그 미시작/실패.
// 서버는 초 단위(totalFocusSeconds, GROMO-665)라 분으로 내려 다른 축(분)과 단위를 맞춘다.
export async function fetchGlobalAverage(): Promise<number | null> {
  try {
    const ranking = await getGlobalRanking();
    return mean(ranking.map((m) => m.totalFocusSeconds / 60));
  } catch {
    return null;
  }
}

// 같은 카테고리 평균 — focusCategory ↔ Occupation 전 카테고리 1:1(19종, GROMO-631). null = 미선택/실패.
export async function fetchCategoryAverage(): Promise<{
  avg: number | null;
  label: string | null;
}> {
  const label = await AsyncStorage.getItem(STORAGE_KEYS.focusCategory).catch(() => null);
  const occupation = occupationForCategory(label);
  if (!occupation) return { avg: null, label };
  try {
    const ranking = await getMyRanking(occupation);
    return { avg: mean(ranking.map((m) => m.totalFocusSeconds / 60)), label };
  } catch {
    return { avg: null, label };
  }
}

// scope 평균 — 서버 평균 집계 API(GROMO-753) 단일 호출. count는 집계에 포함된 활동 유저 수.
// count 규약: 0 = 집계 대상 없음(친구 없음·무활동·occupation 미설정), -1 = 조회 실패.
// 실패↔대상 없음 구분(679)을 값으로 고정한다 — 예전엔 실패도 count 0이라 문구가 섞였다.
export async function fetchFocusAverage(
  scope: FocusAverageScope,
  period: StatsPeriod,
): Promise<{ avg: number | null; count: number }> {
  try {
    const res = await getFocusAverage(scope, period);
    return { avg: res.averageMinutes ?? null, count: res.sampleSize };
  } catch {
    return { avg: null, count: -1 };
  }
}

// 친구 평균 — scope=FRIENDS 단일 호출(GROMO-755). 기존 친구별 개별 조회(N+1, 상한 10명)를
// 대체한다. count=0이면 친구 없음(또는 이번 기간 무활동), -1이면 조회 실패.
export async function fetchFriendsAverage(
  period: StatsPeriod = 'WEEK',
): Promise<{ avg: number | null; count: number }> {
  return fetchFocusAverage('FRIENDS', period);
}
