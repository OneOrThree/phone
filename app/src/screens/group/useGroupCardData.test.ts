import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { getAnnouncements, getChallenges, getGroupDetail } from '@/services/groupApi';
import { getMyRanking } from '@/services/leagueApi';
import { todayStrKst } from '@/utils/localDate';
import { useGroupCardData } from './useGroupCardData';

jest.mock('@/services/groupApi', () => ({
  getGroupDetail: jest.fn(),
  getAnnouncements: jest.fn(),
  getChallenges: jest.fn(),
}));

jest.mock('@/services/leagueApi', () => ({ getMyRanking: jest.fn() }));
jest.mock('@/utils/localDate', () => ({ todayStrKst: jest.fn() }));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockGetAnnouncements = getAnnouncements as jest.MockedFunction<typeof getAnnouncements>;
const mockGetChallenges = getChallenges as jest.MockedFunction<typeof getChallenges>;
const mockGetMyRanking = getMyRanking as jest.MockedFunction<typeof getMyRanking>;
const mockTodayStrKst = todayStrKst as jest.MockedFunction<typeof todayStrKst>;
const GROUP_IDS = ['g1'] as const;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('KST 자정을 백그라운드에서 넘기면 foreground 복귀 즉시 열린 카드 scope를 갱신한다', async () => {
  mockTodayStrKst.mockReturnValue('2026-08-10');
  const appStateListeners: Array<(state: 'active' | 'background') => void> = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener as (state: 'active' | 'background') => void);
    return { remove: jest.fn() };
  });
  mockGetGroupDetail.mockResolvedValue({ id: 'g1', members: [] } as never);
  mockGetAnnouncements.mockResolvedValue([]);
  mockGetChallenges.mockResolvedValue([]);
  mockGetMyRanking.mockResolvedValue([]);

  const { result, unmount } = await renderHook(() =>
    useGroupCardData({ userId: 'u1', groupIds: GROUP_IDS, screenFocused: true }),
  );
  await act(async () => {
    result.current.ensureBack('g1');
    await Promise.resolve();
  });
  await waitFor(() => expect(mockGetGroupDetail).toHaveBeenCalledWith('g1', '2026-08-10'));
  await waitFor(() => expect(result.current.snapshots.g1?.detail.status).toBe('ready'));

  mockTodayStrKst.mockReturnValue('2026-08-11');
  await act(async () => {
    appStateListeners.forEach((listener) => listener('active'));
    await Promise.resolve();
  });
  expect(appStateListeners).toHaveLength(1);
  expect(mockTodayStrKst).toHaveBeenLastCalledWith();

  await waitFor(() => expect(mockGetGroupDetail).toHaveBeenCalledWith('g1', '2026-08-11'));
  unmount();
});

test('AppState가 아직 null이어도 열린 카드의 60초 focus polling을 시작한다', async () => {
  const appState = AppState as unknown as { currentState: AppStateStatus | null };
  const previousState = appState.currentState;
  appState.currentState = null;
  jest.useFakeTimers();
  mockTodayStrKst.mockReturnValue('2026-08-10');
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  mockGetGroupDetail.mockResolvedValue({ id: 'g1', members: [] } as never);
  mockGetAnnouncements.mockResolvedValue([]);
  mockGetChallenges.mockResolvedValue([]);
  mockGetMyRanking.mockResolvedValue([]);

  try {
    const { result, unmount } = await renderHook(() =>
      useGroupCardData({ userId: 'u1', groupIds: GROUP_IDS, screenFocused: true }),
    );
    await act(async () => {
      result.current.ensureBack('g1');
      await Promise.resolve();
    });
    await waitFor(() => expect(mockGetMyRanking).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockGetMyRanking).toHaveBeenCalledTimes(2));
    unmount();
  } finally {
    appState.currentState = previousState;
    jest.useRealTimers();
  }
});
