import assert from 'node:assert/strict';
import { getBlockedUsers } from '@/services/api/safety';
import { clearSession, saveSession } from '@/services/api/session';
import {
  isUserBlocked,
  markUserBlocked,
  markUserUnblocked,
  refreshBlockedUsers,
  replaceBlockedUsers,
} from '@/services/blockedUsers';

jest.mock('@/services/api/safety', () => ({
  getBlockedUsers: jest.fn(),
}));

const listMock = getBlockedUsers as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  replaceBlockedUsers([]);
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
