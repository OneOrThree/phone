import type { LeagueMemberResponse } from '@/types/api';
import {
  deriveGroupFocusCount,
  GroupFocusPollingController,
  GroupFocusStatusStore,
} from './groupFocusStatus';

jest.mock('@/services/leagueApi', () => ({ getMyRanking: jest.fn() }));

const USER_ID = '00000000-0000-0000-0000-000000000001';
const DATE = '2026-08-10';

const member = (userId: string, isFocusing: boolean): LeagueMemberResponse =>
  ({ userId, isFocusing }) as LeagueMemberResponse;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('GroupFocusStatusStore coverage와 count', () => {
  test('raw 99행 이하는 완전한 응답이며 확인된 0명과 N명을 계산한다', async () => {
    const rows = [member('a', true), member('b', false)];
    const store = new GroupFocusStatusStore(jest.fn().mockResolvedValue(rows));
    await store.ensure(USER_ID, DATE);

    expect(deriveGroupFocusCount(['x'], store.getState(USER_ID, DATE))).toEqual({
      status: 'ready',
      count: 0,
    });
    expect(deriveGroupFocusCount(['a', 'b', 'missing'], store.getState(USER_ID, DATE))).toEqual({
      status: 'ready',
      count: 1,
    });
  });

  test('raw 100행은 coverage-unknown이며 숫자를 만들지 않는다', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => member(String(index), false));
    const store = new GroupFocusStatusStore(jest.fn().mockResolvedValue(rows));
    await store.ensure(USER_ID, DATE);

    expect(store.getState(USER_ID, DATE)).toEqual({ status: 'coverage-unknown' });
    expect(deriveGroupFocusCount([], store.getState(USER_ID, DATE))).toEqual({
      status: 'unavailable',
    });
  });

  test('최초 loading·error는 미산출이고 complete는 갱신 중 유지한 뒤 실패 시 stale이 된다', async () => {
    const refresh = deferred<LeagueMemberResponse[]>();
    const load = jest
      .fn()
      .mockResolvedValueOnce([member('a', true)])
      .mockImplementationOnce(() => refresh.promise);
    const store = new GroupFocusStatusStore(load);
    await store.ensure(USER_ID, DATE);
    const pending = store.retry(USER_ID, DATE);

    expect(store.getState(USER_ID, DATE)).toEqual({
      status: 'ready',
      data: [member('a', true)],
    });
    expect(deriveGroupFocusCount(['a'], store.getState(USER_ID, DATE))).toEqual({
      status: 'ready',
      count: 1,
    });
    refresh.reject(new Error('network'));
    await pending;

    const state = store.getState(USER_ID, DATE);
    expect(state.status).toBe('stale');
    expect(deriveGroupFocusCount(['a'], state)).toEqual({ status: 'stale', count: 1 });

    const failed = new GroupFocusStatusStore(jest.fn().mockRejectedValue(new Error('first')));
    await failed.ensure(USER_ID, DATE);
    expect(failed.getState(USER_ID, DATE).status).toBe('error');
    expect(deriveGroupFocusCount([], failed.getState(USER_ID, DATE))).toEqual({
      status: 'unavailable',
    });
  });

  test('coverage-unknown이 확인되면 이전 complete fallback을 폐기한다', async () => {
    const complete = [member('a', true)];
    const incomplete = Array.from({ length: 100 }, (_, index) => member(String(index), false));
    const load = jest
      .fn()
      .mockResolvedValueOnce(complete)
      .mockResolvedValueOnce(incomplete)
      .mockRejectedValueOnce(new Error('network'));
    const store = new GroupFocusStatusStore(load);

    await store.ensure(USER_ID, DATE);
    await store.retry(USER_ID, DATE);
    expect(store.getState(USER_ID, DATE)).toEqual({ status: 'coverage-unknown' });

    await store.retry(USER_ID, DATE);
    expect(store.getState(USER_ID, DATE).status).toBe('error');
  });

  test('같은 userId+date의 in-flight 요청은 ensure와 refresh가 공유한다', async () => {
    const pending = deferred<LeagueMemberResponse[]>();
    const load = jest.fn(() => pending.promise);
    const store = new GroupFocusStatusStore(load);

    const requests = [
      store.ensure(USER_ID, DATE),
      store.ensure(USER_ID, DATE),
      store.retry(USER_ID, DATE),
    ];
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve([]);
    await Promise.all(requests);
  });
});

describe('GroupFocusPollingController', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('첫 back 전에는 조회하지 않고 활성 foreground에서 즉시 조회한 뒤 60초마다 갱신한다', async () => {
    const load = jest.fn().mockResolvedValue([]);
    const store = new GroupFocusStatusStore(load);
    const controller = new GroupFocusPollingController({
      store,
      userId: USER_ID,
      getDate: () => DATE,
    });
    controller.setLifecycle({ screenFocused: true, appActive: true, hasGroups: true });
    expect(load).not.toHaveBeenCalled();

    controller.activate();
    expect(load).toHaveBeenCalledTimes(1);
    await flushPromises();
    jest.advanceTimersByTime(60_000);
    expect(load).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  test('새 controller의 첫 활성화는 이전 ready cache도 즉시 갱신한다', async () => {
    const load = jest.fn().mockResolvedValue([]);
    const store = new GroupFocusStatusStore(load);
    await store.ensure(USER_ID, DATE);
    expect(load).toHaveBeenCalledTimes(1);

    const controller = new GroupFocusPollingController({
      store,
      userId: USER_ID,
      getDate: () => DATE,
    });
    controller.setLifecycle({ screenFocused: true, appActive: true, hasGroups: true });
    controller.activate();

    expect(load).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  test('blur·background에서는 timer를 멈추고 복귀 때 즉시 한 번 갱신한다', async () => {
    const load = jest.fn().mockResolvedValue([]);
    const store = new GroupFocusStatusStore(load);
    const controller = new GroupFocusPollingController({
      store,
      userId: USER_ID,
      getDate: () => DATE,
    });
    controller.setLifecycle({ screenFocused: true, appActive: true, hasGroups: true });
    controller.activate();
    await flushPromises();

    controller.setLifecycle({ screenFocused: false, appActive: true, hasGroups: true });
    jest.advanceTimersByTime(120_000);
    expect(load).toHaveBeenCalledTimes(1);

    controller.setLifecycle({ screenFocused: true, appActive: true, hasGroups: true });
    expect(load).toHaveBeenCalledTimes(2);
    await flushPromises();
    controller.setLifecycle({ screenFocused: true, appActive: false, hasGroups: true });
    jest.advanceTimersByTime(60_000);
    expect(load).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  test('KST 날짜 변경은 다음 tick의 새 cache key로 조회한다', async () => {
    let date = DATE;
    const load = jest.fn().mockResolvedValue([]);
    const store = new GroupFocusStatusStore(load);
    const controller = new GroupFocusPollingController({
      store,
      userId: USER_ID,
      getDate: () => date,
    });
    controller.setLifecycle({ screenFocused: true, appActive: true, hasGroups: true });
    controller.activate();
    await flushPromises();
    date = '2026-08-11';
    jest.advanceTimersByTime(60_000);

    expect(load).toHaveBeenNthCalledWith(1, DATE);
    expect(load).toHaveBeenNthCalledWith(2, '2026-08-11');
    controller.dispose();
  });
});
