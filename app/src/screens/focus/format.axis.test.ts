// thisWeekDates 축 잠금 테스트(GROMO-1236 P2 3라운드) — 결과 화면의 주간 막대·스트릭 칸 키는
// KST 앵커(todayStrKst → kstTodayDate)에서 파생돼야 한다. 러너 TZ가 KST라 로컬 시계로 만들어도
// 값이 같으므로, todayStrKst를 시스템 시계(7월)와 다른 날짜(3월)로 목킹해 축 이탈을 즉시
// 드러낸다(stats/format.gridAxis.test.ts와 동일 패턴). todayStr는 독극물.
import { thisWeekDates } from './format';

jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  todayStr: jest.fn(() => '2000-01-02'), // 독극물 — 결과에 섞이면 축 위반
  todayStrKst: jest.fn(() => '2026-03-04'), // 앵커(수요일) — 시스템 시계와 일부러 다른 달
}));

const NOW = new Date('2026-07-15T09:00:00+09:00'); // 시계는 7월 — 앵커(3월)와 갈라놓는다

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

describe('thisWeekDates — KST 앵커', () => {
  test('시스템 시계(7월)가 아니라 앵커 3/4(수)의 월~일 주를 돌려준다', () => {
    expect(thisWeekDates()).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ]);
  });

  test('앵커가 일요일이어도 주 시작은 같은 주 월요일(다음 주로 넘어가지 않음)', () => {
    const localDate = jest.requireMock('@/utils/localDate') as { todayStrKst: jest.Mock };
    localDate.todayStrKst.mockReturnValueOnce('2026-03-08'); // 일요일
    expect(thisWeekDates()[0]).toBe('2026-03-02');
  });
});
