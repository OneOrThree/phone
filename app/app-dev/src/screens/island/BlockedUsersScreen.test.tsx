import assert from 'node:assert/strict';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { BlockedUsersScreen } from '@/screens/island/BlockedUsersScreen';
import { ApiError } from '@/services/api/client';
import { getBlockedUsers, unblockUser } from '@/services/api/safety';
import { applyLocalePref } from '@/i18n';
import {
  isUserBlocked,
  refreshBlockedUsers,
  replaceBlockedUsers,
  revalidateBlockedUsers,
} from '@/services/blockedUsers';

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

const events = () => ({
  back: jest.fn(),
  home: jest.fn(),
  notify: jest.fn(),
  friendsScreen: { refresh: jest.fn() },
});

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

test('화면 진입 전 시작한 전역 조회가 진행 중이면 완료 뒤 최신 목록을 다시 읽는다', async () => {
  let resolve: (value: (typeof user)[]) => void = () => {};
  listMock
    .mockReturnValueOnce(new Promise((done) => (resolve = done)))
    .mockResolvedValueOnce([user]);

  const pending = refreshBlockedUsers();
  const screen = await render(<BlockedUsersScreen e={events()} />);
  assert.equal(listMock.mock.calls.length, 1);
  resolve([user]);
  await pending;
  await waitFor(() => assert.ok(screen.getByText('민지')));

  assert.equal(listMock.mock.calls.length, 2);
  assert.equal(isUserBlocked('user-2'), true);
  assert.equal(screen.queryByText(/불러오지 못했어요/), null);
  await screen.unmount();
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

test('과거 조회 오류 뒤 공유 재검증이 성공하면 목록 화면으로 복구한다', async () => {
  listMock
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0))
    .mockResolvedValueOnce([user]);
  const screen = await render(<BlockedUsersScreen e={events()} />);
  await waitFor(() => assert.ok(screen.getByText('네트워크 오류')));

  await act(async () => {
    await revalidateBlockedUsers();
  });

  await waitFor(() => assert.ok(screen.getByText('민지')));
  assert.equal(screen.queryByText('네트워크 오류'), null);
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
  assert.equal(e.friendsScreen.refresh.mock.calls.length, 0);
  assert.equal(e.notify.mock.calls[0][0], '민지님의 차단을 해제했어요.');
});

test('차단 해제 뒤 목록 재조회가 실패해도 친구 화면 중복 새로고침은 하지 않는다', async () => {
  listMock
    .mockResolvedValueOnce([user])
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '목록 갱신 실패', 0));
  unblockMock.mockResolvedValue(undefined);
  const e = events();
  const screen = await render(<BlockedUsersScreen e={e} />);
  await waitFor(() => assert.ok(screen.getByText('민지')));

  await fireEvent.press(screen.getByText('차단 해제'));

  await waitFor(() => assert.ok(screen.getByText('목록 갱신 실패')));
  assert.equal(e.friendsScreen.refresh.mock.calls.length, 0);
  assert.equal(e.notify.mock.calls[0][0], '민지님의 차단을 해제했어요.');
  assert.equal(isUserBlocked('user-2'), false);
});

test('전역 차단 목록 snapshot이 바뀌면 열린 화면의 행도 즉시 갱신한다', async () => {
  listMock.mockResolvedValue([user]);
  const screen = await render(<BlockedUsersScreen e={events()} />);
  await waitFor(() => assert.ok(screen.getByText('민지')));

  await act(async () => replaceBlockedUsers([{ id: 'user-3', name: '서윤' }]));

  await waitFor(() => assert.ok(screen.getByText('서윤')));
  assert.equal(screen.queryByText('민지'), null);
});

test('차단 목록은 단방향 숨김과 해제 뒤 재노출 가능성을 안내한다', async () => {
  listMock.mockResolvedValue([]);
  const screen = await render(<BlockedUsersScreen e={events()} />);

  assert.ok(screen.getByText(/내 화면에서 숨겨져요/));
  assert.ok(screen.getByText(/해제하면 다시 보일 수 있어요/));
});

describe('en', () => {
  const mockLocales = jest.requireMock('expo-localization').getLocales as jest.Mock;

  afterEach(() => {
    mockLocales.mockReturnValue([{ languageCode: 'ko', languageTag: 'ko-KR' }]);
    applyLocalePref('system');
  });

  test('en 로케일 — 빈 목록 화면을 영문으로 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    listMock.mockResolvedValue([]);
    const screen = await render(<BlockedUsersScreen e={events()} />);

    await waitFor(() => assert.ok(screen.getByText('No blocked users.')));
    assert.ok(screen.getByText('Blocked Users'));
  });

  // errorText 배선 — 서버가 보낸 한글 message 가 en 화면에 새지 않는지(차단 해제 흐름).
  // 이름은 사용자 데이터라 번역 대상이 아니므로, 전수 한글 검사가 이름 자체를 걸러내지 않도록
  // 영문 이름의 사용자로 검증한다.
  test('en 로케일 — 차단 해제가 한글 서버 메시지로 실패해도 화면에 한글이 없다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const enUser = { id: 'user-en', name: 'Mina' };
    listMock.mockResolvedValueOnce([enUser]);
    unblockMock.mockRejectedValueOnce(new ApiError('CLIENT_UNKNOWN_CODE', '서버 한글 메시지', 400));
    const screen = await render(<BlockedUsersScreen e={events()} />);
    await waitFor(() => assert.ok(screen.getByText('Mina')));

    await fireEvent.press(screen.getByText('Unblock'));

    await waitFor(() => assert.ok(screen.getByText('Please check your connection and try again.')));
    assert.equal(screen.queryByText(/[가-힣]/), null);
  });
});
