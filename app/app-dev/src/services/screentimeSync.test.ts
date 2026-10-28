import { createAndroidScreenTimeSync } from './screentimeSync';
import { dayKey, initialState, reducer } from './model';
import type { AndroidUsageSnapshot, ScreenTimeAuthorization } from './ScreenTimeModule';

function harness() {
  let now = Date.parse('2026-09-22T12:00:00+09:00');
  let stored: string | null = null;
  const status = jest.fn<Promise<ScreenTimeAuthorization>, []>().mockResolvedValue('approved');
  const read = jest.fn<Promise<AndroidUsageSnapshot>, []>().mockImplementation(async () => ({
    date: dayKey(now),
    minutes: 30,
    previousDate: dayKey(now - 86400000),
    previousMinutes: 60,
  }));
  const save = jest.fn(async (value: string) => {
    stored = value;
  });
  const deps = {
    status,
    read,
    save,
    load: async () => stored,
    now: () => now,
    clear: async () => {
      stored = null;
    },
  };
  return {
    sync: createAndroidScreenTimeSync(deps),
    deps,
    status,
    read,
    save,
    advance: (days = 1) => {
      now += days * 86400000;
    },
    stored: () => stored,
    corrupt: () => {
      stored = '{broken';
    },
  };
}

test('첫 승인 이전 기록은 가져오지 않고 실제 0분은 보존한다', async () => {
  const h = harness();
  h.read.mockResolvedValueOnce({
    date: '2026-09-22',
    minutes: 0,
    previousDate: '2026-09-21',
    previousMinutes: 40,
  });
  expect(await h.sync()).toMatchObject({ approved: true, minutes: 0, history: [] });
});

test('다음 날 어제 기록을 확정하고 재시작 후에도 감소한 관측값으로 덮지 않는다', async () => {
  const h = harness();
  await h.sync();
  h.advance();
  const restarted = createAndroidScreenTimeSync(h.deps);
  expect((await restarted()).history).toEqual([{ date: '2026-09-22', minutes: 60 }]);
  h.read.mockResolvedValueOnce({
    date: '2026-09-23',
    minutes: 5,
    previousDate: '2026-09-22',
    previousMinutes: 10,
  });
  expect(await restarted()).toMatchObject({
    minutes: 30,
    history: [{ date: '2026-09-22', minutes: 60 }],
  });
});

test('권한 철회와 재승인은 미확인 날짜를 0분 기록으로 바꾸지 않는다', async () => {
  const h = harness();
  await h.sync();
  h.advance();
  h.status.mockResolvedValue('denied');
  expect(await h.sync()).toMatchObject({
    approved: false,
    minutes: null,
    unconfirmedDays: ['2026-09-22', '2026-09-23'],
  });
  h.status.mockResolvedValue('approved');
  expect(await h.sync()).toMatchObject({
    approved: true,
    history: [],
    unconfirmedDays: ['2026-09-22', '2026-09-23'],
  });
});

test('오래 실행하지 않은 기간은 미확인으로 남기고 어제만 복원한다', async () => {
  const h = harness();
  await h.sync();
  h.advance(4);
  expect(await h.sync()).toMatchObject({
    history: [{ date: '2026-09-25', minutes: 60 }],
    unconfirmedDays: ['2026-09-22', '2026-09-23', '2026-09-24'],
  });
});

test('자정을 넘긴 조회는 저장하지 않고 다음 조회에서 복구한다', async () => {
  const h = harness();
  h.read.mockImplementationOnce(async () => {
    h.advance();
    return { date: '2026-09-22', minutes: 1, previousDate: '2026-09-21', previousMinutes: 2 };
  });
  await expect(h.sync()).rejects.toThrow('STALE_OR_INVALID_USAGE');
  expect(h.save).not.toHaveBeenCalled();
  expect((await h.sync()).date).toBe('2026-09-23');
});

test('조회 실패는 기존 기록을 보존하고 후속 호출을 막지 않는다', async () => {
  const h = harness();
  await h.sync();
  const before = h.stored();
  h.read.mockRejectedValueOnce(new Error('USER_LOCKED'));
  await expect(h.sync()).rejects.toThrow('USER_LOCKED');
  expect(h.stored()).toBe(before);
  expect((await h.sync()).minutes).toBe(30);
});

test('조회 도중 권한이 철회되면 사용량을 저장하지 않는다', async () => {
  const h = harness();
  h.status.mockResolvedValueOnce('approved').mockResolvedValueOnce('denied');
  await expect(h.sync()).rejects.toThrow('USAGE_ACCESS_CHANGED');
  expect(h.save).not.toHaveBeenCalled();
});

test('동시 요청은 직렬 처리하고 초기화는 진행 중 저장 이후 실행한다', async () => {
  const h = harness();
  let release!: () => void;
  h.read.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { date: '2026-09-22', minutes: 70, previousDate: '2026-09-21', previousMinutes: 0 };
  });
  const first = h.sync();
  const second = h.sync();
  const reset = h.sync.reset();
  while (!release) await Promise.resolve();
  expect(h.read).toHaveBeenCalledTimes(1);
  release();
  expect((await first).minutes).toBe(70);
  expect((await second).minutes).toBe(70);
  await reset;
  expect(h.stored()).toBeNull();
});

test('손상된 저장소를 성공한 0분 측정으로 간주하지 않는다', async () => {
  const h = harness();
  h.corrupt();
  await expect(h.sync()).rejects.toThrow();
  expect(h.save).not.toHaveBeenCalled();
});

test('측정 실패 스냅샷은 측정 완료 표시를 해제하고 기존 분 값을 숨긴다', () => {
  const state = initialState(true);
  state.screenMinutes = 90;
  const next = reducer(state, {
    type: 'SCREEN_TIME_SNAPSHOT',
    snapshot: {
      approved: true,
      date: '2026-09-22',
      minutes: null,
      history: [],
      unconfirmedDays: ['2026-09-21'],
    },
  });
  expect(next.settings.permission).toBe(true);
  expect(next.settings.screenTimeMeasurementReady).toBe(false);
  expect(next.settings.screenTimeHistoryReady).toBe(false);
  expect(next.screenDays?.['2026-09-21']).toBeNull();
  expect(next.screenMinutes).toBe(90);
});

test('자정 후 새 측정 전까지 이전 날짜의 분 값을 새 날짜에 쓰지 않는다', () => {
  const state = initialState(true);
  state.settings.screenTimeMeasurementDay = '2026-09-22';
  state.screenMinutes = 90;
  const next = reducer(state, { type: 'TICK', now: Date.parse('2026-09-23T00:00:01+09:00') });
  expect(next.screenDays?.['2026-09-23']).toBeNull();
});

test('같은 날 권한을 다시 승인해도 미확인 오늘은 측정 완료로 표시하지 않는다', async () => {
  const h = harness();
  await h.sync();
  h.status.mockResolvedValue('denied');
  await h.sync();
  h.status.mockResolvedValue('approved');
  const snapshot = await h.sync();
  const next = reducer(initialState(true), {
    type: 'SCREEN_TIME_SNAPSHOT',
    snapshot,
    now: Date.parse('2026-09-22T12:00:00+09:00'),
  });
  expect(next.settings.permission).toBe(true);
  expect(next.settings.screenTimeMeasurementReady).toBe(false);
  expect(next.screenDays?.['2026-09-22']).toBeNull();
});

test('자정 직후 동기화 시작 전 TICK도 전날 부분 기록으로 보상을 만들지 않는다', () => {
  const state = initialState(true);
  const island = state.islands.find((i) => i.id === state.islandId)!;
  island.members = [];
  const quest = island.quests.find((q) => q.type === 'screen')!;
  quest.rounds = {
    '2026-09-22': {
      targets: ['me'],
      achieved: [],
      claimed: [],
      bonus: false,
      target: quest.target,
      kind: 'screen',
    },
  };
  state.screenDays = { '2026-09-22': 0 };
  state.settings.screenTimeMeasurementDay = '2026-09-22';
  state.settings.screenTimeHistoryDay = '2026-09-22';
  state.settings.screenTimeHistoryReady = true;
  const now = Date.parse('2026-09-23T00:00:01+09:00');
  const pending = reducer(state, { type: 'TICK', now });
  expect(pending.rewards?.some((r) => r.day === '2026-09-22')).toBeFalsy();
  const settled = reducer(pending, {
    type: 'SCREEN_TIME_SNAPSHOT',
    now,
    snapshot: {
      approved: true,
      date: '2026-09-23',
      minutes: 0,
      history: [{ date: '2026-09-22', minutes: quest.target + 60 }],
      unconfirmedDays: [],
    },
  });
  expect(settled.rewards?.some((r) => r.day === '2026-09-22')).toBeFalsy();
});

test('계정별 저장소는 기록·미확인 날짜를 공유하지 않고 대기 중 이전 계정 조회를 폐기한다', async () => {
  const h = harness();
  let owner = 'A';
  const records = new Map<string, string>();
  const sync = createAndroidScreenTimeSync({
    ...h.deps,
    owner: () => owner,
    load: async (id) => records.get(id) ?? null,
    save: async (value, id) => {
      records.set(id, value);
    },
    clear: async (id) => {
      records.delete(id);
    },
  });
  await sync();
  h.advance();
  h.status.mockResolvedValue('denied');
  await sync();
  h.status.mockResolvedValue('approved');
  owner = 'B';
  expect(await sync()).toMatchObject({ history: [], unconfirmedDays: [] });
  expect(records.size).toBe(2);
  let release!: () => void;
  h.read.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { date: '2026-09-23', minutes: 200, previousDate: '2026-09-22', previousMinutes: 300 };
  });
  const before = records.get('B');
  const pending = sync();
  const queued = sync();
  const failed = Promise.allSettled([pending, queued]);
  while (!release) await Promise.resolve();
  owner = 'A';
  release();
  expect((await failed).map((r) => r.status)).toEqual(['rejected', 'rejected']);
  expect(records.get('B')).toBe(before);
  expect((await sync()).unconfirmedDays).toEqual(['2026-09-22', '2026-09-23']);
  await sync.reset();
  expect(records.has('A')).toBe(false);
  expect(records.has('B')).toBe(true);
});
