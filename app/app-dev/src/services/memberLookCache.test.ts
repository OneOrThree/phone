import { MemberLookCache, type MemberLookBatch } from './memberLookCache';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const look = (version: number, head: string | null = 'duck') => ({
  head,
  neck: null,
  shoes: null,
  version,
});
const batch = (ids: string[], version = 1): MemberLookBatch => ({
  members: ids.map((userId) => ({ userId, catColor: 'black', appearance: look(version) })),
  hiddenUserIds: [],
});
const deferred = () => {
  let resolve!: (value: MemberLookBatch) => void;
  const promise = new Promise<MemberLookBatch>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('여러 화면의 중복 조회를 합치고 이후 표시는 HTTP를 호출하지 않는다', async () => {
  const fetch = jest.fn(async (ids: string[]) => batch(ids));
  const cache = new MemberLookCache(fetch);
  await Promise.all([cache.ensure([id(1), id(2)]), cache.ensure([id(2), id(3)])]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith([id(1), id(2), id(3)]);
  await cache.ensure([id(1), id(2)]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('큰 목록도 요청당 50명을 넘지 않는다', async () => {
  const fetch = jest.fn(async (ids: string[]) => batch(ids));
  const cache = new MemberLookCache(fetch);
  await cache.ensure(Array.from({ length: 120 }, (_, n) => id(n)));
  expect(fetch.mock.calls.map(([ids]) => ids.length)).toEqual([50, 50, 20]);
});

test('최초 조회 중 받은 새 외양을 늦은 응답이 덮지 않고 털색은 복원한다', async () => {
  const response = deferred();
  const cache = new MemberLookCache(() => response.promise);
  const loading = cache.ensure([id(1)]);
  await Promise.resolve();
  cache.accept(id(1), look(5, 'new'));
  response.resolve(batch([id(1)], 2));
  await loading;
  expect(cache.get(id(1))?.appearance).toEqual(look(5, 'new'));
  expect(cache.get(id(1))?.catColor).toBe('black');
  cache.accept(id(1), look(3, 'old'));
  expect(cache.get(id(1))?.appearance?.head).toBe('new');
});

test('계정 변경 전의 늦은 응답은 캐시를 복구하지 못한다', async () => {
  const response = deferred();
  const cache = new MemberLookCache(() => response.promise);
  const loading = cache.ensure([id(1)]);
  await Promise.resolve();
  cache.clear();
  response.resolve(batch([id(1)]));
  await loading;
  await Promise.resolve();
  expect(cache.get(id(1))).toBeUndefined();
});

test('차단·탈퇴 응답은 새 버전의 이전 복사본도 지우며 이벤트가 되살리지 못한다', async () => {
  const fetch = jest.fn(async (ids: string[]) => batch(ids, 9));
  const cache = new MemberLookCache(fetch);
  await cache.ensure([id(1)]);
  fetch.mockResolvedValueOnce({ members: [], hiddenUserIds: [id(1)] });
  await cache.ensure([id(1)], true);
  cache.accept(id(1), look(10));
  expect(cache.get(id(1))).toEqual({ catColor: null, appearance: null, hidden: true });
});

test('만료·재접속 때 복구하고 장애 시에는 재시도 폭주를 막는다', async () => {
  let time = 0;
  const fetch = jest.fn(async (ids: string[]) => batch(ids));
  const cache = new MemberLookCache(fetch, () => time, 3, 100);
  await cache.ensure([id(1)]);
  time = 101;
  await cache.ensure([id(1)]);
  await cache.ensure([id(1)], true);
  expect(fetch).toHaveBeenCalledTimes(3);
  fetch.mockRejectedValueOnce(new Error('offline'));
  await cache.ensure([id(2)]);
  await cache.ensure([id(2)]);
  expect(fetch).toHaveBeenCalledTimes(4);
  time += 30_001;
  await cache.ensure([id(2)]);
  expect(fetch).toHaveBeenCalledTimes(5);
});

test('캐시 크기는 제한하고 이벤트의 null은 장착 해제로 반영한다', async () => {
  const cache = new MemberLookCache(async (ids) => batch(ids), Date.now, 2);
  await cache.ensure([id(1), id(2), id(3)]);
  expect(cache.get(id(1))).toBeUndefined();
  cache.accept(id(3), look(2, null));
  expect(cache.get(id(3))?.appearance?.head).toBeNull();
});

test('첫 배치가 실패하면 남은 배치도 요청 없이 끝내고 대기 후 다시 조회한다', async () => {
  let time = 0;
  const fetch = jest.fn(async (ids: string[]) => batch(ids));
  fetch.mockRejectedValueOnce(new Error('offline'));
  const cache = new MemberLookCache(fetch, () => time);
  const ids = Array.from({ length: 120 }, (_, n) => id(n));
  await cache.ensure(ids);
  expect(fetch).toHaveBeenCalledTimes(1);
  await cache.ensure(ids);
  expect(fetch).toHaveBeenCalledTimes(1);
  time += 30_001;
  await cache.ensure(ids);
  expect(fetch.mock.calls.map(([wanted]) => wanted.length)).toEqual([50, 50, 50, 20]);
  expect(cache.get(id(119))?.hidden).toBe(false);
});

test('주기 조회는 털색을 갱신하고 더 최신인 착용 이벤트를 보존한다', async () => {
  let time = 0;
  const fetch = jest.fn(async (ids: string[]) => batch(ids));
  const cache = new MemberLookCache(fetch, () => time);
  await cache.ensure([id(1)]);
  time = 29_000;
  cache.accept(id(1), look(5, 'new'));
  fetch.mockResolvedValueOnce({
    members: [{ userId: id(1), catColor: 'white', appearance: look(1) }],
    hiddenUserIds: [],
  });
  await cache.ensure([id(1)]);
  expect(fetch).toHaveBeenCalledTimes(1);
  time = 30_000;
  await Promise.all([cache.ensure([id(1)]), cache.ensure([id(1)])]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(cache.get(id(1))).toEqual({
    catColor: 'white',
    appearance: look(5, 'new'),
    hidden: false,
  });
});
