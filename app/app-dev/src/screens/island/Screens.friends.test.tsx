/** 친구 목록·검색 줄의 고양이 그림 — 서버가 catColor 를 안 주면(2389 이전) 예전처럼 흰 고양이, 주면 그 색(GROMO-2391). */
import assert from 'node:assert/strict';
import React, { useMemo, useReducer, useRef, useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RedesignScreens } from '@/screens/island/Screens';
import { initialState, reducer } from '@/services/model';
import { art } from '@/constants/art';
import { useFriendsScreen } from '@/screens/island/useFriendsScreen';
import {
  cancelFriendRequest,
  getFriendsScreen,
  rejectFriendRequest,
  searchFriends,
} from '@/services/api/friends';
import { blockUser, getBlockedUsers } from '@/services/api/safety';
import { replaceBlockedUsers } from '@/services/blockedUsers';

jest.mock('@/services/api/friends', () => ({
  ...jest.requireActual('@/services/api/friends'),
  getFriendsScreen: jest.fn(),
  searchFriends: jest.fn(),
  cancelFriendRequest: jest.fn(),
  rejectFriendRequest: jest.fn(),
}));
// 차단 목록 저장소는 진짜를 쓴다 — 차단하면 그 줄이 실제 필터로 사라지는지 본다(GROMO-2467)
jest.mock('@/services/api/safety', () => ({
  ...jest.requireActual('@/services/api/safety'),
  blockUser: jest.fn(),
  getBlockedUsers: jest.fn(),
}));

beforeEach(() => {
  replaceBlockedUsers([]);
  jest.mocked(getBlockedUsers).mockReset().mockResolvedValue([]);
});

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
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 52, bottom: 32, left: 0, right: 0 }),
}));

const friend = (userId: string, nickname: string, catColor?: string | null) => ({
  userId,
  nickname,
  tierLevel: null,
  occupation: null,
  isPinned: false,
  isFocusing: false,
  focusTimeMinutes: 0,
  focusStartedAt: null,
  focusTagName: null,
  mainIslandName: null,
  catColor,
});
const screenState = (friends: ReturnType<typeof friend>[]) => ({
  status: 'ready',
  error: null,
  data: { friends, friendRequests: [], sentFriendRequests: [] },
  busy: false,
  refresh: jest.fn(),
  retry: jest.fn(),
  command: jest.fn(),
  query: '',
  setQuery: jest.fn(),
  searchStatus: 'idle',
  searchError: null,
  searchItems: [],
});

// Screens.test.tsx 의 Harness 를 이 파일 전용으로 축약했다 — 'product'/'shop' 경로만 다룬다.
function Harness({ friendsScreen }: { friendsScreen: unknown }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const s = initialState(false);
    return s;
  });
  const islands = useMemo(() => ({}), []);
  const confirm = useRef(jest.fn((_title: string, _body: string, ok: () => void) => ok())).current;
  const [tab, setTab] = useState('');
  return (
    <RedesignScreens
      e={{
        state,
        route: 'friends',
        dispatch,
        go: jest.fn(),
        replace: jest.fn(),
        reset: jest.fn(),
        home: jest.fn(),
        back: jest.fn(),
        notify: jest.fn(),
        confirm,
        signOut: jest.fn(async () => {}),
        build: jest.fn(),
        text: '',
        setText: jest.fn(),
        body: '',
        setBody: jest.fn(),
        tab,
        setTab,
        detail: '',
        now: Date.now(),
        terms: false,
        setTerms: jest.fn(),
        approval: false,
        setApproval: jest.fn(),
        visited: '',
        setVisited: jest.fn(),
        guideStep: 0,
        setGuideStep: jest.fn(),
        player: { addListener: () => ({ remove() {} }), replace() {}, play() {}, pause() {} },
        previewAudio: false,
        setPreviewAudio: jest.fn(),
        walkTo: jest.fn(),
        newQuest: jest.fn(),
        walkRequest: null,
        islands,
        islandBootError: false,
        homeError: false,
        retryHome: jest.fn(),
        friendsScreen,
      }}
    />
  );
}

function LiveHarness({ open }: { open: boolean }) {
  const friendsScreen = useFriendsScreen({
    active: true,
    searchActive: open,
    routeKey: open ? 'friends' : 'home',
    date: '2026-10-25',
  });
  return open ? <Harness friendsScreen={friendsScreen} /> : null;
}

test('서버가 털색을 안 준 친구는 흰 고양이, 준 친구는 그 색으로 그린다', async () => {
  const screen = await render(
    <Harness
      friendsScreen={screenState([
        friend('f1', '옛서버', undefined),
        friend('f2', '새서버', 'ginger'),
      ])}
    />,
  );
  const sources = screen.getAllByTestId('cat-avatar-image').map((n) => n.props.source);
  assert.ok(sources.includes(art['avatar/white']));
  assert.ok(sources.includes(art['avatar/ginger']));
});

test('받은·보낸 요청과 친구가 모두 0건이면 빈 칸·「받은 요청 0」 배지 대신 빈 안내 하나만 보인다(GROMO-2412)', async () => {
  const empty = await render(<Harness friendsScreen={screenState([])} />);
  assert.ok(empty.getByTestId('friends-empty'));
  assert.ok(empty.getByText('아직 친구가 없어요'));
  assert.equal(empty.queryByText('받은 요청'), null);
  assert.equal(empty.queryByText('보낸 요청'), null);
  assert.equal(empty.queryByText('0'), null);
  await empty.unmount();

  const some = await render(
    <Harness friendsScreen={screenState([friend('f1', '하늘', 'ginger')])} />,
  );
  assert.equal(some.queryByTestId('friends-empty'), null);
  assert.ok(some.getByText('받은 요청'));
  assert.ok(some.getByText('하늘'));
});

test('요청·친구가 0건이어도 검색어로 찾은 결과 행은 보인다(GROMO-2412)', async () => {
  const screen = await render(
    <Harness
      friendsScreen={{
        ...screenState([]),
        query: '구름',
        searchStatus: 'ready',
        searchItems: [{ userId: 'u9', nickname: '구름', relation: 'NONE', catColor: 'gray' }],
      }}
    />,
  );
  assert.equal(screen.queryByTestId('friends-empty'), null);
  assert.ok(screen.getByText('검색 결과'));
  assert.ok(screen.getByText('구름'));
  assert.ok(screen.getByText('친구 요청'));
});

test('다시 연 화면의 새 친구·받은 요청과 검색의 친구 표시가 일치한다', async () => {
  const getMock = jest.mocked(getFriendsScreen);
  const searchMock = jest.mocked(searchFriends);
  getMock.mockResolvedValueOnce(screenState([]).data);
  const screen = await render(<LiveHarness open />);
  await screen.findByText('아직 친구가 없어요');
  await screen.rerender(<LiveHarness open={false} />);

  getMock.mockResolvedValue({
    ...screenState([friend('u-friend', '짝꿍')]).data,
    friendRequests: [
      { requestId: 'r1', userId: 'u-request', nickname: '새요청', tierLevel: null, createdAt: 't' },
    ],
  });
  searchMock.mockResolvedValue([
    { userId: 'u-friend', nickname: '짝꿍', relation: 'FRIEND', tierLevel: null, occupation: null },
  ]);
  await screen.rerender(<LiveHarness open />);
  await screen.findByText('새요청');
  assert.ok(screen.getByText('짝꿍'));
  assert.equal(screen.queryByText('아직 친구가 없어요'), null);

  await fireEvent.changeText(screen.getByPlaceholderText('닉네임으로 친구 찾기'), '짝꿍');
  await waitFor(() => assert.equal(searchMock.mock.calls.length, 1));
  await waitFor(() => assert.equal(screen.getAllByText('짝꿍').length, 2));
  assert.equal(screen.queryByText('친구 요청'), null);
  assert.equal(getMock.mock.calls.length, 2);
});

test('검색 뒤 친구 관리를 닫았다 열면 입력과 검색 결과 영역이 비어 있다', async () => {
  const getMock = jest.mocked(getFriendsScreen);
  const searchMock = jest.mocked(searchFriends);
  getMock.mockReset().mockResolvedValue(screenState([]).data);
  searchMock
    .mockReset()
    .mockResolvedValue([
      { userId: 'old', nickname: '이전결과', relation: 'NONE', tierLevel: null, occupation: null },
    ]);
  const screen = await render(<LiveHarness open />);
  await screen.findByText('아직 친구가 없어요');
  await fireEvent.changeText(screen.getByPlaceholderText('닉네임으로 친구 찾기'), 'ㅊㅊ');
  await screen.findByText('이전결과');
  assert.ok(screen.getByText('검색 결과'));

  await screen.rerender(<LiveHarness open={false} />);
  await screen.rerender(<LiveHarness open />);
  await waitFor(() => assert.equal(getMock.mock.calls.length, 2));
  await screen.findByText('아직 친구가 없어요');
  assert.equal(screen.getByPlaceholderText('닉네임으로 친구 찾기').props.value, '');
  assert.equal(screen.queryByText('검색 결과'), null);
  assert.equal(screen.queryByText('이전결과'), null);
  assert.equal(searchMock.mock.calls.length, 1);
});

// ── 친구 관리 네 줄의 ··· 차단(GROMO-2467) ──
const sentRequest = {
  requestId: 'r-sent',
  userId: 'u-sent',
  nickname: '보낸이',
  tierLevel: null,
  createdAt: 't',
};
const receivedRequest = {
  requestId: 'r-recv',
  userId: 'u-recv',
  nickname: '받은이',
  tierLevel: null,
  createdAt: 't',
};

async function renderBlockScreen() {
  jest
    .mocked(getFriendsScreen)
    .mockReset()
    .mockResolvedValue({
      friends: [friend('u-friend', '짝꿍')],
      friendRequests: [receivedRequest],
      sentFriendRequests: [sentRequest],
    });
  jest.mocked(searchFriends).mockReset();
  jest.mocked(blockUser).mockReset().mockResolvedValue(undefined);
  jest.mocked(cancelFriendRequest).mockReset().mockResolvedValue(undefined);
  jest.mocked(rejectFriendRequest).mockReset().mockResolvedValue(undefined);
  const screen = await render(<LiveHarness open />);
  await screen.findByText('보낸이');
  return screen;
}

async function search(screen: Awaited<ReturnType<typeof render>>, nickname: string) {
  await fireEvent.changeText(screen.getByPlaceholderText('닉네임으로 친구 찾기'), nickname);
  await waitFor(() => assert.ok(screen.getByText('검색 결과')));
  await waitFor(() => assert.ok(screen.getByLabelText(`${nickname} 더보기`)));
}

async function blockFromMenu(screen: Awaited<ReturnType<typeof render>>, name: string) {
  await fireEvent.press(screen.getByLabelText(`${name} 더보기`));
  // 친구 삭제는 친구 줄 메뉴에만 있다
  assert.equal(screen.queryByText('친구 삭제'), null);
  await fireEvent.press(screen.getByText('차단하기'));
  await fireEvent.press(screen.getByText('차단'));
}

test('친구 줄 ··· 메뉴에는 차단하기와 친구 삭제가 함께 있다', async () => {
  const screen = await renderBlockScreen();

  await fireEvent.press(screen.getByLabelText('짝꿍 더보기'));

  assert.ok(screen.getByText('차단하기'));
  assert.ok(screen.getByText('친구 삭제'));
});

test('검색 결과 줄 ··· 로 차단하면 차단 API 뒤 그 줄이 사라지고, 보낸 요청이 없으면 취소하지 않는다', async () => {
  const screen = await renderBlockScreen();
  jest
    .mocked(searchFriends)
    .mockResolvedValue([
      { userId: 'u-new', nickname: '구름', relation: 'NONE', tierLevel: null, occupation: null },
    ]);
  await search(screen, '구름');
  assert.ok(screen.getByText('친구 요청'));

  await blockFromMenu(screen, '구름');

  await waitFor(() => assert.equal(screen.queryByText('구름'), null));
  expect(jest.mocked(blockUser).mock.calls).toEqual([['u-new']]);
  assert.equal(jest.mocked(cancelFriendRequest).mock.calls.length, 0);
});

test('보낸 요청 줄 ··· 로 차단하면 차단 성공 뒤 그 요청을 취소하고 줄이 사라진다', async () => {
  const screen = await renderBlockScreen();
  assert.ok(screen.getByText('요청 취소'));

  await blockFromMenu(screen, '보낸이');

  await waitFor(() => expect(jest.mocked(cancelFriendRequest).mock.calls).toEqual([['r-sent']]));
  expect(jest.mocked(blockUser).mock.calls).toEqual([['u-sent']]);
  assert.ok(
    jest.mocked(blockUser).mock.invocationCallOrder[0] <
      jest.mocked(cancelFriendRequest).mock.invocationCallOrder[0],
  );
  await waitFor(() => assert.equal(screen.queryByText('보낸이'), null));
  assert.equal(screen.queryByText('요청 취소'), null);
});

test('검색에서 「요청 중」인 상대를 차단해도 보낸 요청을 취소한다', async () => {
  const screen = await renderBlockScreen();
  jest.mocked(searchFriends).mockResolvedValue([
    {
      userId: 'u-sent',
      nickname: '보낸이',
      relation: 'PENDING',
      tierLevel: null,
      occupation: null,
    },
  ]);
  await search(screen, '보낸이');
  assert.ok(screen.getByText('요청 중'));

  await blockFromMenu(screen, '보낸이');

  await waitFor(() => expect(jest.mocked(cancelFriendRequest).mock.calls).toEqual([['r-sent']]));
  await waitFor(() => assert.equal(screen.queryByText('보낸이'), null));
});

test('차단이 실패하면 보낸 요청을 취소하지 않고 줄도 남는다', async () => {
  const screen = await renderBlockScreen();
  jest.mocked(blockUser).mockRejectedValue(new Error('offline'));

  await blockFromMenu(screen, '보낸이');

  await waitFor(() => assert.ok(screen.getByText(/처리하지 못했어요/)));
  assert.equal(jest.mocked(cancelFriendRequest).mock.calls.length, 0);
  await waitFor(() => assert.ok(screen.getByText('보낸이')));
});

test('받은 요청 줄에서 차단하면 거절하지 않고 숨기기만 한다', async () => {
  const screen = await renderBlockScreen();

  await blockFromMenu(screen, '받은이');

  await waitFor(() => assert.equal(screen.queryByText('받은이'), null));
  expect(jest.mocked(blockUser).mock.calls).toEqual([['u-recv']]);
  assert.equal(jest.mocked(rejectFriendRequest).mock.calls.length, 0);
  assert.equal(jest.mocked(cancelFriendRequest).mock.calls.length, 0);
  assert.ok(screen.getByText('보낸이'));
});
