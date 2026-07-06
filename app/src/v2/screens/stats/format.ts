// 통계 화면(GROMO-604) 포맷·집계 헬퍼. 순수 함수만 — UI/네트워크 없음.
import { localDateStr, todayStr } from '@/utils/localDate';
import type { HeatmapCellResponse, StatsPeriod } from '@/types/dto/stats';

// 분 → "N시간 M분" / "N시간" / "M분" / "0분"
export function hm(totalMinutes: number): string {
  const t = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

// 상단 기간 세그먼트 정의(일/주/월).
export const PERIOD_TABS: { key: StatsPeriod; label: string }[] = [
  { key: 'DAY', label: '일' },
  { key: 'WEEK', label: '주' },
  { key: 'MONTH', label: '월' },
];

// 현재 구간 라벨(카드 부제용).
export function periodLabel(period: StatsPeriod): string {
  return period === 'DAY' ? '오늘' : period === 'WEEK' ? '이번 주' : '이번 달';
}

// 전(前) 대비 라벨(전일/전주/전월).
export function prevLabel(period: StatsPeriod): string {
  return period === 'DAY' ? '전일' : period === 'WEEK' ? '전주' : '전월';
}

// StatsPeriod → 애널리틱스 소문자 키.
export function periodKey(period: StatsPeriod): 'day' | 'week' | 'month' {
  return period === 'DAY' ? 'day' : period === 'WEEK' ? 'week' : 'month';
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
// 'YYYY-MM-DD' → 요일 '월'..'일' (로컬 자정 파싱으로 타임존 어긋남 방지).
export function weekdayKo(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAY[new Date(y, m - 1, d).getDay()];
}

// 기간별 히트맵 조회 범위 [from, to] ('YYYY-MM-DD').
// DAY=오늘, WEEK=이번 주 월요일~오늘(서버 /stats/focus WEEK와 동일 구간 — 리뷰 반영), MONTH=이달 1일~오늘.
export function heatmapRange(period: StatsPeriod): { from: string; to: string } {
  const to = todayStr();
  if (period === 'DAY') return { from: to, to };
  const now = new Date();
  if (period === 'WEEK') {
    const dow = now.getDay(); // 0=일..6=토
    const toMonday = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMonday);
    return { from: localDateStr(monday), to };
  }
  return { from: localDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to };
}

// 최근 7일 범위 [오늘-6, 오늘] — 타 유저 heatmap(getUserStats, 서버가 최근 7일 고정)과 같은 창으로
// 비교할 때 사용(주간 월~오늘과 다름에 주의).
export function rollingWeekRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 6);
  return { from: localDateStr(from), to: todayStr() };
}

// 막대 1개(집중/폰 사용 공용).
export interface StatBar {
  label: string;
  value: number; // 분
  current: boolean; // 강조(오늘/이번 주차 등)
}

// 히트맵 → 기간별 막대. WEEK=요일별, MONTH=주차별 합산, DAY=오늘 단일.
export function heatmapBars(
  period: StatsPeriod,
  cells: HeatmapCellResponse[],
  pick: (c: HeatmapCellResponse) => number,
): StatBar[] {
  const today = todayStr();
  if (period === 'WEEK') {
    return cells.map((c) => ({
      label: weekdayKo(c.date),
      value: pick(c),
      current: c.date === today,
    }));
  }
  if (period === 'MONTH') {
    const weeks: number[] = [];
    for (const c of cells) {
      const day = Number(c.date.slice(8, 10));
      const wi = Math.floor((day - 1) / 7);
      weeks[wi] = (weeks[wi] ?? 0) + pick(c);
    }
    const todayWeek = Math.floor((Number(today.slice(8, 10)) - 1) / 7);
    return weeks.map((v, i) => ({ label: `${i + 1}주`, value: v ?? 0, current: i === todayWeek }));
  }
  return cells.map((c) => ({ label: '오늘', value: pick(c), current: true }));
}

// 집중 목표 달성률(주·월) — 달성일/경과일.
export function focusGoalRate(cells: HeatmapCellResponse[]): {
  percent: number;
  achieved: number;
  total: number;
} {
  const total = cells.length;
  const achieved = cells.filter((c) => c.focusGoalAchieved).length;
  return { percent: total ? Math.round((achieved / total) * 100) : 0, achieved, total };
}

// 집중 분 → 잔디 강도 0..4 (칸 색 진하기).
export function grassLevel(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}
