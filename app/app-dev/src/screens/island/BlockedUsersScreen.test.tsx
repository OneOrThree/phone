import assert from 'node:assert/strict';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { BlockedUsersScreen } from '@/screens/island/BlockedUsersScreen';
import { ApiError } from '@/services/api/client';
import { getBlockedUsers, unblockUser } from '@/services/api/safety';
import { isUserBlocked, replaceBlockedUsers } from '@/services/blockedUsers';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: 1,
    compact: false,
    tablet: false,
    modalWidth: 340,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));

jest.mock('@/services/api/safety', () => ({
  getBlockedUsers: jest.fn(),
  unblockUser: jest.fn(),
}));

const listMock = getBlockedUsers as jest.Mock;
const unblockMock = unblockUser as jest.Mock;
const user = { id: 'user-2', name: '민지' };

const events = () => ({ back: jest.fn(), home: jest.fn(), notify: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
  replaceBlockedUsers([]);
});

test('차단 목록을 불러오는 동안 로딩을 보여 주고 빈 응답을 빈 상태로 표시한다', async () => {
  let finish: (value: unknown[]) => void = () => {};
  listMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const screen = await render(<BlockedUsersScreen e={events()} />);
  assert.ok(screen.getByText('불러오는 중…'));

  finish([]);
  await waitFor(() => assert.ok(screen.getByText('차단한 사용자가 없어요.')));
});

test('차단 목록 오류를 보여 주고 다시 시도하면 목록으로 복구한다', async () => {
  listMock
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0))
    .mockResolvedValueOnce([user]);
  const screen = await render(<BlockedUsersScreen e={events()} />);
  await waitFor(() => assert.ok(screen.getByText('네트워크 오류')));

  await fireEvent.press(screen.getByText('다시 시도'));

  await waitFor(() => assert.ok(screen.getByText('민지')));
  assert.equal(listMock.mock.calls.length, 2);
  assert.equal(isUserBlocked('user-2'), true);
});

test('차단 해제 성공 후 목록을 재조회하고 완료를 알린다', async () => {
  listMock.mockResolvedValueOnce([user]).mockResolvedValueOnce([]);
  unblockMock.mockResolvedValue(undefined);
  const e = events();
  const screen = await render(<BlockedUsersScreen e={e} />);
  await waitFor(() => assert.ok(screen.getByText('민지')));

  await fireEvent.press(screen.getByText('차단 해제'));

  await waitFor(() => assert.ok(screen.getByText('차단한 사용자가 없어요.')));
  assert.equal(unblockMock.mock.calls[0][0], 'user-2');
  assert.equal(listMock.mock.calls.length, 2);
  assert.equal(isUserBlocked('user-2'), false);
  assert.equal(e.notify.mock.calls[0][0], '민지님의 차단을 해제했어요.');
});
