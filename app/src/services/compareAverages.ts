// 비교 3축(친구/전체/같은 카테고리) 주간 평균 조회 — 집중 결과(603)·내 통계 ST1(604) 공용.
// 서버에 평균 집계 API가 없어 리그 랭킹·친구 통계를 FE가 평균 낸다(계획: 통계-3화면-지표-계획.md).
// 리그는 주간(이번 주 아레나) 기준 → "이번 주" 비교에만 사용한다.
// 축별로 독립 함수 — 호출부가 각자 로딩/도착 시점을 다르게 처리할 수 있다(전체는 빠르고 친구는 N+1로 느림).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { occupationForCategory } from '@/constants/focusCategories';
import { getGlobalRanking, getMyRanking } from '@/services/leagueApi';
import { getFocusPeriodStats } from '@/services/statsApi';
import { fetchFriends } from '@/services/friendsApi';

// 친구 평균은 친구별 개별 조회(N+1)라 상한을 둔다(지연 억제).
const FRIEND_FETCH_CAP = 10;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

// 전체 평균 — 이번 주 전체 랭킹(상위 100) totalFocusMinutes 평균. null = 리그 미시작/실패.
export async function fetchGlobalAverage(): Promise<number | null> {
  try {
    const ranking = await getGlobalRanking();
    return mean(ranking.map((m) => m.totalFocusMinutes));
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
    return { avg: mean(ranking.map((m) => m.totalFocusMinutes)), label };
  } catch {
    return { avg: null, label };
  }
}

// 친구 평균 — 친구별 기간 집중 합계 개별 조회(상한 FRIEND_FETCH_CAP명) 평균. count=0이면 친구 없음.
// period: 'DAY'(오늘)·'WEEK'(이번 주) — /stats/focus?friends=는 기간 지정이 돼서 친구 축만 일 단위 비교 가능.
// (전체·같은 카테고리는 리그 랭킹(주간 집계) 기반이라 오늘 비교 불가 — 서버 일 단위 집계 필요.)
export async function fetchFriendsAverage(
  period: 'DAY' | 'WEEK' = 'WEEK',
): Promise<{ avg: number | null; count: number }> {
  try {
    const friends = await fetchFriends();
    if (friends.length === 0) return { avg: null, count: 0 };
    const stats = await Promise.all(
      friends
        .slice(0, FRIEND_FETCH_CAP)
        .map((f) => getFocusPeriodStats(period, f.userId).catch(() => null)),
    );
    const avg = mean(
      stats.filter((s): s is NonNullable<typeof s> => s != null).map((s) => s.totalFocusMinutes),
    );
    return { avg, count: friends.length };
  } catch {
    return { avg: null, count: 0 };
  }
}
