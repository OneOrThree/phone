// 통계 화면(GROMO-604) 데이터 훅 — 기간(period)별로 필요한 stats API를 병렬 조회.
// 리그 화면과 동일한 useFocusEffect + useState 패턴(React Query 미사용).
// 개별 호출 실패는 해당 항목만 null/[]로 떨어뜨리고 나머지는 살린다.
// heatmap만 실패 플래그(heatmapFailed)를 따로 노출 — 캘린더가 '조회 실패'를 '기록 0분'으로
// 그리지 않고 에러+재시도로 처리할 수 있게 한다(코드리뷰 반영). refetch는 그 재시도용.
import { useCallback, useRef, useState } from 'react';
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
  heatmapFailed: boolean; // heatmap 조회 실패 — 빈 데이터([])와 구분(캘린더 에러 표시용)
}

const EMPTY: StatsData = {
  focus: null,
  category: null,
  screenTime: null,
  today: null,
  heatmap: [],
  heatmapFailed: false,
};

export function useStatsData(period: StatsPeriod): {
  data: StatsData;
  loading: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<StatsData>(EMPTY);
  const [loading, setLoading] = useState(true);
  // 요청 시퀀스 — 포커스 재진입·기간 전환·재시도가 겹칠 때 늦게 온 이전 응답이 최신 상태를
  // 덮지 않게 최신 요청만 반영한다(리그 훅과 동일 패턴).
  const seqRef = useRef(0);

  const refetch = useCallback(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    (async () => {
      const { from, to } = heatmapRange(period);
      const [focus, category, screenTime, today, heatmap] = await Promise.all([
        getFocusPeriodStats(period).catch(() => null),
        getFocusStatsByCategory(period).catch(() => null),
        getScreenTimePeriodStats(period).catch(() => null),
        getTodayStats().catch(() => null),
        getHeatmap(from, to).catch(() => null),
      ]);
      if (seq !== seqRef.current) return;
      setData({
        focus,
        category,
        screenTime,
        today,
        heatmap: heatmap ?? [],
        heatmapFailed: heatmap == null,
      });
      setLoading(false);
    })();
  }, [period]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  return { data, loading, refetch };
}
