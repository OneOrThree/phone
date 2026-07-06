// stats 도메인 API 래퍼 (StatsController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
// friends 파라미터(GROMO-608): 지정 시 해당 친구(ACCEPTED)의 통계, 미지정 시 self.
// 친구 아님/대상 없음이면 404 — 호출부에서 try/catch 분기.
import { api } from '@/services/api';
import type {
  TodayStatsResponse,
  StreakResponse,
  HeatmapCellResponse,
  FocusPeriodStatsResponse,
  ScreenTimePeriodStatsResponse,
  StatsPeriod,
} from '@/types/dto/stats';

// GET /api/v1/stats/today — 오늘 집중·스크린타임 요약 (friends 지정 시 친구 것).
export async function getTodayStats(friends?: string): Promise<TodayStatsResponse> {
  const { data } = await api.get<TodayStatsResponse>('/api/v1/stats/today', {
    params: { friends },
  });
  return data;
}

// GET /api/v1/stats/streak — 연속일(스트릭) (friends 지정 시 친구 것).
export async function getStreak(friends?: string): Promise<StreakResponse> {
  const { data } = await api.get<StreakResponse>('/api/v1/stats/streak', {
    params: { friends },
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

// GET /api/v1/stats/focus?period — 기간별 집중시간 통계(DAY|WEEK|MONTH) (friends 지정 시 친구 것).
export async function getFocusPeriodStats(
  period: StatsPeriod,
  friends?: string,
): Promise<FocusPeriodStatsResponse> {
  const { data } = await api.get<FocusPeriodStatsResponse>('/api/v1/stats/focus', {
    params: { period, friends },
  });
  return data;
}

// GET /api/v1/stats/screen-time?period — 기간별 스크린타임 통계 (friends 지정 시 친구 것).
// 목표(goalMinutes)·달성 여부는 대상 유저 자신의 설정 기준.
export async function getScreenTimePeriodStats(
  period: StatsPeriod,
  friends?: string,
): Promise<ScreenTimePeriodStatsResponse> {
  const { data } = await api.get<ScreenTimePeriodStatsResponse>('/api/v1/stats/screen-time', {
    params: { period, friends },
  });
  return data;
}
