import assert from 'node:assert/strict';
import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { getBlockedUsers } from '@/services/api/safety';
import { clearSession, saveSession } from '@/services/api/session';
import { getMailboxScreen, listIslandMessages, sendIslandMessage } from '@/services/api/letters';
import { useIslandChat } from '@/screens/island/useIslandChat';
import { markUserBlocked, replaceBlockedUsers } from '@/services/blockedUsers';

jest.mock('@/services/api/letters', () => ({
  ...jest.requireActual('@/services/api/letters'),
  getMailboxScreen: jest.fn(),
  listIslandMessages: jest.fn(),
  sendIslandMessage: jest.fn(),
}));
jest.mock('@/services/api/safety', () => ({
  ...jest.requireActual('@/services/api/safety'),
  getBlockedUsers: jest.fn(),
}));

const ISLAND = 'island-1';
const screenMock = getMailboxScreen as jest.Mock;
const listMessagesMock = listIslandMessages as jest.Mock;
const sendMessageMock = sendIslandMessage as jest.Mock;
const blockedUsersMock = getBlockedUsers as jest.Mock;

const msg = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  clientMessageId: id,
  userId: 'u2',
  name: '민지',
  text: id,
  createdAt: `2026-09-20T10:00:0${id.slice(1)}Z`,
  ...over,
});

let onAppState: (next: string) => void;
let subscription: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  AppState.currentState = 'active';
  subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    onAppState = handler as (next: string) => void;
    return { remove: jest.fn() };
  });
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  replaceBlockedUsers([]);
  blockedUsersMock.mockResolvedValue([]);
  listMessagesMock.mockReset().mockResolvedValue({ items: [msg('m1')], nextCursor: null });
});

afterEach(() => {
  subscription.mockRestore();
  jest.useRealTimers();
});

type Props = { islandId: string | null; active: boolean };
const open = async (props: Partial<Props> = {}) => {
  const hook = await renderHook((p: Props) => useIslandChat(p), {
    initialProps: { islandId: ISLAND, active: true, ...props },
  });
  await act(async () => {});
  return hook;
};

test('첫 목록부터 GET messages 로 읽고 우체통 묶음은 부르지 않는다', async () => {
  listMessagesMock.mockResolvedValue({ items: [msg('m0'), msg('m1')], nextCursor: 'older' });
  const hook = await open();
  expect(listMessagesMock.mock.calls).toEqual([[ISLAND]]);
  assert.equal(screenMock.mock.calls.length, 0);
  expect(hook.result.current.messages.map((m) => m.id)).toEqual(['m0', 'm1']);
  assert.equal(hook.result.current.messagesCursor, 'older');
  assert.equal(hook.result.current.loading, false);
  assert.equal(hook.result.current.myId, 'u1');
  await hook.unmount();
});

test('섬이 없거나 꺼져 있으면 API 를 하나도 부르지 않는다', async () => {
  const none = await open({ islandId: null });
  const off = await open({ active: false });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30_000);
  });
  assert.equal(listMessagesMock.mock.calls.length, 0);
  assert.equal(blockedUsersMock.mock.calls.length, 0);
  await none.unmount();
  await off.unmount();
});

test('진입·10초 주기·복귀에 갱신하고 꺼짐·백그라운드에서는 멈춘다 — 꺼져도 읽은 글은 남는다', async () => {
  const hook = await open();
  assert.equal(listMessagesMock.mock.calls.length, 1);
  listMessagesMock.mockResolvedValue({ items: [msg('m1'), msg('m2')], nextCursor: null });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  expect(hook.result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  await act(async () => {
    onAppState('background');
    await jest.advanceTimersByTimeAsync(30_000);
  });
  assert.equal(listMessagesMock.mock.calls.length, 2);
  await act(async () => {
    onAppState('active');
  });
  assert.equal(listMessagesMock.mock.calls.length, 3);
  await hook.rerender({ islandId: ISLAND, active: false });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30_000);
  });
  assert.equal(listMessagesMock.mock.calls.length, 3);
  await hook.rerender({ islandId: ISLAND, active: true });
  assert.equal(listMessagesMock.mock.calls.length, 4);
  expect(hook.result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  await hook.unmount();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30_000);
  });
  assert.equal(listMessagesMock.mock.calls.length, 4);
});

test('내 발송이 있어도 마지막 조회 지점까지 읽고 과거 이력을 보존한다', async () => {
  listMessagesMock.mockResolvedValueOnce({ items: [msg('m0'), msg('m1')], nextCursor: 'older' });
  const hook = await open();
  sendMessageMock.mockResolvedValue(msg('m5'));
  await act(async () => {
    await hook.result.current.sendMessage('내 새 글');
  });
  listMessagesMock
    .mockResolvedValueOnce({ items: [msg('m4'), msg('m5')], nextCursor: 'gap' })
    .mockResolvedValueOnce({ items: [msg('m1'), msg('m2'), msg('m3')], nextCursor: 'older' });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  expect(hook.result.current.messages.map((m) => m.id)).toEqual([
    'm0',
    'm1',
    'm2',
    'm3',
    'm4',
    'm5',
  ]);
  assert.equal(hook.result.current.messagesCursor, 'older');
  expect(listMessagesMock.mock.calls.at(-1)).toEqual([ISLAND, 'gap']);
  await hook.unmount();
});

test('네트워크 실패는 이력을 보존하고 다음 갱신으로 복구한다', async () => {
  const hook = await open();
  listMessagesMock.mockRejectedValueOnce(new ApiError('NETWORK', '연결 오류', 0));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  assert.equal(hook.result.current.messages.length, 1);
  assert.equal(hook.result.current.error?.code, 'NETWORK');
  listMessagesMock.mockResolvedValue({ items: [msg('m1'), msg('m2')], nextCursor: null });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  assert.equal(hook.result.current.messages.length, 2);
  assert.equal(hook.result.current.error, null);
  await hook.unmount();
});

test('첫 목록이 실패하면 로딩을 끝내고 오류를 보인다', async () => {
  listMessagesMock.mockRejectedValueOnce(new ApiError('NETWORK', '연결 오류', 0));
  const hook = await open();
  assert.equal(hook.result.current.loading, false);
  assert.equal(hook.result.current.error?.code, 'NETWORK');
  await hook.unmount();
});

test('진행 중 요청은 중복하지 않고 꺼진 뒤 도착한 응답은 버린다', async () => {
  const hook = await open();
  let resolve!: (value: any) => void;
  listMessagesMock.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30_000);
  });
  assert.equal(listMessagesMock.mock.calls.length, 2);
  await hook.rerender({ islandId: ISLAND, active: false });
  await act(async () => {
    resolve({ items: [msg('m1'), msg('m2')], nextCursor: null });
  });
  assert.equal(hook.result.current.messages.length, 1);
  await hook.unmount();
});

test('계정이 바뀐 뒤 도착한 응답은 버린다', async () => {
  const hook = await open();
  let resolve!: (value: any) => void;
  listMessagesMock.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  await act(async () => {
    await clearSession();
    resolve({ items: [msg('m2')], nextCursor: null });
  });
  assert.ok(!hook.result.current.messages.some((m) => m.id === 'm2'));
  await hook.unmount();
});

test('섬이 바뀌면 옛 글을 지우고 새 섬을 처음부터 읽는다', async () => {
  const hook = await open();
  assert.equal(hook.result.current.messages.length, 1);
  listMessagesMock.mockResolvedValue({ items: [msg('m7')], nextCursor: null });
  await hook.rerender({ islandId: 'island-2', active: true });
  await act(async () => {});
  expect(listMessagesMock.mock.calls.at(-1)).toEqual(['island-2']);
  expect(hook.result.current.messages.map((m) => m.id)).toEqual(['m7']);
  await hook.unmount();
});

test('권한 상실은 글을 비우고 자동 재요청을 멈추며, 다시 시도만 다시 읽는다', async () => {
  const hook = await open();
  listMessagesMock.mockRejectedValueOnce(new ApiError('FORBIDDEN', '접근 불가', 403));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  assert.equal(hook.result.current.messages.length, 0);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30_000);
  });
  assert.equal(listMessagesMock.mock.calls.length, 2);
  await act(async () => {
    await hook.result.current.retry();
  });
  assert.equal(listMessagesMock.mock.calls.length, 3);
  assert.equal(hook.result.current.messages.length, 1);
  await hook.unmount();
});

test('보내기 — 실패 뒤 같은 본문 재시도는 같은 clientMessageId 로 간다', async () => {
  const hook = await open();
  sendMessageMock
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0))
    .mockResolvedValueOnce(msg('m9', { clientMessageId: 'key', userId: 'u1', text: '같이 해요' }));

  await act(async () => {
    await hook.result.current.sendMessage('같이 해요').catch(() => {});
  });
  assert.equal(hook.result.current.messages.length, 1); // 실패 글을 목록에 합성하지 않는다

  await act(async () => {
    await hook.result.current.sendMessage('같이 해요');
  });
  const firstKey = sendMessageMock.mock.calls[0][1].clientMessageId;
  const retryKey = sendMessageMock.mock.calls[1][1].clientMessageId;
  assert.equal(firstKey, retryKey);
  assert.equal(sendMessageMock.mock.calls[0][0], ISLAND);
  expect(hook.result.current.messages.map((m) => m.id)).toEqual(['m1', 'm9']);
  await hook.unmount();
});

test('이전 글 더 보기 — 다음 커서의 더 오래된 글을 앞에 붙인다', async () => {
  listMessagesMock.mockResolvedValueOnce({ items: [msg('m1')], nextCursor: 'old-1' });
  const hook = await open();
  listMessagesMock.mockResolvedValueOnce({
    items: [msg('m0', { userId: 'u3', name: '보리', createdAt: '2026-09-19T10:00:00Z' })],
    nextCursor: null,
  });

  await act(async () => {
    await hook.result.current.loadMoreMessages();
  });

  expect(listMessagesMock.mock.calls.at(-1)).toEqual([ISLAND, 'old-1']);
  expect(hook.result.current.messages.map((m) => m.id)).toEqual(['m0', 'm1']);
  assert.equal(hook.result.current.messagesCursor, null);
  await hook.unmount();
});

test('차단한 사람의 글은 서버 재조회 없이 바로 숨긴다', async () => {
  listMessagesMock.mockResolvedValue({
    items: [msg('m1'), msg('m2', { userId: 'u3' })],
    nextCursor: null,
  });
  const hook = await open();
  assert.equal(hook.result.current.messages.length, 2);
  const calls = listMessagesMock.mock.calls.length;

  await act(async () => markUserBlocked('u2'));

  expect(hook.result.current.messages.map((m) => m.id)).toEqual(['m2']);
  assert.equal(listMessagesMock.mock.calls.length, calls);
  await hook.unmount();
});

test('차단 목록을 읽지 못하면 글을 숨기고(fail-closed) 오류를 보인다', async () => {
  await saveSession({ accessToken: 'AT-2', refreshToken: 'RT-2', userId: 'u1' });
  blockedUsersMock.mockRejectedValue(new Error('blocks unavailable'));
  const hook = await open();
  assert.deepEqual(hook.result.current.messages, []);
  assert.equal(hook.result.current.error?.code, 'BLOCKED_USERS_UNAVAILABLE');
  // 차단 목록 실패는 로딩을 끝내 오류·재시도가 보여야 한다(로딩에 머물지 않는다)
  assert.equal(hook.result.current.loading, false);
  assert.equal(listMessagesMock.mock.calls.length, 0);
  await hook.unmount();
});
