/** 다른 고양이 정보창(GROMO-2474) — 친구 관계별 버튼, 서버 성공 뒤에만 바뀌는 상태, 늦은 응답 무시. */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CatInfoPopup, FriendActionContext, type FriendActionSource } from './CatInfoPopup';
import type { FriendsScreenState } from './useFriendsScreen';
import { ApiError, CLIENT_NETWORK_ERROR } from '@/services/api/client';
import { acceptFriendRequest, sendFriendRequest, type FriendsScreen } from '@/services/api/friends';
import * as session from '@/services/api/session';
import { applyLocalePref } from '@/i18n';

jest.mock('@/services/api/friends', () => ({
  ...jest.requireActual('@/services/api/friends'),
  sendFriendRequest: jest.fn(),
  acceptFriendRequest: jest.fn(),
}));
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

const send = sendFriendRequest as jest.Mock;
const accept = acceptFriendRequest as jest.Mock;

const deferred = () => {
  let resolve!: () => void, reject!: (e: unknown) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const item = (userId: string, extra: object = {}) => ({
  userId,
  nickname: userId,
  tierLevel: null,
  occupation: null,
  isPinned: false,
  isFocusing: false,
  focusTimeMinutes: 0,
  focusStartedAt: null,
  focusTagName: null,
  mainIslandName: null,
  ...extra,
});
const request = (userId: string, requestId: string) => ({
  requestId,
  userId,
  nickname: userId,
  tierLevel: null,
  createdAt: '2026-10-26T00:00:00Z',
});

// useFriendsScreen 대역 — command 는 실제 훅처럼 fn 을 부르고 성공·실패를 그대로 넘긴다
const screen = (data: Partial<FriendsScreen> = {}, over: Partial<FriendsScreenState> = {}) =>
  ({
    status: 'ready',
    error: null,
    data: { friends: [], friendRequests: [], sentFriendRequests: [], ...data },
    busy: false,
    refresh: jest.fn(),
    retry: jest.fn(),
    command: jest.fn(async (fn: () => Promise<unknown>) => {
      await fn();
    }),
    ...over,
  }) as unknown as FriendsScreenState;

const popup = (source: FriendActionSource | null, props: { message?: string } = {}) => {
  const onClose = jest.fn();
  const ui = (
    <FriendActionContext.Provider value={source}>
      <CatInfoPopup
        userId="u1"
        name="두부"
        catColor="cream"
        art={null}
        onClose={onClose}
        {...props}
      />
    </FriendActionContext.Provider>
  );
  return { ui, onClose };
};

beforeEach(() => {
  send.mockReset();
  accept.mockReset();
});

// 버튼의 onPress 를 직접 꺼낸다 — fireEvent 는 매번 act 로 감싸 다시 그리므로 «같은 프레임 두 번»을 만들 수 없다
const pressHandler = (host: { unstable_fiber?: any }) => {
  let fiber = host.unstable_fiber;
  while (fiber && typeof fiber.memoizedProps?.onPress !== 'function') fiber = fiber.return;
  return fiber.memoizedProps.onPress as () => void;
};

test('요청 가능 → 처리 중(중복 입력 막음) → 서버 성공 뒤에만 요청 중', async () => {
  const flight = deferred();
  send.mockReturnValue(flight.promise);
  const { ui } = popup({ friendsScreen: screen() });
  const view = await render(ui);
  expect(view.getByTestId('cat-info-name')).toHaveTextContent('두부');
  await fireEvent.press(view.getByLabelText('친구 요청'));
  expect(view.getByLabelText('처리 중…')).toBeDisabled();
  await fireEvent.press(view.getByLabelText('처리 중…'));
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith('u1');
  await act(async () => flight.resolve());
  expect(view.getByLabelText('요청 중')).toBeDisabled();
  expect(view.queryByText('요청을 보내지 못했어요. 다시 눌러 시도해 주세요.')).toBeNull();
});

test('받은 요청 → 수락은 요청 id 로 → 친구 배지', async () => {
  accept.mockResolvedValue(undefined);
  const { ui } = popup({ friendsScreen: screen({ friendRequests: [request('u1', 'r-9')] }) });
  const view = await render(ui);
  await fireEvent.press(view.getByLabelText('친구 요청 수락'));
  expect(accept).toHaveBeenCalledWith('r-9');
  expect(send).not.toHaveBeenCalled();
  expect(view.getByText('친구')).toBeTruthy();
  expect(view.queryByTestId('cat-info-action')).toBeNull();
});

test('보낸 요청은 요청 중(비활성), 친구는 배지와 서버 오늘 집중 한 줄', async () => {
  const sent = await render(
    popup({ friendsScreen: screen({ sentFriendRequests: [request('u1', 'r-1')] }) }).ui,
  );
  expect(sent.getByLabelText('요청 중')).toBeDisabled();
  expect(sent.queryByTestId('cat-info-today')).toBeNull();
  const friend = await render(
    popup({ friendsScreen: screen({ friends: [item('u1', { focusTimeMinutes: 65 })] }) }).ui,
  );
  expect(friend.getByText('친구')).toBeTruthy();
  expect(friend.getByTestId('cat-info-today')).toHaveTextContent('오늘 집중 1시간 5분');
});

test('실패하면 안내 한 줄과 [친구 요청]을 다시 보이고, 다시 누르면 다시 보낸다', async () => {
  send.mockRejectedValueOnce(new ApiError(CLIENT_NETWORK_ERROR, 'offline', 0));
  send.mockResolvedValueOnce(undefined);
  const view = await render(popup({ friendsScreen: screen() }).ui);
  await fireEvent.press(view.getByLabelText('친구 요청'));
  expect(view.getByText('요청을 보내지 못했어요. 다시 눌러 시도해 주세요.')).toBeTruthy();
  expect(view.getByLabelText('친구 요청')).toBeEnabled();
  await fireEvent.press(view.getByLabelText('친구 요청'));
  expect(send).toHaveBeenCalledTimes(2);
  expect(view.getByLabelText('요청 중')).toBeDisabled();
  expect(view.queryByText('요청을 보내지 못했어요. 다시 눌러 시도해 주세요.')).toBeNull();
});

test('이미 친구·보낸 요청(중복)은 안내 없이 목록을 다시 읽고, 게스트 거절은 회원 전환을 연다', async () => {
  const duplicate = screen();
  send.mockRejectedValueOnce(new ApiError('STATE_CONFLICT', 'dup', 409, { field: 'targetUserId' }));
  const view = await render(popup({ friendsScreen: duplicate }).ui);
  await fireEvent.press(view.getByLabelText('친구 요청'));
  expect(duplicate.refresh).toHaveBeenCalledTimes(1);
  expect(view.queryByText('요청을 보내지 못했어요. 다시 눌러 시도해 주세요.')).toBeNull();

  const offer = jest.fn(() => true);
  const guestError = new ApiError('SOCIAL_LOGIN_REQUIRED', 'login', 403);
  send.mockRejectedValueOnce(guestError);
  const guest = await render(popup({ friendsScreen: screen(), conversion: { offer } }).ui);
  await fireEvent.press(guest.getByLabelText('친구 요청'));
  expect(offer).toHaveBeenCalledWith(guestError);
  expect(guest.queryByText('요청을 보내지 못했어요. 다시 눌러 시도해 주세요.')).toBeNull();
  expect(guest.getByLabelText('친구 요청')).toBeEnabled();
});

test('닫힌 뒤·계정이 바뀐 뒤 도착한 응답은 아무것도 바꾸지 않는다', async () => {
  const closed = deferred();
  send.mockReturnValueOnce(closed.promise);
  const offer = jest.fn(() => true);
  const first = screen();
  const view = await render(popup({ friendsScreen: first, conversion: { offer } }).ui);
  await fireEvent.press(view.getByLabelText('친구 요청'));
  await view.unmount();
  await act(async () => closed.reject(new ApiError('SOCIAL_LOGIN_REQUIRED', 'login', 403)));
  expect(offer).not.toHaveBeenCalled();
  expect(first.refresh).not.toHaveBeenCalled();

  const switched = deferred();
  send.mockReturnValueOnce(switched.promise);
  const generation = jest.spyOn(session, 'sessionGeneration').mockReturnValue(1);
  try {
    const second = await render(popup({ friendsScreen: screen() }).ui);
    await fireEvent.press(second.getByLabelText('친구 요청'));
    generation.mockReturnValue(2);
    await act(async () => switched.resolve());
    // 옛 계정의 성공을 새 계정 화면에 «요청 중»으로 남기지 않고 버튼만 되돌린다
    expect(second.queryByLabelText('요청 중')).toBeNull();
    expect(second.getByLabelText('친구 요청')).toBeEnabled();
  } finally {
    generation.mockRestore();
  }
});

test('같은 프레임에 두 번 눌러도(다시 그리기 전) 서버 요청은 한 번만 나간다', async () => {
  const flight = deferred();
  send.mockReturnValue(flight.promise);
  const view = await render(popup({ friendsScreen: screen() }).ui);
  const press = pressHandler(view.getByLabelText('친구 요청') as never);
  await act(async () => {
    press();
    press();
  });
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => flight.resolve());
  expect(view.getByLabelText('요청 중')).toBeDisabled();
});

test('다른 친구 명령이 진행 중이라 command 가 요청을 보내지 않고 끝나면 버튼이 원래대로 돌아온다', async () => {
  // useFriendsScreen.command 는 진행 중인 명령이 있으면 fn 을 부르지 않고 그냥 끝난다
  const busyElsewhere = screen({}, { command: jest.fn(async () => {}) });
  const view = await render(popup({ friendsScreen: busyElsewhere }).ui);
  await fireEvent.press(view.getByLabelText('친구 요청'));
  expect(send).not.toHaveBeenCalled();
  expect(view.getByLabelText('친구 요청')).toBeEnabled();
  expect(view.queryByLabelText('요청 중')).toBeNull();
  expect(view.queryByText('요청을 보내지 못했어요. 다시 눌러 시도해 주세요.')).toBeNull();
});

test('닫은 뒤 도착한 성공은 다시 연 정보창을 «요청 중»으로 바꾸지 않는다', async () => {
  const flight = deferred();
  send.mockReturnValueOnce(flight.promise);
  const source = { friendsScreen: screen() };
  const error = jest.spyOn(console, 'error');
  const view = await render(popup(source).ui);
  await fireEvent.press(view.getByLabelText('친구 요청'));
  await view.rerender(
    <FriendActionContext.Provider value={source}>{null}</FriendActionContext.Provider>,
  );
  await view.rerender(popup(source).ui);
  await act(async () => flight.resolve());
  expect(view.getByLabelText('친구 요청')).toBeEnabled();
  expect(view.queryByLabelText('요청 중')).toBeNull();
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

test('받은 요청인데 요청 id 가 없으면 새 요청으로 보내지 않고 실패 안내를 보인다', async () => {
  const view = await render(
    popup({ friendsScreen: screen({ friendRequests: [request('u1', '')] }) }).ui,
  );
  await fireEvent.press(view.getByLabelText('친구 요청 수락'));
  expect(send).not.toHaveBeenCalled();
  expect(accept).not.toHaveBeenCalled();
  expect(view.getByText('요청을 보내지 못했어요. 다시 눌러 시도해 주세요.')).toBeTruthy();
  expect(view.getByLabelText('친구 요청 수락')).toBeEnabled();
});

test('목업은 로컬 친구 목록으로 상태를 보이고 리듀서로 요청한다 · 출처가 없으면 행동 줄이 없다', async () => {
  const dispatch = jest.fn();
  const friend = await render(
    popup({
      friendsScreen: null,
      friends: [
        { id: 'u1', name: '두부', color: 'cream', island: '', status: 'friend', messages: [] },
      ],
      dispatch,
    }).ui,
  );
  expect(friend.getByText('친구')).toBeTruthy();
  const none = await render(popup({ friendsScreen: null, friends: [], dispatch }).ui);
  await fireEvent.press(none.getByLabelText('친구 요청'));
  expect(dispatch).toHaveBeenCalledWith({
    type: 'FRIEND_REQUEST',
    id: 'u1',
    friend: { id: 'u1', name: '두부', color: 'cream', island: '' },
  });
  expect(send).not.toHaveBeenCalled();
  const bare = await render(popup(null).ui);
  expect(bare.getByTestId('cat-info-name')).toBeTruthy();
  expect(bare.queryByTestId('cat-info-action')).toBeNull();
});

test('한마디가 있으면 말풍선, 없으면 없음 · × 는 닫기 · 영어 문구', async () => {
  const withMessage = popup({ friendsScreen: screen() }, { message: '같이 집중해요' });
  const view = await render(withMessage.ui);
  expect(view.getByTestId('cat-info-message')).toHaveTextContent('같이 집중해요');
  await fireEvent.press(view.getByLabelText('닫기'));
  expect(withMessage.onClose).toHaveBeenCalledTimes(1);
  const plain = await render(popup({ friendsScreen: screen() }).ui);
  expect(plain.queryByTestId('cat-info-message')).toBeNull();
  applyLocalePref('en');
  try {
    const en = await render(popup({ friendsScreen: screen() }).ui);
    expect(en.getByLabelText('Add friend')).toBeTruthy();
  } finally {
    applyLocalePref('ko');
  }
});
