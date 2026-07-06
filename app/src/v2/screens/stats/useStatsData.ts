// 통계 화면(GROMO-604) 데이터 훅 — 기간(period)별로 필요한 stats API를 병렬 조회.
// 리그 화면과 동일한 useFocusEffect + useState 패턴(React Query 미사용).
// 개별 호출 실패는 해당 항목만 null/[]로 떨어뜨리고 나머지는 살린다.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  getFocusPeriodStats,
  getFocusStatsByCategory,
  getScreenTimePeriodStats,
  getTodayStats,
  getStreak,
  getHeatmap,
} from '@/services/statsApi';
import { getFocusTags } from '@/services/focusApi';
import type {
  FocusPeriodStatsResponse,
  CategoryFocusStatsResponse,
  ScreenTimePeriodStatsResponse,
  TodayStatsResponse,
  StreakResponse,
  HeatmapCellResponse,
  StatsPeriod,
} from '@/types/dto/stats';
import type { FocusTagResponse } from '@/types/dto/focus';
import { heatmapRange } from './format';

export interface StatsData {
  focus: FocusPeriodStatsResponse | null;
  category: CategoryFocusStatsResponse | null;
  screenTime: ScreenTimePeriodStatsResponse | null;
  today: TodayStatsResponse | null;
  streak: StreakResponse | null;
  heatmap: HeatmapCellResponse[];
  tags: FocusTagResponse[];
}

const EMPTY: StatsData = {
  focus: null,
  category: null,
  screenTime: null,
  today: null,
  streak: null,
  heatmap: [],
  tags: [],
};

export function useStatsData(period: StatsPeriod): { data: StatsData; loading: boolean } {
  const [data, setData] = useState<StatsData>(EMPTY);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      (async () => {
        const { from, to } = heatmapRange(period);
        const [focus, category, screenTime, today, streak, heatmap, tags] = await Promise.all([
          getFocusPeriodStats(period).catch(() => null),
          getFocusStatsByCategory(period).catch(() => null),
          getScreenTimePeriodStats(period).catch(() => null),
          getTodayStats().catch(() => null),
          getStreak().catch(() => null),
          getHeatmap(from, to).catch(() => [] as HeatmapCellResponse[]),
          getFocusTags().catch(() => [] as FocusTagResponse[]),
        ]);
        if (cancelled) return;
        setData({ focus, category, screenTime, today, streak, heatmap, tags });
        setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [period]),
  );

  return { data, loading };
}
