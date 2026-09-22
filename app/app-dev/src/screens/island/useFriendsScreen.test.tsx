/**
 * useFriendsScreen (GROMO-2015) — /screens/friends 조각을 읽고, 명령은 2xx 뒤에만
 * 재조회한다(optimistic 금지). empty/error/retry·검색 디바운스를 확인한다.
 */
import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { getFriendsScreen, searchFriends } from '@/services/api/friends';
import type { FriendsScreen } from '@/services/api/friends';
import { useFriendsScreen } from '@/screens/island/useFriendsScreen';

jest.mock('@/services/api/friends', () => ({
  ...jest.requireActual('@/services/api/friends'),
  getFriendsScreen: jest.fn(),
  searchFriends: jest.fn(),
}));

const screenMock = getFriendsScreen as jest.Mock;
const searchMock = searchFriends as jest.Mock;

const screen = (over: Partial<FriendsScreen> = {}): FriendsScreen => ({
  friends: [
    {
      userId: 'u-friend',
      nickname: '짝꿍',
      tierLevel: 3,
      occupation: 'CODING',
      isPinned: false,
      isFocusing: true,
      focusTimeMinutes: 42,
      focusStartedAt: '2026-09-22T01:00:00Z',
      focusTagName: '전공',
      mainIslandName: '모래섬',
    },
  ],
  friendRequests: [
    {
      requestId: 'r-1',
      userId: 'u-recv',
      nickname: '받은',
      tierLevel: null,
      createdAt: 't',
    },
  ],
  sentFriendRequests: [],
  ...over,
});

const args = { active: true, searchActive: false, date: '2026-09-22' };

beforeEach(() => jest.clearAllMocks());

test('비활성이면 조회하지 않는다', async () => {
  const { result } = await renderHook(() => useFriendsScreen({ ...args, active: false }));
  assert.equal(result.current.status, 'loading');
  assert.equal(screenMock.mock.calls.length, 0);
});

test('활성이면 /screens/friends 를 date 와 함께 읽고 세 조각을 보존한다', async () => {
  screenMock.mockResolvedValue(screen());
  const { result } = await renderHook(() => useFriendsScreen(args));

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(screenMock.mock.calls[0][0], '2026-09-22');
  assert.equal(result.current.data?.friends[0].nickname, '짝꿍');
  assert.equal(result.current.data?.friendRequests[0].requestId, 'r-1');
});

test('빈 목록은 ready+빈 배열 — 오류로 접지 않는다', async () => {
  screenMock.mockResolvedValue(screen({ friends: [], friendRequests: [], sentFriendRequests: [] }));
  const { result } = await renderHook(() => useFriendsScreen(args));
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(result.current.data?.friends.length, 0);
});

test('조회 실패는 error 상태로 두고 retry 가 같은 date 로 다시 읽는다', async () => {
  screenMock
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0))
    .mockResolvedValueOnce(screen());
  const { result } = await renderHook(() => useFriendsScreen(args));

  await waitFor(() => assert.equal(result.current.status, 'error'));
  assert.equal(result.current.error?.code, 'CLIENT_NETWORK_ERROR');

  await act(async () => result.current.retry());
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(screenMock.mock.calls.length, 2);
});

test('명령 성공 뒤에만 목록을 재조회한다 — 실패는 화면을 바꾸지 않는다', async () => {
  screenMock.mockResolvedValue(screen());
  const { result } = await renderHook(() => useFriendsScreen(args));
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(screenMock.mock.calls.length, 1);

  // 실패 — 재조회 없이 오류를 그대로 던진다
  await act(async () => {
    await assert.rejects(
      result.current.command(() =>
        Promise.reject(new ApiError('STATE_CONFLICT', '이미 처리된 요청', 409)),
      ),
    );
  });
  assert.equal(screenMock.mock.calls.length, 1);

  // 성공 — 재조회가 한 번 더 간다
  await act(async () => {
    await result.current.command(() => Promise.resolve());
  });
  await waitFor(() => assert.equal(screenMock.mock.calls.length, 2));
});

test('명령 진행 중에는 두 번째 명령이 나가지 않는다', async () => {
  screenMock.mockResolvedValue(screen());
  const { result } = await renderHook(() => useFriendsScreen(args));
  await waitFor(() => assert.equal(result.current.status, 'ready'));

  let release: () => void = () => {};
  const pending = new Promise<void>((r) => (release = r));
  let ran = 0;
  let first: Promise<void> = Promise.resolve();
  let second: Promise<void> = Promise.resolve();
  await act(async () => {
    first = result.current.command(() => {
      ran += 1;
      return pending;
    });
    second = result.current.command(() => {
      ran += 1;
      return Promise.resolve();
    });
    release();
    await Promise.all([first, second]);
  });
  assert.equal(ran, 1);
});

test('검색은 searchActive 일 때 디바운스로 서버 정확 일치를 친다', async () => {
  screenMock.mockResolvedValue(screen());
  searchMock.mockResolvedValue([
    { userId: 'u-1', nickname: '새봄', tierLevel: null, occupation: null, relation: 'NONE' },
  ]);
  const { result } = await renderHook(() => useFriendsScreen({ ...args, searchActive: true }));
  await waitFor(() => assert.equal(result.current.status, 'ready'));

  await act(async () => result.current.setQuery('새'));
  await act(async () => result.current.setQuery('새봄'));
  await waitFor(() => assert.equal(result.current.searchStatus, 'ready'), {
    timeout: 2000,
  });
  // 연타는 마지막 질의만 서버로 간다
  assert.equal(searchMock.mock.calls.length, 1);
  assert.equal(searchMock.mock.calls[0][0], '새봄');
  assert.equal(result.current.searchItems[0].relation, 'NONE');
});

test('검색 활성이 아니거나 빈 질의면 검색하지 않는다', async () => {
  screenMock.mockResolvedValue(screen());
  const { result } = await renderHook(() => useFriendsScreen(args));
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  await act(async () => result.current.setQuery('새봄'));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  assert.equal(searchMock.mock.calls.length, 0);
  assert.equal(result.current.searchStatus, 'idle');
});
