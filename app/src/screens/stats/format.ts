// 통계 화면(GROMO-604) 포맷·집계 헬퍼. 순수 함수만 — UI/네트워크 없음.
import { localDateStr, todayStr } from '@/utils/localDate';
import type { HeatmapCellResponse, StatsPeriod } from '@/types/dto/stats';

// 오늘 세션 → 10분 슬롯(0~143 = 24시간×6)별 집중 분 + 지배 과목(GROMO-761 시간대별 집중 타임테이블).
// 세션 구간을 슬롯 경계로 잘라 분배하고, 자정 이전(어제) 부분은 제외한다. minutes 범위 0~10(분).
// tagId = 그 슬롯에서 가장 오래 집중한 세션의 태그(과목 색 결정용) — 없거나 미분류면 null.
export interface FocusSlot {
  minutes: number;
  tagId: string | null;
}

export function tenMinuteFocusSlots(
  sessions: { startedAt: string; endedAt: string; focusTagId: string | null }[],
): FocusSlot[] {
  const SLOT_MS = 600e3; // 10분
  const totals: number[] = new Array(144).fill(0);
  // 슬롯별 태그 누적(지배 과목 판정용) — key는 tagId(미분류는 '')
  const byTag: Map<string, number>[] = Array.from({ length: 144 }, () => new Map());
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const dayStart = midnight.getTime();
  const dayEnd = dayStart + 24 * 3600e3;
  for (const s of sessions) {
    const start = Math.max(Date.parse(s.startedAt), dayStart);
    const end = Math.min(Date.parse(s.endedAt), dayEnd);
    if (!(end > start)) continue;
    const first = Math.floor((start - dayStart) / SLOT_MS);
    const last = Math.min(Math.floor((end - 1 - dayStart) / SLOT_MS), 143);
    for (let i = first; i <= last; i++) {
      const slotStart = dayStart + i * SLOT_MS;
      const overlap = Math.min(end, slotStart + SLOT_MS) - Math.max(start, slotStart);
      if (overlap <= 0) continue;
      const minutes = overlap / 60000;
      totals[i] += minutes;
      const key = s.focusTagId ?? '';
      byTag[i].set(key, (byTag[i].get(key) ?? 0) + minutes);
    }
  }
  return totals.map((minutes, i) => {
    let tagId: string | null = null;
    let best = 0;
    for (const [key, m] of byTag[i]) {
      if (m > best) {
        best = m;
        tagId = key === '' ? null : key;
      }
    }
    return { minutes, tagId };
  });
}

// 분 → "N시간 M분" / "N시간" / "M분" / "0분"
// ⚠️ 통계 허브(StatsScreen)는 fmtMinutes(00:00:00)로 전환(GROMO-761) — 현재 집중 결과(FocusResult)만 사용,
// 683(집중 결과 00:00:00 통일)에서 정리 예정.
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
