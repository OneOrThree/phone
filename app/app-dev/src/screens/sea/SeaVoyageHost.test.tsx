// 바다 항해 호스트(GROMO-2310) — 세션 정본 → SeaScreen 어댑터: 남은 분 → 정박 문구, 그만두기 확인 1회 → 멀어지는 연출 → 표류,
// 내리기 → seaArrival 라우트 인자, 한마디 잠금·게스트. 바다 방 STOMP·연출·API 는 목이다.
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, BackHandler } from 'react-native';
import { ApiError } from '@/services/api/client';
import { updateSeaRemark } from '@/services/api/focusSessions';
import { getMyInventory } from '@/services/api/shop';
import { sendFriendRequest } from '@/services/api/friends';
import { sessionGeneration } from '@/services/api/session';
import { openSeaRoom } from '@/services/seaRealtime';
import { arriveAtIsland, getTelescope } from '@/services/api/telescope';
import * as magazineApi from '@/services/api/magazine';
import type { MagazineReceipt, MagazineToday } from '@/services/api/magazine';
import { resetMagazineToday } from '@/screens/magazine/useMagazineToday';
import { SeaVoyageHost } from './SeaVoyageHost';

jest.mock('@/components/CatSprite', () => ({ CatSprite: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  getSession: () => ({ userId: 'me' }),
  sessionGeneration: jest.fn(() => 1),
}));
jest.mock('@/services/api/friends', () => ({
  ...jest.requireActual('@/services/api/friends'),
  sendFriendRequest: jest.fn(),
}));
jest.mock('@/services/api/focusSessions', () => ({
  ...jest.requireActual('@/services/api/focusSessions'),
  updateSeaRemark: jest.fn(),
}));
jest.mock('@/services/api/telescope', () => ({
  ...jest.requireActual('@/services/api/telescope'),
  arriveAtIsland: jest.fn(),
  getTelescope: jest.fn(async () => ({
    items: [
      { islandId: 'dest', name: '목록섬' },
      { islandId: 'dest-b', name: '새목적섬' },
    ],
  })),
}));
jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  putMagazineReceipt: jest.fn(),
  getMagazineIssues: jest.fn(),
}));
jest.mock('@/services/api/shop', () => ({
  ...jest.requireActual('@/services/api/shop'),
  getMyInventory: jest.fn(async () => ({ clothes: [], decor: [], hulls: [], equipped: {} })),
}));
const mockRoom = {
  sendEmote: jest.fn((): string => 'sent'),
  close: jest.fn(),
  reconnect: jest.fn(),
};
let mockRoomOpts: any;
jest.mock('@/services/seaRealtime', () => ({
  ...jest.requireActual('@/services/seaRealtime'),
  openSeaRoom: jest.fn((opts: any) => {
    mockRoomOpts = opts;
    return mockRoom;
  }),
}));
jest.mock('@/components/VideoCutscene', () => ({
  VideoCutscene: ({ accessibilityLabel, testID, onFinish }: any) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID={testID} onPress={onFinish}>
        <Text testID={`${testID}-label`}>{accessibilityLabel}</Text>
      </Pressable>
    );
  },
}));

const mockRemark = updateSeaRemark as jest.Mock;
const seaSession = (over: Record<string, unknown> = {}) => ({
  id: 'sea-1',
  islandId: 'dest',
  subject: '',
  startedAt: Date.now(),
  syncedAt: Date.now(),
  seconds: 1700,
  status: 'active',
  version: 1,
  kind: 'sea',
  targetMinutes: 30,
  destinationIslandName: '별고래섬',
  ...over,
});
const env = (over: Record<string, unknown> = {}) => ({
  state: { name: '나냥', color: 'black', session: seaSession() } as any,
  route: 'sea',
  detail: '',
  now: Date.now(),
  focus: { finish: jest.fn(), recover: jest.fn(async (): Promise<string | null> => null) },
  notify: jest.fn(),
  replace: jest.fn(),
  go: jest.fn(),
  home: jest.fn(),
  backOverride: { current: null as null | (() => boolean) },
  conversion: { offer: jest.fn(() => false) },
  friendsScreen: { refresh: jest.fn() },
  ...over,
});

let mockAppStateChange: (next: string) => void = () => {};
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: any) => {
    mockAppStateChange = cb;
    return { remove: jest.fn() };
  }) as never);
  mockRemark.mockReset();
  jest.mocked(sessionGeneration).mockReturnValue(1);
  jest.mocked(sendFriendRequest).mockReset();
});

const showPeer = async () => {
  const e = env({
    state: { name: '나냥', color: 'black', session: null },
    friendsScreen: { refresh: jest.fn() },
  });
  const screen = await render(<SeaVoyageHost e={e} />);
  await act(async () =>
    mockRoomOpts.onMembers([
      {
        userId: 'peer',
        name: '치즈',
        color: 'ginger',
        focusing: false,
        activeSeconds: 123,
        anchorMs: Date.now(),
      },
    ]),
  );
  await fireEvent.press(screen.getByTestId('sea-person-peer'));
  expect(openSeaRoom).toHaveBeenCalledTimes(1);
  return { e, screen };
};

test('바다 유저 카드의 친구 요청은 API 성공 뒤에만 완료 표시하고 친구 목록을 새로 읽는다', async () => {
  jest.mocked(sendFriendRequest).mockResolvedValue();
  const { e, screen } = await showPeer();
  await fireEvent.press(screen.getByLabelText('친구 요청'));
  expect(sendFriendRequest).toHaveBeenCalledWith('peer');
  expect(e.friendsScreen.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('친구 요청 보냄')).toBeDisabled();
  expect(openSeaRoom).toHaveBeenCalledTimes(1);
});

test.each([
  ['STATE_CONFLICT', '이미 친구이거나 보낸 요청이 있어요.'],
  ['FORBIDDEN', '친구 요청을 보낼 수 없는 상대예요.'],
])('친구 요청 %s 실패를 성공으로 표시하지 않고 이유를 안내한다', async (code, message) => {
  jest.mocked(sendFriendRequest).mockRejectedValue(new ApiError(code, '', 409));
  const { e, screen } = await showPeer();
  await fireEvent.press(screen.getByLabelText('친구 요청'));
  expect(e.notify).toHaveBeenCalledWith(message);
  expect(screen.getByLabelText('친구 요청')).toBeEnabled();
});

test('게스트 친구 요청은 회원 전환을 열고 성공으로 표시하지 않는다', async () => {
  jest.mocked(sendFriendRequest).mockRejectedValue(new ApiError('SOCIAL_LOGIN_REQUIRED', '', 403));
  const { e, screen } = await showPeer();
  e.conversion.offer.mockReturnValue(true);
  await fireEvent.press(screen.getByLabelText('친구 요청'));
  expect(e.conversion.offer).toHaveBeenCalled();
  expect(e.notify).not.toHaveBeenCalled();
  expect(screen.getByLabelText('친구 요청')).toBeEnabled();
});

test('계정 전환 뒤 도착한 친구 요청 성공은 새 계정에 반영하지 않는다', async () => {
  let finish!: () => void;
  jest.mocked(sendFriendRequest).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { e, screen } = await showPeer();
  await fireEvent.press(screen.getByLabelText('친구 요청'));
  jest.mocked(sessionGeneration).mockReturnValue(2);
  await act(async () => finish());
  expect(e.friendsScreen.refresh).not.toHaveBeenCalled();
  expect(screen.getByLabelText('친구 요청')).toBeEnabled();
});

test('남은 분이 줄다가 목표 시간에 닿으면 「○○ 앞 정박 중」과 [섬에 내리기]로 바뀐다', async () => {
  const e = env();
  const screen = await render(<SeaVoyageHost e={e} />);
  expect(screen.getByText('별고래섬까지 2분')).toBeTruthy();
  expect(screen.getByLabelText('집중 마치기')).toBeTruthy();
  expect(screen.queryByLabelText('휴식')).toBeNull();
  await screen.rerender(<SeaVoyageHost e={{ ...e, now: e.now + 101_000 }} />);
  expect(screen.getByText('별고래섬 앞 정박 중')).toBeTruthy();
  expect(screen.getByLabelText('섬에 내리기')).toBeTruthy();
});

test('그만두기는 확인창을 한 번 거쳐 finish 하고, 멀어지는 연출 뒤 표류(망원경 버튼)로 남는다', async () => {
  const e = env();
  e.focus.finish.mockResolvedValue({ recordId: 'sea-1', arrived: false, activeSeconds: 1700 });
  const screen = await render(<SeaVoyageHost e={e} />);
  await fireEvent.press(screen.getByLabelText('집중 마치기'));
  expect(screen.getByText('별고래섬 항해를 그만둘까요?')).toBeTruthy();
  expect(screen.getByText('지금까지 28분은 기록에 남아요')).toBeTruthy();
  expect(e.focus.finish).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('집중 마치기'));
  await act(async () => {});
  expect(e.focus.finish).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('abandon-cutscene-label').props.children).toContain('별고래섬');
  // 연출 중 뒤로가기는 삼킨다
  expect(e.backOverride.current?.()).toBe(true);
  // 실제 앱에서는 finish 가 세션을 닫는다
  const ended = { ...e, state: { ...e.state, session: null } };
  await screen.rerender(<SeaVoyageHost e={ended} />);
  await fireEvent.press(screen.getByTestId('abandon-cutscene'));
  await fireEvent.press(screen.getByLabelText('망원경'));
  expect(e.go).toHaveBeenCalledWith('telescope');
  expect(e.replace).not.toHaveBeenCalled();
});

test('부팅 소속 조회가 실패해도 바다에 머물고 망원경을 누르면 동기화를 재시도한다', async () => {
  const sync = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
  const e = env({
    state: { name: '나냥', color: 'black', session: null },
    islandBootError: true,
    islands: { sync },
  });
  const screen = await render(<SeaVoyageHost e={e} />);
  expect(sync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('망원경'));
  expect(sync).toHaveBeenCalledTimes(1);
  expect(e.go).not.toHaveBeenCalled();
  expect(screen.getByLabelText('망원경')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('망원경'));
  expect(sync).toHaveBeenCalledTimes(2);
  expect(e.go).toHaveBeenCalledWith('telescope');
});

test('소속 재조회 중 계정이 바뀌면 늦은 응답으로 망원경을 열지 않는다', async () => {
  const sync = jest.fn(async () => {
    (sessionGeneration as jest.Mock).mockReturnValue(2);
  });
  const e = env({
    state: { name: '나냥', color: 'black', session: null },
    islandBootError: true,
    islands: { sync },
  });
  const screen = await render(<SeaVoyageHost e={e} />);
  await fireEvent.press(screen.getByLabelText('망원경'));
  expect(sync).toHaveBeenCalledTimes(1);
  expect(e.go).not.toHaveBeenCalled();
});

test('정박 중 [섬에 내리기]는 finish 결과(arrived)를 seaArrival 라우트 인자로 넘긴다', async () => {
  const e = env({
    state: { name: '나냥', color: 'black', session: seaSession({ seconds: 1800 }) },
  });
  const finish = { recordId: 'sea-1', islandId: 'dest', arrived: true, activeSeconds: 1800 };
  e.focus.finish.mockResolvedValue(finish);
  const screen = await render(<SeaVoyageHost e={e} />);
  await fireEvent.press(screen.getByLabelText('섬에 내리기'));
  await act(async () => {});
  expect(e.replace).toHaveBeenCalledWith(
    'seaArrival',
    JSON.stringify({ finish, destinationName: '별고래섬' }),
  );
});

test('seaArrival 라우트는 넘겨받은 결과로 결과창을 띄운다(내용은 GROMO-2311)', async () => {
  const finish = { recordId: 'sea-1', islandId: 'dest', arrived: true, activeSeconds: 1800 };
  const e = env({
    route: 'seaArrival',
    detail: JSON.stringify({ finish, destinationName: '별고래섬' }),
    state: { name: '나냥', color: 'black', session: null },
  });
  const screen = await render(<SeaVoyageHost e={e} />);
  expect(screen.getByTestId('sea-arrival-result')).toBeTruthy();
  expect(screen.getByText('별고래섬')).toBeTruthy();
});

test('목적지 이름 — 서버 이름이 없으면 망원경이 넘긴 이름, 그것도 없으면 망원경 목록에서 찾는다', async () => {
  const passed = env({
    detail: '건넨섬',
    state: {
      name: '나냥',
      color: 'black',
      session: seaSession({ destinationIslandName: undefined }),
    },
  });
  const a = await render(<SeaVoyageHost e={passed} />);
  expect(a.getByText('건넨섬까지 2분')).toBeTruthy();
  await a.unmount();
  const recovered = env({
    state: {
      name: '나냥',
      color: 'black',
      session: seaSession({ destinationIslandName: undefined }),
    },
  });
  const b = await render(<SeaVoyageHost e={recovered} />);
  expect(await b.findByText('목록섬까지 2분')).toBeTruthy();
});

test('바다 방 구성원과 이모트가 화면에 이어지고 내 이모트는 방에 보낸다', async () => {
  const e = env({ state: { name: '나냥', color: 'black', session: null } });
  const screen = await render(<SeaVoyageHost e={e} />);
  await act(async () =>
    mockRoomOpts.onMembers([
      {
        userId: 'a',
        name: '치즈',
        color: 'ginger',
        focusing: false,
        activeSeconds: 0,
        anchorMs: 0,
        message: '수학 끝!',
      },
    ]),
  );
  expect(screen.getByText('치즈')).toBeTruthy();
  expect(screen.getByText('수학 끝!')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('이모트'));
  await fireEvent.press(screen.getByLabelText('응원'));
  await act(async () => {});
  expect(mockRoom.sendEmote).toHaveBeenCalledWith('cheer');
  await screen.unmount();
  expect(mockRoom.close).toHaveBeenCalled();
});

test.each([
  ['no-room', '바다에 다시 들어가는 중이에요. 잠시 뒤 다시 보내 주세요.'],
  ['disconnected', '연결이 원활하지 않아요. 다시 눌러 시도해 주세요.'],
  ['throttled', '이모트는 잠시 뒤에 다시 보낼 수 있어요'],
])(
  '이모트가 나가지 못하면 이유(%s)별 문구를 패널에 띄우고 패널은 열어 둔다 (GROMO-2484)',
  async (reason, text) => {
    const e = env({ state: { name: '나냥', color: 'black', session: null } });
    const screen = await render(<SeaVoyageHost e={e} />);
    mockRoom.sendEmote.mockReturnValueOnce(reason);
    await fireEvent.press(screen.getByLabelText('이모트'));
    await fireEvent.press(screen.getByLabelText('응원'));
    await act(async () => {});
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByLabelText('응원')).toBeTruthy();
  },
);

test('표류 중 한마디 — 저장하면 내 말풍선에 뜨고, 5분 잠금(409)은 토스트, 게스트(403)는 회원 전환', async () => {
  const e = env({ state: { name: '나냥', color: 'black', session: null } });
  const screen = await render(<SeaVoyageHost e={e} />);
  const write = async (text: string) => {
    await fireEvent.press(screen.getByLabelText('＋ 한마디 쓰기'));
    await fireEvent.changeText(screen.getByLabelText('한마디 쓰기'), text);
    await fireEvent.press(screen.getByLabelText('한마디 띄우기'));
    await act(async () => {});
  };
  mockRemark.mockRejectedValueOnce(new ApiError('SEA_REMARK_LOCKED', '잠김', 409));
  await write('공부 중');
  expect(e.notify).toHaveBeenCalledWith('한마디는 고친 뒤 5분 동안 바꿀 수 없어요');
  expect(mockRoom.reconnect).not.toHaveBeenCalled(); // 저장 실패면 다시 들어가지 않는다
  e.conversion.offer.mockReturnValueOnce(true);
  mockRemark.mockRejectedValueOnce(new ApiError('SOCIAL_LOGIN_REQUIRED', '로그인', 403));
  await write('공부 중');
  expect(e.conversion.offer).toHaveBeenCalledTimes(2);
  mockRemark.mockResolvedValueOnce({ remark: '공부 중' });
  await write('공부 중');
  expect(mockRemark).toHaveBeenLastCalledWith('공부 중');
  expect(screen.getByText('공부 중')).toBeTruthy();
  // 표류 정리 뒤면 저장 «뒤» 바다 방에 다시 들어간다 — 입장 스냅샷이 새 한마디를 싣는다(GROMO-2484)
  expect(mockRoom.reconnect).toHaveBeenCalledTimes(1);
});

test('다른 화면에 갔다가 돌아와도(재마운트) 경과는 세션을 받은 시각부터 이어 센다', async () => {
  const synced = Date.now() - 120_000; // 2분 전에 받은 세션(1700초)
  const e = env({
    state: {
      name: '나냥',
      color: 'black',
      session: seaSession({ syncedAt: synced, seconds: 1500 }),
    },
  });
  const first = await render(<SeaVoyageHost e={e} />);
  expect(first.getByText('별고래섬까지 3분')).toBeTruthy(); // 1800 − (1500 + 120) = 180초
  await first.unmount();
  const again = await render(<SeaVoyageHost e={{ ...e, now: e.now + 60_000 }} />);
  expect(again.getByText('별고래섬까지 2분')).toBeTruthy();
});

test('포그라운드 복귀·바다 방 재연결 때 세션 정본을 다시 읽고, 다른 기기에서 끝났으면 표류로 바뀐다', async () => {
  const e = env();
  const screen = await render(<SeaVoyageHost e={e} />);
  await act(async () => mockAppStateChange('active'));
  expect(e.focus.recover).toHaveBeenCalledTimes(1);
  expect(mockRoom.reconnect).toHaveBeenCalledTimes(1); // 바다 방이 쉬고 있으면 바로 다시 붙는다
  await act(async () => mockRoomOpts.onReconnect());
  expect(e.focus.recover).toHaveBeenCalledTimes(2);
  // recover 가 current=null 로 SESSION_SYNC 하면 세션이 사라진다 → 표류
  await screen.rerender(<SeaVoyageHost e={{ ...e, state: { ...e.state, session: null } }} />);
  expect(screen.getByLabelText('망원경')).toBeTruthy();
  expect(screen.queryByTestId('sea-focus-clock')).toBeNull();
  // 표류(세션 없음)에서도 복귀하면 다시 읽고, 다른 기기가 섬 집중을 시작했으면 그 화면으로 간다
  e.focus.recover.mockResolvedValueOnce('focus');
  await act(async () => mockAppStateChange('active'));
  expect(e.focus.recover).toHaveBeenCalledTimes(3);
  expect(e.replace).toHaveBeenCalledWith('focus');
});

test('App 공용 뒤로가기 — 항해 중에는 홈으로 가지 않고 삼키며, 표류 중에는 App 기본 처리에 맡긴다', async () => {
  const e = env();
  const screen = await render(<SeaVoyageHost e={e} />);
  let handled: boolean | undefined;
  await act(async () => {
    handled = e.backOverride.current?.();
  });
  expect(handled).toBe(true);
  expect(e.notify).toHaveBeenCalledWith('진행 중인 집중은 [집중 마치기]로 마칠 수 있어요');
  expect(e.home).not.toHaveBeenCalled();
  await screen.rerender(<SeaVoyageHost e={{ ...e, state: { ...e.state, session: null } }} />);
  expect(e.backOverride.current?.()).toBe(false);
  await screen.unmount();
  expect(e.backOverride.current).toBeNull();
});

test('내 참가자가 adrift 로 오면(다른 기기가 항해를 끝냄) 세션을 다시 읽고, 세션이 사라지면 표류로 바뀐다', async () => {
  let done!: () => void;
  const e = env();
  e.focus.recover.mockImplementation(() => new Promise<null>((r) => (done = () => r(null))));
  const screen = await render(<SeaVoyageHost e={e} />);
  const adriftMe = {
    userId: 'me',
    name: '나냥',
    color: 'black',
    focusing: false,
    activeSeconds: 0,
    anchorMs: 0,
  };
  await act(async () => mockRoomOpts.onMembers([adriftMe]));
  await act(async () => mockRoomOpts.onMembers([adriftMe])); // 재조회 중 연타는 무시
  expect(e.focus.recover).toHaveBeenCalledTimes(1);
  await act(async () => done());
  await screen.rerender(<SeaVoyageHost e={{ ...e, state: { ...e.state, session: null } }} />);
  expect(screen.queryByTestId('sea-focus-clock')).toBeNull();
  expect(screen.getByLabelText('망원경')).toBeTruthy();
  // 로컬 세션과 서버 상태가 같으면(표류 = 세션 없음) 더 부르지 않는다
  await act(async () => mockRoomOpts.onMembers([adriftMe]));
  expect(e.focus.recover).toHaveBeenCalledTimes(1);
});

test('저장한 한마디는 서버 확인 전 임시값 — 다른 기기에서 고친 한마디가 오면 서버 값을 보인다', async () => {
  const e = env({ state: { name: '나냥', color: 'black', session: null } });
  const me = (message?: string) => ({
    userId: 'me',
    name: '나냥',
    color: 'black',
    focusing: false,
    activeSeconds: 0,
    anchorMs: 0,
    ...(message ? { message } : {}),
  });
  const screen = await render(<SeaVoyageHost e={e} />);
  await act(async () => mockRoomOpts.onMembers([me('옛 한마디')]));
  mockRemark.mockResolvedValueOnce({ remark: '내 새 한마디' });
  await fireEvent.press(screen.getByLabelText('＋ 한마디 쓰기'));
  await fireEvent.changeText(screen.getByLabelText('한마디 쓰기'), '내 새 한마디');
  await fireEvent.press(screen.getByLabelText('한마디 띄우기'));
  await act(async () => {});
  expect(screen.getByText('내 새 한마디')).toBeTruthy();
  // 아직 옛 값인 스냅샷(실시간 사건 꺼짐)은 임시값을 덮지 않는다
  await act(async () => mockRoomOpts.onMembers([me('옛 한마디')]));
  expect(screen.getByText('내 새 한마디')).toBeTruthy();
  // 다른 기기에서 고친 값이 오면 그 값으로
  await act(async () => mockRoomOpts.onMembers([me('다른 기기 한마디')]));
  expect(screen.getByText('다른 기기 한마디')).toBeTruthy();
  expect(screen.queryByText('내 새 한마디')).toBeNull();
});

test('표류 정리로 방이 비었을 때 고친 한마디 — 저장 뒤 늦게 온 옛 한마디 스냅샷이 화면을 되돌리지 않는다 (GROMO-2484)', async () => {
  const e = env({ state: { name: '나냥', color: 'black', session: null } });
  const me = (message: string) => ({
    userId: 'me',
    name: '나냥',
    color: 'black',
    focusing: false,
    activeSeconds: 0,
    anchorMs: 0,
    message,
  });
  const screen = await render(<SeaVoyageHost e={e} />);
  await act(async () => mockRoomOpts.onMembers([me('옛 한마디')]));
  await act(async () => mockRoomOpts.onMembers([])); // sea.room.left{adrift} — 방을 버려 내 서버 값도 모른다
  mockRemark.mockResolvedValueOnce({ remark: '내 새 한마디' });
  await fireEvent.press(screen.getByLabelText('＋ 한마디 쓰기'));
  await fireEvent.changeText(screen.getByLabelText('한마디 쓰기'), '내 새 한마디');
  await fireEvent.press(screen.getByLabelText('한마디 띄우기'));
  await act(async () => {});
  expect(screen.getByText('내 새 한마디')).toBeTruthy();
  // 저장 전에 시작된 재입장(직전 이모트 탭 등)의 스냅샷이 저장 뒤 옛 한마디를 싣고 온다
  await act(async () => mockRoomOpts.onMembers([me('옛 한마디')]));
  expect(screen.getByText('내 새 한마디')).toBeTruthy();
  expect(screen.queryByText('옛 한마디')).toBeNull();
  // 방금 저장한 값이 돌아오면 임시값을 푼다 — 그 뒤 다른 기기 값은 그대로 보인다
  await act(async () => mockRoomOpts.onMembers([me('내 새 한마디')]));
  await act(async () => mockRoomOpts.onMembers([me('다른 기기 한마디')]));
  expect(screen.getByText('다른 기기 한마디')).toBeTruthy();
});

test('종료 응답을 잃으면 확인 중으로 두고, 재연결·복귀 때 recover 보다 먼저 같은 finish 를 다시 보내 결과창으로 간다', async () => {
  const e = env({
    state: { name: '나냥', color: 'black', session: seaSession({ seconds: 1800 }) },
  });
  const done = { recordId: 'sea-1', islandId: 'dest', arrived: true, activeSeconds: 1800 };
  e.focus.finish
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '유실', 0))
    .mockResolvedValueOnce(done);
  const screen = await render(<SeaVoyageHost e={e} />);
  await fireEvent.press(screen.getByLabelText('섬에 내리기'));
  await act(async () => {});
  expect(e.notify).toHaveBeenCalledWith('항해 결과를 확인하고 있어요. 연결되면 이어서 처리해요.');
  expect(e.replace).not.toHaveBeenCalled();
  await act(async () => mockRoomOpts.onReconnect());
  expect(e.focus.finish).toHaveBeenCalledTimes(2);
  expect(e.focus.recover).not.toHaveBeenCalled();
  expect(e.replace).toHaveBeenCalledWith(
    'seaArrival',
    JSON.stringify({ finish: done, destinationName: '별고래섬' }),
  );
});

test('종료 재시도가 세션 없음(STATE_CONFLICT)이면 정본을 맞추고 결과를 못 찾았다고 알린다', async () => {
  const e = env();
  e.focus.finish
    .mockRejectedValueOnce(new ApiError('UPSTREAM_TIMEOUT', '지연', 504))
    .mockRejectedValueOnce(new ApiError('STATE_CONFLICT', '없어요', 409));
  const screen = await render(<SeaVoyageHost e={e} />);
  await fireEvent.press(screen.getByLabelText('집중 마치기'));
  await fireEvent.press(screen.getByLabelText('집중 마치기'));
  await act(async () => {});
  await act(async () => mockAppStateChange('active'));
  expect(e.focus.recover).toHaveBeenCalledTimes(1);
  expect(e.notify).toHaveBeenLastCalledWith(
    '항해 결과를 확인하지 못했어요. 기록에서 확인해 주세요.',
  );
});

test('내 참가자의 서버 sessionId 가 로컬 세션과 다르면(다른 기기가 새로 출항) 세션을 다시 읽는다', async () => {
  const e = env();
  await render(<SeaVoyageHost e={e} />);
  const me = (sessionId: string) => ({
    userId: 'me',
    name: '나냥',
    color: 'black',
    focusing: true,
    activeSeconds: 0,
    anchorMs: 0,
    sessionId,
  });
  await act(async () => mockRoomOpts.onMembers([me('sea-1')]));
  expect(e.focus.recover).not.toHaveBeenCalled();
  await act(async () => mockRoomOpts.onMembers([me('sea-2')]));
  expect(e.focus.recover).toHaveBeenCalledTimes(1);
});

test('복구 결과가 섬 집중(focus·rest)이면 그 화면으로 옮기고, sea 면 그대로 둔다', async () => {
  const e = env();
  e.focus.recover.mockResolvedValueOnce('focus').mockResolvedValueOnce('sea');
  await render(<SeaVoyageHost e={e} />);
  await act(async () => mockAppStateChange('active'));
  expect(e.replace).toHaveBeenCalledWith('focus');
  await act(async () => mockAppStateChange('active'));
  expect(e.replace).toHaveBeenCalledTimes(1);
});

test('세션이 다른 목적지로 바뀌면 옛 이름(라우트 인자·목록 캐시)을 버리고 목록을 다시 읽는다', async () => {
  const mockGet = getTelescope as jest.Mock;
  const noName = (over: Record<string, unknown>) =>
    seaSession({ destinationIslandName: undefined, ...over });
  const e = env({ detail: '건넨섬', state: { name: '나냥', color: 'black', session: noName({}) } });
  const screen = await render(<SeaVoyageHost e={e} />);
  expect(screen.getByText('건넨섬까지 2분')).toBeTruthy();
  expect(mockGet).not.toHaveBeenCalled();
  const next = {
    ...e,
    state: { ...e.state, session: noName({ id: 'sea-2', islandId: 'dest-b' }) },
  };
  await screen.rerender(<SeaVoyageHost e={next} />);
  expect(screen.queryByText(/건넨섬/)).toBeNull();
  expect(await screen.findByText('새목적섬까지 2분')).toBeTruthy();
  expect(mockGet).toHaveBeenCalledTimes(1);
});

test('종료 유실 뒤 재시도가 409 로 확정 실패하고 새 세션이 복원되면, 복귀해도 그 새 세션을 끝내지 않는다', async () => {
  const e = env();
  e.focus.finish
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '유실', 0))
    .mockRejectedValueOnce(new ApiError('STATE_CONFLICT', '없어요', 409));
  const screen = await render(<SeaVoyageHost e={e} />);
  const stop = async () => {
    await fireEvent.press(screen.getByLabelText('집중 마치기'));
    await fireEvent.press(screen.getByLabelText('집중 마치기'));
    await act(async () => {});
  };
  await stop(); // 유실 — 대기
  await fireEvent.press(screen.getByLabelText('계속 집중하기')).catch(() => {});
  await stop(); // 수동 재시도 → 409(확정) — 명령 계층이 새 세션을 복원했다
  // 확정 실패만으로도(세션 id 가 같아도) 대기 중 재시도는 끝난다
  await act(async () => mockAppStateChange('active'));
  expect(e.focus.finish).toHaveBeenCalledTimes(2);
  const renewed = { ...e, state: { ...e.state, session: seaSession({ id: 'sea-2' }) } };
  await screen.rerender(<SeaVoyageHost e={renewed} />);
  await act(async () => mockAppStateChange('active'));
  await act(async () => mockRoomOpts.onReconnect());
  expect(e.focus.finish).toHaveBeenCalledTimes(2);
  expect(e.focus.recover).toHaveBeenCalled();
});

test('종료 유실 대기 중 세션이 다른 id 로 바뀌면 재연결·복귀 때 finish 를 다시 보내지 않는다', async () => {
  const e = env();
  e.focus.finish.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '유실', 0));
  const screen = await render(<SeaVoyageHost e={e} />);
  await fireEvent.press(screen.getByLabelText('집중 마치기'));
  await fireEvent.press(screen.getByLabelText('집중 마치기'));
  await act(async () => {});
  const renewed = { ...e, state: { ...e.state, session: seaSession({ id: 'sea-2' }) } };
  await screen.rerender(<SeaVoyageHost e={renewed} />);
  await act(async () => mockRoomOpts.onReconnect());
  await act(async () => mockAppStateChange('active'));
  expect(e.focus.finish).toHaveBeenCalledTimes(1);
  expect(e.focus.recover).toHaveBeenCalledTimes(2);
});

describe('결과창 [섬 둘러보기] (GROMO-2311)', () => {
  const arrivalEnv = (extra: Record<string, unknown> = {}): any =>
    env({
      route: 'seaArrival',
      detail: JSON.stringify({
        finish: {
          recordId: 'r',
          islandId: 'dest',
          arrived: true,
          activeSeconds: 1800,
          seaReward: { grantedProductIds: [], minutesToNextTier: 12 },
        },
        destinationName: '별고래섬',
      }),
      state: { name: '나냥', color: 'black', session: null, equipped: {} },
      dispatch: jest.fn(),
      islands: { sync: jest.fn(async () => ({})), visit: jest.fn(async () => {}) },
      reset: jest.fn(),
      ...extra,
    });

  test('seaReward 의 남은 시간을 보여 준다', async () => {
    const screen = await render(<SeaVoyageHost e={arrivalEnv()} />);
    expect(screen.getByText('다음 단계까지 12분')).toBeTruthy();
  });

  test('주민 첫 도착(arrivedBefore=false)이면 환영 뒤 주민 홈', async () => {
    (arriveAtIsland as jest.Mock).mockResolvedValue({
      islandId: 'dest',
      arrivedBefore: false,
      membershipStatus: 'active',
      currentIslandId: 'dest',
    });
    const e = arrivalEnv();
    const screen = await render(<SeaVoyageHost e={e} />);
    await fireEvent.press(screen.getByLabelText('섬 둘러보기'));
    await act(async () => {});
    expect(e.notify).toHaveBeenCalledWith(expect.stringContaining('환영해요!'));
    expect(e.reset).toHaveBeenCalledWith('home');
  });

  const member = () =>
    (arriveAtIsland as jest.Mock).mockResolvedValue({
      islandId: 'dest',
      arrivedBefore: true,
      membershipStatus: 'active',
      currentIslandId: 'dest',
    });

  test('인벤토리 응답이 늦어도 응답을 받은 뒤에 SHOP_SYNC 하고 그 다음 한 번 이동한다', async () => {
    member();
    (getMyInventory as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ clothes: [], decor: [], hulls: [], equipped: {} }), 200),
        ),
    );
    const e = arrivalEnv();
    const screen = await render(<SeaVoyageHost e={e} />);
    await fireEvent.press(screen.getByLabelText('섬 둘러보기'));
    expect(e.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SHOP_SYNC' }));
    expect(e.reset).toHaveBeenCalledTimes(1);
    expect(e.dispatch.mock.invocationCallOrder[0]).toBeLessThan(
      e.reset.mock.invocationCallOrder[0],
    );
  });

  test('인벤토리 재조회가 실패하면 SHOP_SYNC 없이 이동은 한 번', async () => {
    member();
    (getMyInventory as jest.Mock).mockRejectedValueOnce(new Error('x'));
    const e = arrivalEnv();
    const screen = await render(<SeaVoyageHost e={e} />);
    await fireEvent.press(screen.getByLabelText('섬 둘러보기'));
    expect(e.reset).toHaveBeenCalledTimes(1);
    expect(e.dispatch).not.toHaveBeenCalled();
  });

  test('인벤토리 재조회가 3초를 넘기면 기다리지 않고 이동하며 늦은 응답은 버린다', async () => {
    member();
    let resolve!: (v: unknown) => void;
    (getMyInventory as jest.Mock).mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const e = arrivalEnv();
    const screen = await render(<SeaVoyageHost e={e} />);
    await fireEvent.press(screen.getByLabelText('섬 둘러보기'));
    expect(e.reset).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ clothes: [], decor: [], hulls: [], equipped: {} }));
    expect(e.dispatch).not.toHaveBeenCalled();
  }, 10000);

  test('인벤토리 대기 중 화면을 떠나면(언마운트) 응답이 와도 dispatch·이동을 하지 않는다', async () => {
    member();
    const e = arrivalEnv();
    const screen = await render(<SeaVoyageHost e={e} />);
    // 재조회가 나가는 순간 사용자가 뒤로가기로 떠난다
    (getMyInventory as jest.Mock).mockImplementationOnce(() => {
      screen.unmount();
      return new Promise((resolve) =>
        setTimeout(() => resolve({ clothes: [], decor: [], hulls: [], equipped: {} }), 100),
      );
    });
    await fireEvent.press(screen.getByLabelText('섬 둘러보기'));
    expect(e.dispatch).not.toHaveBeenCalled();
    expect(e.reset).not.toHaveBeenCalled();
  });

  test('방문자는 환영 없이 방문 라우트로', async () => {
    (arriveAtIsland as jest.Mock).mockResolvedValue({
      islandId: 'dest',
      arrivedBefore: true,
      membershipStatus: 'none',
      currentIslandId: null,
    });
    const e = arrivalEnv();
    const screen = await render(<SeaVoyageHost e={e} />);
    await fireEvent.press(screen.getByLabelText('섬 둘러보기'));
    await act(async () => {});
    expect(e.notify).not.toHaveBeenCalled();
    expect(e.islands.visit).toHaveBeenCalledWith('dest');
    expect(e.dispatch).toHaveBeenCalledWith({ type: 'SERVER_VISITING', islandId: 'dest' });
    expect(e.replace).toHaveBeenCalledWith('visitIsland', 'dest');
  });
});

test('호스트 구독 콜백은 첫 렌더가 아니라 최신 e 를 쓴다(App 의 e·replace 는 렌더마다 새로 만든다)', async () => {
  const e = env();
  e.focus.recover.mockResolvedValue('focus');
  const screen = await render(<SeaVoyageHost e={e} />);
  const next = { ...e, replace: jest.fn(), notify: jest.fn() };
  await screen.rerender(<SeaVoyageHost e={next} />);
  await act(async () => mockAppStateChange('active'));
  expect(next.replace).toHaveBeenCalledWith('focus');
  expect(e.replace).not.toHaveBeenCalled();
  await act(async () => mockRoomOpts.onError('끊겼어요'));
  expect(next.notify).toHaveBeenCalledWith('끊겼어요');
});

test('종료 응답을 잃은 뒤 복구가 로컬 세션을 지웠으면(없음 = 불명) 같은 (세션, version) 으로 한 번 더 묻는다', async () => {
  const e = env({
    state: { name: '나냥', color: 'black', session: seaSession({ seconds: 1800 }) },
  });
  const done = { recordId: 'sea-1', islandId: 'dest', arrived: true, activeSeconds: 1800 };
  e.focus.finish
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '유실', 0))
    .mockResolvedValueOnce(done);
  const screen = await render(<SeaVoyageHost e={e} />);
  await fireEvent.press(screen.getByLabelText('섬에 내리기'));
  await act(async () => {});
  // App 쪽 recover() 가 current=null 로 세션을 지웠다
  const cleared = { ...e, state: { ...e.state, session: null } };
  await screen.rerender(<SeaVoyageHost e={cleared} />);
  await act(async () => mockAppStateChange('active'));
  expect(e.focus.finish).toHaveBeenCalledTimes(2);
  expect(e.focus.finish).toHaveBeenLastCalledWith({ id: 'sea-1', version: 1 });
  expect(e.focus.recover).not.toHaveBeenCalled();
  expect(e.replace).toHaveBeenCalledWith(
    'seaArrival',
    JSON.stringify({ finish: done, destinationName: '별고래섬' }),
  );
});

test('대기 중인 종료가 «다른» 진행 세션을 가리키게 되면 재시도를 버리고 정본만 읽는다', async () => {
  const e = env();
  e.focus.finish.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '유실', 0));
  const screen = await render(<SeaVoyageHost e={e} />);
  await fireEvent.press(screen.getByLabelText('집중 마치기'));
  await fireEvent.press(screen.getByLabelText('집중 마치기'));
  await act(async () => {});
  const other = { ...e, state: { ...e.state, session: seaSession({ id: 'sea-2' }) } };
  await screen.rerender(<SeaVoyageHost e={other} />);
  await act(async () => mockAppStateChange('active'));
  expect(e.focus.finish).toHaveBeenCalledTimes(1);
  expect(e.focus.recover).toHaveBeenCalledTimes(1);
});

describe('바다 고양이 잡지(GROMO-2314) — 펠리컨 배달 B1 · 뗏목 옆 잡지 물건 B3', () => {
  const putReceipt = magazineApi.putMagazineReceipt as jest.Mock;
  const getIssues = magazineApi.getMagazineIssues as jest.Mock;
  const issue = {
    issueId: 'iss-20',
    issueNo: 20,
    issueDate: '2026-10-20',
    publishedAt: '2026-10-19T22:00:00Z',
    current: true,
  };
  const receipt = (over: Partial<MagazineReceipt> = {}): MagazineReceipt => ({
    place: 'SEA',
    receivedAt: '2026-10-20T01:00:00Z',
    deferredAt: null,
    openedAt: null,
    ...over,
  });
  // 표류(세션 없음) 중인 바다 — 오늘 호 상태는 CurrentScreens 가 e.magazineToday 로 넘긴다
  const drift = (today: MagazineToday | null, over: Record<string, unknown> = {}) =>
    env({ state: { name: '나냥', color: 'black', session: null }, magazineToday: today, ...over });

  beforeEach(() => {
    resetMagazineToday();
    putReceipt.mockResolvedValue(receipt());
  });
  afterEach(() => expect(getIssues).not.toHaveBeenCalled());

  test('표류 중 아직 받지 않은 오늘 호면 펠리컨이 화면 전체로 뜨고, 띄우는 순간 받음(SEA)을 한 번 보내고 스크린리더에 알린다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const screen = await render(<SeaVoyageHost e={drift({ issue, receipt: null })} />);
    expect(screen.getByTestId('sea-magazine-delivery')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sea-magazine-cutscene'));
    expect(screen.getByText('고양이 잡지 왔어요!')).toBeTruthy();
    expect(putReceipt).toHaveBeenCalledTimes(1);
    expect(putReceipt).toHaveBeenCalledWith('iss-20', { place: 'SEA' });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('고양이 잡지 왔어요!');
    // 뒤의 바다 장면은 스크린리더에서 숨는다
    expect(screen.queryByLabelText('망원경')).toBeNull();
  });

  test('항해 중에는 펠리컨도 잡지 물건도 없고 받음도 보내지 않는다', async () => {
    const a = await render(<SeaVoyageHost e={env({ magazineToday: { issue, receipt: null } })} />);
    expect(a.queryByTestId('sea-magazine-delivery')).toBeNull();
    expect(putReceipt).not.toHaveBeenCalled();
    await a.unmount();
    const b = await render(
      <SeaVoyageHost e={env({ magazineToday: { issue, receipt: receipt() } })} />,
    );
    expect(b.queryByTestId('sea-magazine-object')).toBeNull();
  });

  test('「나중에 읽기」는 나중에(SEA)를 적고 닫는다 — 받은 호는 뗏목 옆 물건(빨간 점)으로 남고 다시 알리지 않는다', async () => {
    const e = drift({ issue, receipt: null });
    const screen = await render(<SeaVoyageHost e={e} />);
    await fireEvent.press(screen.getByTestId('sea-magazine-cutscene'));
    await fireEvent.press(screen.getByLabelText('나중에 읽기'));
    expect(putReceipt).toHaveBeenLastCalledWith('iss-20', { place: 'SEA', deferred: true });
    expect(screen.queryByTestId('sea-magazine-delivery')).toBeNull();
    await screen.rerender(
      <SeaVoyageHost e={{ ...e, magazineToday: { issue, receipt: receipt() } }} />,
    );
    expect(screen.queryByTestId('sea-magazine-delivery')).toBeNull();
    expect(screen.getByLabelText('고양이 잡지 20호, 아직 안 읽음')).toBeTruthy();
    expect(screen.getByTestId('sea-magazine-object-dot')).toBeTruthy();
    expect(putReceipt).toHaveBeenCalledTimes(2);
  });

  test('안드로이드 뒤로가기도 「나중에 읽기」와 같다', async () => {
    const add = jest.spyOn(BackHandler, 'addEventListener');
    const screen = await render(<SeaVoyageHost e={drift({ issue, receipt: null })} />);
    const handler = add.mock.calls.at(-1)?.[1] as () => boolean;
    let handled = false;
    await act(async () => {
      handled = handler();
    });
    expect(handled).toBe(true);
    expect(putReceipt).toHaveBeenLastCalledWith('iss-20', { place: 'SEA', deferred: true });
    expect(screen.queryByTestId('sea-magazine-delivery')).toBeNull();
  });

  test('App 의 뒤로가기(backOverride)가 먼저 불려도 떠 있는 펠리컨은 「나중에 읽기」로 닫는다', async () => {
    const e = drift({ issue, receipt: null });
    const screen = await render(<SeaVoyageHost e={e} />);
    let handled = false;
    await act(async () => {
      handled = e.backOverride.current!();
    });
    expect(handled).toBe(true);
    expect(putReceipt).toHaveBeenLastCalledWith('iss-20', { place: 'SEA', deferred: true });
    expect(screen.queryByTestId('sea-magazine-delivery')).toBeNull();
    // 닫힌 뒤에는 평소 표류 뒤로가기(App 기본)
    expect(e.backOverride.current!()).toBe(false);
  });

  test('[잡지 펼치기]는 오늘 호로 바다 잡지(seaMagazine)를 연다', async () => {
    const e = drift({ issue, receipt: null });
    const screen = await render(<SeaVoyageHost e={e} />);
    await fireEvent.press(screen.getByTestId('sea-magazine-cutscene'));
    await fireEvent.press(screen.getByLabelText('잡지 펼치기'));
    expect(e.go).toHaveBeenCalledWith('seaMagazine', 'iss-20');
  });

  test('섬에서 이미 받은 호는 펠리컨 없이 물건만 — 읽었으면 점이 없고, 누르면 그 호를 바다 잡지로 편다', async () => {
    const e = drift({
      issue,
      receipt: receipt({ place: 'ISLAND', openedAt: '2026-10-20T02:00:00Z' }),
    });
    const screen = await render(<SeaVoyageHost e={e} />);
    expect(screen.queryByTestId('sea-magazine-delivery')).toBeNull();
    expect(putReceipt).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sea-magazine-object-dot')).toBeNull();
    await fireEvent.press(screen.getByLabelText('고양이 잡지 20호'));
    expect(e.go).toHaveBeenCalledWith('seaMagazine', 'iss-20');
  });

  test('다른 창(유저 카드)이 열려 있으면 받음을 적지 않고 기다렸다가, 닫힌 뒤 펠리컨을 띄우며 받음을 한 번 적는다', async () => {
    const e = drift(null);
    const screen = await render(<SeaVoyageHost e={e} />);
    await fireEvent.press(screen.getByLabelText('내 뗏목'));
    await screen.rerender(<SeaVoyageHost e={{ ...e, magazineToday: { issue, receipt: null } }} />);
    expect(screen.queryByTestId('sea-magazine-delivery')).toBeNull();
    expect(putReceipt).not.toHaveBeenCalled();
    // 아직 뜨지 않았다 — 뒤로가기는 펠리컨을 건드리지 않는다
    expect(e.backOverride.current!()).toBe(false);
    await fireEvent.press(screen.getByLabelText('닫기'));
    expect(screen.getByTestId('sea-magazine-delivery')).toBeTruthy();
    expect(putReceipt).toHaveBeenCalledTimes(1);
    expect(putReceipt).toHaveBeenCalledWith('iss-20', { place: 'SEA' });
  });

  test('펠리컨이 떠 있는 채 07:01 재조회로 호가 바뀌면 새 호로 다시 떠서 받음(SEA)과 알림을 새 호에 한 번 더 남긴다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const e = drift({ issue, receipt: null });
    const screen = await render(<SeaVoyageHost e={e} />);
    expect(putReceipt).toHaveBeenCalledTimes(1);
    const next = { ...issue, issueId: 'iss-21', issueNo: 21, issueDate: '2026-10-21' };
    await screen.rerender(
      <SeaVoyageHost e={{ ...e, magazineToday: { issue: next, receipt: null } }} />,
    );
    expect(screen.getByTestId('sea-magazine-delivery')).toBeTruthy();
    expect(putReceipt).toHaveBeenCalledTimes(2);
    expect(putReceipt).toHaveBeenLastCalledWith('iss-21', { place: 'SEA' });
    expect(announce).toHaveBeenCalledTimes(2);
  });

  test('펠리컨이 뜬 뒤 다른 기기에서 항해를 시작했다 끝내 다시 표류가 돼도 같은 호의 펠리컨은 다시 뜨지 않는다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const e = drift({ issue, receipt: null });
    const screen = await render(<SeaVoyageHost e={e} />);
    expect(screen.getByTestId('sea-magazine-delivery')).toBeTruthy();
    await screen.rerender(
      <SeaVoyageHost e={{ ...e, state: { ...e.state, session: seaSession() } }} />,
    );
    expect(screen.queryByTestId('sea-magazine-delivery')).toBeNull();
    await screen.rerender(<SeaVoyageHost e={e} />);
    expect(screen.queryByTestId('sea-magazine-delivery')).toBeNull();
    expect(putReceipt).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  test('항해를 그만두고 멀어지는 연출이 끝나 표류가 되면 그때 펠리컨이 뜬다', async () => {
    const e = env({ magazineToday: { issue, receipt: null } });
    e.focus.finish.mockResolvedValue({ recordId: 'sea-1', arrived: false, activeSeconds: 1700 });
    const screen = await render(<SeaVoyageHost e={e} />);
    await fireEvent.press(screen.getByLabelText('집중 마치기'));
    await fireEvent.press(screen.getByLabelText('집중 마치기'));
    await act(async () => {});
    const ended = { ...e, state: { ...e.state, session: null } };
    await screen.rerender(<SeaVoyageHost e={ended} />);
    // 멀어지는 연출 중에는 아직이다
    expect(screen.getByTestId('abandon-cutscene')).toBeTruthy();
    expect(putReceipt).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('abandon-cutscene'));
    expect(screen.getByTestId('sea-magazine-delivery')).toBeTruthy();
    expect(putReceipt).toHaveBeenCalledTimes(1);
    expect(putReceipt).toHaveBeenCalledWith('iss-20', { place: 'SEA' });
  });

  test('펠리컨 배달은 영상이 끝난 뒤에야 말풍선과 버튼을 보여 준다', async () => {
    const screen = await render(<SeaVoyageHost e={drift({ issue, receipt: null })} />);
    expect(screen.getByTestId('sea-magazine-cutscene')).toBeTruthy();
    expect(screen.queryByTestId('sea-magazine-open')).toBeNull();
    await fireEvent.press(screen.getByTestId('sea-magazine-cutscene'));
    expect(screen.queryByTestId('sea-magazine-cutscene')).toBeNull();
    expect(screen.getByTestId('sea-magazine-open')).toBeTruthy();
  });

  test('지난 호뿐이면(오늘 호 발행 전) 펠리컨·물건 모두 없다', async () => {
    const screen = await render(
      <SeaVoyageHost e={drift({ issue: { ...issue, current: false }, receipt: null })} />,
    );
    expect(screen.queryByTestId('sea-magazine-delivery')).toBeNull();
    expect(screen.queryByTestId('sea-magazine-object')).toBeNull();
    expect(putReceipt).not.toHaveBeenCalled();
  });
});

// 한마디 잠금은 모듈에 남으므로 이 파일의 마지막 테스트로 둔다
test('한마디 저장 응답의 잠금(lockedUntil − changedAt)을 입력창 잠금으로 보이고, 지나면 다시 열린다', async () => {
  const e = env({ state: { name: '나냥', color: 'black', session: null } });
  mockRemark.mockResolvedValueOnce({
    remark: '안녕',
    changedAt: '2026-10-18T00:00:00Z',
    lockedUntil: '2026-10-18T00:05:00Z',
  });
  const screen = await render(<SeaVoyageHost e={e} />);
  await fireEvent.press(screen.getByLabelText('＋ 한마디 쓰기'));
  await fireEvent.changeText(screen.getByLabelText('한마디 쓰기'), '안녕');
  await fireEvent.press(screen.getByLabelText('한마디 띄우기'));
  await act(async () => {});
  await screen.rerender(<SeaVoyageHost e={{ ...e, now: Date.now() }} />);
  await fireEvent.press(screen.getByLabelText('＋ 한마디 쓰기'));
  expect(screen.getByText('5분 뒤에 다시 쓸 수 있어요')).toBeTruthy();
  expect(screen.queryByLabelText('한마디 쓰기')).toBeNull();
  await screen.rerender(<SeaVoyageHost e={{ ...e, now: Date.now() + 301_000 }} />);
  expect(screen.getByLabelText('한마디 쓰기')).toBeTruthy();
});
