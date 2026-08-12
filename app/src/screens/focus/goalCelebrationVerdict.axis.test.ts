// 목표 달성 축하 판정 축 잠금(GROMO-1254) — 종전 FocusResultScreen 인라인 effect였던 판정을
// goalCelebrationVerdict로 뽑아 처음으로 직접 부른다. GROMO-1236의 KST 이전이 회귀 그물 없이
// 착지했던 자리다.
//
// 러너 TZ가 KST(jest.config.js)라 값만으로는 로컬/KST가 안 갈린다. 그래서 확립된
// **독극물/센티널** 패턴을 쓴다(goalCelebration.test.ts·stats/format.gridAxis.test.ts 원형):
//   · todayStr(로컬) = 독극물 '2000-01-02' — 예약 date나 heatmap 창에 실리면 축 위반이 드러난다
//   · todayStrKst(KST) = 센티널 '2026-03-04' — 시스템 시계(7월)와 일부러 다른 달
// localDate의 나머지(localDateStr·kstLocalSameDay)는 실물이다 — 커서 산술과 동축 게이트는
// 실제 구현이 돌아야 한다(시임 오버라이드 금지, 계약 §6).
//
// 목은 **네트워크·저장소 경계**에만 건다(statsApi). goalCelebration은 부분 목 —
// celebrationDayKey는 실물이라 목킹된 todayStrKst를 실제로 타고, 예약/조회만 스파이한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { getHeatmap, getTodayStats } from '@/services/statsApi';
import { schedulePendingCelebration } from '@/services/goalCelebration';
import type { HeatmapCellResponse, TodayStatsResponse } from '@/types/dto/stats';
import { evaluateGoalCelebration } from './goalCelebrationVerdict';

jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  todayStr: jest.fn(() => '2000-01-02'), // 독극물(로컬)
  todayStrKst: jest.fn(() => '2026-03-04'), // 센티널(KST) — 수요일
}));

jest.mock('@/services/statsApi', () => ({
  getTodayStats: jest.fn(),
  getHeatmap: jest.fn(),
}));

jest.mock('@/services/goalCelebration', () => ({
  ...jest.requireActual('@/services/goalCelebration'),
  schedulePendingCelebration: jest.fn(() => Promise.resolve()),
}));

const mockGetTodayStats = getTodayStats as jest.MockedFunction<typeof getTodayStats>;
const mockGetHeatmap = getHeatmap as jest.MockedFunction<typeof getHeatmap>;
const mockSchedule = schedulePendingCelebration as jest.MockedFunction<
  typeof schedulePendingCelebration
>;

// 시스템 시계는 7월 — 센티널(3월)과 갈라놓아 new Date() 기반 산술의 회귀를 검출한다
const NOW = new Date('2026-07-15T09:00:00+09:00');

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHeatmap.mockResolvedValue([]);
  return AsyncStorage.clear();
});

function todayStats(todayMinutes: number, goalMinutes: number): TodayStatsResponse {
  return {
    focus: { todayMinutes, goalMinutes, goalAchieved: todayMinutes >= goalMinutes },
    screenTime: { todayMinutes: 0, goalMinutes: 0, goalAchieved: false },
  } as TodayStatsResponse;
}

function cell(date: string, focusGoalAchieved: boolean): HeatmapCellResponse {
  return {
    date,
    totalFocusMinutes: 60,
    sessionCount: 1,
    focusGoalAchieved,
    actualScreenTimeMinutes: 0,
    screenTimeGoalAchieved: false,
  };
}

describe('evaluateGoalCelebration — 예약 date는 KST 축', () => {
  test('달성 시 예약 date = KST 센티널(로컬 독극물 아님)', async () => {
    mockGetTodayStats.mockResolvedValue(todayStats(90, 60));

    const pending = await evaluateGoalCelebration(0, 60 * 60);

    expect(pending).not.toBeNull();
    expect(pending?.date).toBe('2026-03-04');
    expect(pending?.date).not.toBe('2000-01-02');
    expect(mockSchedule).toHaveBeenCalledWith(pending);
  });

  test('미달성이면 예약하지 않는다', async () => {
    mockGetTodayStats.mockResolvedValue(todayStats(10, 60));

    expect(await evaluateGoalCelebration(0, 60 * 60)).toBeNull();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  test('오늘 이미 축하했으면(완료 기록 = KST 키) 재판정하지 않는다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.focusGoalCelebratedDate, '2026-03-04');
    mockGetTodayStats.mockResolvedValue(todayStats(90, 60));

    expect(await evaluateGoalCelebration(0, 60 * 60)).toBeNull();
    expect(mockGetTodayStats).not.toHaveBeenCalled();
    // 로컬 키로 기록돼 있으면 가드가 안 걸린다 = 축이 갈린 기기에서 하루 두 번 축하
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  test('로컬(독극물) 키로 남은 완료 기록은 가드로 쓰지 않는다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.focusGoalCelebratedDate, '2000-01-02');
    mockGetTodayStats.mockResolvedValue(todayStats(90, 60));

    const pending = await evaluateGoalCelebration(0, 60 * 60);
    expect(pending?.date).toBe('2026-03-04');
  });
});

describe('evaluateGoalCelebration — 연속 달성일 커서·조회 창도 KST 앵커', () => {
  test('heatmap 조회 창이 KST 오늘의 어제(3/3)에서 60일 뒤로 — 시스템 시계(7월)가 아니다', async () => {
    mockGetTodayStats.mockResolvedValue(todayStats(90, 60));

    await evaluateGoalCelebration(0, 60 * 60);

    // 커서 = 앵커(3/4) − 1일 = 3/3, 창 = [3/3 − 59일, 3/3] = [2026-01-03, 2026-03-03]
    expect(mockGetHeatmap).toHaveBeenCalledWith('2026-01-03', '2026-03-03');
  });

  test('어제부터 연속 달성 셀을 세어 오늘(+1)까지 더한다 — 셀 키가 KST라 그대로 붙는다', async () => {
    mockGetTodayStats.mockResolvedValue(todayStats(90, 60));
    mockGetHeatmap.mockResolvedValue([
      cell('2026-03-03', true),
      cell('2026-03-02', true),
      cell('2026-03-01', false), // 갭 — 여기서 멈춘다
    ]);

    const pending = await evaluateGoalCelebration(0, 60 * 60);

    expect(pending?.days).toBe(3); // 오늘 + 3/3 + 3/2
  });

  test('heatmap 조회가 실패해도 연속 1일로 예약된다', async () => {
    mockGetTodayStats.mockResolvedValue(todayStats(90, 60));
    mockGetHeatmap.mockRejectedValue(new Error('network'));

    const pending = await evaluateGoalCelebration(0, 60 * 60);

    expect(pending?.days).toBe(1);
  });
});

describe('evaluateGoalCelebration — 측정 축(로컬 누적) 폴백', () => {
  test('서버 조회 실패 시 로컬 누적 + 로컬 목표로 판정한다', async () => {
    mockGetTodayStats.mockRejectedValue(new Error('network'));

    // 로컬 90분 누적 · 목표 60분 — 러너는 KST 기기라 동축 게이트(kstLocalSameDay)가 열려 있다
    const pending = await evaluateGoalCelebration(90 * 60, 60 * 60);

    expect(pending?.date).toBe('2026-03-04');
    expect(pending?.goalMinutes).toBe(60);
  });

  test('목표가 0이면 달성 판정 자체를 하지 않는다', async () => {
    mockGetTodayStats.mockRejectedValue(new Error('network'));

    expect(await evaluateGoalCelebration(90 * 60, 0)).toBeNull();
  });
});
