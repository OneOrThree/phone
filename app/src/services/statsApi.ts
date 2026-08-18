// stats 도메인 API 래퍼 (StatsController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
// date는 서버 필수 파라미터(GROMO-643) — 미전송 시 400으로 통계 전체가 떨어진다.
// 서버는 이 값을 그대로 KST(country_code 파생 존) 일별 버킷에 equality 조회하므로, 기본값은
// 로컬이 아니라 KST 오늘이다(GROMO-1236 — 비KST 기기에서 로컬 날짜를 보내면 하루 오귀속).
import { api } from '@/services/api';
import { todayStrKst } from '@/utils/localDate';
import type {
  TodayStatsResponse,
  StreakResponse,
  HeatmapCellResponse,
  FocusPeriodStatsResponse,
  CategoryFocusStatsResponse,
  ScreenTimePeriodStatsResponse,
  StatsPeriod,
  FocusAverageResponse,
  FocusAverageScope,
} from '@/types/dto/stats';

// GET /api/v1/stats/today?date&friends — 오늘 집중·스크린타임 요약.
// friends 지정 시 해당 대상(ACCEPTED 친구 또는 전체공개 PUBLIC 유저) 조회, 미지정 시 본인.
export async function getTodayStats(
  friends?: string,
  date: string = todayStrKst(),
): Promise<TodayStatsResponse> {
  const { data } = await api.get<TodayStatsResponse>('/api/v1/stats/today', {
    params: { date, friends },
  });
  return data;
}

// GET /api/v1/stats/streak?date&friends — 연속일(스트릭).
// friends 지정 시 해당 친구(ACCEPTED)의 스트릭 조회, 미지정 시 본인.
export async function getStreak(
  friends?: string,
  date: string = todayStrKst(),
): Promise<StreakResponse> {
  const { data } = await api.get<StreakResponse>('/api/v1/stats/streak', {
    params: { date, friends },
  });
  return data;
}

// GET /api/v1/stats/heatmap?from&to — 일별 집계(히트맵). from/to는 'YYYY-MM-DD', 범위 상한 366일.
export async function getHeatmap(from: string, to: string): Promise<HeatmapCellResponse[]> {
  const { data } = await api.get<HeatmapCellResponse[]>('/api/v1/stats/heatmap', {
    params: { from, to },
  });
  return data;
}

// GET /api/v1/stats/focus?period&date&friends — 기간별 집중시간 통계(DAY|WEEK|MONTH).
// friends 지정 시 해당 친구(ACCEPTED)의 통계 조회, 미지정 시 본인.
export async function getFocusPeriodStats(
  period: StatsPeriod,
  friends?: string,
  date: string = todayStrKst(),
): Promise<FocusPeriodStatsResponse> {
  const { data } = await api.get<FocusPeriodStatsResponse>('/api/v1/stats/focus', {
    params: { period, date, friends },
  });
  return data;
}

// GET /api/v1/stats/by-category?period&date&friends — 태그(과목)별 집중시간. 비율은 클라 계산.
// friends 지정 시 해당 친구(ACCEPTED)의 과목별 조회(GROMO-624), 미지정 시 본인.
export async function getFocusStatsByCategory(
  period: StatsPeriod,
  friends?: string,
  date: string = todayStrKst(),
): Promise<CategoryFocusStatsResponse> {
  const { data } = await api.get<CategoryFocusStatsResponse>('/api/v1/stats/by-category', {
    params: { period, date, friends },
  });
  return data;
}

// GET /api/v1/stats/screen-time?period&date — 기간별 스크린타임 통계(DAY|WEEK|MONTH).
export async function getScreenTimePeriodStats(
  period: StatsPeriod,
  date: string = todayStrKst(),
): Promise<ScreenTimePeriodStatsResponse> {
  const { data } = await api.get<ScreenTimePeriodStatsResponse>('/api/v1/stats/screen-time', {
    params: { period, date },
  });
  return data;
}

// GET /api/v1/stats/focus/average?scope&period&date — 활동 유저 1인당 평균 집중시간(분).
// scope: FRIENDS(내 친구)·TOTAL(전체)·CATEGORY(내 occupation) — GROMO-753.
export async function getFocusAverage(
  scope: FocusAverageScope,
  period: StatsPeriod,
  date: string = todayStrKst(),
): Promise<FocusAverageResponse> {
  const { data } = await api.get<FocusAverageResponse>('/api/v1/stats/focus/average', {
    params: { scope, period, date },
  });
  return data;
}
