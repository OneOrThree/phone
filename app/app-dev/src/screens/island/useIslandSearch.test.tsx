/**
 * useIslandSearch (GROMO-2269) — 300ms 디바운스 · 빈 검색어는 호출 없음 · 늦게 온 옛 응답 무시 ·
 * 오류+바로 재시도 · 첫 페이지만(more) · 모양이 어긋난 응답은 오류.
 * 가짜 타이머로 디바운스를 진행하고 searchIslands 는 목이다.
 */
import { act, renderHook } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { CLIENT_CONTRACT_ERROR } from '@/services/api/home';
import { searchIslands, type IslandSummary } from '@/services/api/islands';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  useIslandSearch,
} from '@/screens/island/useIslandSearch';

jest.mock('@/services/api/islands', () => ({
  ...jest.requireActual('@/services/api/islands'),
  searchIslands: jest.fn(),
}));
const searchMock = searchIslands as jest.Mock;

const island = (id: string): IslandSummary => ({
  id,
  name: `섬 ${id}`,
  intro: '',
  visibility: 'public',
  approvalRequired: false,
  memberCount: 1,
  maxMembers: 15,
  membershipStatus: 'none',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
});
const page = (ids: string[], nextCursor: string | null = null) => ({
  items: ids.map(island),
  nextCursor,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const mount = (text = '') =>
  renderHook((p: { text: string }) => useIslandSearch(p.text), { initialProps: { text } });
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const ids = (hook: { result: { current: { items: IslandSummary[] } } }) =>
  hook.result.current.items.map((i) => i.id);

beforeEach(() => {
  jest.useFakeTimers();
  searchMock.mockReset();
});
afterEach(() => jest.useRealTimers());

test('검색어가 비었거나 공백뿐이면 서버를 부르지 않는다(idle)', async () => {
  const hook = await mount('');
  await advance(SEARCH_DEBOUNCE_MS * 2);
  expect(hook.result.current.status).toBe('idle');
  await hook.rerender({ text: '   ' });
  await advance(SEARCH_DEBOUNCE_MS * 2);
  expect(hook.result.current.status).toBe('idle');
  expect(searchMock).not.toHaveBeenCalled();
});

test('입력이 300ms 멈춰야 부르고, 그 사이 또 입력하면 마지막 검색어로 한 번만 부른다', async () => {
  searchMock.mockResolvedValue(page(['a']));
  const hook = await mount();
  await hook.rerender({ text: '단' });
  await advance(SEARCH_DEBOUNCE_MS - 1);
  expect(searchMock).not.toHaveBeenCalled();
  expect(hook.result.current.status).toBe('loading');
  await hook.rerender({ text: '단풍' });
  await advance(SEARCH_DEBOUNCE_MS - 1);
  expect(searchMock).not.toHaveBeenCalled();
  await advance(1);
  expect(searchMock).toHaveBeenCalledTimes(1);
  // 첫 페이지만 — 커서 없이 limit 20
  expect(searchMock).toHaveBeenCalledWith('단풍', { limit: SEARCH_LIMIT });
  expect(SEARCH_LIMIT).toBe(20);
  expect(hook.result.current.status).toBe('ready');
  expect(ids(hook)).toEqual(['a']);
});

test('앞뒤 공백은 자르고 부른다', async () => {
  searchMock.mockResolvedValue(page([]));
  const hook = await mount('  단풍  ');
  await advance(SEARCH_DEBOUNCE_MS);
  expect(searchMock).toHaveBeenCalledWith('단풍', { limit: SEARCH_LIMIT });
  expect(hook.result.current.status).toBe('ready');
});

test('결과가 비면 ready + 빈 목록이다 — 오류로 접지 않는다', async () => {
  searchMock.mockResolvedValue(page([]));
  const hook = await mount('없는섬');
  await advance(SEARCH_DEBOUNCE_MS);
  expect(hook.result.current.status).toBe('ready');
  expect(hook.result.current.items).toEqual([]);
  expect(hook.result.current.error).toBeNull();
});

test('첫 페이지 뒤에 결과가 더 있으면 more 로 알린다', async () => {
  searchMock.mockResolvedValueOnce(page(['a'], 'cursor-1')).mockResolvedValueOnce(page(['b']));
  const hook = await mount('섬');
  await advance(SEARCH_DEBOUNCE_MS);
  expect(hook.result.current.more).toBe(true);
  await hook.rerender({ text: '섬 이름' });
  await advance(SEARCH_DEBOUNCE_MS);
  expect(hook.result.current.more).toBe(false);
});

test('늦게 온 옛 검색어 응답은 버린다 — 새 검색어의 결과만 남는다', async () => {
  const first = deferred<ReturnType<typeof page>>();
  const second = deferred<ReturnType<typeof page>>();
  searchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const hook = await mount();
  await hook.rerender({ text: 'ab' });
  await advance(SEARCH_DEBOUNCE_MS);
  await hook.rerender({ text: 'abc' });
  await advance(SEARCH_DEBOUNCE_MS);
  expect(searchMock).toHaveBeenCalledTimes(2);
  expect(searchMock).toHaveBeenNthCalledWith(1, 'ab', { limit: SEARCH_LIMIT });
  expect(searchMock).toHaveBeenNthCalledWith(2, 'abc', { limit: SEARCH_LIMIT });

  await act(async () => second.resolve(page(['new'])));
  expect(ids(hook)).toEqual(['new']);
  await act(async () => first.resolve(page(['old'])));
  expect(hook.result.current.status).toBe('ready');
  expect(ids(hook)).toEqual(['new']);
});

test('입력을 바꾼 직후(디바운스 대기)에는 옛 검색어 응답이 와도 loading 이다', async () => {
  const first = deferred<ReturnType<typeof page>>();
  searchMock.mockReturnValueOnce(first.promise);
  const hook = await mount('ab');
  await advance(SEARCH_DEBOUNCE_MS);
  await hook.rerender({ text: 'abc' }); // 아직 부르기 전
  await act(async () => first.resolve(page(['old'])));
  expect(hook.result.current.status).toBe('loading');
  expect(hook.result.current.items).toEqual([]);
});

test('검색어를 지우면 바로 idle 이고, 그 사이 도착한 응답은 쓰지 않는다', async () => {
  const first = deferred<ReturnType<typeof page>>();
  searchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(page(['again']));
  const hook = await mount('ab');
  await advance(SEARCH_DEBOUNCE_MS);
  await hook.rerender({ text: '' });
  expect(hook.result.current.status).toBe('idle');
  await act(async () => first.resolve(page(['late'])));
  expect(hook.result.current.status).toBe('idle');
  expect(hook.result.current.items).toEqual([]);
  // 같은 검색어를 다시 치면 새로 부른다
  await hook.rerender({ text: 'ab' });
  await advance(SEARCH_DEBOUNCE_MS);
  expect(searchMock).toHaveBeenCalledTimes(2);
  expect(ids(hook)).toEqual(['again']);
});

test('입력을 바꿨다가 마지막 검색어로 돌아오면 다시 부르지 않고 그 결과를 보여 준다', async () => {
  searchMock.mockResolvedValue(page(['a']));
  const hook = await mount('ab');
  await advance(SEARCH_DEBOUNCE_MS);
  await hook.rerender({ text: 'abc' });
  await advance(SEARCH_DEBOUNCE_MS - 1);
  await hook.rerender({ text: 'ab' });
  await advance(SEARCH_DEBOUNCE_MS * 2);
  expect(searchMock).toHaveBeenCalledTimes(1);
  expect(hook.result.current.status).toBe('ready');
  expect(ids(hook)).toEqual(['a']);
});

test('실패는 error 로 두고 retry 는 디바운스 없이 바로 같은 검색어로 다시 부른다', async () => {
  const again = deferred<ReturnType<typeof page>>();
  searchMock
    .mockRejectedValueOnce(
      new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요.', 0, { retryable: true }),
    )
    .mockReturnValueOnce(again.promise);
  const hook = await mount('ab');
  await advance(SEARCH_DEBOUNCE_MS);
  expect(hook.result.current.status).toBe('error');
  expect(hook.result.current.error?.code).toBe('CLIENT_NETWORK_ERROR');
  expect(hook.result.current.items).toEqual([]);

  await act(async () => hook.result.current.retry()); // 타이머를 진행하지 않는다
  expect(searchMock).toHaveBeenCalledTimes(2);
  expect(searchMock).toHaveBeenLastCalledWith('ab', { limit: SEARCH_LIMIT });
  expect(hook.result.current.status).toBe('loading');
  await act(async () => again.resolve(page(['a'])));
  expect(hook.result.current.status).toBe('ready');
  expect(ids(hook)).toEqual(['a']);
});

test('목록이 아닌 응답은 «결과 없음» 이 아니라 계약 오류다', async () => {
  searchMock.mockResolvedValue({ nextCursor: null });
  const hook = await mount('ab');
  await advance(SEARCH_DEBOUNCE_MS);
  expect(hook.result.current.status).toBe('error');
  expect(hook.result.current.error?.code).toBe(CLIENT_CONTRACT_ERROR);
});
