import { AppState, type AppStateStatus } from 'react-native';
import { getFriendsScreen } from '@/services/api/friends';
import { myIslands } from '@/services/api/islands';
import { getSession, sessionGeneration, subscribeSession } from '@/services/api/session';
import { captureProductEvent, getPostHogClient } from '@/services/posthog';
import { startSocialAnalytics } from './socialAnalytics';

jest.mock('@/services/api/friends', () => ({ getFriendsScreen: jest.fn() }));
jest.mock('@/services/api/islands', () => ({ myIslands: jest.fn() }));
jest.mock('@/services/api/session', () => ({
  getSession: jest.fn(),
  sessionGeneration: jest.fn(),
  subscribeSession: jest.fn(),
}));
jest.mock('@/services/posthog', () => ({
  captureProductEvent: jest.fn(),
  getPostHogClient: jest.fn(),
}));

let session: ReturnType<typeof getSession>;
let generation: number;
let sessionListener: Parameters<typeof subscribeSession>[0];
let appStateListener: (state: AppStateStatus) => void;
let stop: (() => void) | undefined;
const remove = jest.fn();
const unsubscribe = jest.fn();
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
function foreground() {
  AppState.currentState = 'background';
  appStateListener('background');
  AppState.currentState = 'active';
  appStateListener('active');
}
function snapshotProperties() {
  return jest
    .mocked(captureProductEvent)
    .mock.calls.find(([event]) => event === 'social_state_observed')?.[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-10-17T00:00:00Z') });
  session = { userId: 'user-a', accessToken: 'a', refreshToken: 'r' };
  generation = 1;
  AppState.currentState = 'active';
  jest.mocked(getSession).mockImplementation(() => session);
  jest.mocked(sessionGeneration).mockImplementation(() => generation);
  jest.mocked(subscribeSession).mockImplementation((listener) => {
    sessionListener = listener;
    listener(session);
    return unsubscribe;
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    appStateListener = listener as typeof appStateListener;
    return { remove };
  });
  jest
    .mocked(getPostHogClient)
    .mockReturnValue({} as NonNullable<ReturnType<typeof getPostHogClient>>);
  jest
    .mocked(myIslands)
    .mockResolvedValue({ items: [], nextCursor: null, currentIslandId: null, lossReason: null });
  jest
    .mocked(getFriendsScreen)
    .mockResolvedValue({ friends: [], friendRequests: [], sentFriendRequests: [] });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('현재 선택 섬이 없어도 실제 소속은 member, 친구 요청과 핀은 친구 수에 더하지 않는다', async () => {
  jest.mocked(myIslands).mockResolvedValue({
    items: [{ id: 'island-a' }] as any,
    nextCursor: null,
    currentIslandId: null,
    lossReason: null,
  });
  jest.mocked(getFriendsScreen).mockResolvedValue({
    friends: [
      { userId: 'friend-a', nickname: '비공개 이름', isPinned: true },
      { userId: 'friend-a', nickname: '중복', isPinned: true },
      { userId: 'friend-b', nickname: '다른 이름', isPinned: false },
    ] as any,
    friendRequests: [{ userId: 'pending' }] as any,
    sentFriendRequests: [{ userId: 'sent' }] as any,
  });
  stop = startSocialAnalytics();
  await flush();
  expect(snapshotProperties()).toEqual({
    analytics_schema_version: 1,
    island_status: 'member',
    island_count: 1,
    friend_bucket: '2-4',
    friend_count: 2,
  });
});

test('조회 실패는 0명이 아닌 unknown, 성공한 섬 정보는 유지한다', async () => {
  jest.mocked(getFriendsScreen).mockRejectedValue(new Error('offline'));
  stop = startSocialAnalytics();
  await flush();
  expect(snapshotProperties()).toEqual({
    analytics_schema_version: 1,
    island_status: 'drifting',
    island_count: 0,
    friend_bucket: 'unknown',
  });
});

test('잘못된 목록이나 페이지가 남은 응답을 0명으로 보내지 않는다', async () => {
  jest.mocked(myIslands).mockResolvedValue({ items: [], nextCursor: 'more' } as any);
  jest.mocked(getFriendsScreen).mockResolvedValue({ friends: null } as any);
  stop = startSocialAnalytics();
  await flush();
  expect(snapshotProperties()).toEqual({
    analytics_schema_version: 1,
    island_status: 'unknown',
    friend_bucket: 'unknown',
  });
});

test('SDK 비활성화나 로그인 전에는 서버 조회와 계측을 하지 않는다', () => {
  jest.mocked(getPostHogClient).mockReturnValue(null);
  startSocialAnalytics()();
  expect(subscribeSession).not.toHaveBeenCalled();
  jest.mocked(getPostHogClient).mockReturnValue({} as any);
  session = null;
  stop = startSocialAnalytics();
  expect(captureProductEvent).not.toHaveBeenCalled();
  expect(myIslands).not.toHaveBeenCalled();
  expect(getFriendsScreen).not.toHaveBeenCalled();
});

test('복귀마다 활동은 기록하되 5분 내 조회와 토큰갱신 활동은 중복하지 않는다', async () => {
  stop = startSocialAnalytics();
  await flush();
  sessionListener(session);
  foreground();
  expect(myIslands).toHaveBeenCalledTimes(1);
  expect(
    jest.mocked(captureProductEvent).mock.calls.filter(([event]) => event === 'app_active'),
  ).toHaveLength(2);
  jest.advanceTimersByTime(5 * 60 * 1000);
  foreground();
  await flush();
  expect(myIslands).toHaveBeenCalledTimes(2);
});

test('계정 전환 후 늦게 온 이전 응답이 새 사용자의 상태로 전송되지 않는다', async () => {
  let resolveOld!: (value: any) => void;
  jest.mocked(myIslands).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  stop = startSocialAnalytics();
  session = { userId: 'user-b', accessToken: 'b', refreshToken: 'r' };
  generation++;
  sessionListener(session);
  await flush();
  expect(snapshotProperties()?.island_status).toBe('drifting');
  resolveOld({ items: [{ id: 'old' }], nextCursor: null });
  await flush();
  expect(
    jest
      .mocked(captureProductEvent)
      .mock.calls.filter(([event]) => event === 'social_state_observed'),
  ).toHaveLength(1);
});

test('로그아웃과 구독 해제 뒤 대기 응답을 버린다', async () => {
  let resolveOld!: (value: any) => void;
  jest.mocked(myIslands).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  stop = startSocialAnalytics();
  session = null;
  generation++;
  sessionListener(null);
  stop();
  stop = undefined;
  resolveOld({ items: [], nextCursor: null });
  await flush();
  expect(snapshotProperties()).toBeUndefined();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
