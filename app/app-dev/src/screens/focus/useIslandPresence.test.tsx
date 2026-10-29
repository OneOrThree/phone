import { memberLooks, useMemberLooks } from '@/services/memberLooks';
import * as apiClient from '@/services/api/client';
/**
 * useIslandPresence (GROMO-2010) — 섬·계정 변경 때 이전 채널 해제,
 * 포그라운드 복귀 때 재연결+스냅숏 재동기화, retry 가 채널을 새로 연다.
 */
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { clearSession, saveSession } from '@/services/api/session';
import { useIslandPresence } from '@/screens/focus/useIslandPresence';
import { markUserBlocked, markUserUnblocked, replaceBlockedUsers } from '@/services/blockedUsers';
import type {
  GoldenFishEvent,
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
    setEmoteSessionId: jest.fn(),
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
  onGoldenFish?: (event: GoldenFishEvent) => void;
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

test('차단을 풀면 가려졌던 이름을 되돌리려 스냅숏을 다시 읽고, 차단·계정 전환으로는 다시 읽지 않는다 (GROMO-2470 D1)', async () => {
  replaceBlockedUsers([]);
  const resyncs = () =>
    (sessions.at(-1)!.resync as jest.Mock).mock.calls
      .map((call) => String(call[0] ?? 'open'))
      .join(',');
  await mount({ active: true, islandId: 'i1' });
  assert.equal(resyncs(), 'open');
  await act(async () => markUserBlocked('u2'));
  assert.equal(resyncs(), 'open');
  await act(async () => markUserUnblocked('u2'));
  assert.equal(resyncs(), 'open,manual');
  await act(async () => markUserBlocked('u3'));
  // 계정이 바뀌어 차단 목록이 비는 것은 해제가 아니다 — 새 채널의 첫 재동기화만 있다
  await act(async () => {
    await saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'other' });
  });
  assert.equal(sessions.length, 2);
  assert.equal(resyncs(), 'open');
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

test('검증된 황금 물고기 사건을 최신 콜백으로 전달한다', async () => {
  const received: GoldenFishEvent[] = [];
  await mount({
    active: true,
    islandId: 'i1',
    onGoldenFish: (event) => received.push(event),
  });
  const event: GoldenFishEvent = {
    eventId: 'golden-i1-1',
    islandId: 'i1',
    drawnAt: '2026-09-28T00:00:00.000Z',
    reward: 2,
    sharePerMember: 1,
    members: [
      { userId: 'me', sessionId: 's-me' },
      { userId: 'peer', sessionId: 's-peer' },
    ],
  };
  await act(async () => sessions[0].deps.onGoldenFish?.(event));
  assert.deepEqual(received, [event]);
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

test('응원 세션이 바뀌어도 presence 연결을 다시 열지 않는다', async () => {
  const { rerender } = await mount({ active: true, islandId: 'i1', emoteSessionId: 's-me' });
  await rerender({ active: true, islandId: 'i1', emoteSessionId: null });
  assert.equal(sessions.length, 1);
  assert.equal((sessions[0].dispose as jest.Mock).mock.calls.length, 0);
  assert.equal((sessions[0].setEmoteSessionId as jest.Mock).mock.calls.at(-1)?.[0], null);
});

test('섬 전환 직후 이전 주민 목록을 비우고 해제된 채널의 늦은 이벤트를 무시한다', async () => {
  const { result, rerender } = await mount({ active: true, islandId: 'i1' });
  const oldView = { ...READY, clockOffset: 123 };
  await act(async () => sessions[0].deps.onView(oldView));
  assert.equal(result.current.clockOffset, 123);
  await rerender({ active: true, islandId: 'i2' });
  assert.equal(result.current.clockOffset, 0);
  await act(async () => sessions[0].deps.onView(oldView));
  assert.equal(result.current.clockOffset, 0);
  assert.equal(sessions[0].deps.alive?.(), false);
  await act(async () => sessions[1].deps.onView({ ...READY, clockOffset: 456 }));
  assert.equal(result.current.clockOffset, 456);
});

test('주민 외양 사건은 version 이 큰 것만 looks 에 남고 섬이 바뀌면 비운다 (GROMO-2390)', async () => {
  const { result, rerender } = await mount({ active: true, islandId: 'i1' });
  const look = (head: string | null, version: number) => ({
    head,
    neck: null,
    shoes: null,
    version,
  });
  await act(async () => sessions[0].deps.onMemberAppearance?.('u2', look('hat-2', 6)));
  await act(async () => sessions[0].deps.onMemberAppearance?.('u2', look('hat-1', 5)));
  assert.equal(result.current.looks.u2.head, 'hat-2');
  await act(async () => sessions[0].deps.onMemberAppearance?.('u2', look(null, 7)));
  assert.equal(result.current.looks.u2.head, null);
  await act(async () => rerender({ active: true, islandId: 'i2' }));
  assert.deepEqual(result.current.looks, {});
});

test('주민 외양은 묶음 조회로 채우고 변경 이벤트 뒤에는 다시 조회하지 않는다', async () => {
  const userId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const request = jest.spyOn(apiClient, 'request').mockResolvedValue({
    members: [{ userId, catColor: 'black', appearance: { head: 'duck', neck: null, version: 1 } }],
    hiddenUserIds: [],
  });
  const { result, unmount } = await mount({ active: true, islandId: 'i1' });
  await act(async () => {
    sessions[0].deps.onView({
      ...READY,
      rest: [
        {
          userId,
          name: '주민',
          anchorMs: Date.now(),
          catColor: null,
          restSeat: null,
          restStartedAt: null,
        },
      ],
    });
  });
  expect(result.current.rest[0].catColor).toBe('black');
  expect(result.current.rest[0].appearance).toMatchObject({ head: 'duck', version: 1 });
  await act(async () => {
    sessions[0].deps.onMemberAppearance?.(userId, {
      head: 'new',
      neck: null,
      shoes: null,
      version: 2,
    });
  });
  expect(result.current.rest[0].appearance).toMatchObject({ head: 'new', version: 2 });
  expect(request).toHaveBeenCalledTimes(1);
  await unmount();
  request.mockRestore();
});

test('섬의 최신 스냅샷을 캐시에 병합하고 늦은 스냅샷으로 되돌리지 않는다', async () => {
  const userId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const request = jest.spyOn(apiClient, 'request').mockResolvedValue({
    members: [{ userId, catColor: 'black', appearance: { head: 'old', version: 1 } }],
    hiddenUserIds: [],
  });
  await memberLooks.ensure([userId]);
  const { result, unmount } = await mount({ active: true, islandId: 'i1' });
  const snapshot = (version: number, head: string | null) => ({
    ...READY,
    rest: [
      {
        userId,
        name: '주민',
        anchorMs: Date.now(),
        catColor: 'black',
        restSeat: null,
        restStartedAt: null,
        appearance: { head, neck: null, shoes: null, version },
      },
    ],
  });
  await act(async () => sessions[0].deps.onView(snapshot(4, 'new')));
  expect(result.current.rest[0].appearance).toMatchObject({ head: 'new', version: 4 });
  expect(memberLooks.get(userId)?.appearance?.version).toBe(4);
  await act(async () => sessions[0].deps.onView(snapshot(2, 'stale')));
  expect(result.current.rest[0].appearance).toMatchObject({ head: 'new', version: 4 });
  expect(request).toHaveBeenCalledTimes(1);
  await unmount();
  request.mockRestore();
});

test('첫 마운트와 같은 차단 목록 재조회는 기존 외양 캐시를 재사용한다', async () => {
  const userId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  replaceBlockedUsers([]);
  const request = jest.spyOn(apiClient, 'request').mockResolvedValue({
    members: [{ userId, catColor: 'black', appearance: { head: 'hat', version: 1 } }],
    hiddenUserIds: [],
  });
  await memberLooks.ensure([userId]);
  const { result, unmount } = await renderHook(() => useMemberLooks([userId]));
  await act(async () => replaceBlockedUsers([]));
  expect(result.current[userId]?.appearance?.head).toBe('hat');
  expect(request).toHaveBeenCalledTimes(1);
  await unmount();
  request.mockRestore();
});
