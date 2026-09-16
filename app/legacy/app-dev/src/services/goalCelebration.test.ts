// 목표 달성 축하 dedup 키 축 테스트(GROMO-1236 P2 6라운드) — 달성 판정이 서버 KST 버킷이므로
// '하루 1회' 키 체인(celebrationDayKey → 예약 date → 홈 비교 → 완료 기록)도 KST 축이어야 한다.
// 러너 TZ가 KST라 값으론 축이 안 갈리므로 로컬 todayStr를 독극물, todayStrKst를 센티널로 목킹해
// **축이 갈린 날**을 재현한다 — 키가 로컬을 따라가면 독극물이 그대로 드러난다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  celebrationDayKey,
  readPendingCelebration,
  schedulePendingCelebration,
} from './goalCelebration';

jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  todayStr: jest.fn(() => '2000-01-02'), // 독극물(로컬) — 키에 실리면 축 위반
  todayStrKst: jest.fn(() => '2026-03-04'), // 센티널(KST) — 로컬과 일부러 다른 날
}));

beforeEach(() => {
  jest.clearAllMocks();
  return AsyncStorage.clear();
});

describe('celebrationDayKey — KST 축(로컬≠KST인 날 재현)', () => {
  test('키는 KST 오늘을 따라간다 — 로컬(독극물)이 아니다', () => {
    expect(celebrationDayKey()).toBe('2026-03-04');
    expect(celebrationDayKey()).not.toBe('2000-01-02');
  });

  test('예약(date=키) → 조회 → 소비 측 비교(p.date === celebrationDayKey())가 축이 갈린 날에도 성립한다', async () => {
    // 결과 화면의 예약 경로와 동일 — date에 celebrationDayKey를 싣는다
    await schedulePendingCelebration({ date: celebrationDayKey(), days: 3, goalMinutes: 60 });
    const p = await readPendingCelebration();
    expect(p).not.toBeNull();
    // 홈(checkGoalCelebration)의 dedup 비교와 동일 술어 — 로컬 키였다면 여기서 어긋나
    // 예약이 '지난 날짜'로 오폐기되거나(한쪽 로컬) 같은 달성이 두 번 축하된다(반쪽 이전 검출).
    expect(p?.date).toBe(celebrationDayKey());
    expect(p?.date).not.toBe('2000-01-02');
  });
});
