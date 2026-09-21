import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { saveSession } from '@/services/api/session';
import type { LedgerPage, TownHallScreen } from '@/services/api/townHall';
import { getLedger, getTownHall } from '@/services/api/townHall';
import { useLedgerScreen } from '@/screens/island/useLedgerScreen';

jest.mock('@/services/api/townHall', () => ({
  getTownHall: jest.fn(),
  getLedger: jest.fn(),
}));

const townHallMock = getTownHall as jest.Mock;
const ledgerMock = getLedger as jest.Mock;

const MONTH = '2026-09';
const SERVER_ISLAND = '3f6b9c2a-7d4e-4a1b-8c5d-2e9f0a1b3c4d';

const entry = (id: string, over: Partial<LedgerPage['items'][number]> = {}) => ({
  id,
  direction: 'earn' as const,
  reason: 'contribution',
  amount: 10,
  createdAt: '2026-09-20T00:12:00Z',
  groupedUntil: '2026-09-20T09:51:00Z',
  entryCount: 1,
  ...over,
});

const page = (over: Partial<LedgerPage> = {}): LedgerPage => ({
  month: MONTH,
  earnedTotal: 60,
  spentTotal: 15,
  items: [entry('e1')],
  nextCursor: null,
  ...over,
});

// fish(개인)와 villagePoints(공동)를 다른 값으로 둔다 — 개인 잔액 오표시를 잡기 위해서다
const screen = (ledger: Partial<LedgerPage> = {}): TownHallScreen =>
  ({
    island: { id: SERVER_ISLAND },
    wallets: { fish: 41, villagePoints: 1240 },
    ledger: page(ledger),
  }) as unknown as TownHallScreen;

const deferred = <T,>() => {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const props = { active: true, islandId: 'soda', currentMonth: MONTH };

const mount = (over: Partial<typeof props> = {}) =>
  renderHook((p: typeof props) => useLedgerScreen(p), {
    initialProps: { ...props, ...over },
  });

beforeEach(() => {
  jest.clearAllMocks();
});

test('이번 달 무필터 진입은 town-hall 1회로 잔액·합계·첫 쪽을 채운다', async () => {
  townHallMock.mockResolvedValue(screen({ nextCursor: 'cur1' }));
  const { result } = await mount();

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(townHallMock.mock.calls.length, 1);
  assert.equal(ledgerMock.mock.calls.length, 0);
  assert.equal(result.current.villagePoints, 1240);
  assert.equal(result.current.earnedTotal, 60);
  assert.equal(result.current.spentTotal, 15);
  assert.equal(result.current.items.length, 1);
  assert.equal(result.current.nextCursor, 'cur1');
});

test('적립/지출 탭은 같은 달 direction 으로 cursor 없이 새 조회하고 잔액 복귀는 무필터다', async () => {
  townHallMock.mockResolvedValue(screen());
  ledgerMock.mockResolvedValue(page({ items: [entry('earn1')], nextCursor: null }));
  const { result } = await mount();
  await waitFor(() => assert.equal(result.current.status, 'ready'));

  await act(async () => result.current.setTab('earn'));
  await waitFor(() => assert.equal(result.current.items[0]?.id, 'earn1'));
  assert.equal(ledgerMock.mock.calls[0][0], SERVER_ISLAND);
  assert.deepEqual(ledgerMock.mock.calls[0][1], { month: MONTH, direction: 'earn' });

  ledgerMock.mockResolvedValue(page({ items: [entry('spend1', { direction: 'spend' })] }));
  await act(async () => result.current.setTab('spend'));
  await waitFor(() => assert.equal(result.current.items[0]?.id, 'spend1'));
  assert.equal(ledgerMock.mock.calls[1][0], SERVER_ISLAND);
  assert.deepEqual(ledgerMock.mock.calls[1][1], { month: MONTH, direction: 'spend' });

  await act(async () => result.current.setTab('balance'));
  await waitFor(() => assert.equal(townHallMock.mock.calls.length, 2));
  assert.equal(result.current.items[0]?.id, 'e1');
});

test('이전 달은 정확한 YYYY-MM·유지된 direction·버려진 cursor/items 로 조회하고 다음 달은 막는다', async () => {
  townHallMock.mockResolvedValue(screen({ nextCursor: 'cur1' }));
  ledgerMock.mockResolvedValue(page({ month: '2026-08', items: [entry('aug1')] }));
  const { result } = await mount();
  await waitFor(() => assert.equal(result.current.status, 'ready'));

  await act(async () => result.current.setTab('spend'));
  await waitFor(() => assert.equal(ledgerMock.mock.calls.length, 1));
  await act(async () => result.current.prevMonth());
  await waitFor(() => assert.equal(result.current.month, '2026-08'));
  assert.equal(ledgerMock.mock.calls[1][0], SERVER_ISLAND);
  assert.deepEqual(ledgerMock.mock.calls[1][1], { month: '2026-08', direction: 'spend' });
  await waitFor(() => assert.equal(result.current.items[0]?.id, 'aug1'));
  assert.equal(result.current.nextCursor, null);

  // 이번 달로 돌아오면 더 갈 곳이 없다
  await act(async () => result.current.nextMonth());
  assert.equal(result.current.month, MONTH);
  assert.equal(result.current.canNext, false);
  const calls = ledgerMock.mock.calls.length;
  await act(async () => result.current.nextMonth());
  assert.equal(ledgerMock.mock.calls.length, calls);
});

test('더보기는 같은 scope 의 cursor 로 append·id 중복을 제거하고 nextCursor=null 이면 멈춘다', async () => {
  townHallMock.mockResolvedValue(screen({ nextCursor: 'cur1' }));
  ledgerMock.mockResolvedValue(page({ items: [entry('e1'), entry('e2')], nextCursor: 'cur2' }));
  const { result } = await mount();
  await waitFor(() => assert.equal(result.current.nextCursor, 'cur1'));

  await act(async () => result.current.loadMore());
  await waitFor(() => assert.equal(result.current.items.length, 2));
  assert.equal(ledgerMock.mock.calls[0][0], SERVER_ISLAND);
  assert.deepEqual(ledgerMock.mock.calls[0][1], {
    month: MONTH,
    direction: undefined,
    cursor: 'cur1',
  });
  // 첫 쪽의 e1 이 다음 쪽에 다시 오면 id 로 걸러 한 줄만 늘어난다
  assert.deepEqual(
    result.current.items.map((x) => x.id),
    ['e1', 'e2'],
  );
  assert.equal(result.current.nextCursor, 'cur2');

  ledgerMock.mockResolvedValue(page({ items: [entry('e3')], nextCursor: null }));
  await act(async () => result.current.loadMore());
  await waitFor(() => assert.equal(result.current.nextCursor, null));
  const calls = ledgerMock.mock.calls.length;
  await act(async () => result.current.loadMore());
  assert.equal(ledgerMock.mock.calls.length, calls);
});

test('첫 쪽 실패는 error 상태로 남기고 retry 는 같은 scope 를 다시 읽는다', async () => {
  townHallMock.mockRejectedValue(new ApiError('FORBIDDEN', '섬 주민만 볼 수 있어요.', 403));
  const { result } = await mount();
  await waitFor(() => assert.equal(result.current.status, 'error'));
  assert.equal(result.current.error?.code, 'FORBIDDEN');
  assert.deepEqual(result.current.items, []);

  townHallMock.mockResolvedValue(screen());
  await act(async () => result.current.retry());
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(result.current.items.length, 1);
});

test('더보기 실패는 기존 rows 를 유지한 채 moreError 만 단다 — 빈 성공으로 접지 않는다', async () => {
  townHallMock.mockResolvedValue(screen({ nextCursor: 'cur1' }));
  const { result } = await mount();
  await waitFor(() => assert.equal(result.current.status, 'ready'));

  ledgerMock.mockRejectedValue(new ApiError('CLIENT_NETWORK_ERROR', '네트워크', 0));
  await act(async () => result.current.loadMore());
  await waitFor(() => assert.equal(result.current.moreError?.code, 'CLIENT_NETWORK_ERROR'));
  assert.deepEqual(
    result.current.items.map((x) => x.id),
    ['e1'],
  );
  assert.equal(result.current.status, 'ready');
});

test('scope A 요청 뒤 B 가 먼저 완료되면 늦은 A 응답은 버린다', async () => {
  townHallMock.mockResolvedValue(screen());
  const { result } = await mount();
  await waitFor(() => assert.equal(result.current.status, 'ready'));

  // 적립(A)을 보내고 끝나기 전에 지출(B)로 바꾼다 — B 가 먼저 오면 늦은 A 는 버린다
  const slowEarn = deferred<LedgerPage>();
  const fastSpend = deferred<LedgerPage>();
  ledgerMock.mockReturnValueOnce(slowEarn.promise).mockReturnValueOnce(fastSpend.promise);
  await act(async () => result.current.setTab('earn'));
  await act(async () => result.current.setTab('spend'));
  await act(async () => fastSpend.resolve(page({ items: [entry('spend1')] })));
  await waitFor(() => assert.equal(result.current.items[0]?.id, 'spend1'));

  await act(async () => slowEarn.resolve(page({ items: [entry('stale')] })));
  assert.deepEqual(
    result.current.items.map((x) => x.id),
    ['spend1'],
  );
  assert.equal(result.current.tab, 'spend');
});

test('active 가 아니면 API 를 부르지 않고, 다시 활성화되면 새로 읽는다', async () => {
  townHallMock.mockResolvedValue(screen());
  const { result, rerender } = await mount({ active: false });
  assert.equal(townHallMock.mock.calls.length, 0);
  assert.equal(ledgerMock.mock.calls.length, 0);

  await rerender({ ...props, active: true });
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(townHallMock.mock.calls.length, 1);
});

test('계정이 갈리면 잔액·rows·cursor·서버 섬 id 를 전부 버리고 새 계정으로 다시 묶는다', async () => {
  townHallMock.mockResolvedValue(screen({ nextCursor: 'cur1' }));
  const { result } = await mount();
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(result.current.villagePoints, 1240);

  // A 계정 로딩 완료 → 동일 localId('soda') 로 B 계정 전환
  const OTHER_ISLAND = 'other-account-island';
  const relearn = deferred<TownHallScreen>();
  townHallMock.mockReturnValueOnce(relearn.promise);
  ledgerMock.mockResolvedValue(page({ items: [entry('new1')] }));
  await act(async () => {
    await saveSession({ accessToken: 'a2', refreshToken: 'r2', userId: 'u2' });
    result.current.setTab('earn');
  });
  // B 응답이 오기 전: A 의 잔액·rows·cursor·합계는 화면에서 비워진다
  assert.equal(result.current.villagePoints, null);
  assert.deepEqual(result.current.items, []);
  assert.equal(result.current.nextCursor, null);
  assert.equal(result.current.earnedTotal, 0);
  assert.equal(result.current.spentTotal, 0);
  // 그리고 A 의 서버 섬 id 로는 어떤 GET 도 나가지 않는다
  assert.equal(ledgerMock.mock.calls.length, 0);

  await act(async () =>
    relearn.resolve({
      ...screen(),
      island: { id: OTHER_ISLAND },
      wallets: { fish: 7, villagePoints: 77 },
    } as TownHallScreen),
  );
  await waitFor(() => assert.equal(result.current.items[0]?.id, 'new1'));
  // 로컬 islandId 가 같아도 서버 섬 id 는 새 계정의 town-hall 에서 다시 배운 값이다
  assert.equal(ledgerMock.mock.calls[0][0], OTHER_ISLAND);
  assert.equal(result.current.villagePoints, 77);
  assert.equal(townHallMock.mock.calls.length, 2);
});

test('비활성 전환은 표시 중이던 잔액·rows 를 즉시 비우고 늦은 응답도 폐기한다', async () => {
  const slow = deferred<TownHallScreen>();
  townHallMock.mockReturnValueOnce(slow.promise);
  const { result, rerender } = await mount();
  await rerender({ ...props, active: false });
  await act(async () => slow.resolve(screen({ items: [entry('late')] })));
  assert.deepEqual(result.current.items, []);
  assert.equal(result.current.villagePoints, null);
  assert.equal(result.current.status, 'loading');

  // ready 상태에서 내려가도 마찬가지다
  townHallMock.mockResolvedValue(screen());
  await rerender({ ...props, active: true });
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  await rerender({ ...props, active: false });
  assert.deepEqual(result.current.items, []);
  assert.equal(result.current.villagePoints, null);
});

test('계정이 갈린 직후 캡처된 loadMore 는 옛 서버 섬 id 로 요청을 보내지 않는다', async () => {
  townHallMock.mockResolvedValue(screen({ nextCursor: 'cur1' }));
  const { result } = await mount();
  await waitFor(() => assert.equal(result.current.nextCursor, 'cur1'));

  // 세대만 바뀌고 아직 재조회가 안 된 틈에 옛 렌더의 콜백을 부른다
  const staleLoadMore = result.current.loadMore;
  await act(async () => saveSession({ accessToken: 'a2', refreshToken: 'r2', userId: 'u2' }));
  await act(async () => staleLoadMore());
  assert.equal(ledgerMock.mock.calls.length, 0);
});

test('unmount 뒤 캡처된 loadMore 는 요청을 보내지 않는다', async () => {
  townHallMock.mockResolvedValue(screen({ nextCursor: 'cur1' }));
  const { result, unmount } = await mount();
  await waitFor(() => assert.equal(result.current.nextCursor, 'cur1'));

  const staleLoadMore = result.current.loadMore;
  // unmount 의 effect cleanup(세대 증가)은 concurrent root 에서 act 경계 안에서 플러시된다
  await act(async () => unmount());
  await act(async () => staleLoadMore());
  assert.equal(ledgerMock.mock.calls.length, 0);
});

test('unmount 뒤 도착한 응답은 어디에도 적용되지 않는다', async () => {
  const slow = deferred<TownHallScreen>();
  townHallMock.mockReturnValueOnce(slow.promise);
  const { unmount } = await mount();
  await act(async () => unmount());
  // 늦은 첫 쪽 응답이 와도 cleanup 이 올린 세대에 막혀 어디에도 쓰이지 않고, 추가 요청도 없다
  await act(async () => slow.resolve(screen({ items: [entry('ghost')] })));
  assert.equal(townHallMock.mock.calls.length, 1);
  assert.equal(ledgerMock.mock.calls.length, 0);
});
