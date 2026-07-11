// 통계 화면(GROMO-604) 포맷·집계 헬퍼. 순수 함수만 — UI/네트워크 없음.
import { localDateStr, todayStr } from '@/utils/localDate';
import type { HeatmapCellResponse, StatsPeriod } from '@/types/dto/stats';

// 오늘 세션 → 10분 슬롯(0~143 = 24시간×6)별 집중 구간(GROMO-761 시간대별 집중 타임테이블).
// 슬롯 경계는 시계 기준(정각 정렬 — 예: 3:00~3:10, 3:10~3:20)이고, 세션 구간을 경계로 잘라
// 슬롯 안의 실제 위치(start~end, 0~1 비율)로 담는다 → 3:35~3:45 집중이면 3:30 칸의 오른쪽
// 절반 + 3:40 칸의 왼쪽 절반이 칠해진다. 자정 이전(어제) 부분은 제외.
export interface FocusSlotSegment {
  start: number; // 슬롯 내 시작 위치 0~1
  end: number; // 슬롯 내 끝 위치 0~1
  tagId: string | null; // 세션의 태그(과목 색 결정용) — 미분류면 null
}

export function tenMinuteFocusSlots(
  sessions: { startedAt: string; endedAt: string; focusTagId: string | null }[],
): FocusSlotSegment[][] {
  const SLOT_MS = 600e3; // 10분
  const slots: FocusSlotSegment[][] = Array.from({ length: 144 }, () => []);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const dayStart = midnight.getTime();
  // 달력 기준 다음날 자정 — DST 전환일은 하루가 23/25시간이라 +24h 고정 더하기는 어긋난다(리뷰 반영)
  const nextMidnight = new Date(midnight);
  nextMidnight.setDate(midnight.getDate() + 1);
  const dayEnd = nextMidnight.getTime();
  for (const s of sessions) {
    const start = Math.max(Date.parse(s.startedAt), dayStart);
    const end = Math.min(Date.parse(s.endedAt), dayEnd);
    if (!(end > start)) continue;
    // 슬롯은 로컬 벽시계(시:분) 기준 — 자정 경과 ms 나눗셈은 DST 전환일에 시각과 어긋난다(리뷰 반영).
    // 슬롯의 로컬 경계까지 조각을 담으며 전진한다.
    let t = start;
    while (t < end) {
      const d = new Date(t);
      const idx = d.getHours() * 6 + Math.floor(d.getMinutes() / 10);
      const boundary = new Date(d);
      boundary.setMinutes(Math.floor(d.getMinutes() / 10) * 10 + 10, 0, 0);
      const segEnd = Math.min(end, boundary.getTime());
      const segStartFrac =
        ((d.getMinutes() % 10) * 60e3 + d.getSeconds() * 1e3 + d.getMilliseconds()) / SLOT_MS;
      const segEndFrac = Math.min(segStartFrac + (segEnd - t) / SLOT_MS, 1);
      if (idx >= 0 && idx < 144 && segEndFrac > segStartFrac) {
        slots[idx].push({ start: segStartFrac, end: segEndFrac, tagId: s.focusTagId });
      }
      // 경계가 전진하지 않는 비정상 케이스(시간대 급변 등) 무한 루프 방지
      t = segEnd > t ? segEnd : t + 60e3;
    }
  }
  return slots;
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

// 막대/점 1개(집중/폰 사용 공용).
export interface StatBar {
  label: string;
  value: number; // 분
  current: boolean; // 강조(오늘/이번 주차 등)
  future?: boolean; // 아직 오지 않은 구간 — 가로축 라벨만 표시하고 선·점은 그리지 않음(GROMO-761)
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

// 달력 일 번호 — UTC 자정으로 정규화해 DST가 있는 시간대에서도 일수 차이가 정확(StatsScreen과 동일 로직).
const dayNum = (y: number, monthIdx: number, d: number) =>
  Math.floor(Date.UTC(y, monthIdx, d) / 86400e3);

// 세션 목록 → 일별 첫 세션 시작 시각(로컬 자정 경과 분). key = 'YYYY-MM-DD'(로컬).
export function dailyFirstStartMinutes(sessions: { startedAt: string }[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = localDateStr(d);
    const minutes = d.getHours() * 60 + d.getMinutes();
    const prev = byDay.get(key);
    if (prev === undefined || minutes < prev) byDay.set(key, minutes);
  }
  return byDay;
}

// 첫 시작 시각 점 1개 — 기록 없는 날(주)은 minutes=null로 라벨만 남기고 점은 그리지 않는다.
export interface StartTimePoint {
  label: string;
  minutes: number | null; // 자정 경과 분
  current: boolean;
  future?: boolean;
}

// 일별 첫 시작 시각 → 기간별 점. WEEK=요일별(월~일), MONTH=주별 평균('N월 주별' 차트와 같은
// 달력 주 분할 — 이달 1일이 낀 주의 월요일부터). 평균은 기록 있는 날만 분모에 넣는다.
export function firstStartPoints(
  period: StatsPeriod,
  byDay: Map<string, number>,
): StartTimePoint[] {
  const now = new Date();
  const today = todayStr();
  if (period === 'WEEK') {
    const dow = now.getDay(); // 0=일..6=토
    const monday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + (dow === 0 ? -6 : 1 - dow),
    );
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = localDateStr(d);
      return {
        label: WEEKDAY[(i + 1) % 7], // 월~일
        minutes: byDay.get(key) ?? null,
        current: key === today,
        future: key > today, // 'YYYY-MM-DD'는 문자열 비교가 날짜 비교와 일치
      };
    });
  }
  // MONTH — MonthWeeklyChart와 동일한 주 분할·라벨(6/29~7/5 또는 6~12)
  const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
  const dow = monthFirst.getDay();
  const weekStart0 = new Date(monthFirst);
  weekStart0.setDate(monthFirst.getDate() - (dow === 0 ? 6 : dow - 1));
  const startDay = dayNum(weekStart0.getFullYear(), weekStart0.getMonth(), weekStart0.getDate());
  const monthLast = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const weekCount =
    Math.floor(
      (dayNum(monthLast.getFullYear(), monthLast.getMonth(), monthLast.getDate()) - startDay) / 7,
    ) + 1;
  const thisWeekIdx = Math.floor(
    (dayNum(now.getFullYear(), now.getMonth(), now.getDate()) - startDay) / 7,
  );
  return Array.from({ length: weekCount }, (_, i) => {
    const ws = new Date(weekStart0);
    ws.setDate(weekStart0.getDate() + i * 7);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    const vals: number[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(ws);
      day.setDate(ws.getDate() + d);
      const v = byDay.get(localDateStr(day));
      if (v !== undefined) vals.push(v);
    }
    const label =
      ws.getMonth() === we.getMonth()
        ? `${ws.getDate()}~${we.getDate()}`
        : `${ws.getMonth() + 1}/${ws.getDate()}~${we.getMonth() + 1}/${we.getDate()}`;
    return {
      label,
      minutes: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
      current: i === thisWeekIdx,
      future: i > thisWeekIdx,
    };
  });
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
