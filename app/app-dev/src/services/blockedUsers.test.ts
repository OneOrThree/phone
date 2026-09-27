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

test('차단 중 먼저 시작한 목록 응답이 늦게 와도 새 차단을 덮지 않는다', async () => {
  let resolve: (users: Array<{ id: string; name: string }>) => void = () => {};
  listMock.mockReturnValue(new Promise((done) => (resolve = done)));

  const loading = refreshBlockedUsers();
  markUserBlocked('u-new');
  resolve([]);
  await loading;

  assert.equal(isUserBlocked('u-new'), true);
});
