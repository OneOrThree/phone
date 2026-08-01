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
  getHeatmap,
} from '@/services/statsApi';
import type {
  FocusPeriodStatsResponse,
  CategoryFocusStatsResponse,
  ScreenTimePeriodStatsResponse,
  TodayStatsResponse,
  HeatmapCellResponse,
  StatsPeriod,
} from '@/types/dto/stats';
import { heatmapRange } from './format';

export interface StatsData {
  focus: FocusPeriodStatsResponse | null;
  category: CategoryFocusStatsResponse | null;
  screenTime: ScreenTimePeriodStatsResponse | null;
  today: TodayStatsResponse | null;
  heatmap: HeatmapCellResponse[];
}

const EMPTY: StatsData = {
  focus: null,
  category: null,
  screenTime: null,
  today: null,
  heatmap: [],
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
        const [focus, category, screenTime, today, heatmap] = await Promise.all([
          getFocusPeriodStats(period).catch(() => null),
          getFocusStatsByCategory(period).catch(() => null),
          getScreenTimePeriodStats(period).catch(() => null),
          getTodayStats().catch(() => null),
          getHeatmap(from, to).catch(() => [] as HeatmapCellResponse[]),
        ]);
        if (cancelled) return;
        setData({ focus, category, screenTime, today, heatmap });
        setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [period]),
  );

  return { data, loading };
}
