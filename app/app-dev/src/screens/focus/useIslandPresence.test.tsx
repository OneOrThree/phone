/**
 * useIslandPresence (GROMO-2010) — 섬·계정 변경 때 이전 채널 해제,
 * 포그라운드 복귀 때 재연결+스냅숏 재동기화, retry 가 채널을 새로 연다.
 */
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { clearSession, saveSession } from '@/services/api/session';
import { useIslandPresence } from '@/screens/focus/useIslandPresence';
import type {
  IslandPresenceTransition,
  IslandRealtime,
  IslandRealtimeDeps,
  PresenceView,
} from '@/services/islandRealtime';

type Fake = IslandRealtime & { deps: IslandRealtimeDeps };
const sessions: Fake[] = [];

const start = (deps: IslandRealtimeDeps): IslandRealtime => {
  const s: Fake = {
    deps,
    resync: jest.fn(),
    reopen: jest.fn(),
    sendEmote: jest.fn(() => true),
    dispose: jest.fn(),
  };
  sessions.push(s);
  return s;
};

const READY: PresenceView = {
  status: 'ready',
  error: null,
  focus: [],
  rest: [],
  emotes: [],
  clockOffset: 0,
};

let appListener: ((state: string) => void) | null = null;

beforeEach(async () => {
  sessions.length = 0;
  appListener = null;
  (AppState as any).addEventListener = jest.fn((_t: string, cb: (state: string) => void) => {
    appListener = cb;
    return { remove: jest.fn() };
  });
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

type Props = {
  active: boolean;
  islandId: string | null;
  emoteSessionId?: string | null;
  onTransition?: (transition: IslandPresenceTransition) => void;
};
const mount = (p: Props) =>
  renderHook((q: Props) => useIslandPresence(q, start), { initialProps: p });

test('비활성이면 채널을 열지 않는다', async () => {
  await mount({ active: false, islandId: 'i1' });
  assert.equal(sessions.length, 0);
});

test('활성이면 채널을 열고 스냅숏 재동기화를 부른다', async () => {
  const { result } = await mount({ active: true, islandId: 'i1' });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].deps.islandId, 'i1');
  assert.equal((sessions[0].resync as jest.Mock).mock.calls.length, 1);
  await act(async () => sessions[0].deps.onView(READY));
  assert.equal(result.current.status, 'ready');
});

test('섬이 바뀌면 이전 채널을 해제하고 새 채널을 연다', async () => {
  const { rerender } = await mount({ active: true, islandId: 'i1' });
  await rerender({ active: true, islandId: 'i2' });
  assert.equal(sessions.length, 2);
  assert.equal((sessions[0].dispose as jest.Mock).mock.calls.length, 1);
  assert.equal(sessions[1].deps.islandId, 'i2');
});

test('계정(세션 세대)이 바뀌면 이전 채널을 해제하고 새로 연다', async () => {
  const { rerender } = await mount({ active: true, islandId: 'i1' });
  await act(async () => {
    await saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'other' });
  });
  await rerender({ active: true, islandId: 'i1' });
  assert.equal(sessions.length, 2);
  assert.equal((sessions[0].dispose as jest.Mock).mock.calls.length, 1);
});

test('포그라운드 복귀는 reconnect 출처로 스냅숏을 재동기화한다', async () => {
  await mount({ active: true, islandId: 'i1' });
  await act(async () => appListener?.('active'));
  assert.equal((sessions[0].reopen as jest.Mock).mock.calls.length, 1);
  assert.equal((sessions[0].resync as jest.Mock).mock.calls.length, 2);
  assert.equal((sessions[0].resync as jest.Mock).mock.calls[1][0], 'reconnect');
});

test('검증된 전이를 최신 콜백으로 전달한다', async () => {
  const received: IslandPresenceTransition[] = [];
  await mount({
    active: true,
    islandId: 'i1',
    onTransition: (transition) => received.push(transition),
  });
  const transition: IslandPresenceTransition = {
    source: 'event',
    kind: 'focus',
    userId: 'u1',
    previous: null,
    current: {
      userId: 'u1',
      name: '이름-u1',
      catColor: 'ginger',
      appearance: null,
      sessionId: 's-u1',
      subject: '영어',
      activeSeconds: 1,
      status: 'active',
      anchorMs: Date.now(),
    },
  };
  await act(async () => sessions[0].deps.onTransition?.(transition));
  assert.deepEqual(received, [transition]);
});

test('언마운트는 채널을 해제하고, retry 는 채널을 새로 연다', async () => {
  const { result, unmount } = await mount({ active: true, islandId: 'i1' });
  await act(async () => result.current.retry());
  assert.equal(sessions.length, 2);
  assert.equal((sessions[0].dispose as jest.Mock).mock.calls.length, 1);
  await act(async () => unmount());
  assert.equal((sessions[1].dispose as jest.Mock).mock.calls.length, 1);
});

test('sendEmote 는 열린 채널로 위임한다', async () => {
  const { result } = await mount({ active: true, islandId: 'i1', emoteSessionId: 's-me' });
  assert.equal(sessions[0].deps.emoteSessionId, 's-me');
  assert.equal(result.current.sendEmote('cheer'), true);
  assert.equal((sessions[0].sendEmote as jest.Mock).mock.calls[0][0], 'cheer');
});
