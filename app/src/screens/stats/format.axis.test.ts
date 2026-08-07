// heatmapRange·rollingWeekRange 축 테스트(GROMO-1236) — 서버 히트맵 조회 범위는 from/to 모두
// KST 축이어야 한다. 러너 TZ가 KST라 값으론 로컬/KST가 안 갈리므로, 로컬 todayStr를 독극물로
// 목킹해 로컬 축 호출을 즉시 드러낸다(서비스 축 테스트와 동일 패턴). 여기선 todayStrKst가
// **실물**이라 Intl 경유 KST 자정 경계까지 검증한다. 그리드·마커의 앵커 축(P2에서 KST로 이전)은
// todayStrKst를 센티널로 목킹하는 format.gridAxis.test.ts가 잠근다. 값 검증은 format.test.ts.
import { heatmapRange, rollingWeekRange } from './format';

jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  todayStr: jest.fn(() => '2000-01-02'), // 독극물 — 결과에 섞이면 축 위반
}));

// 고정 '오늘': 2026-07-15(수) 09:00 KST — format.test.ts와 같은 손검증 날짜
const NOW = new Date('2026-07-15T09:00:00+09:00');

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

describe('heatmapRange — from/to 모두 KST 축(GROMO-1236)', () => {
  test('DAY=KST 오늘 하루, WEEK=KST 월요일~오늘, MONTH=KST 이달 1일~오늘 (독극물 미검출)', () => {
    expect(heatmapRange('DAY')).toEqual({ from: '2026-07-15', to: '2026-07-15' });
    expect(heatmapRange('WEEK')).toEqual({ from: '2026-07-13', to: '2026-07-15' });
    expect(heatmapRange('MONTH')).toEqual({ from: '2026-07-01', to: '2026-07-15' });
  });

  test('KST 일요일에도 WEEK 시작은 같은 주 월요일', () => {
    jest.setSystemTime(new Date('2026-07-19T09:00:00+09:00')); // KST 일요일
    expect(heatmapRange('WEEK')).toEqual({ from: '2026-07-13', to: '2026-07-19' });
  });

  test('KST 자정 직후(UTC로는 전날)에도 KST 날짜로 계산된다', () => {
    // 2026-07-15T15:30:00Z = KST 7/16 00:30 — UTC·서쪽 시간대 감각으론 아직 7/15
    jest.setSystemTime(new Date('2026-07-15T15:30:00Z'));
    expect(heatmapRange('DAY')).toEqual({ from: '2026-07-16', to: '2026-07-16' });
    // 7/16(목)의 주 시작도 KST 기준 같은 주 월요일(7/13)
    expect(heatmapRange('WEEK')).toEqual({ from: '2026-07-13', to: '2026-07-16' });
  });
});

describe('rollingWeekRange — KST [오늘-6, 오늘]', () => {
  test('오늘 포함 최근 7일 (독극물 미검출)', () => {
    expect(rollingWeekRange()).toEqual({ from: '2026-07-09', to: '2026-07-15' });
  });

  test('월 경계를 거슬러 넘어간다 (7/3 → 6/27부터)', () => {
    jest.setSystemTime(new Date('2026-07-03T09:00:00+09:00'));
    expect(rollingWeekRange()).toEqual({ from: '2026-06-27', to: '2026-07-03' });
  });
});
