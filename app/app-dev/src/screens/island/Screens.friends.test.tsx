/** 친구 목록·검색 줄의 고양이 그림 — 서버가 catColor 를 안 주면(2389 이전) 예전처럼 흰 고양이, 주면 그 색(GROMO-2391). */
import assert from 'node:assert/strict';
import React, { useMemo, useReducer, useRef, useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RedesignScreens } from '@/screens/island/Screens';
import { initialState, reducer } from '@/services/model';
import { art } from '@/constants/art';
import { useFriendsScreen } from '@/screens/island/useFriendsScreen';
import { getFriendsScreen, searchFriends } from '@/services/api/friends';

jest.mock('@/services/api/friends', () => ({
  ...jest.requireActual('@/services/api/friends'),
  getFriendsScreen: jest.fn(),
  searchFriends: jest.fn(),
}));
jest.mock('@/services/blockedUsers', () => ({
  ...jest.requireActual('@/services/blockedUsers'),
  useBlockedUsers: () => ({ ids: new Set<string>(), status: 'ready', retry: jest.fn() }),
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
