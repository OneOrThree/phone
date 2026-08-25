// 비교 3축(친구/전체/같은 카테고리) 평균 조회 — 집중 결과(603)·내 통계 ST1(604) 공용.
// GROMO-755: 친구 축은 서버 평균 집계 API(GROMO-753) 단일 호출로 전환(N+1·상한 10명 표본 편향 제거).
// GROMO-1632: 전체·같은 카테고리도 전 기간 서버 평균으로 통일 — 주 탭의 리그 랭킹(상위 100)
// 클라 평균을 폐지했다(상위 100명 선발 편향·봇 포함·0분 패딩 문제 정정).
// 축별로 독립 함수 — 호출부가 각자 로딩/도착 시점을 다르게 처리할 수 있다.
import { getFocusAverage } from '@/services/statsApi';
import type { FocusAverageScope, StatsPeriod } from '@/types/dto/stats';

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
