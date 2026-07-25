// GoalDayStamps 컴포넌트 테스트(GROMO-946) — 오늘 2목표 스탬프(집중/폰 사용)의 상태 분기.
// 집중 현재값은 FocusProvider가 AsyncStorage(메모리 목)에서 읽으므로, 저장값을 심어서 제어한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { screen } from '@testing-library/react-native';
import { GoalDayStamps } from './GoalCards';
import { renderWithProviders } from '@/test/renderWithProviders';
import { STORAGE_KEYS } from '@/types/storage';
import { todayStr } from '@/utils/localDate';
import type { TodayStatMetric, TodayStatsResponse } from '@/types/dto/stats';

// Provider 마운트 복원 API 차단 — 저장값이 없을 때만 불리며, 테스트에선 항상 '데이터 없음' 응답
jest.mock('@/screens/focus/focusRestore', () => ({
  fetchTodayFocusRestore: jest.fn().mockResolvedValue({ sessions: null, tags: null }),
  sessionFocusSeconds: jest.fn(() => 0),
}));

const metric = (todayMinutes: number, goalMinutes: number): TodayStatMetric => ({
  todayMinutes,
  goalMinutes,
  goalAchieved: false,
  progressPercent: 0,
});

const todayOf = (over: {
  focusGoal: number;
  phoneCur: number;
  phoneGoal: number;
}): TodayStatsResponse => ({
  focus: metric(0, over.focusGoal), // 집중 현재값은 서버가 아니라 로컬(useFocus) 기준 — todayMinutes는 안 쓰임
  screenTime: metric(over.phoneCur, over.phoneGoal),
});

// FocusProvider가 읽는 '오늘 누적'(초)을 저장소에 심는다
const seedFocusSeconds = (sec: number) =>
  AsyncStorage.setItem(
    STORAGE_KEYS.focus,
    JSON.stringify({ todayFocusSeconds: sec, date: todayStr() }),
  );

afterEach(async () => {
  await AsyncStorage.clear();
});

describe('GoalDayStamps', () => {
  test('today가 null이면 조회 실패 문구', async () => {
    await renderWithProviders(<GoalDayStamps today={null} />);
    expect(screen.getByText('목표 정보를 불러오지 못했어요')).toBeOnTheScreen();
  });

  test('둘 다 목표 미설정(goal 0) — 미설정 스탬프 2개와 설정 유도 문구', async () => {
    await renderWithProviders(
      <GoalDayStamps today={todayOf({ focusGoal: 0, phoneCur: 30, phoneGoal: 0 })} />,
    );
    expect(await screen.findAllByText('목표 미설정')).toHaveLength(2);
    expect(screen.getByText('설정에서 집중 목표를 정해요')).toBeOnTheScreen();
    expect(screen.getByText('설정에서 폰 사용 목표를 정해요')).toBeOnTheScreen();
  });

  test('진행 중 — 집중은 분 단위 버림(59분 59초 = 59분, 달성 아님), 폰은 남은 시간 표시', async () => {
    await seedFocusSeconds(3599); // 59분 59초 → floor 59분 (반올림이면 60분이 돼 달성 오판)
    await renderWithProviders(
      <GoalDayStamps today={todayOf({ focusGoal: 60, phoneCur: 30, phoneGoal: 120 })} />,
    );
    expect(await screen.findByText('집중 59/60분')).toBeOnTheScreen();
    expect(screen.getByText('목표까지 1분')).toBeOnTheScreen();
    expect(screen.getByText('01:30 남음')).toBeOnTheScreen(); // 폰 목표까지 90분
    expect(screen.getByText('폰 사용 00:30 · 목표 02:00')).toBeOnTheScreen();
  });

  test('집중 달성 — 목표 도달 시 달성 스탬프', async () => {
    await seedFocusSeconds(3600); // 정확히 60분
    await renderWithProviders(
      <GoalDayStamps today={todayOf({ focusGoal: 60, phoneCur: 30, phoneGoal: 120 })} />,
    );
    expect(await screen.findByText('집중 달성')).toBeOnTheScreen();
    expect(screen.getByText('60분 · 목표 60분')).toBeOnTheScreen();
  });

  test('폰 사용 초과 — 목표를 넘기면 실패 스탬프', async () => {
    await renderWithProviders(
      <GoalDayStamps today={todayOf({ focusGoal: 0, phoneCur: 130, phoneGoal: 120 })} />,
    );
    expect(await screen.findByText('목표 달성 실패!')).toBeOnTheScreen();
    expect(screen.getByText('폰 사용 02:10 · 목표 02:00')).toBeOnTheScreen();
  });
});
