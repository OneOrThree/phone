import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { clearSession, saveSession, sessionGeneration } from '@/services/api/session';
import {
  createNotice as postNotice,
  createNoticeComment as postComment,
  deleteNotice as delNotice,
  getBoard,
  getNotice,
  listNotices,
  updateNotice as patchNotice,
} from '@/services/api/notices';
import {
  CLIENT_INACTIVE,
  CLIENT_WRITE_IN_PROGRESS,
  useBoardNotices,
} from '@/screens/interiors/useBoardNotices';
import {
  claimQuest as postClaim,
  createQuest as postQuest,
  getQuestProgress,
  updateQuest as patchQuest,
} from '@/services/api/quests';

jest.mock('@/services/api/notices', () => ({
  getBoard: jest.fn(),
  listNotices: jest.fn(),
  getNotice: jest.fn(),
  createNotice: jest.fn(),
  updateNotice: jest.fn(),
  deleteNotice: jest.fn(),
  createNoticeComment: jest.fn(),
}));
jest.mock('@/services/api/quests', () => ({
  getCurrentQuests: jest.fn(),
  getQuestProgress: jest.fn(),
  createQuest: jest.fn(),
  updateQuest: jest.fn(),
  claimQuest: jest.fn(),
}));

const board = (
  items: { id: string; title: string }[],
  nextCursor: string | null = null,
  role: 'host' | 'member' = 'host',
  quests: Record<string, unknown>[] = [],
) => ({
  island: { id: 'island-1', role },
  quests: { items: quests },
  notices: { items: items.map((i) => ({ ...i, commentCount: 0 })), nextCursor },
  wallets: { fish: 0, villagePoints: 50, fishVersion: null, villagePointsVersion: 1 },
});

const questItem = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  occurrenceId: 'occ-1',
  title: '저녁 집중',
  type: 'focus',
  windowStart: '19:00',
  windowEnd: '22:00',
  timezone: 'UTC',
  date: '2026-09-21',
  targetMinutes: 50,
  myRate: 64,
  reward: { currency: 'village_points', amount: 10 },
  settlementStatus: 'open',
  claimable: true,
  claimBlockedReason: null,
  claimed: false,
  bonusAmount: 20,
  bonusGranted: false,
  version: 3,
  ...over,
});

const questProgress = (over: Record<string, unknown> = {}) => ({
  ...questItem(),
  members: [
    {
      userId: 'u1',
      name: '나',
      rate: 100,
      measurementStatus: 'measured',
      achieved: true,
      claimed: false,
    },
  ],
  nextCursor: null,
  ...over,
});

const detail = (
  id: string,
  comments: { id: string }[],
  nextCommentsCursor: string | null = null,
) => ({
  id,
  title: '공지',
  body: '본문',
  version: 1,
  comments: comments.map((c) => ({
    ...c,
    userId: 'u',
    name: 'n',
    text: 't',
    createdAt: '2026-09-21T00:00:00Z',
  })),
  nextCommentsCursor,
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const getBoardMock = getBoard as jest.Mock;
const listNoticesMock = listNotices as jest.Mock;
const getNoticeMock = getNotice as jest.Mock;
const postNoticeMock = postNotice as jest.Mock;
const patchNoticeMock = patchNotice as jest.Mock;
const delNoticeMock = delNotice as jest.Mock;
const postCommentMock = postComment as jest.Mock;
const getQuestProgressMock = getQuestProgress as jest.Mock;
const postQuestMock = postQuest as jest.Mock;
const patchQuestMock = patchQuest as jest.Mock;
const postClaimMock = postClaim as jest.Mock;

/** 로드가 끝난 활성 훅 — 쓰기 테스트의 공통 출발점. */
const mountActive = async () => {
  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: 'a' }]));
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));
  getBoardMock.mockClear();
  return hook;
};

/** 거절을 던지지 않고 값으로 돌려준다 — assert.rejects 와 act 를 섞지 않기 위한 헬퍼. */
const settle = (p: Promise<unknown>) =>
  p.then(
    (v) => ({ ok: v }),
    (e: unknown) => ({ err: e }),
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('성공적으로 조회한 페이지의 범위만 onLoaded에 전달한다', async () => {
  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: '첫 공지' }], 'next'));
  listNoticesMock.mockResolvedValue({
    items: [{ id: 'n2', title: '다음 공지', commentCount: 2 }],
    nextCursor: null,
  });
  const onLoaded = jest.fn();
  const hook = await renderHook(() => useBoardNotices({ active: true, scopeKey: 'i1', onLoaded }));
  await waitFor(() => assert.equal(onLoaded.mock.calls.length, 1));
  assert.equal(onLoaded.mock.calls[0][0].nextCursor, 'next');
  assert.deepEqual(
    onLoaded.mock.calls[0][0].items.map((item: { id: string }) => item.id),
    ['n1'],
  );
  await act(async () => {
    await hook.result.current.loadMore();
  });
  assert.equal(onLoaded.mock.calls[1][0].nextCursor, null);
  assert.deepEqual(
    onLoaded.mock.calls[1][0].items.map((item: { id: string }) => item.id),
    ['n1', 'n2'],
  );
  await hook.unmount();
});

test('게시판 조회 실패는 onLoaded를 호출하지 않는다', async () => {
  getBoardMock.mockRejectedValue(new Error('offline'));
  const onLoaded = jest.fn();
  const hook = await renderHook(() => useBoardNotices({ active: true, scopeKey: 'i1', onLoaded }));
  await waitFor(() => assert.ok(hook.result.current.error));
  assert.equal(onLoaded.mock.calls.length, 0);
  await hook.unmount();
});

test('계정 전환 후 도착한 게시판 응답은 onLoaded를 호출하지 않는다', async () => {
  const pending = deferred<ReturnType<typeof board>>();
  getBoardMock.mockReturnValue(pending.promise);
  const onLoaded = jest.fn();
  const hook = await renderHook(() => useBoardNotices({ active: true, scopeKey: 'i1', onLoaded }));
  await act(async () => {
    await clearSession();
    pending.resolve(board([{ id: 'n1', title: '옛 계정 공지' }]));
  });
  assert.equal(onLoaded.mock.calls.length, 0);
  await hook.unmount();
});

test('active=false — API 를 하나도 부르지 않고 빈 상태를 유지한다', async () => {
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: false, scopeKey: 's1' },
  });
  await act(async () => {});
  assert.equal(getBoardMock.mock.calls.length, 0);
  assert.equal(listNoticesMock.mock.calls.length, 0);
  assert.equal(getNoticeMock.mock.calls.length, 0);
  assert.deepEqual(hook.result.current.items, []);
  assert.equal(hook.result.current.loading, false);
  await hook.unmount();
});

test('active=true — getBoard 의 island.id·공지 첫 페이지를 그대로 싣는다', async () => {
  getBoardMock.mockResolvedValue(
    board(
      [
        { id: 'n1', title: 'a' },
        { id: 'n2', title: 'b' },
      ],
      'c1',
    ),
  );
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));
  assert.equal(getBoardMock.mock.calls.length, 1);
  assert.equal(hook.result.current.islandId, 'island-1');
  assert.deepEqual(
    hook.result.current.items.map((i) => i.id),
    ['n1', 'n2'],
  );
  assert.equal(hook.result.current.nextCursor, 'c1');
  await hook.unmount();
});

test('loadMore — 다음 페이지를 붙이고 겹친 id 는 중복으로 두지 않는다', async () => {
  getBoardMock.mockResolvedValue(
    board(
      [
        { id: 'n1', title: 'a' },
        { id: 'n2', title: 'b' },
      ],
      'c1',
    ),
  );
  listNoticesMock.mockResolvedValue({
    items: [
      { id: 'n2', title: 'b', commentCount: 0 },
      { id: 'n3', title: 'c', commentCount: 0 },
    ],
    nextCursor: null,
  });
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));

  await act(async () => {
    await hook.result.current.loadMore();
  });
  assert.equal(listNoticesMock.mock.calls.length, 1);
  assert.deepEqual([...listNoticesMock.mock.calls[0]], ['island-1', 'c1']);
  assert.deepEqual(
    hook.result.current.items.map((i) => i.id),
    ['n1', 'n2', 'n3'],
  );
  assert.equal(hook.result.current.nextCursor, null);

  // 커서가 없으면 더 부르지 않는다.
  await act(async () => {
    await hook.result.current.loadMore();
  });
  assert.equal(listNoticesMock.mock.calls.length, 1);
  await hook.unmount();
});

test('실패하면 error 를 싣고 retry 로 다시 읽는다', async () => {
  getBoardMock.mockRejectedValueOnce(new ApiError('FORBIDDEN', '권한이 없습니다.', 403));
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));
  assert.equal((hook.result.current.error as ApiError).code, 'FORBIDDEN');

  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: 'a' }]));
  await act(async () => {
    await hook.result.current.retry();
  });
  assert.equal(hook.result.current.error, null);
  assert.deepEqual(
    hook.result.current.items.map((i) => i.id),
    ['n1'],
  );
  await hook.unmount();
});

test('select — 상세를 싣고 null 로 닫는다(닫기는 API 를 부르지 않는다)', async () => {
  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: 'a' }]));
  getNoticeMock.mockResolvedValue(detail('n1', [{ id: 'c1' }]));
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));

  await act(async () => {
    await hook.result.current.select('n1');
  });
  assert.deepEqual([...getNoticeMock.mock.calls[0]], ['island-1', 'n1']);
  assert.equal(hook.result.current.detail?.id, 'n1');
  assert.equal(hook.result.current.detail?.comments.length, 1);

  await act(async () => {
    await hook.result.current.select(null);
  });
  assert.equal(hook.result.current.detail, null);
  assert.equal(getNoticeMock.mock.calls.length, 1);
  await hook.unmount();
});

test('연속 select — 마지막으로 고른 공지만 detail 로 남는다', async () => {
  getBoardMock.mockResolvedValue(
    board([
      { id: 'n1', title: 'a' },
      { id: 'n2', title: 'b' },
    ]),
  );
  const slow = deferred<ReturnType<typeof detail>>();
  getNoticeMock.mockImplementation((_: string, id: string) =>
    id === 'n1' ? slow.promise : Promise.resolve(detail('n2', [])),
  );
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));

  let first: Promise<void>;
  await act(async () => {
    first = hook.result.current.select('n1');
    await hook.result.current.select('n2');
  });
  assert.equal(hook.result.current.detail?.id, 'n2');
  // n1 의 늦은 응답은 버린다.
  await act(async () => {
    slow.resolve(detail('n1', []));
    await first;
  });
  assert.equal(hook.result.current.detail?.id, 'n2');
  await hook.unmount();
});

test('loadMoreComments — 다음 댓글 페이지를 붙이고 겹친 id 는 중복으로 두지 않는다', async () => {
  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: 'a' }]));
  getNoticeMock
    .mockResolvedValueOnce(detail('n1', [{ id: 'c1' }, { id: 'c2' }], 'cc1'))
    .mockResolvedValueOnce(detail('n1', [{ id: 'c2' }, { id: 'c3' }], null));
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));
  await act(async () => {
    await hook.result.current.select('n1');
  });

  await act(async () => {
    await hook.result.current.loadMoreComments();
  });
  assert.deepEqual([...getNoticeMock.mock.calls[1]], ['island-1', 'n1', 'cc1']);
  assert.deepEqual(
    hook.result.current.detail?.comments.map((c) => c.id),
    ['c1', 'c2', 'c3'],
  );
  await hook.unmount();
});

test('scopeKey 가 바뀌면 옛 데이터를 지우고 첫 페이지부터 다시 읽는다', async () => {
  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: 'a' }]));
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.items.length, 1));

  getBoardMock.mockResolvedValue(board([{ id: 'n9', title: 'x' }]));
  await hook.rerender({ active: true, scopeKey: 's2' });
  await waitFor(() => assert.equal(hook.result.current.items.length, 1));
  assert.equal(getBoardMock.mock.calls.length, 2);
  assert.deepEqual(
    hook.result.current.items.map((i) => i.id),
    ['n9'],
  );
  await hook.unmount();
});

test('세션 세대가 바뀌면 옛 계정 데이터를 지우고 다시 읽는다', async () => {
  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: 'a' }]));
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.items.length, 1));
  const before = sessionGeneration();

  getBoardMock.mockResolvedValue(board([{ id: 'n2', title: 'b' }]));
  await act(async () => {
    await saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'u2' });
  });
  assert.equal(sessionGeneration(), before + 1);
  await hook.rerender({ active: true, scopeKey: 's1' });
  await waitFor(() => assert.equal(hook.result.current.items.length, 1));
  assert.deepEqual(
    hook.result.current.items.map((i) => i.id),
    ['n2'],
  );
  await hook.unmount();
});

test('범위가 바뀐 뒤 도착한 옛 scope 응답은 버린다', async () => {
  const slow = deferred<ReturnType<typeof board>>();
  getBoardMock.mockReturnValueOnce(slow.promise);
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  getBoardMock.mockResolvedValue(board([{ id: 'n2', title: 'b' }]));
  await hook.rerender({ active: true, scopeKey: 's2' });
  await waitFor(() => assert.equal(hook.result.current.items.length, 1));

  await act(async () => {
    slow.resolve(board([{ id: 'n1', title: 'a' }]));
    await slow.promise;
  });
  assert.deepEqual(
    hook.result.current.items.map((i) => i.id),
    ['n2'],
  );
  await hook.unmount();
});

test('언마운트 뒤 도착한 응답은 상태를 건드리지 않는다', async () => {
  const slow = deferred<ReturnType<typeof board>>();
  getBoardMock.mockReturnValue(slow.promise);
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await hook.unmount();
  await act(async () => {
    slow.resolve(board([{ id: 'n1', title: 'a' }]));
    await slow.promise;
  });
  // 예외 없이 끝나면 된다 — 언마운트된 훅에 setState 는 없다.
});

test('언마운트 뒤 액션 호출은 API 를 부르지 않는다', async () => {
  const hook = await mountActive();
  await hook.unmount();
  await act(async () => {
    await hook.result.current.loadMore();
    await hook.result.current.select('n1');
  });
  // 쓰기는 거절된다 — 호출부 초안을 지우지 않는다.
  const r = await hook.result.current.createNotice({ title: 't', body: 'b' }).then(
    () => null,
    (e: ApiError) => e,
  );
  assert.equal((r as ApiError).code, CLIENT_INACTIVE);
  assert.equal(listNoticesMock.mock.calls.length, 0);
  assert.equal(getNoticeMock.mock.calls.length, 0);
  assert.equal(postNoticeMock.mock.calls.length, 0);
});

test('active=false — 쓰기 액션도 CLIENT_INACTIVE 로 거절되고 API 는 0건이다', async () => {
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: false, scopeKey: 's1' },
  });
  await act(async () => {});
  for (const call of [
    () => hook.result.current.createNotice({ title: 't', body: 'b' }),
    () => hook.result.current.updateNotice('n1', { title: 't' }),
    () => hook.result.current.deleteNotice('n1'),
    () => hook.result.current.addComment('n1', 'x'),
  ]) {
    const r = await settle(call());
    assert.equal((r as { err: ApiError }).err.code, CLIENT_INACTIVE);
  }
  assert.equal(postNoticeMock.mock.calls.length, 0);
  assert.equal(patchNoticeMock.mock.calls.length, 0);
  assert.equal(delNoticeMock.mock.calls.length, 0);
  assert.equal(postCommentMock.mock.calls.length, 0);
  await hook.unmount();
});

test('retry 도 비활성에서는 API 를 부르지 않는다', async () => {
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: false, scopeKey: 's1' },
  });
  await act(async () => {
    await hook.result.current.retry();
  });
  assert.equal(getBoardMock.mock.calls.length, 0);
  await hook.unmount();
});

test('중복 탭 — 진행 중인 같은 의도는 요청을 하나만 내고 둘 다 같은 결과로 끝난다', async () => {
  const hook = await mountActive();
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);

  let p1!: Promise<unknown>, p2!: Promise<unknown>;
  await act(async () => {
    p1 = hook.result.current.createNotice({ title: 't', body: 'b' });
    p2 = hook.result.current.createNotice({ title: 't', body: 'b' });
  });
  assert.equal(postNoticeMock.mock.calls.length, 1);

  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
    await Promise.all([p1, p2]);
  });
  assert.deepEqual(await p1, { id: 'n9', title: 't', body: 'b' });
  assert.deepEqual(await p2, { id: 'n9', title: 't', body: 'b' });
  await hook.unmount();
});

test('응답 유실 재시도는 같은 Idempotency-Key 로 간다', async () => {
  const hook = await mountActive();
  const body = { title: 't', body: 'b' };
  postNoticeMock.mockRejectedValueOnce(
    new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요.', 0),
  );

  // 실패한 쓰기는 state 를 건드리지 않는다 — act 없이 기다려도 된다.
  const first = await settle(hook.result.current.createNotice(body));
  assert.equal((first as { err: ApiError }).err.code, 'CLIENT_NETWORK_ERROR');
  // 실패한 의도의 key 가 슬롯에 남아 같은 body 의 재시도가 그 key 를 쓴다.
  postNoticeMock.mockResolvedValue({ id: 'n9', title: 't', body: 'b' });
  await act(async () => {
    await hook.result.current.createNotice(body);
  });
  assert.equal(postNoticeMock.mock.calls.length, 2);
  const [k1, k2] = [postNoticeMock.mock.calls[0][2], postNoticeMock.mock.calls[1][2]];
  assert.equal(typeof k1, 'string');
  assert.equal(k1, k2);
  await hook.unmount();
});

test('성공 뒤의 다음 의도는 새 key 를 쓴다 — 바뀐 페이로드도 새 의도다', async () => {
  const hook = await mountActive();
  postNoticeMock.mockResolvedValue({ id: 'n9', title: 't', body: 'b' });

  await act(async () => {
    await hook.result.current.createNotice({ title: 't', body: 'b' });
  });
  await act(async () => {
    await hook.result.current.createNotice({ title: 't', body: 'b' });
  });
  const [k1, k2] = [postNoticeMock.mock.calls[0][2], postNoticeMock.mock.calls[1][2]];
  assert.notEqual(k1, k2);
  await hook.unmount();
});

test('쓰기 성공 뒤 목록은 서버 첫 페이지로 갱신된다(create → getBoard 재요청)', async () => {
  const hook = await mountActive();
  postNoticeMock.mockResolvedValue({ id: 'n9', title: 't', body: 'b' });
  getBoardMock.mockResolvedValue(
    board([
      { id: 'n9', title: 't' },
      { id: 'n1', title: 'a' },
    ]),
  );

  await act(async () => {
    await hook.result.current.createNotice({ title: 't', body: 'b' });
  });
  assert.equal(getBoardMock.mock.calls.length, 1);
  assert.deepEqual(
    hook.result.current.items.map((i) => i.id),
    ['n9', 'n1'],
  );
  await hook.unmount();
});

test('update 성공 뒤 목록과 열린 상세가 함께 갱신된다', async () => {
  const hook = await mountActive();
  getNoticeMock.mockResolvedValueOnce(detail('n1', []));
  await act(async () => {
    await hook.result.current.select('n1');
  });
  assert.equal(hook.result.current.detail?.title, '공지');

  patchNoticeMock.mockResolvedValue({ id: 'n1', title: '새 제목', body: '본문' });
  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: '새 제목' }]));
  getNoticeMock.mockResolvedValueOnce({ ...detail('n1', []), title: '새 제목' });
  await act(async () => {
    await hook.result.current.updateNotice('n1', { title: '새 제목' });
  });
  assert.deepEqual(
    [...patchNoticeMock.mock.calls[0].slice(0, 3)],
    ['island-1', 'n1', { title: '새 제목' }],
  );
  assert.equal(hook.result.current.items[0].title, '새 제목');
  assert.equal(hook.result.current.detail?.title, '새 제목');
  await hook.unmount();
});

test('delete 성공 뒤 목록에서 빠지고 열린 상세는 닫힌다', async () => {
  const hook = await mountActive();
  getNoticeMock.mockResolvedValueOnce(detail('n1', []));
  await act(async () => {
    await hook.result.current.select('n1');
  });
  delNoticeMock.mockResolvedValue({ deleted: true });
  getBoardMock.mockResolvedValue(board([]));

  await act(async () => {
    await hook.result.current.deleteNotice('n1');
  });
  assert.deepEqual([...delNoticeMock.mock.calls[0].slice(0, 2)], ['island-1', 'n1']);
  assert.deepEqual(hook.result.current.items, []);
  assert.equal(hook.result.current.detail, null);
  await hook.unmount();
});

test('addComment 성공 뒤 열린 상세의 댓글이 서버 값으로 갱신된다', async () => {
  const hook = await mountActive();
  getNoticeMock.mockResolvedValueOnce(detail('n1', [{ id: 'c1' }]));
  await act(async () => {
    await hook.result.current.select('n1');
  });
  postCommentMock.mockResolvedValue({ id: 'c2', name: null, text: 'x' });
  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: 'a' }]));
  getNoticeMock.mockResolvedValueOnce(detail('n1', [{ id: 'c1' }, { id: 'c2' }]));

  await act(async () => {
    await hook.result.current.addComment('n1', 'x');
  });
  assert.deepEqual(
    [...postCommentMock.mock.calls[0].slice(0, 3)],
    ['island-1', 'n1', { text: 'x' }],
  );
  assert.deepEqual(
    hook.result.current.detail?.comments.map((c) => c.id),
    ['c1', 'c2'],
  );
  await hook.unmount();
});

test('오래된 공지 댓글 작성 뒤 목록 페이지의 서버 정본 카운트를 확인 상태에 반영한다', async () => {
  getBoardMock.mockResolvedValue(board([{ id: 'recent', title: '최근' }], 'older'));
  listNoticesMock.mockResolvedValue({
    items: [{ id: 'old', title: '오래된 공지', commentCount: 4 }],
    nextCursor: null,
  });
  const onLoaded = jest.fn();
  const hook = await renderHook(() => useBoardNotices({ active: true, scopeKey: 'i1', onLoaded }));
  await waitFor(() => assert.equal(hook.result.current.loading, false));
  await act(async () => {
    await hook.result.current.loadMore();
  });
  getNoticeMock.mockResolvedValueOnce(detail('old', []));
  await act(async () => {
    await hook.result.current.select('old');
  });
  postCommentMock.mockResolvedValue({ id: 'mine', name: '나', text: '내 댓글' });
  getNoticeMock.mockResolvedValueOnce(detail('old', [{ id: 'mine' }]));
  listNoticesMock.mockResolvedValueOnce({
    items: [{ id: 'old', title: '오래된 공지', commentCount: 7 }],
    nextCursor: null,
  });
  getBoardMock.mockClear();

  await act(async () => {
    await hook.result.current.addComment('old', '내 댓글');
  });

  assert.equal(getBoardMock.mock.calls.length, 0);
  assert.equal(hook.result.current.items.find((item) => item.id === 'old')?.commentCount, 7);
  assert.deepEqual([...listNoticesMock.mock.calls.at(-1)!.slice(0, 2)], ['island-1', 'older']);
  const confirmed = onLoaded.mock.calls.at(-1)?.[0];
  assert.equal(confirmed.items.find((item: { id: string }) => item.id === 'old')?.commentCount, 7);
  assert.equal(confirmed.nextCursor, null);
  await hook.unmount();
});

test('범위 교체 중인 쓰기의 refresh 는 새 범위 목록을 덮지 않는다', async () => {
  const hook = await mountActive();
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);

  let p!: Promise<unknown>;
  await act(async () => {
    p = hook.result.current.createNotice({ title: 't', body: 'b' });
  });
  // 쓰기가 아직 안 끝났는데 범위가 바뀐다.
  getBoardMock.mockResolvedValue(board([{ id: 'n7', title: 's2' }]));
  await hook.rerender({ active: true, scopeKey: 's2' });
  await waitFor(() => assert.equal(hook.result.current.items.length, 1));

  let r!: { ok?: unknown; err?: ApiError };
  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
    r = (await settle(p)) as { err?: ApiError };
  });
  // 옛 범위에서 시작한 쓰기 여정은 stale 실패다 — 조용히 성공 처리하지 않는다.
  assert.equal(r.err?.code, CLIENT_STALE_SESSION);
  // refresh 응답도 버려진다 — s2 목록이 유지된다.
  assert.deepEqual(
    hook.result.current.items.map((i) => i.id),
    ['n7'],
  );
  await hook.unmount();
});

test('loadMoreComments 재진입 — 진행 중엔 두 번째 호출이 나가지 않는다', async () => {
  const hook = await mountActive();
  getNoticeMock.mockResolvedValueOnce(detail('n1', [{ id: 'c1' }], 'cc1'));
  await act(async () => {
    await hook.result.current.select('n1');
  });

  const slow = deferred<ReturnType<typeof detail>>();
  getNoticeMock.mockReturnValueOnce(slow.promise);
  await act(async () => {
    hook.result.current.loadMoreComments().catch(() => {});
    hook.result.current.loadMoreComments().catch(() => {});
  });
  assert.equal(getNoticeMock.mock.calls.length, 2); // select 1 + 페이징 1
  await act(async () => {
    slow.resolve(detail('n1', [{ id: 'c2' }], null));
    await slow.promise;
  });
  assert.deepEqual(
    hook.result.current.detail?.comments.map((c) => c.id),
    ['c1', 'c2'],
  );
  await hook.unmount();
});

test('islandRole — getBoard 의 island.role 을 그대로 노출한다', async () => {
  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: 'a' }], null, 'member'));
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));
  assert.equal(hook.result.current.islandRole, 'member');
  await hook.unmount();
});

test('세대가 바뀐 직후 — 리렌더 전 옛 콜백은 옛 섬 id 를 새 토큰으로 보내지 않는다', async () => {
  getBoardMock.mockResolvedValue(board([{ id: 'n1', title: 'a' }], 'c1'));
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));

  // 계정 교체 — 아직 리렌더도 effect 재실행도 없이 세대만 올라간 상태다.
  await act(async () => {
    await saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'u2' });
  });
  // 캐시된 islandId 는 옛 세대 것 — 읽기는 조용히 막는다.
  await act(async () => {
    await hook.result.current.loadMore();
  });
  assert.equal(listNoticesMock.mock.calls.length, 0);
  // 쓰기는 stale 거절 — 옛 섬 id 가 새 토큰으로 나가지 않는다.
  const r = (await settle(hook.result.current.createNotice({ title: 't', body: 'b' }))) as {
    err?: ApiError;
  };
  assert.equal(r.err?.code, CLIENT_STALE_SESSION);
  assert.equal(postNoticeMock.mock.calls.length, 0);
  await hook.unmount();
});

test('쓰기 refresh 가 stale 하면 CLIENT_STALE_SESSION 으로 거절하고 목록 재요청도 없다', async () => {
  const hook = await mountActive();
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);

  let p!: Promise<unknown>;
  await act(async () => {
    p = hook.result.current.createNotice({ title: 't', body: 'b' });
  });
  // 쓰기 진행 중 계정이 바뀐다 — 리렌더 전이라 effect 재로드는 아직 없다.
  await act(async () => {
    await saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'u2' });
  });
  let r!: { ok?: unknown; err?: ApiError };
  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
    r = (await settle(p)) as { err?: ApiError };
  });
  assert.equal(r.err?.code, CLIENT_STALE_SESSION);
  // stale 여정은 refresh GET 조차 내지 않는다.
  assert.equal(getBoardMock.mock.calls.length, 0);
  await hook.unmount();
});

test('진행 중인 슬롯에 다른 본문 — CLIENT_WRITE_IN_PROGRESS 거절로 새 초안을 보존한다', async () => {
  const hook = await mountActive();
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);

  let p1!: Promise<unknown>;
  let r2!: { ok?: unknown; err?: ApiError };
  await act(async () => {
    p1 = hook.result.current.createNotice({ title: 't', body: 'b' });
    r2 = (await settle(hook.result.current.createNotice({ title: 't', body: '수정된 본문' }))) as {
      err?: ApiError;
    };
  });
  assert.equal(r2.err?.code, CLIENT_WRITE_IN_PROGRESS);
  assert.equal(postNoticeMock.mock.calls.length, 1);

  getBoardMock.mockResolvedValue(board([{ id: 'n9', title: 't' }]));
  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
    await p1;
  });
  // 첫 의도는 정상 완료된다 — 두 번째 초안이 첫 성공으로 지워지지 않았다.
  assert.deepEqual(
    hook.result.current.items.map((i) => i.id),
    ['n9'],
  );
  await hook.unmount();
});

test('댓글 페이징 중 다른 공지를 열면 loadingMoreComments 가 풀리고 새 공지 페이징이 된다', async () => {
  const hook = await mountActive();
  getNoticeMock.mockResolvedValueOnce(detail('n1', [{ id: 'c1' }], 'cc1'));
  await act(async () => {
    await hook.result.current.select('n1');
  });
  const slow = deferred<ReturnType<typeof detail>>();
  getNoticeMock.mockReturnValueOnce(slow.promise);
  await act(async () => {
    hook.result.current.loadMoreComments().catch(() => {});
  });
  assert.equal(hook.result.current.loadingMoreComments, true);

  // 옛 페이징이 아직 안 끝났는데 다른 공지를 연다 — 플래그가 풀려야 한다.
  getNoticeMock.mockResolvedValueOnce(detail('n2', [{ id: 'x1' }], 'cc2'));
  await act(async () => {
    await hook.result.current.select('n2');
  });
  assert.equal(hook.result.current.detail?.id, 'n2');
  assert.equal(hook.result.current.loadingMoreComments, false);

  // 늦게 도착한 옛 페이징 응답은 버려지고 플래그도 건드리지 않는다.
  await act(async () => {
    slow.resolve(detail('n1', [{ id: 'c2' }], null));
    await slow.promise;
  });
  assert.equal(hook.result.current.loadingMoreComments, false);
  assert.equal(hook.result.current.detail?.id, 'n2');

  // 새 공지의 댓글 페이징은 정상 동작한다.
  getNoticeMock.mockResolvedValueOnce(detail('n2', [{ id: 'x2' }], null));
  await act(async () => {
    await hook.result.current.loadMoreComments();
  });
  assert.deepEqual(
    hook.result.current.detail?.comments.map((c) => c.id),
    ['x1', 'x2'],
  );
  assert.deepEqual([...getNoticeMock.mock.calls[3]], ['island-1', 'n2', 'cc2']);
  await hook.unmount();
});

/** 퀘스트가 실린 채 로드가 끝난 활성 훅 — 퀘스트 테스트의 공통 출발점. */
const mountWithQuest = async () => {
  getBoardMock.mockResolvedValue(board([], null, 'host', [questItem()]));
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));
  getBoardMock.mockClear();
  return hook;
};

test('getBoard 의 quests.items 가 목록 정본이다 — 진행률·수령 필드를 그대로 싣는다', async () => {
  const hook = await mountWithQuest();
  assert.deepEqual(hook.result.current.quests, [questItem()]);
  await hook.unmount();
});

test('selectQuest — occurrenceId 로 progress 를 싣고 null 로 닫는다', async () => {
  const hook = await mountWithQuest();
  getQuestProgressMock.mockResolvedValue(questProgress());

  await act(async () => {
    await hook.result.current.selectQuest('occ-1');
  });
  assert.deepEqual([...getQuestProgressMock.mock.calls[0]], ['island-1', 'q1', 'occ-1']);
  // members 의 rate·achieved·claimed 는 서버 값 그대로다.
  assert.equal(hook.result.current.questDetail?.members[0].rate, 100);
  assert.equal(hook.result.current.questDetail?.members[0].achieved, true);

  await act(async () => {
    await hook.result.current.selectQuest(null);
  });
  assert.equal(hook.result.current.questDetail, null);
  assert.equal(getQuestProgressMock.mock.calls.length, 1);
  await hook.unmount();
});

test('selectQuest — nextCursor를 끝까지 따라가 모든 주민을 병합한다', async () => {
  const hook = await mountWithQuest();
  getQuestProgressMock
    .mockResolvedValueOnce(
      questProgress({
        members: [questProgress().members[0]],
        nextCursor: 'cursor-2',
      }),
    )
    .mockResolvedValueOnce(
      questProgress({
        members: [
          questProgress().members[0],
          { ...questProgress().members[0], userId: 'u2', name: '두부' },
        ],
        nextCursor: null,
      }),
    );

  await act(async () => {
    await hook.result.current.selectQuest('occ-1');
  });

  assert.deepEqual(
    [...getQuestProgressMock.mock.calls[1]],
    ['island-1', 'q1', 'occ-1', 'cursor-2'],
  );
  assert.deepEqual(
    hook.result.current.questDetail?.members.map((member) => member.userId),
    ['u1', 'u2'],
  );
  assert.equal(hook.result.current.questDetail?.nextCursor, null);
  await hook.unmount();
});

test('정의 ID가 같은 여러 회차는 occurrenceId로 구분해 선택한다', async () => {
  getBoardMock.mockResolvedValue(
    board([], null, 'host', [
      questItem({ occurrenceId: 'occ-yesterday', date: '2026-09-20' }),
      questItem({ occurrenceId: 'occ-today', date: '2026-09-21' }),
    ]),
  );
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: true, scopeKey: 's1' },
  });
  await waitFor(() => assert.equal(hook.result.current.loading, false));
  getQuestProgressMock.mockResolvedValue(
    questProgress({ occurrenceId: 'occ-today', date: '2026-09-21' }),
  );

  await act(async () => {
    await hook.result.current.selectQuest('occ-today');
  });

  assert.deepEqual([...getQuestProgressMock.mock.calls[0]], ['island-1', 'q1', 'occ-today']);
  assert.equal(hook.result.current.questDetail?.occurrenceId, 'occ-today');
  await hook.unmount();
});

test('selectQuest — 목록에 없는 id 는 API 없이 QUEST_GONE 오류를 싣는다', async () => {
  const hook = await mountWithQuest();
  await act(async () => {
    await hook.result.current.selectQuest('gone');
  });
  assert.equal((hook.result.current.questDetailError as ApiError).code, 'QUEST_GONE');
  assert.equal(getQuestProgressMock.mock.calls.length, 0);
  await hook.unmount();
});

test('claimQuest — {occurrenceId, expectedVersion} 만 보내고 성공 뒤 목록·열린 상세를 재조회한다', async () => {
  const hook = await mountWithQuest();
  getQuestProgressMock.mockResolvedValue(questProgress());
  await act(async () => {
    await hook.result.current.selectQuest('occ-1');
  });
  getQuestProgressMock.mockClear();

  postClaimMock.mockResolvedValue({
    claimId: 'c1',
    occurrenceId: 'occ-1',
    villagePointsAdded: 10,
    bonusAdded: 0,
    claimed: true,
  });
  getBoardMock.mockResolvedValue(
    board([], null, 'host', [questItem({ claimable: false, claimed: true, version: 4 })]),
  );
  getQuestProgressMock.mockResolvedValue(questProgress({ claimed: true, version: 4 }));

  let result!: unknown;
  await act(async () => {
    result = await hook.result.current.claimQuest(questItem() as never);
  });
  assert.deepEqual(result, {
    claimId: 'c1',
    occurrenceId: 'occ-1',
    villagePointsAdded: 10,
    bonusAdded: 0,
    claimed: true,
  });
  // 본문은 정확히 {occurrenceId, expectedVersion} 다 — 지급량·사용자 id 를 싣지 않는다.
  assert.deepEqual(postClaimMock.mock.calls[0][2], { occurrenceId: 'occ-1', expectedVersion: 3 });
  assert.equal(typeof postClaimMock.mock.calls[0][3], 'string');
  // 성공 뒤 목록(getBoard·지갑 포함)과 열린 상세를 다시 읽는다 — 로컬 가산 없음.
  assert.equal(getBoardMock.mock.calls.length, 1);
  assert.deepEqual([...getQuestProgressMock.mock.calls[0]], ['island-1', 'q1', 'occ-1']);
  assert.equal(hook.result.current.quests[0].claimed, true);
  assert.equal(hook.result.current.questDetail?.claimed, true);
  await hook.unmount();
});

test('claimQuest — 응답 유실 재시도는 같은 Idempotency-Key 로 간다', async () => {
  const hook = await mountWithQuest();
  postClaimMock.mockRejectedValueOnce(
    new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요.', 0),
  );
  const first = await settle(hook.result.current.claimQuest(questItem() as never));
  assert.equal((first as { err: ApiError }).err.code, 'CLIENT_NETWORK_ERROR');

  postClaimMock.mockResolvedValue({
    claimId: 'c1',
    occurrenceId: 'occ-1',
    villagePointsAdded: 10,
    bonusAdded: 0,
    claimed: true,
  });
  getBoardMock.mockResolvedValue(board([], null, 'host', [questItem({ claimed: true })]));
  await act(async () => {
    await hook.result.current.claimQuest(questItem() as never);
  });
  assert.equal(postClaimMock.mock.calls.length, 2);
  assert.equal(postClaimMock.mock.calls[0][3], postClaimMock.mock.calls[1][3]);
  await hook.unmount();
});

test('claimQuest — 409 버전 충돌은 오류를 그대로 던지고 목록을 새 버전으로 다시 읽는다', async () => {
  const hook = await mountWithQuest();
  postClaimMock.mockRejectedValueOnce(
    new ApiError('VERSION_CONFLICT', '다른 기기에서 먼저 바뀌었습니다.', 409),
  );
  getBoardMock.mockResolvedValue(board([], null, 'host', [questItem({ version: 5 })]));

  const r = await settle(hook.result.current.claimQuest(questItem() as never));
  assert.equal((r as { err: ApiError }).err.code, 'VERSION_CONFLICT');
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.equal(hook.result.current.quests[0].version, 5));
  await hook.unmount();
});

test('claimQuest — 중복 탭은 요청을 하나만 낸다', async () => {
  const hook = await mountWithQuest();
  const slow = deferred<unknown>();
  postClaimMock.mockReturnValue(slow.promise);
  let p1!: Promise<unknown>, p2!: Promise<unknown>;
  await act(async () => {
    p1 = hook.result.current.claimQuest(questItem() as never);
    p2 = hook.result.current.claimQuest(questItem() as never);
  });
  assert.equal(postClaimMock.mock.calls.length, 1);

  getBoardMock.mockResolvedValue(board([], null, 'host', [questItem({ claimed: true })]));
  await act(async () => {
    slow.resolve({
      claimId: 'c1',
      occurrenceId: 'occ-1',
      villagePointsAdded: 10,
      bonusAdded: 0,
      claimed: true,
    });
    await p1;
    await p2;
  });
  assert.equal(postClaimMock.mock.calls.length, 1);
  await hook.unmount();
});

test('createQuest — POST 본문을 그대로 보내고 성공 뒤 목록을 다시 읽는다', async () => {
  const hook = await mountWithQuest();
  postQuestMock.mockResolvedValue({ id: 'q2', title: '새 퀘스트' });
  getBoardMock.mockResolvedValue(board([], null, 'host', [questItem(), questItem({ id: 'q2' })]));

  const body = {
    title: '새 퀘스트',
    type: 'focus' as const,
    targetMinutes: 30,
    windowStart: '20:00',
    windowEnd: '22:00',
    timezone: 'UTC',
  };
  await act(async () => {
    await hook.result.current.createQuest(body);
  });
  assert.deepEqual([...postQuestMock.mock.calls[0]].slice(0, 2), ['island-1', body]);
  assert.equal(getBoardMock.mock.calls.length, 1);
  assert.equal(hook.result.current.quests.length, 2);
  await hook.unmount();
});

test('updateQuest — PATCH 는 title/targetMinutes 만 보내고 열린 상세도 갱신한다', async () => {
  const hook = await mountWithQuest();
  getQuestProgressMock.mockResolvedValue(questProgress());
  await act(async () => {
    await hook.result.current.selectQuest('occ-1');
  });
  getQuestProgressMock.mockClear();

  patchQuestMock.mockResolvedValue({ id: 'q1', title: '새 제목', targetMinutes: 60 });
  getBoardMock.mockResolvedValue(
    board([], null, 'host', [questItem({ title: '새 제목', targetMinutes: 60 })]),
  );
  getQuestProgressMock.mockResolvedValue(questProgress({ title: '새 제목', targetMinutes: 60 }));

  await act(async () => {
    await hook.result.current.updateQuest('q1', { title: '새 제목', targetMinutes: 60 });
  });
  assert.deepEqual([...patchQuestMock.mock.calls[0]].slice(0, 3), [
    'island-1',
    'q1',
    { title: '새 제목', targetMinutes: 60 },
  ]);
  assert.equal(hook.result.current.quests[0].title, '새 제목');
  assert.equal(hook.result.current.questDetail?.title, '새 제목');
  await hook.unmount();
});

test('active=false — 퀘스트 쓰기도 CLIENT_INACTIVE 로 거절되고 API 는 0건이다', async () => {
  const hook = await renderHook((p: { active: boolean; scopeKey: string }) => useBoardNotices(p), {
    initialProps: { active: false, scopeKey: 's1' },
  });
  await act(async () => {});
  for (const call of [
    () => hook.result.current.createQuest({ title: 't', type: 'screen', targetMinutes: 30 }),
    () => hook.result.current.updateQuest('q1', { title: 't' }),
    () => hook.result.current.claimQuest(questItem() as never),
  ]) {
    const r = await settle(call());
    assert.equal((r as { err: ApiError }).err.code, CLIENT_INACTIVE);
  }
  assert.equal(postQuestMock.mock.calls.length, 0);
  assert.equal(patchQuestMock.mock.calls.length, 0);
  assert.equal(postClaimMock.mock.calls.length, 0);
  assert.equal(getQuestProgressMock.mock.calls.length, 0);
  await hook.unmount();
});
