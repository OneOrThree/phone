// ST1 비교 블록 컴포넌트 테스트(GROMO-946) — CompareWeek(주)·ComparePeriod(일/월)의
// 빈 상태 3분기(친구 없음/준비 시험 미설정/조회 실패)와 정상 바 렌더.
// 평균 조회는 compareAverages 목으로, 화면 포커스 재조회(useFocusEffect)는 useEffect로 대체한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, userEvent } from '@testing-library/react-native';
import { CompareWeek, ComparePeriod } from './Compare';
import { STORAGE_KEYS } from '@/types/storage';
import {
  fetchGlobalAverage,
  fetchCategoryAverage,
  fetchFriendsAverage,
  fetchFocusAverage,
} from '@/services/compareAverages';

jest.mock('@/services/compareAverages');
jest.mock('@/services/analyticsEvents', () => ({
  logStatsCompareAxisChanged: jest.fn(),
}));
// 내비게이션 밖에서도 렌더되게 포커스 효과를 일반 effect로 대체 — 마운트 시 1회 조회와 동일
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(cb, [cb]);
  },
}));

const mockGlobal = fetchGlobalAverage as jest.Mock;
const mockCategory = fetchCategoryAverage as jest.Mock;
const mockFriends = fetchFriendsAverage as jest.Mock;
const mockFocusAvg = fetchFocusAverage as jest.Mock;

beforeEach(() => {
  // 기본값: 전체 평균만 정상, 나머지 축은 빈 상태 — 각 테스트가 필요한 축만 덮어쓴다
  mockGlobal.mockResolvedValue(120);
  mockCategory.mockResolvedValue({ avg: null, label: null });
  mockFriends.mockResolvedValue({ avg: null, count: 0 });
  mockFocusAvg.mockResolvedValue({ avg: null, count: 0 });
});

afterEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('CompareWeek (주 탭 — 리그 랭킹 기반)', () => {
  test('정상 — 나 vs 전체 평균 바', async () => {
    await render(<CompareWeek myMinutes={90} />);
    expect(await screen.findByText('전체 평균')).toBeOnTheScreen();
    expect(screen.getByText('01:30:00')).toBeOnTheScreen(); // 나 90분
    expect(screen.getByText('02:00:00')).toBeOnTheScreen(); // 평균 120분
  });

  test('친구 축 — 친구가 없으면 원인 안내', async () => {
    const user = userEvent.setup();
    await render(<CompareWeek myMinutes={90} />);
    await screen.findByText('전체 평균'); // 로딩 종료 대기
    await user.press(screen.getByText('친구'));
    expect(await screen.findByText('아직 친구가 없어요')).toBeOnTheScreen();
  });

  test('카테고리 축 — 준비 시험 미설정이면 설정 유도', async () => {
    const user = userEvent.setup();
    await render(<CompareWeek myMinutes={90} />);
    await screen.findByText('전체 평균');
    await user.press(screen.getByText('같은 카테고리'));
    expect(await screen.findByText('준비 시험을 설정하면 비교할 수 있어요')).toBeOnTheScreen();
  });

  test('전체 축 — 평균 조회 실패면 실패 문구', async () => {
    mockGlobal.mockResolvedValue(null);
    await render(<CompareWeek myMinutes={90} />);
    expect(await screen.findByText('비교 데이터를 불러오지 못했어요')).toBeOnTheScreen();
  });
});

describe('ComparePeriod (일/월 탭 — 평균 집계 API 기반)', () => {
  test('DAY 친구 축 — 집계 대상 없음(count 0)은 오늘 기준 원인 안내', async () => {
    const user = userEvent.setup();
    mockFocusAvg.mockResolvedValue({ avg: 60, count: 3 }); // 전체 축은 정상
    await render(<ComparePeriod period="DAY" myMinutes={30} />);
    await screen.findByText('전체 평균');
    await user.press(screen.getByText('친구'));
    expect(await screen.findByText('오늘 집중한 친구가 아직 없어요')).toBeOnTheScreen();
  });

  test('MONTH 전체 축 — 기록 없음(count 0)은 이번 달 문구', async () => {
    await render(<ComparePeriod period="MONTH" myMinutes={30} />);
    expect(await screen.findByText('이번 달 집중 기록이 아직 모이지 않았어요')).toBeOnTheScreen();
  });

  test('조회 실패(count -1)는 원인 안내 대신 실패 문구', async () => {
    mockFocusAvg.mockResolvedValue({ avg: null, count: -1 });
    await render(<ComparePeriod period="DAY" myMinutes={30} />);
    expect(await screen.findByText('비교 데이터를 불러오지 못했어요')).toBeOnTheScreen();
  });

  test('카테고리 축 — 준비 시험 미설정이면 설정 유도', async () => {
    const user = userEvent.setup();
    mockFocusAvg.mockImplementation((scope: string) =>
      Promise.resolve(scope === 'TOTAL' ? { avg: 60, count: 3 } : { avg: null, count: 0 }),
    );
    await render(<ComparePeriod period="DAY" myMinutes={30} />);
    await screen.findByText('전체 평균');
    await user.press(screen.getByText('같은 카테고리'));
    expect(await screen.findByText('준비 시험을 설정하면 비교할 수 있어요')).toBeOnTheScreen();
  });

  test('카테고리 축 — 설정돼 있으면 같은 count 0이라도 기록 없음 안내', async () => {
    const user = userEvent.setup();
    await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, '수능');
    mockFocusAvg.mockImplementation((scope: string) =>
      Promise.resolve(scope === 'TOTAL' ? { avg: 60, count: 3 } : { avg: null, count: 0 }),
    );
    await render(<ComparePeriod period="DAY" myMinutes={30} />);
    await screen.findByText('전체 평균');
    await user.press(screen.getByText('같은 카테고리'));
    expect(await screen.findByText('오늘 같은 카테고리 기록이 아직 없어요')).toBeOnTheScreen();
  });

  test('카테고리 축 정상 — 설정된 카테고리명으로 평균 라벨 표기', async () => {
    const user = userEvent.setup();
    await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, '수능');
    mockFocusAvg.mockImplementation((scope: string) =>
      Promise.resolve(scope === 'CATEGORY' ? { avg: 45, count: 5 } : { avg: null, count: 0 }),
    );
    await render(<ComparePeriod period="DAY" myMinutes={30} />);
    await user.press(screen.getByText('같은 카테고리'));
    expect(await screen.findByText('수능 평균')).toBeOnTheScreen();
    expect(screen.getByText('00:45:00')).toBeOnTheScreen(); // 평균 45분
  });
});
