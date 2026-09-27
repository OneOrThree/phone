import assert from 'node:assert/strict';
import { getBlockedUsers } from '@/services/api/safety';
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
  listMock
    .mockReturnValueOnce(new Promise((done) => (resolve = done)))
    .mockResolvedValueOnce([
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
