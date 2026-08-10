// 통계 화면(GROMO-604) 포맷·집계 헬퍼. 순수 함수만 — UI/네트워크 없음.
import { kstDateStr, localDateStr, todayStrKst } from '@/utils/localDate';
import type { HeatmapCellResponse, StatsPeriod } from '@/types/dto/stats';
import { FOCUS_COLOR } from './constants';

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

// 주간 세션 → 요일별 집중 블록(GROMO-778 요일별 집중 타임라인).
// 세션을 로컬 자정 경계로 분할해 각 조각을 해당 날짜의 요일 칼럼(월=0..일=6)에 담는다 — 자정을
// 넘긴 세션도 다음날 칼럼에 이어서 보인다(리뷰 반영). 위치는 벽시계 시:분 기준 — 자정 경과 ms
// 나눗셈은 DST 전환일에 시각과 어긋난다(tenMinuteFocusSlots와 동일 취지, 리뷰 반영).
// weekStartMs(주 시작 월요일 00:00 '순간' — KST 축, GROMO-1236) 이전 구간은 담지 않는다: 전부
// 이전인 조각은 버리고, 경계를 걸친 조각은 시작을 주 시작으로 잘라 주 내 몫만 남긴다. 비KST
// 기기에선 KST 주 시작이 로컬 자정과 어긋나 조각 중간에 올 수 있기 때문(P2 5라운드 — 종전
// '시작 >= 주 시작' 통과/통폐기는 걸친 조각의 주 내 몫을 통째로 잃었다).
export interface WeekFocusBlock {
  col: number; // 0=월 .. 6=일
  startMin: number; // 그날 벽시계 기준 시작(분)
  endMin: number; // 그날 벽시계 기준 끝(분, 최대 1440)
  tagId: string | null; // 과목 색 결정용(미분류면 null)
}

export function weekdayFocusBlocks(
  sessions: { startedAt: string; endedAt: string; focusTagId: string | null }[],
  weekStartMs: number,
): WeekFocusBlock[] {
  const out: WeekFocusBlock[] = [];
  for (const sn of sessions) {
    const end = Date.parse(sn.endedAt);
    let t = Date.parse(sn.startedAt);
    if (!(end > t)) continue;
    while (t < end) {
      const d = new Date(t);
      // 조각 끝 = 세션 끝 vs 다음날 로컬 자정 중 이른 쪽
      const nextMid = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const pieceEnd = Math.min(end, nextMid);
      // 주 시작을 걸친 조각은 시작을 주 시작으로 클립 — 조각은 로컬 하루 안이라 클립해도 같은
      // 날짜(요일·자정 기준)를 유지한다(상단 주석 참고)
      const clipped = Math.max(t, weekStartMs);
      if (pieceEnd > clipped) {
        const cd = new Date(clipped);
        const startMin = cd.getHours() * 60 + cd.getMinutes() + cd.getSeconds() / 60;
        const e = new Date(pieceEnd);
        const endMin =
          pieceEnd === nextMid ? 1440 : e.getHours() * 60 + e.getMinutes() + e.getSeconds() / 60;
        if (endMin > startMin) {
          const dow = cd.getDay(); // 0=일..6=토
          out.push({ col: dow === 0 ? 6 : dow - 1, startMin, endMin, tagId: sn.focusTagId });
        }
      }
      // 경계가 전진하지 않는 비정상 케이스(시간대 급변 등) 무한 루프 방지 — tenMinuteFocusSlots와 동일
      t = pieceEnd > t ? pieceEnd : t + 60e3;
    }
  }
  return out;
}

// 세션 구간의 과목 색 — 서버 tagId → 태그명 → 로컬 과목 색. 로컬 과목 id는 서버 tagId와 다를 수
// 있어 이름으로 잇는다. 미분류·매칭 실패는 기본 집중색(오늘 타임테이블·주간 타임라인 공용).
export function subjectColorForTag(
  tagId: string | null,
  tagNames: Map<string, string>,
  subjects: { name: string; color: string }[],
): string {
  const name = tagId ? tagNames.get(tagId) : undefined;
  const subject = name ? subjects.find((x) => x.name === name) : undefined;
  return subject?.color ?? FOCUS_COLOR;
}

// 상단 기간 세그먼트 정의(일/주/월).
export const PERIOD_TABS: { key: StatsPeriod; label: string }[] = [
  { key: 'DAY', label: '일' },
  { key: 'WEEK', label: '주' },
  { key: 'MONTH', label: '월' },
];

// StatsPeriod → 애널리틱스 소문자 키.
export function periodKey(period: StatsPeriod): 'day' | 'week' | 'month' {
  return period === 'DAY' ? 'day' : period === 'WEEK' ? 'week' : 'month';
}

// 요일 라벨(일=0..토=6) — 첫 시작 차트·공유 이미지 날짜 헤더 등 공용.
export const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

// 이번 주 월~일 7일의 날짜 키('YYYY-MM-DD') — 요일별 차트들이 남은 요일까지 미리 그릴 때 공용.
// 축은 KST(GROMO-1236 P2) — 서버 heatmap 셀(KST 버킷)과 키가 일치해야 값이 제 요일 칸에 붙는다.
function weekDateKeys(): string[] {
  const now = kstTodayDate();
  const dow = now.getDay(); // 0=일..6=토
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + (dow === 0 ? -6 : 1 - dow),
  );
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return localDateStr(d);
  });
}

// 'YYYY-MM-DD' → 그 달력 날짜의 로컬 Date(정오) — KST 날짜 문자열에 대해 요일·일수 산술만 하기
// 위한 파싱. 파트 생성자라 시간대 변환이 끼지 않고, 정오 고정은 DST 자정 부재/중복에도 안전.
function dateFromStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

// KST '오늘'의 달력 날짜 Date — 통계 그리드·마커의 공용 앵커(GROMO-1236 P2 리뷰 반영).
// 데이터(서버 heatmap 셀)가 KST 버킷이므로 그것을 그리는 페이지·주 키·오늘 마커도 같은 축에서
// 파생해야 한다 — new Date()(로컬)로 만들면 비KST 기기에서 조회한 KST 주가 표시 중인 로컬 주
// 밖에 떨어져 캘린더가 비어 보인다. 이후 산술은 이 Date에 대한 달력 산술로만 한다.
export function kstTodayDate(): Date {
  return dateFromStr(todayStrKst());
}

// 기간별 히트맵 조회 범위 [from, to] ('YYYY-MM-DD').
// DAY=오늘, WEEK=이번 주 월요일~오늘(서버 /stats/focus WEEK와 동일 구간 — 리뷰 반영), MONTH=이달 1일~오늘.
// 축은 KST(GROMO-1236) — 서버 일별 버킷이 KST라 from/to 둘 다 KST 오늘에서 파생해야 한 축이 된다
// (to만 바꾸면 비KST 기기에서 주/월 시작이 하루 어긋난 반쪽 이전이 된다).
export function heatmapRange(period: StatsPeriod): { from: string; to: string } {
  const to = todayStrKst();
  if (period === 'DAY') return { from: to, to };
  const kstToday = dateFromStr(to); // KST '오늘'의 달력 날짜 — 로컬 new Date()를 쓰면 축이 갈린다
  if (period === 'WEEK') {
    const dow = kstToday.getDay(); // 0=일..6=토
    const toMonday = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(kstToday);
    monday.setDate(kstToday.getDate() + toMonday);
    return { from: localDateStr(monday), to };
  }
  return { from: localDateStr(new Date(kstToday.getFullYear(), kstToday.getMonth(), 1)), to };
}

// 최근 7일 범위 [오늘-6, 오늘] — 타 유저 heatmap(getUserStats, 서버가 최근 7일 고정)과 같은 창으로
// 비교할 때 사용(주간 월~오늘과 다름에 주의). 축은 KST(GROMO-1236) — 존재 이유가
// getUserStats(기본값 KST 오늘)와의 구간 정합이므로 같은 축이어야 한다.
export function rollingWeekRange(): { from: string; to: string } {
  const to = todayStrKst();
  const from = dateFromStr(to);
  from.setDate(from.getDate() - 6);
  return { from: localDateStr(from), to };
}

// 주/월 캘린더(GROMO-974) 한 페이지 — 그리드가 그릴 날짜 목록과 내비게이션 라벨.
export interface CalendarPage {
  days: string[]; // 'YYYY-MM-DD' — 주=월~일 7일, 월=1일~말일
  label: string; // '7월 3주차' | '2026년 7월'
  sublabel: string; // '7.13 – 7.19' | '1일 – 31일'
  leadingBlanks: number; // 월 그리드 앞쪽 빈 칸 수(1일 요일 정렬, 월=0..일=6). 주는 항상 0
}

// offset: 0=이번 기간, -1=지난 기간 … (미래 넘김 없음 — 양수는 쓰지 않는다).
// 주차 라벨은 그 주 월요일이 속한 달 기준, 1일이 낀 주(월요일 시작)가 1주차.
// 앵커는 KST 오늘(GROMO-1236 P2) — 페이지가 로컬 주/월이면 heatmapRange로 조회한 KST 셀이
// 표시 범위 밖에 떨어져(예: LA 일요일 아침 = KST 월요일) 캘린더가 비어 보인다.
export function calendarPage(period: 'WEEK' | 'MONTH', offset: number): CalendarPage {
  const now = kstTodayDate();
  if (period === 'WEEK') {
    const dow = now.getDay(); // 0=일..6=토
    const monday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + (dow === 0 ? -6 : 1 - dow) + offset * 7,
    );
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return localDateStr(d);
    });
    const first = new Date(monday.getFullYear(), monday.getMonth(), 1);
    const week1Monday = new Date(first);
    week1Monday.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const nth =
      (dayNum(monday.getFullYear(), monday.getMonth(), monday.getDate()) -
        dayNum(week1Monday.getFullYear(), week1Monday.getMonth(), week1Monday.getDate())) /
        7 +
      1;
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      days,
      label: `${monday.getMonth() + 1}월 ${nth}주차`,
      sublabel: `${monday.getMonth() + 1}.${monday.getDate()} – ${sunday.getMonth() + 1}.${sunday.getDate()}`,
      leadingBlanks: 0,
    };
  }
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: lastDay }, (_, i) =>
    localDateStr(new Date(first.getFullYear(), first.getMonth(), i + 1)),
  );
  return {
    days,
    label: `${first.getFullYear()}년 ${first.getMonth() + 1}월`,
    sublabel: `1일 – ${lastDay}일`,
    leadingBlanks: (first.getDay() + 6) % 7, // 월=0..일=6
  };
}

/**
 * 캘린더 그리드를 7칸 행으로 나눈 결과 — 월은 1일 요일 정렬용 앞 빈 칸 + 마지막 행 채움 빈 칸.
 *
 * ⚠️ **행 수를 아는 곳이 두 군데다** — 실제 그리드(CalendarCard)와 로딩 스켈레톤의 카드 높이
 *    (constants.skeletonCards). 같은 식을 두 번 구현하면 어긋난다. 월은 달마다 5행이거나
 *    6행이라(예: 2026-08 = 앞 빈칸 5 + 31일 = 36칸 = 6행) 어긋나면 도착 순간 카드가 한 행
 *    (≈52px) 갑자기 커진다. 그래서 분할을 여기 한 번만 두고 양쪽이 이걸 쓴다.
 */
export function calendarRows(period: 'WEEK' | 'MONTH', offset: number): (string | null)[][] {
  const page = calendarPage(period, offset);
  const slots: (string | null)[] = [
    ...Array.from({ length: page.leadingBlanks }, () => null),
    ...page.days,
  ];
  while (slots.length % 7 !== 0) slots.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < slots.length; i += 7) rows.push(slots.slice(i, i + 7));
  return rows;
}

/** 캘린더 그리드 행 수 — 스켈레톤 카드 높이 계산용. 분할은 calendarRows 한 곳에만 있다. */
export function calendarRowCount(period: 'WEEK' | 'MONTH', offset: number): number {
  return calendarRows(period, offset).length;
}

// 막대/점 1개(집중/폰 사용 공용).
export interface StatBar {
  label: string;
  value: number; // 분
  current: boolean; // 강조(오늘/이번 주차 등)
  future?: boolean; // 아직 오지 않은 구간 — 가로축 라벨만 표시하고 선·점은 그리지 않음(GROMO-761)
}

// 히트맵 → 기간별 막대. WEEK=요일별(월~일 7칸 전체), MONTH=주차별 합산, DAY=오늘 단일.
export function heatmapBars(
  period: StatsPeriod,
  cells: HeatmapCellResponse[],
  pick: (c: HeatmapCellResponse) => number,
): StatBar[] {
  // current/future 마커는 셀 날짜(KST 버킷)와 직접 비교되는 데이터 결합 마커라 KST 축이다
  // (GROMO-1236 P2 — 1차의 '로컬 유지(체감 축)' 분류를 대체: 데이터와 다른 축의 마커는
  // 비KST 기기에서 오늘 칸을 비켜 찍힌다).
  const today = todayStrKst();
  if (period === 'WEEK') {
    // 월~일 7칸을 미리 기재 — 서버 히트맵은 월~오늘까지만 오므로 없는 날은 0,
    // 아직 안 온 요일은 future(라벨만 표시, 선·점 없음)로 채운다
    const byDate = new Map(cells.map((c) => [c.date, pick(c)]));
    return weekDateKeys().map((key, i) => ({
      label: WEEKDAY[(i + 1) % 7], // 월~일
      value: byDate.get(key) ?? 0,
      current: key === today,
      future: key > today, // 'YYYY-MM-DD'는 문자열 비교가 날짜 비교와 일치
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

// 달력 일 번호 — UTC 자정으로 정규화해 DST가 있는 시간대에서도 일수 차이가 정확.
// 첫 시작 시각 집계·해당월 주별 차트(MonthWeeklyChart) 공용.
export const dayNum = (y: number, monthIdx: number, d: number) =>
  Math.floor(Date.UTC(y, monthIdx, d) / 86400e3);

// 임의 시각 → KST 벽시계 자정 경과 분 — dailyFirstStartMinutes 전용.
// Intl 실패 시 로컬 폴백 — localDate.ts의 KST 헬퍼와 같은 관례.
// 포매터는 모듈 스코프 1회 생성 캐시(레코드당 생성은 세션 수백 건에서 JS 스레드 멈춤 —
// PR #531 P2, localDate.ts와 동일 패턴). 생성 실패도 1회만 판정해 null 캐시.
let kstTimeFormat: Intl.DateTimeFormat | null | undefined;
function getKstTimeFormat(): Intl.DateTimeFormat | null {
  if (kstTimeFormat === undefined) {
    try {
      kstTimeFormat = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      kstTimeFormat = null;
    }
  }
  return kstTimeFormat;
}

function kstMinutesOfDay(d: Date): number {
  const fmt = getKstTimeFormat();
  if (fmt != null) {
    try {
      const parts = fmt.formatToParts(d);
      const get = (type: string): number =>
        Number(parts.find((p) => p.type === type)?.value ?? NaN);
      const h = get('hour');
      const m = get('minute');
      if (Number.isFinite(h) && Number.isFinite(m)) return (h % 24) * 60 + m;
    } catch {
      // 아래 로컬 폴백
    }
  }
  return d.getHours() * 60 + d.getMinutes();
}

// 세션 목록 → 일별 첫 세션 시작 시각(자정 경과 분). key = 'YYYY-MM-DD'(KST — GROMO-1236 P2:
// 점을 그리는 그리드(weekDateKeys·월 주 분할)가 KST 버킷이라 데이터 키도 같은 축이어야 점이
// 제 칸에 붙는다). 분도 KST 벽시계 — 로컬 분은 비KST 기기에서 KST 하루 안을 자정 wrap으로
// 넘나들어 '첫 시작' 최소값 비교가 시간 순서와 어긋난다(KR 기기에선 종전과 동일 값).
export function dailyFirstStartMinutes(sessions: { startedAt: string }[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = kstDateStr(d);
    const minutes = kstMinutesOfDay(d);
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
  // 그리드 키(weekDateKeys·월 주 분할)와 마커 모두 KST 앵커 — heatmapBars와 같은 이유
  // (GROMO-1236 P2, 1차의 '로컬 유지' 분류 대체). byDay 키도 같은 축(dailyFirstStartMinutes).
  const now = kstTodayDate();
  const today = todayStrKst();
  if (period === 'WEEK') {
    return weekDateKeys().map((key, i) => ({
      label: WEEKDAY[(i + 1) % 7], // 월~일
      minutes: byDay.get(key) ?? null,
      current: key === today,
      future: key > today, // 'YYYY-MM-DD'는 문자열 비교가 날짜 비교와 일치
    }));
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

// 저장된 카드 순서를 현재 카드 목록에 적용(통계 카드 순서 편집).
// 저장에 없는 새 카드는 기본 순서상 바로 앞 카드(존재하는 것 중 가장 가까운) 뒤에 끼워넣고,
// 이제 없는 카드 키는 버린다 — 카드가 추가/삭제돼도 저장된 순서가 자연스럽게 이어진다.
export function mergeCardOrder(defaults: string[], stored?: string[] | null): string[] {
  if (!stored || stored.length === 0) return defaults;
  const result = stored.filter((k) => defaults.includes(k));
  defaults.forEach((k, di) => {
    if (result.includes(k)) return;
    let at = 0;
    for (let i = di - 1; i >= 0; i--) {
      const idx = result.indexOf(defaults[i]);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    result.splice(at, 0, k);
  });
  return result;
}

// 집중 분 → 캘린더 셀 강도 0..4 (칸 색 진하기 — 구 잔디 강도, GROMO-974에서 캘린더가 승계).
export function grassLevel(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}
