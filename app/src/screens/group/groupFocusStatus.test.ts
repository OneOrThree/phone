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
  test('entry가 없는 동안 idle snapshot 참조가 안정적이다', () => {
    const store = new GroupFocusStatusStore(jest.fn());

    expect(store.getState(USER_ID, DATE)).toBe(store.getState(USER_ID, DATE));
  });

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

  test('loading·최초 error는 미산출이고 이전 complete 뒤 갱신 실패만 stale count를 유지한다', async () => {
    const refresh = deferred<LeagueMemberResponse[]>();
    const load = jest
      .fn()
      .mockResolvedValueOnce([member('a', true)])
      .mockImplementationOnce(() => refresh.promise);
    const store = new GroupFocusStatusStore(load);
    await store.ensure(USER_ID, DATE);
    const pending = store.retry(USER_ID, DATE);

    expect(store.getState(USER_ID, DATE)).toEqual({ status: 'loading' });
    expect(deriveGroupFocusCount(['a'], store.getState(USER_ID, DATE))).toEqual({
      status: 'unavailable',
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

  test('coverage-unknown 이후 실패에서는 이전 complete 숫자를 되살리지 않는다', async () => {
    const rows100 = Array.from({ length: 100 }, (_, index) => member(String(index), false));
    const load = jest
      .fn()
      .mockResolvedValueOnce([member('a', true)])
      .mockResolvedValueOnce(rows100)
      .mockRejectedValueOnce(new Error('network'));
    const store = new GroupFocusStatusStore(load);

    await store.ensure(USER_ID, DATE);
    await store.retry(USER_ID, DATE);
    expect(store.getState(USER_ID, DATE).status).toBe('coverage-unknown');

    await store.retry(USER_ID, DATE);
    expect(store.getState(USER_ID, DATE).status).toBe('error');
    expect(deriveGroupFocusCount(['a'], store.getState(USER_ID, DATE))).toEqual({
      status: 'unavailable',
    });
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

  test('KST 자정 경계에서 interval을 기다리지 않고 새 cache key로 즉시 조회한다', async () => {
    let date = DATE;
    const load = jest.fn().mockResolvedValue([]);
    const store = new GroupFocusStatusStore(load);
    const controller = new GroupFocusPollingController({
      store,
      userId: USER_ID,
      getDate: () => date,
      getMsUntilNextDate: () => 1_000,
    });
    controller.setLifecycle({ screenFocused: true, appActive: true, hasGroups: true });
    controller.activate();
    await flushPromises();
    const oldDateListener = jest.fn();
    store.subscribe(USER_ID, DATE, oldDateListener);
    jest.advanceTimersByTime(999);
    expect(load).toHaveBeenCalledTimes(1);

    date = '2026-08-11';
    jest.advanceTimersByTime(1);

    expect(load).toHaveBeenNthCalledWith(1, DATE);
    expect(load).toHaveBeenNthCalledWith(2, '2026-08-11');
    expect(oldDateListener).toHaveBeenCalledTimes(1);
    expect(store.getState(USER_ID, DATE).status).toBe('idle');
    controller.dispose();
  });

  test('dispose 뒤 같은 user/date의 새 controller는 이전 ready cache 대신 즉시 재조회한다', async () => {
    const load = jest.fn().mockResolvedValue([]);
    const store = new GroupFocusStatusStore(load);
    const first = new GroupFocusPollingController({ store, userId: USER_ID, getDate: () => DATE });
    first.setLifecycle({ screenFocused: true, appActive: true, hasGroups: true });
    first.activate();
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);

    first.dispose();
    const second = new GroupFocusPollingController({ store, userId: USER_ID, getDate: () => DATE });
    second.setLifecycle({ screenFocused: true, appActive: true, hasGroups: true });
    second.activate();

    expect(load).toHaveBeenCalledTimes(2);
    second.dispose();
  });
});
