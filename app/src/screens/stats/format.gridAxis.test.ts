// 그리드 축 잠금 테스트(GROMO-1236 P2) — 캘린더 페이지·주 키·current/future 마커는 KST 앵커
// (todayStrKst → kstTodayDate)에서 파생돼야 한다. 러너 TZ가 KST라 new Date()(로컬 시계)로
// 앵커해도 값이 같아 회귀를 못 잡으므로, todayStrKst를 시스템 시계(7월)와 **다른 날짜(3월)**로
// 목킹한다 — 코드가 시계를 보면 7월 주가, 앵커를 보면 3월 주가 나와 축 이탈이 즉시 드러난다.
// 로컬 todayStr는 독극물('2000-01-02') — 마커가 로컬 축을 부르면 current가 사라져 단언이 깨진다.
import {
  calendarPage,
  firstStartPoints,
  heatmapBars,
  heatmapRange,
  rollingWeekRange,
} from './format';
import type { HeatmapCellResponse } from '@/types/dto/stats';

jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  todayStr: jest.fn(() => '2000-01-02'), // 독극물 — 결과에 섞이면 축 위반
  todayStrKst: jest.fn(() => '2026-03-04'), // 앵커(수요일) — 아래 시스템 시계와 일부러 다른 달
}));

// 시스템 시계는 7월 — 앵커(3월)와 갈라놓아 new Date() 기반 산술의 회귀를 검출한다
const NOW = new Date('2026-07-15T09:00:00+09:00');

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

// 히트맵 셀 생성 헬퍼 — format.test.ts와 동일 형태
function cell(date: string, totalFocusMinutes: number): HeatmapCellResponse {
  return {
    date,
    totalFocusMinutes,
    sessionCount: 1,
    focusGoalAchieved: false,
    actualScreenTimeMinutes: 0,
    screenTimeGoalAchieved: false,
  };
}

describe('calendarPage — KST 앵커(시계가 아니라 todayStrKst의 주/월을 그린다)', () => {
  test('WEEK: 앵커 3/4(수)의 월요일 3/2~일요일 3/8', () => {
    const p = calendarPage('WEEK', 0);
    expect(p.days[0]).toBe('2026-03-02');
    expect(p.days[6]).toBe('2026-03-08');
    expect(p.label).toBe('3월 2주차'); // 3/1(일)이 낀 주(2/23 시작)가 1주차
  });

  test('MONTH: 앵커 월(3월) 1~31일, 1일(일요일) 정렬 빈 칸 6', () => {
    const p = calendarPage('MONTH', 0);
    expect(p.days[0]).toBe('2026-03-01');
    expect(p.days).toHaveLength(31);
    expect(p.label).toBe('2026년 3월');
    expect(p.leadingBlanks).toBe(6);
  });
});

describe('heatmapRange·rollingWeekRange — 같은 앵커에서 파생(그리드와 조회 범위 일치)', () => {
  test('DAY·WEEK·MONTH 범위가 전부 앵커 기준', () => {
    expect(heatmapRange('DAY')).toEqual({ from: '2026-03-04', to: '2026-03-04' });
    expect(heatmapRange('WEEK')).toEqual({ from: '2026-03-02', to: '2026-03-04' });
    expect(heatmapRange('MONTH')).toEqual({ from: '2026-03-01', to: '2026-03-04' });
  });

  test('rollingWeekRange = 앵커 [오늘-6, 오늘]', () => {
    expect(rollingWeekRange()).toEqual({ from: '2026-02-26', to: '2026-03-04' });
  });
});

describe('마커 — current/future가 KST 오늘(앵커) 기준', () => {
  const pick = (c: HeatmapCellResponse) => c.totalFocusMinutes;

  test('heatmapBars WEEK: 주 키가 앵커 주고, 앵커 날짜 칸이 current', () => {
    const bars = heatmapBars('WEEK', [cell('2026-03-02', 60), cell('2026-03-04', 30)], pick);
    // 셀 값이 제 요일 칸에 붙는다 = 주 키(weekDateKeys)가 셀(KST 버킷)과 같은 축이라는 증거
    expect(bars[0]).toEqual({ label: '월', value: 60, current: false, future: false });
    expect(bars[2]).toEqual({ label: '수', value: 30, current: true, future: false });
    expect(bars.slice(3).every((b) => b.future === true)).toBe(true);
  });

  test('firstStartPoints WEEK: 같은 앵커 주·같은 마커 축', () => {
    const points = firstStartPoints(
      'WEEK',
      new Map([
        ['2026-03-02', 480],
        ['2026-03-04', 540],
      ]),
    );
    expect(points[0]).toEqual({ label: '월', minutes: 480, current: false, future: false });
    expect(points[2]).toEqual({ label: '수', minutes: 540, current: true, future: false });
    expect(points.slice(3).every((p) => p.future === true && p.minutes === null)).toBe(true);
  });
});
