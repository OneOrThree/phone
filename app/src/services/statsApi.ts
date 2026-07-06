// stats 도메인 API 래퍼 (StatsController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import type {
  TodayStatsResponse,
  StreakResponse,
  HeatmapCellResponse,
  FocusPeriodStatsResponse,
  CategoryFocusStatsResponse,
  ScreenTimePeriodStatsResponse,
  StatsPeriod,
} from '@/types/dto/stats';

// GET /api/v1/stats/today — 오늘 집중·스크린타임 요약.
export async function getTodayStats(): Promise<TodayStatsResponse> {
  const { data } = await api.get<TodayStatsResponse>('/api/v1/stats/today');
  return data;
}

// GET /api/v1/stats/streak — 연속일(스트릭).
export async function getStreak(): Promise<StreakResponse> {
  const { data } = await api.get<StreakResponse>('/api/v1/stats/streak');
  return data;
}

// GET /api/v1/stats/heatmap?from&to — 일별 집계(히트맵). from/to는 'YYYY-MM-DD', 범위 상한 366일.
export async function getHeatmap(from: string, to: string): Promise<HeatmapCellResponse[]> {
  const { data } = await api.get<HeatmapCellResponse[]>('/api/v1/stats/heatmap', {
    params: { from, to },
  });
  return data;
}

// GET /api/v1/stats/focus?period&friends — 기간별 집중시간 통계(DAY|WEEK|MONTH).
// friends 지정 시 해당 친구(ACCEPTED)의 통계 조회, 미지정 시 본인.
export async function getFocusPeriodStats(
  period: StatsPeriod,
  friends?: string,
): Promise<FocusPeriodStatsResponse> {
  const { data } = await api.get<FocusPeriodStatsResponse>('/api/v1/stats/focus', {
    params: { period, friends },
  });
  return data;
}

// GET /api/v1/stats/by-category?period — 태그(과목)별 집중시간(본인). 비율은 클라 계산.
export async function getFocusStatsByCategory(
  period: StatsPeriod,
): Promise<CategoryFocusStatsResponse> {
  const { data } = await api.get<CategoryFocusStatsResponse>('/api/v1/stats/by-category', {
    params: { period },
  });
  return data;
}

// GET /api/v1/stats/screen-time?period — 기간별 스크린타임 통계(DAY|WEEK|MONTH).
export async function getScreenTimePeriodStats(
  period: StatsPeriod,
): Promise<ScreenTimePeriodStatsResponse> {
  const { data } = await api.get<ScreenTimePeriodStatsResponse>('/api/v1/stats/screen-time', {
    params: { period },
  });
  return data;
}
