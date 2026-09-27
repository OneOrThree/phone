import assert from 'node:assert/strict';
import { AppState } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getBlockedUsers } from '@/services/api/safety';
import { clearSession, saveSession } from '@/services/api/session';
import {
  isUserBlocked,
  markUserBlocked,
  markUserUnblocked,
  loadBlockedUsers,
  revalidateBlockedUsers,
  refreshBlockedUsers,
  replaceBlockedUsers,
  useBlockedUsers,
} from '@/services/blockedUsers';

jest.mock('@/services/api/safety', () => ({
  getBlockedUsers: jest.fn(),
}));

const listMock = getBlockedUsers as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  replaceBlockedUsers([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('차단과 해제 성공 신호를 즉시 조회 snapshot에 반영한다', () => {
  markUserBlocked('u2');
  assert.equal(isUserBlocked('u2'), true);

  markUserUnblocked('u2');
  assert.equal(isUserBlocked('u2'), false);
});

test('차단 중 먼저 시작한 목록 응답이 늦게 오면 최신 목록을 다시 읽는다', async () => {
  let resolve: (users: Array<{ id: string; name: string }>) => void = () => {};
  listMock.mockReturnValueOnce(new Promise((done) => (resolve = done))).mockResolvedValueOnce([
    { id: 'u-old', name: '기존 차단' },
    { id: 'u-new', name: '새 차단' },
  ]);

  const loading = refreshBlockedUsers();
  markUserBlocked('u-new');
  resolve([]);
  await loading;
  await new Promise((done) => setTimeout(done, 0));

  assert.equal(listMock.mock.calls.length, 2);
  assert.equal(isUserBlocked('u-old'), true);
  assert.equal(isUserBlocked('u-new'), true);
});

test('이미 차단된 사용자의 차단 성공도 진행 중인 과거 목록 응답을 폐기한다', async () => {
  replaceBlockedUsers([{ id: 'u2', name: '민지' }]);
  let resolve: (users: Array<{ id: string; name: string }>) => void = () => {};
  listMock
    .mockReturnValueOnce(new Promise((done) => (resolve = done)))
    .mockResolvedValueOnce([{ id: 'u2', name: '민지' }]);

  const loading = refreshBlockedUsers();
  markUserBlocked('u2');
  resolve([]);
  await loading;
  await waitFor(() => assert.equal(listMock.mock.calls.length, 2));

  assert.equal(isUserBlocked('u2'), true);
});

test('이미 해제된 사용자의 해제 성공도 진행 중인 과거 목록 응답을 폐기한다', async () => {
  replaceBlockedUsers([]);
  let resolve: (users: Array<{ id: string; name: string }>) => void = () => {};
  listMock.mockReturnValueOnce(new Promise((done) => (resolve = done))).mockResolvedValueOnce([]);

  const loading = refreshBlockedUsers();
  markUserUnblocked('u2');
  resolve([{ id: 'u2', name: '민지' }]);
  await loading;
  await waitFor(() => assert.equal(listMock.mock.calls.length, 2));

  assert.equal(isUserBlocked('u2'), false);
});

test('겹친 목록 요청은 나중에 시작한 응답만 적용한다', async () => {
  let resolveOlder: (users: Array<{ id: string; name: string }>) => void = () => {};
  let resolveLatest: (users: Array<{ id: string; name: string }>) => void = () => {};
  listMock
    .mockReturnValueOnce(new Promise((done) => (resolveOlder = done)))
    .mockReturnValueOnce(new Promise((done) => (resolveLatest = done)));

  const older = refreshBlockedUsers();
  const latest = refreshBlockedUsers();
  resolveLatest([{ id: 'u-latest', name: '최신 차단' }]);
  await latest;
  resolveOlder([{ id: 'u-old', name: '과거 차단' }]);
  await older;

  assert.equal(isUserBlocked('u-latest'), true);
  assert.equal(isUserBlocked('u-old'), false);
});

test('계정이 바뀌면 이전 세션의 차단 snapshot을 즉시 폐기한다', async () => {
  await clearSession();
  await saveSession({ accessToken: 'AT-1', refreshToken: 'RT-1', userId: 'u1' });
  markUserBlocked('blocked-by-u1');
  assert.equal(isUserBlocked('blocked-by-u1'), true);

  await saveSession({ accessToken: 'AT-2', refreshToken: 'RT-2', userId: 'u2' });

  assert.equal(isUserBlocked('blocked-by-u1'), false);
});

test('활성 소비자가 있는 동안 세션이 바뀌면 새 계정 목록을 즉시 적재한다', async () => {
  await clearSession();
  await saveSession({ accessToken: 'AT-live-1', refreshToken: 'RT-live-1', userId: 'u-live-1' });
  listMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: 'blocked-by-u2', name: '새 계정 차단' }]);
  const hook = await renderHook(() => useBlockedUsers(true));
  await waitFor(() => assert.equal(listMock.mock.calls.length, 1));

  await act(async () => {
    await saveSession({
      accessToken: 'AT-live-2',
      refreshToken: 'RT-live-2',
      userId: 'u-live-2',
    });
  });

  await waitFor(() => assert.equal(listMock.mock.calls.length, 2));
  await waitFor(() => assert.equal(isUserBlocked('blocked-by-u2'), true));
  await hook.unmount();
});

test('cache가 만료되면 같은 세션에서도 차단 목록을 다시 검증한다', async () => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + 30_001);
  listMock.mockResolvedValue([{ id: 'u-new', name: '다른 기기 차단' }]);

  await loadBlockedUsers();

  assert.equal(listMock.mock.calls.length, 1);
  assert.equal(isUserBlocked('u-new'), true);
});

test('앱이 포그라운드로 돌아오면 준비된 cache도 다시 검증한다', async () => {
  let onChange: (state: string) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener: any) => {
    onChange = listener;
    return { remove: jest.fn() } as any;
  });
  listMock.mockResolvedValue([{ id: 'u-foreground', name: '포그라운드 차단' }]);
  const hook = await renderHook(() => useBlockedUsers(true));

  await act(async () => onChange('active'));
  await waitFor(() => assert.equal(isUserBlocked('u-foreground'), true));
  assert.equal(listMock.mock.calls.length, 1);
  await hook.unmount();
});

test('준비된 cache의 재검증이 실패하면 stale 목록 대신 오류 상태로 전환한다', async () => {
  listMock.mockRejectedValue(new Error('blocks unavailable'));
  const hook = await renderHook(() => useBlockedUsers(true));

  await act(async () => {
    await revalidateBlockedUsers().catch(() => {});
  });

  await waitFor(() => assert.equal(hook.result.current.status, 'error'));
  assert.equal(hook.result.current.error instanceof Error, true);
  await hook.unmount();
});

test('차단 필터 화면에 재진입하면 TTL과 무관하게 다시 검증한다', async () => {
  listMock.mockResolvedValue([{ id: 'u-reentered', name: '재진입 차단' }]);
  const hook = await renderHook((props: { active: boolean }) => useBlockedUsers(props.active), {
    initialProps: { active: true },
  });
  assert.equal(listMock.mock.calls.length, 0);

  await hook.rerender({ active: false });
  await hook.rerender({ active: true });

  await waitFor(() => assert.equal(isUserBlocked('u-reentered'), true));
  assert.equal(listMock.mock.calls.length, 1);
  await hook.unmount();
});
