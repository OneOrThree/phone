// 바다 항해 호스트(GROMO-2310) — 세션 정본 → SeaScreen 어댑터: 남은 분 → 정박 문구, 그만두기 확인 1회 → 멀어지는 연출 → 표류,
// 내리기 → seaArrival 라우트 인자, 한마디 잠금·게스트. 바다 방 STOMP·연출·API 는 목이다.
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { ApiError } from '@/services/api/client';
import { updateSeaRemark } from '@/services/api/focusSessions';
import { getMyInventory } from '@/services/api/shop';
import { arriveAtIsland, getTelescope } from '@/services/api/telescope';
import { SeaVoyageHost } from './SeaVoyageHost';

jest.mock('@/components/CatSprite', () => ({ CatSprite: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  getSession: () => ({ userId: 'me' }),
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
jest.mock('@/services/api/shop', () => ({
  ...jest.requireActual('@/services/api/shop'),
  getMyInventory: jest.fn(async () => ({ clothes: [], decor: [], hulls: [], equipped: {} })),
}));
const mockRoom = { sendEmote: jest.fn(() => true), close: jest.fn(), reconnect: jest.fn() };
let mockRoomOpts: any;
jest.mock('@/services/seaRealtime', () => ({
  ...jest.requireActual('@/services/seaRealtime'),
  openSeaRoom: (opts: any) => {
    mockRoomOpts = opts;
    return mockRoom;
  },
}));
jest.mock('@/screens/world/WorldViews', () => ({
  Sailing: ({ destination, from, onArrive }: any) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID="sailing" onPress={onArrive}>
        <Text testID="sailing-from">{from}</Text>
        <Text>{destination}</Text>
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
  expect(screen.getByTestId('sailing-from').props.children).toBe('별고래섬');
  // 연출 중 뒤로가기는 삼킨다
  expect(e.backOverride.current?.()).toBe(true);
  // 실제 앱에서는 finish 가 세션을 닫는다
  const ended = { ...e, state: { ...e.state, session: null } };
  await screen.rerender(<SeaVoyageHost e={ended} />);
  await fireEvent.press(screen.getByTestId('sailing'));
  await fireEvent.press(screen.getByLabelText('망원경'));
  expect(e.go).toHaveBeenCalledWith('telescope');
  expect(e.replace).not.toHaveBeenCalled();
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
  e.conversion.offer.mockReturnValueOnce(true);
  mockRemark.mockRejectedValueOnce(new ApiError('SOCIAL_LOGIN_REQUIRED', '로그인', 403));
  await write('공부 중');
  expect(e.conversion.offer).toHaveBeenCalledTimes(2);
  mockRemark.mockResolvedValueOnce({ remark: '공부 중' });
  await write('공부 중');
  expect(mockRemark).toHaveBeenLastCalledWith('공부 중');
  expect(screen.getByText('공부 중')).toBeTruthy();
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
