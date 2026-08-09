// 해당월 주별 차트(월 탭) — 이달 1일부터의 heatmap을 달력 주(월~일) 단위로 합산. 첫 주가 전월에
// 걸쳐도(라벨 6/29~7/5) 전월 활동은 합산에서 제외 — 카드 위 총계 히어로(이달 1일부터의 월 집계
// API)와 구간이 일치해야 한다(코덱스 리뷰 반영). 가로축은 실제 날짜 구간·해당월 전체 주 미리
// 기재·미래 주는 선 미표시. 전용 집계 API 없이 파생 계산(GROMO-761). 지표(pick)·색만 바꿔
// 공부시간/핸드폰 사용량이 공유한다. (하루 평균 전환 검토 후 주별 합계 유지 — 2026-07-11 결정기록)
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { HeatmapCellResponse } from '@/types/dto/stats';
import { getHeatmap } from '@/services/statsApi';
import { localDateStr, todayStrKst } from '@/utils/localDate';
import { dayNum, kstTodayDate, type StatBar } from './format';
import { LineChart } from './charts';
import { CHART_BLOCK_H } from './constants';
import { CardBodyLoading } from './CardBodySlot';

// 히트맵 셀 → 지표 추출기 — 렌더마다 재생성되지 않게 모듈 상수(훅 의존성 안정화)
export const pickFocus = (c: HeatmapCellResponse) => c.totalFocusMinutes;
export const pickScreenTime = (c: HeatmapCellResponse) => c.actualScreenTimeMinutes;

export function MonthWeeklyChart({
  pick,
  color,
}: {
  pick: (c: HeatmapCellResponse) => number;
  color: string;
}) {
  const [bars, setBars] = useState<StatBar[] | null>(null);

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 최신 반영(리뷰 반영, useStatsData와 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // '이번 달'도 KST 앵커(GROMO-1236 P2 리뷰 반영) — 로컬 이달 1일(from)은 월 경계에서
        // 로컬이 KST보다 앞선 기기일 때 from > to(KST 오늘)가 돼 서버 400 → catch → 월 전체가
        // 0으로 그려진다. 한 축(KST)에서 파생하면 from<=to가 항상 성립한다.
        const now = kstTodayDate();
        const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
        // 이달 1일이 속한 주의 월요일 — 주차 인덱스·가로축 라벨의 기준점(예: 7월 첫 주 = 6/29~7/5)
        const dow = monthFirst.getDay(); // 0=일..6=토
        const weekStart0 = new Date(monthFirst);
        weekStart0.setDate(monthFirst.getDate() - (dow === 0 ? 6 : dow - 1));
        // 조회는 이달 1일부터 — 첫 주에 낀 전월 날짜를 받으면 총계 히어로(월 집계)와 합이 어긋난다
        const cells = await getHeatmap(localDateStr(monthFirst), todayStrKst()).catch(
          () => [] as HeatmapCellResponse[],
        );
        if (cancelled) return;
        // 주차 인덱스는 달력 일수 차이 기준 — 경과 ms 나눗셈은 DST 전환일에 하루가 23/25시간이라 어긋난다(리뷰 반영)
        const startDay = dayNum(
          weekStart0.getFullYear(),
          weekStart0.getMonth(),
          weekStart0.getDate(),
        );
        // 해당 월의 모든 주를 미리 기재 — 말일이 낀 주까지 포함(아직 안 온 주는 0으로 빈 막대)
        const monthLast = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const weekCount =
          Math.floor(
            (dayNum(monthLast.getFullYear(), monthLast.getMonth(), monthLast.getDate()) -
              startDay) /
              7,
          ) + 1;
        const thisWeekIdx = Math.floor(
          (dayNum(now.getFullYear(), now.getMonth(), now.getDate()) - startDay) / 7,
        );
        const sums: number[] = new Array(weekCount).fill(0);
        for (const c of cells) {
          const [y, m, d] = c.date.split('-').map(Number);
          const idx = Math.floor((dayNum(y, m - 1, d) - startDay) / 7);
          if (idx >= 0 && idx < weekCount) sums[idx] += pick(c);
        }
        setBars(
          sums.map((v, i) => {
            const ws = new Date(weekStart0);
            ws.setDate(weekStart0.getDate() + i * 7);
            const we = new Date(ws);
            we.setDate(ws.getDate() + 6);
            // 달이 바뀌는 주만 월 표기(6/29~7/5), 같은 달 안의 주는 날짜만(6~12)
            const label =
              ws.getMonth() === we.getMonth()
                ? `${ws.getDate()}~${we.getDate()}`
                : `${ws.getMonth() + 1}/${ws.getDate()}~${we.getMonth() + 1}/${we.getDate()}`;
            return { label, value: v, current: i === thisWeekIdx, future: i > thisWeekIdx };
          }),
        );
      })();
      return () => {
        cancelled = true;
      };
    }, [pick]),
  );

  if (bars === null) {
    return <CardBodyLoading height={CHART_BLOCK_H} testID="stats.monthWeekly.loading" />;
  }
  return <LineChart bars={bars} color={color} />;
}
