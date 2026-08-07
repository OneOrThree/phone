// statsApi date 축 계약 테스트(GROMO-1236) — 서버는 date를 KST 일별 버킷에 equality 조회하므로
// 기본값은 반드시 KST 오늘이어야 한다. 러너 TZ가 KST라 값만 봐선 로컬/KST 축이 안 갈리므로,
// 로컬 todayStr를 **일부러 엉뚱한 날짜(독극물)**로 목킹한다 — 코드가 로컬 축을 부르면
// '2000-01-02'가 요청에 실려 곧장 드러난다(GROMO-1219 축-분리 검증 패턴).
import {
  getTodayStats,
  getStreak,
  getFocusPeriodStats,
  getFocusStatsByCategory,
  getScreenTimePeriodStats,
  getFocusAverage,
} from './statsApi';
import { api } from '@/services/api';
import { todayStrKst } from '@/utils/localDate';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn() },
}));

jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  todayStr: jest.fn(() => '2000-01-02'), // 독극물 — 이 값이 요청에 실리면 축 위반
}));

const mockGet = (api as unknown as { get: jest.Mock }).get;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: {} });
});

// 기본 date가 실물 KST 오늘과 일치하고 독극물(로컬 목)이 아닌지 — 6개 함수 공통 단언.
function expectKstDate(path: string, extraParams: Record<string, unknown> = {}) {
  const kst = todayStrKst();
  expect(kst).not.toBe('2000-01-02'); // 목이 KST 실물까지 오염하지 않았는지 자기검증
  expect(mockGet).toHaveBeenCalledWith(path, {
    params: { ...extraParams, date: kst },
  });
}

describe('date 기본값 = KST 오늘 (GROMO-1236)', () => {
  test('GET /api/v1/stats/today', async () => {
    await getTodayStats();
    expectKstDate('/api/v1/stats/today', { friends: undefined });
  });

  test('GET /api/v1/stats/streak', async () => {
    await getStreak();
    expectKstDate('/api/v1/stats/streak', { friends: undefined });
  });

  test('GET /api/v1/stats/focus', async () => {
    await getFocusPeriodStats('WEEK');
    expectKstDate('/api/v1/stats/focus', { period: 'WEEK', friends: undefined });
  });

  test('GET /api/v1/stats/by-category', async () => {
    await getFocusStatsByCategory('DAY');
    expectKstDate('/api/v1/stats/by-category', { period: 'DAY', friends: undefined });
  });

  test('GET /api/v1/stats/screen-time', async () => {
    await getScreenTimePeriodStats('MONTH');
    expectKstDate('/api/v1/stats/screen-time', { period: 'MONTH' });
  });

  test('GET /api/v1/stats/focus/average', async () => {
    await getFocusAverage('FRIENDS', 'DAY');
    expectKstDate('/api/v1/stats/focus/average', { scope: 'FRIENDS', period: 'DAY' });
  });

  // 명시 date는 그대로 나간다 — 화면이 과거 기준일을 넘기는 경로(CalendarCard anchor 등) 보존.
  test('date를 명시하면 기본값이 끼어들지 않는다', async () => {
    await getFocusPeriodStats('WEEK', undefined, '2026-08-01');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/stats/focus', {
      params: { period: 'WEEK', date: '2026-08-01', friends: undefined },
    });
  });
});
