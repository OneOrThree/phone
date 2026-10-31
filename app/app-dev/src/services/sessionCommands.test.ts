/**
 * GROMO-2009 집중 세션 명령 회귀 — App이 쓰는 실제 createSessionCommands를
 * 실제 reducer와 함께 돌려 멱등 키 수명주기·세대 fence·정본 동기화·결과 1회 표시를 고정한다.
 */
import assert from 'node:assert/strict';
import {
  createSessionCommands,
  FocusApi,
  recordFromFinish,
  sessionFromServer,
} from '@/services/sessionCommands';
import {
  currentIsland,
  initialState,
  seaRouteHeld,
  visitRouteHeld,
  questMemberRate,
  questRate,
  reducer,
  todayFocusSeconds,
  sessionSeconds,
} from '@/services/model';
import { ApiError } from '@/services/api/client';
import type { FocusFinishView, FocusSessionView } from '@/services/api/focusSessions';
import { captureProductEvent } from '@/services/posthog';

jest.mock('@/services/api/session', () => ({ sessionGeneration: () => 0 }));
jest.mock('@/services/posthog', () => ({
  captureProductEvent: jest.fn(),
  getPostHogClient: () => null,
  initPostHog: () => {},
  trackPostHogScreen: () => {},
  identifyPostHogUser: () => {},
  resetPostHogUser: () => {},
}));

const view = (over: Partial<FocusSessionView> = {}): FocusSessionView => ({
  id: 'sess-1',
  islandId: 'srv-island',
  subject: '수학',
  targetMinutes: null,
  status: 'active',
  activeSeconds: 120,
  serverNow: '2026-09-22T01:00:00Z',
  startedAt: '2026-09-22T00:58:00Z',
  restStartedAt: null,
  version: 1,
  ...over,
});
const seaView = (over: Partial<FocusSessionView> = {}): FocusSessionView =>
  view({
    id: 'sea-1',
    islandId: 'dest-island',
    subject: '',
    targetMinutes: 30,
    kind: 'sea',
    destinationIslandName: '별고래섬',
    serverNow: new Date().toISOString(),
    ...over,
  });
const finish = (over: Partial<FocusFinishView> = {}): FocusFinishView => ({
  recordId: 'sess-1',
  islandId: 'srv-island',
  subject: '수학',
  targetMinutes: 25,
  activeSeconds: 1500,
  goalAchieved: true,
  earnedFish: 25,
  allocation: { personalFishAdded: 0, constructionFishAdded: 25 },
  completedAt: '2026-09-22T01:00:00Z',
  questProgress: [],
  ...over,
});

// 실제 reducer로 state를 돌리고 dispatch·세대·키 생성·API 호출을 전부 기록한다.
const harness = (api: Partial<FocusApi> = {}) => {
  let state = initialState(false),
    gen = 0,
    keyN = 0;
  const dispatched: { type: string; [k: string]: unknown }[] = [],
    calls: string[] = [];
  const wrap = <T extends unknown[], R>(name: string, fn?: (...args: T) => Promise<R>) =>
    fn &&
    ((...args: T) => {
      calls.push(`${name}(${JSON.stringify(args)})`);
      return fn(...args);
    });
  const cmds = createSessionCommands({
    dispatch: (a) => {
      dispatched.push(a);
      state = reducer(state, a as never);
    },
    getSession: () => state.session,
    getSnap: () => state.serverIslands,
    generation: () => gen,
    newKey: () => `k${++keyN}`,
    api: {
      current: wrap('current', api.current ?? (async () => null))!,
      pendingResult: wrap('pendingResult', api.pendingResult ?? (async () => null))!,
      start: wrap('start', api.start ?? (async () => view()))!,
      pause: wrap('pause', api.pause ?? (async () => view({ status: 'paused', version: 2 })))!,
      resume: wrap('resume', api.resume ?? (async () => view({ version: 3 })))!,
      finish: wrap('finish', api.finish ?? (async () => finish()))!,
      acknowledge: wrap('acknowledge', api.acknowledge ?? (async () => null))!,
      startSea: wrap('startSea', api.startSea ?? (async () => seaView()))!,
      telescope: wrap('telescope', api.telescope ?? (async () => ({ items: [] }) as never))!,
      tutorialReward:
        api.tutorialReward ?? (async (sessionId) => ({ sessionId, status: 'granted' })),
      tutorialExperienceReward:
        api.tutorialExperienceReward ?? (async (islandId) => ({ islandId, status: 'granted' })),
    },
  });
  return {
    cmds: cmds.commands,
    dispatched,
    calls,
    state: () => state,
    join: () => {
      state = reducer(state, {
        type: 'ISLAND_SYNC',
        memberships: {
          items: [{ id: 'srv-island' }],
          nextCursor: null,
          currentIslandId: 'srv-island',
          lossReason: null,
        },
      } as never);
    },
    bumpGen: () => {
      gen += 1;
    },
  };
};

test('체험 보상은 세션 API·로컬 정산을 호출하지 않고 계정 변경 응답을 버린다', async () => {
  const h = harness();
  h.join();
  const original = h.state();
  expect(await h.cmds.tutorialExperienceReward('srv-island')).toEqual({
    islandId: 'srv-island',
    status: 'granted',
  });
  expect(h.calls).toEqual([]);
  expect(h.dispatched).toEqual([]);
  expect(h.state()).toBe(original);
  let resolve!: (value: { islandId: string; status: 'granted' }) => void;
  const late = harness({
    tutorialExperienceReward: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  late.join();
  const pending = late.cmds.tutorialExperienceReward('srv-island');
  late.bumpGen();
  resolve({ islandId: 'srv-island', status: 'granted' });
  await expect(pending).rejects.toMatchObject({ code: 'CLIENT_STALE_SESSION' });
  expect(late.dispatched).toEqual([]);
});

test('체험 보상의 다른 섬·잘못된 계약·실패를 성공 처리하거나 집중 복구로 전환하지 않는다', async () => {
  const request = jest.fn().mockResolvedValue({ islandId: 'other', status: 'granted' });
  const h = harness({ tutorialExperienceReward: request });
  h.join();
  await expect(h.cmds.tutorialExperienceReward('other')).rejects.toBeDefined();
  expect(request).not.toHaveBeenCalled();
  await expect(h.cmds.tutorialExperienceReward('srv-island')).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
  request.mockRejectedValue(new ApiError('GROUP_NOT_FOUND', '없는 섬', 404));
  await expect(h.cmds.tutorialExperienceReward('srv-island')).rejects.toBeDefined();
  expect(h.calls).toEqual([]);
});

test('첫 물고기 지급 확인은 시간·잔액을 조작하지 않고 같은 세션 복구에도 유지된다', async () => {
  const h = harness({ current: async () => view() });
  h.join();
  await h.cmds.start({ subject: '수학' });
  const fish = currentIsland(h.state()).fish;
  await h.cmds.tutorialReward('sess-1');
  expect(h.state().session?.tutorialFish).toBe(true);
  expect(h.state().session?.seconds).toBe(120);
  expect(currentIsland(h.state()).fish).toBe(fish);
  await h.cmds.recover();
  expect(h.state().session?.tutorialFish).toBe(true);
});

test('계정 변경 뒤 늦은 첫 물고기 응답은 버린다', async () => {
  let resolve!: (value: { sessionId: string; status: 'granted' }) => void;
  const h = harness({
    tutorialReward: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  h.join();
  await h.cmds.start({ subject: '수학' });
  const pending = h.cmds.tutorialReward('sess-1');
  h.bumpGen();
  resolve({ sessionId: 'sess-1', status: 'granted' });
  await expect(pending).rejects.toMatchObject({ code: 'CLIENT_STALE_SESSION' });
  expect(h.state().session?.tutorialFish).toBeUndefined();
});

test('start — memberships current 로 POST 하고 성공 뒤 세션·version 을 싣는다', async () => {
  const h = harness();
  h.join();
  const result = await h.cmds.start({ subject: '수학' });
  assert.equal(h.calls[0], 'start([{"islandId":"srv-island","subject":"수학"},"k1"])');
  assert.equal(result.version, 1);
  assert.equal(h.state().session?.id, 'sess-1');
  assert.equal(h.state().session?.version, 1);
  assert.equal(h.state().session?.status, 'active');
});

test('start — 고른 자리(0~100)는 seat 로 싣고, 범위 밖·없음이면 키를 생략한다 (GROMO-2478)', async () => {
  const h = harness();
  h.join();
  await h.cmds.start({ subject: '수학', seat: { x: 34.1, y: 55.9 } });
  assert.equal(
    h.calls[0],
    'start([{"islandId":"srv-island","subject":"수학","seat":{"x":34.1,"y":55.9}},"k1"])',
  );
  const legacy = harness();
  legacy.join();
  await legacy.cmds.start({ subject: '수학', seat: { x: 340, y: 55.9 } });
  assert.equal(legacy.calls[0], 'start([{"islandId":"srv-island","subject":"수학"},"k1"])');
});

test('start — 소속 current 가 없으면 요청을 보내지 않고 ISLAND_NOT_CURRENT', async () => {
  const h = harness();
  const error = await h.cmds.start({ subject: '수학' }).catch((e) => e);
  assert.equal(error.code, 'ISLAND_NOT_CURRENT');
  assert.equal(h.calls.length, 0);
});

test('pause·resume — expectedVersion 에 세션 version 을 싣고 응답으로 갱신한다', async () => {
  const h = harness();
  h.join();
  await h.cmds.start({ subject: '수학' });

  const paused = await h.cmds.pause();
  assert.equal(h.calls[1], 'pause(["sess-1",1,"k2"])');
  assert.equal(paused.status, 'paused');
  assert.equal(h.state().session?.status, 'paused');
  assert.equal(h.state().session?.version, 2);

  await h.cmds.resume();
  assert.equal(h.calls[2], 'resume(["sess-1",2,"k3"])');
  assert.equal(h.state().session?.status, 'active');
  assert.equal(h.state().session?.version, 3);
});

test('finish — 정산 뷰를 기록·결과로 반영하고 진행 세션을 닫는다', async () => {
  const h = harness();
  h.join();
  await h.cmds.start({ subject: '수학' });

  const result = await h.cmds.finish();
  assert.equal(h.calls[1], 'finish(["sess-1",1,"k2"])');
  assert.equal(result.earnedFish, 25);
  assert.equal(h.state().session, null);
  assert.equal(h.state().lastResult?.id, 'sess-1');
  assert.equal(h.state().lastResult?.fish, 25);
  assert.equal(h.state().records[0].id, 'sess-1');
  assert.equal(h.state().lastResult?.ackId, undefined);
});

test('finish — 섬/바다 집중 장소 요약(focus_location_summary)을 발행한다', async () => {
  const capture = captureProductEvent as jest.Mock;
  capture.mockClear();
  const h = harness({
    finish: async () => finish({ recordId: 'r-sea', activeSeconds: 900, kind: 'sea' }),
  });
  h.join();
  await h.cmds.start({ subject: '수학' });
  await h.cmds.finish();

  const summary = capture.mock.calls.find(([event]) => event === 'focus_location_summary');
  assert.ok(summary, 'focus_location_summary 가 발행되어야 한다');
  assert.deepEqual(summary[1], {
    record_id: 'r-sea',
    duration_seconds: 900,
    island_seconds: 0,
    sea_seconds: 900,
    unknown_seconds: 0,
    metrics_schema_version: 1,
    analytics_excluded: 0,
  });
});

test('멱등 재시도 — 응답 유실·retryable 실패는 같은 키·같은 body 로 다시 보낸다', async () => {
  let attempts = 0;
  const h = harness({
    start: async () => {
      attempts += 1;
      if (attempts === 1) throw new ApiError('CLIENT_NETWORK_ERROR', '끊김', 0);
      return view();
    },
  });
  h.join();
  const first = await h.cmds.start({ subject: '수학' }).catch((e) => e);
  assert.equal(first.code, 'CLIENT_NETWORK_ERROR');
  // 같은 의도(subject)의 재시도 — 키가 바뀌지 않는다
  await h.cmds.start({ subject: '수학' });
  assert.equal(attempts, 2);
  const keys = h.calls.map((c) => c.match(/"(k\d+)"\]\)$/)?.[1]);
  assert.equal(keys[0], 'k1');
  assert.equal(keys[1], 'k1');
});

test('STATE_CONFLICT — current 재조회로 정본을 맞춘 뒤 원 오류를 다시 던진다', async () => {
  const h = harness({
    pause: async () => {
      throw new ApiError('STATE_CONFLICT', '지금 상태에서는 처리할 수 없습니다.', 409);
    },
    current: async () =>
      view({ status: 'paused', version: 7, restStartedAt: '2026-09-22T01:05:00Z' }),
  });
  h.join();
  await h.cmds.start({ subject: '수학' });

  const error = await h.cmds.pause().catch((e) => e);
  assert.equal(error.code, 'STATE_CONFLICT');
  // 재조회 결과가 state 에 반영됐다 — version 7, paused
  assert.equal(h.state().session?.version, 7);
  assert.equal(h.state().session?.status, 'paused');
  assert.equal(h.calls.at(-1), 'current([])');
});

test('휴식 자동 종료 후 재개 충돌 — recover 가 미확인 결과를 복구한다', async () => {
  const h = harness({
    pause: async () =>
      view({ status: 'paused', version: 2, restStartedAt: '2026-09-22T01:05:00Z' }),
    resume: async () => {
      throw new ApiError('STATE_CONFLICT', '이미 종료된 집중이에요.', 409);
    },
    pendingResult: async () => finish(),
  });
  h.join();
  await h.cmds.start({ subject: '수학' });
  await h.cmds.pause();
  const error = await h.cmds.resume().catch((e) => e);
  assert.equal(error.code, 'STATE_CONFLICT');
  assert.equal(h.state().session, null);

  assert.equal(await h.cmds.recover(), 'focusResult');
  assert.equal(h.state().lastResult?.ackId, 'sess-1');
  assert.equal(h.state().resultFromRest, true);
});

test('늦은 휴식 복구 응답은 동시에 성공한 재개 상태를 덮지 않는다', async () => {
  let releaseCurrent!: (value: FocusSessionView | null) => void;
  const h = harness({
    current: () => new Promise<FocusSessionView | null>((resolve) => (releaseCurrent = resolve)),
  });
  h.join();
  await h.cmds.start({ subject: '수학' });
  await h.cmds.pause();
  const recovering = h.cmds.recover().catch((error) => error);
  await h.cmds.resume();
  releaseCurrent(view({ status: 'paused', version: 2 }));
  const error = await recovering;
  assert.equal(error.code, 'CLIENT_RECOVERY_DEFERRED');
  assert.equal(h.state().session?.status, 'active');
  assert.equal(h.state().session?.version, 3);
});

test('세대가 바뀐 늦은 응답은 CLIENT_STALE_SESSION — state 를 덮지 않는다', async () => {
  let release!: (v: FocusSessionView) => void;
  const h = harness({
    start: () => new Promise<FocusSessionView>((resolve) => (release = resolve)),
  });
  h.join();
  const pending = h.cmds.start({ subject: '수학' }).catch((e) => e);
  h.bumpGen();
  release(view());
  const error = await pending;
  assert.equal(error.code, 'CLIENT_STALE_SESSION');
  assert.equal(h.state().session, null);
});

test('recover — active 는 focus, paused 는 rest 로 복구한다', async () => {
  const h = harness({
    current: async () => view({ status: 'paused', restStartedAt: '2026-09-22T01:05:00Z' }),
  });
  const route = await h.cmds.recover();
  assert.equal(route, 'rest');
  assert.equal(h.state().session?.status, 'paused');
  assert.equal(h.state().session?.seconds, 120);

  const h2 = harness({ current: async () => view() });
  assert.equal(await h2.cmds.recover(), 'focus');
  assert.equal(h2.state().session?.status, 'active');
});

test('recover — 미확인 결과는 ackId 를 단 기록으로 focusResult 를 복구하고, acknowledge 가 지운다', async () => {
  const h = harness({ pendingResult: async () => finish() });
  const route = await h.cmds.recover();
  assert.equal(route, 'focusResult');
  const result = h.state().lastResult;
  assert.equal(result?.id, 'sess-1');
  assert.equal(result?.ackId, 'sess-1');
  assert.equal(h.state().resultFromRest, true);

  await h.cmds.acknowledge('sess-1');
  assert.equal(h.calls.at(-1), 'acknowledge(["sess-1"])');
  assert.equal(h.state().lastResult?.ackId, undefined);
});

test('recover — 진행 세션이 없고 결과도 없으면 null', async () => {
  const h = harness();
  assert.equal(await h.cmds.recover(), null);
  assert.equal(h.state().session, null);
});

test('sessionFromServer — serverNow 를 anchor 로 삼아 화면이 경과를 이어 센다', () => {
  const mapped = sessionFromServer(view({ activeSeconds: 120, serverNow: '2026-09-22T01:00:00Z' }));
  // serverNow +10초 시점에는 130초로 읽힌다
  assert.equal(sessionSeconds(mapped, Date.parse('2026-09-22T01:00:10Z')), 130);
  const paused = sessionFromServer(
    view({ status: 'paused', restStartedAt: '2026-09-22T01:05:00Z' }),
  );
  assert.equal(sessionSeconds(paused, Date.parse('2026-09-22T01:10:00Z')), 120);
  assert.equal(paused.restStartedAt, Date.parse('2026-09-22T01:05:00Z'));
});

// GROMO-2131 — activeIntervals 매핑
test('sessionFromServer/recordFromFinish — activeIntervals 를 ms {start,end} 로 그대로 옮긴다', () => {
  const spans = [
    { startedAt: '2026-08-01T14:00:00Z', endedAt: '2026-08-01T15:00:00Z' },
    { startedAt: '2026-08-01T15:00:00Z', endedAt: '2026-08-01T15:15:00Z' },
  ];
  const mapped = sessionFromServer(view({ activeIntervals: spans }));
  assert.deepEqual(mapped.intervals, [
    { start: Date.parse('2026-08-01T14:00:00Z'), end: Date.parse('2026-08-01T15:00:00Z') },
    { start: Date.parse('2026-08-01T15:00:00Z'), end: Date.parse('2026-08-01T15:15:00Z') },
  ]);
  const record = recordFromFinish(finish({ activeIntervals: spans }));
  assert.deepEqual(record.intervals, [
    { start: Date.parse('2026-08-01T14:00:00Z'), end: Date.parse('2026-08-01T15:00:00Z') },
    { start: Date.parse('2026-08-01T15:00:00Z'), end: Date.parse('2026-08-01T15:15:00Z') },
  ]);
});

// GROMO-2382 — 낚시섬 결과창이 받은 꾸미기 아이템을 보이도록 기록에 싣는다. 없거나 비면 키째 없다.
test('recordFromFinish — seaReward.grantedProductIds 를 rewards 로 옮긴다', () => {
  const granted = { grantedProductIds: ['cust.head.mandarin'], minutesToNextTier: null };
  assert.deepEqual(recordFromFinish(finish({ seaReward: granted })).rewards, [
    'cust.head.mandarin',
  ]);
  const none = { grantedProductIds: [], minutesToNextTier: null };
  assert.equal('rewards' in recordFromFinish(finish({ seaReward: none })), false);
  assert.equal('rewards' in recordFromFinish(finish({ seaReward: null })), false);
});

test('recordFromFinish — newProductIds 중 받은 것만 newRewards 로, 없거나 null 이면 키가 없다', () => {
  const reward = (newProductIds?: string[] | null) => ({
    grantedProductIds: ['cust.head.mandarin'],
    minutesToNextTier: null,
    ...(newProductIds !== undefined ? { newProductIds } : {}),
  });
  assert.deepEqual(
    recordFromFinish(finish({ seaReward: reward(['cust.head.mandarin', 'cust.neck.bell']) }))
      .newRewards,
    ['cust.head.mandarin'],
  );
  assert.equal('newRewards' in recordFromFinish(finish({ seaReward: reward([]) })), false);
  assert.equal('newRewards' in recordFromFinish(finish({ seaReward: reward(null) })), false);
  assert.equal('newRewards' in recordFromFinish(finish({ seaReward: reward() })), false);
});

// 구버전 서버는 activeIntervals 자체를 안 보낸다 — []가 아니라 undefined 로 남아야 기존
// 폴백(seconds 를 at 직전으로 뭉뚱그리는 합성 구간)이 그대로 작동한다. 회귀 방지.
test('activeIntervals 가 없으면 intervals 는 undefined 다 (빈 배열이면 당일 집중이 사라진다)', () => {
  assert.equal(sessionFromServer(view()).intervals, undefined);
  assert.equal(recordFromFinish(finish()).intervals, undefined);
});

// 파싱 못 하는 시각이 섞이면 구간 전체를 버리고 기존 폴백으로 — NaN 이 합산을 오염시키지 않게.
test('activeIntervals 에 파싱 불가 시각이 있으면 intervals 는 undefined 다', () => {
  const spans = [
    { startedAt: '2026-08-01T14:00:00Z', endedAt: '2026-08-01T15:00:00Z' },
    { startedAt: 'not-a-time', endedAt: '2026-08-01T15:15:00Z' },
  ];
  assert.equal(sessionFromServer(view({ activeIntervals: spans })).intervals, undefined);
  assert.equal(recordFromFinish(finish({ activeIntervals: spans })).intervals, undefined);
});

// 구버전 서버 때 구간 없이 저장된 결과가 새 서버에서 같은 recordId 로 재생되면 구간만 채운다.
test('같은 recordId 결과가 구간과 함께 재생되면 기존 기록의 intervals 를 채운다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  const base = { recordId: 'replayed', islandId: island.id, completedAt: '2026-08-01T16:00:00Z' };
  s = reducer(s, {
    type: 'SESSION_RESULT',
    record: recordFromFinish(finish(base)),
    fromRest: false,
  } as never);
  const fishAfterFirst = currentIsland(s).fish;
  const ledgerAfterFirst = currentIsland(s).ledger.length;
  const spans = [{ startedAt: '2026-08-01T15:45:00Z', endedAt: '2026-08-01T16:00:00Z' }];
  s = reducer(s, {
    type: 'SESSION_RESULT',
    record: recordFromFinish(finish({ ...base, activeIntervals: spans })),
    fromRest: false,
  } as never);
  const saved = s.records.filter((r) => r.id === 'replayed');
  assert.equal(saved.length, 1);
  // 보상은 첫 도착 때 한 번만 — 재생이 잔액·원장을 다시 늘리지 않는다.
  assert.equal(currentIsland(s).fish, fishAfterFirst);
  assert.equal(currentIsland(s).ledger.length, ledgerAfterFirst);
  assert.deepEqual(saved[0].intervals, [
    { start: Date.parse('2026-08-01T15:45:00Z'), end: Date.parse('2026-08-01T16:00:00Z') },
  ]);
});

// 티켓 DoD — 어제 60분 + 오늘 15분짜리 세션의 시간대(하루) 퀘스트 진행률은 오늘 15분만 센다.
// KST 기준 2026-08-01T15:00:00Z = 8/2 00:00. 목표 30분짜리 오늘의 집중 퀘스트라 15분=50%.
// 자정 직후 45분 휴식을 끼운다 — 연속 세션이면 구간 없이 [now-누적, now] 로 소급해도 15분이 나와
// 회귀를 못 잡는다. 휴식이 있으면 소급은 어제 45분을 오늘로 끌어와 100% 가 된다.
test('활성 세션 — activeIntervals + 실시간 꼬리로 오늘 퀘스트 진행률은 어제분을 빼고 센다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  const serverNow = '2026-08-01T15:45:00Z'; // KST 8/2 00:45 — 휴식 끝, 재개 직후
  const now = Date.parse('2026-08-01T16:00:00Z'); // KST 8/2 01:00 — 재개 후 15분 경과
  const mapped = sessionFromServer(
    view({
      id: 'cross-midnight-live',
      islandId: island.id,
      status: 'active',
      activeSeconds: 3600, // 어제분 60분까지 서버가 이미 합산해 둔 상태
      serverNow,
      version: 3,
      activeIntervals: [
        { startedAt: '2026-08-01T14:00:00Z', endedAt: '2026-08-01T15:00:00Z' }, // 어제 60분
        { startedAt: serverNow, endedAt: serverNow }, // 막 재개한 열린 구간(serverNow 로 닫힘)
      ],
    }),
  );
  s = reducer(s, { type: 'SESSION_SYNC', session: mapped } as never);

  const rate = questMemberRate(s, island.quests[0], 'me', island.id, now);
  assert.equal(island.quests[0].target, 30);
  assert.equal(rate, 50);
});

test('종료 후 — recordFromFinish 의 activeIntervals 로도 오늘 퀘스트 진행률은 어제분을 빼고 센다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  const now = Date.parse('2026-08-01T16:00:00Z'); // KST 8/2 01:00
  const record = recordFromFinish(
    finish({
      recordId: 'cross-midnight-finished',
      islandId: island.id,
      activeSeconds: 4500, // 75분(어제 60 + 오늘 15)
      completedAt: '2026-08-01T16:00:00Z',
      activeIntervals: [
        { startedAt: '2026-08-01T14:00:00Z', endedAt: '2026-08-01T15:00:00Z' }, // 어제 60분
        { startedAt: '2026-08-01T15:45:00Z', endedAt: '2026-08-01T16:00:00Z' }, // 오늘 15분
      ],
    }),
  );
  s = reducer(s, { type: 'SESSION_RESULT', record, fromRest: false } as never);

  const rate = questMemberRate(s, island.quests[0], 'me', island.id, now);
  assert.equal(rate, 50);
});

// GROMO-2310 바다 항해 집중
describe('startSea', () => {
  test('목적지 하나만 보내고 정본을 SESSION_SYNC 로 반영한다 — 종류·항해 분·목적지 이름을 지닌다', async () => {
    const h = harness();
    await h.cmds.startSea('dest-island');
    assert.deepEqual(h.calls, ['startSea(["dest-island","k1"])']);
    const session = h.state().session;
    assert.equal(session?.kind, 'sea');
    assert.equal(session?.islandId, 'dest-island');
    assert.equal(session?.targetMinutes, 30);
    assert.equal(session?.destinationIslandName, '별고래섬');
  });

  test('409 SEA_DESTINATION_UNAVAILABLE — 목록에 아직 있으면 새 키로 한 번만 다시 시도한다', async () => {
    let n = 0;
    const h = harness({
      startSea: async () => {
        n += 1;
        if (n === 1) throw new ApiError('SEA_DESTINATION_UNAVAILABLE', '없어요', 409);
        return seaView();
      },
      telescope: async () => ({ items: [{ islandId: 'dest-island' }] }) as never,
    });
    await h.cmds.startSea('dest-island');
    assert.deepEqual(h.calls, [
      'startSea(["dest-island","k1"])',
      'telescope([])',
      'startSea(["dest-island","k2"])',
    ]);
    assert.equal(h.state().session?.kind, 'sea');
  });

  test('409 뒤 목록에서 빠졌으면 다시 시도하지 않고 원 오류를 던진다', async () => {
    const h = harness({
      startSea: async () => {
        throw new ApiError('SEA_DESTINATION_UNAVAILABLE', '없어요', 409);
      },
      telescope: async () => ({ items: [{ islandId: 'other' }] }) as never,
    });
    const error = await h.cmds.startSea('dest-island').catch((thrown) => thrown);
    assert.equal(error.code, 'SEA_DESTINATION_UNAVAILABLE');
    assert.equal(h.calls.filter((c) => c.startsWith('startSea')).length, 1);
    assert.equal(h.state().session, null);
  });

  test('재시도도 409 면 두 번에서 멈춘다', async () => {
    const h = harness({
      startSea: async () => {
        throw new ApiError('SEA_DESTINATION_UNAVAILABLE', '없어요', 409);
      },
      telescope: async () => ({ items: [{ islandId: 'dest-island' }] }) as never,
    });
    const error = await h.cmds.startSea('dest-island').catch((thrown) => thrown);
    assert.equal(error.code, 'SEA_DESTINATION_UNAVAILABLE');
    assert.equal(h.calls.filter((c) => c.startsWith('startSea')).length, 2);
  });
});

test('recover — 바다 세션은 휴식·집중이 아니라 항해 화면(sea)으로 복구한다', async () => {
  const h = harness({ current: async () => seaView() });
  assert.equal(await h.cmds.recover(), 'sea');
  assert.equal(h.state().session?.kind, 'sea');
});

test('sessionFromServer — 섬 집중은 바다 필드를 키째 싣지 않는다', () => {
  const mapped = sessionFromServer(view({ targetMinutes: 25 }));
  assert.equal('kind' in mapped, false);
  assert.equal('targetMinutes' in mapped, false);
  assert.equal('destinationIslandName' in mapped, false);
});

test('recover — 실제 wire 의 소문자 kind(sea)로 항해 화면 복구·항해 분·목적지 이름·수신 시각을 보존한다', async () => {
  const wire = JSON.parse(
    JSON.stringify({ ...view(), kind: 'sea', targetMinutes: 45, destinationIslandName: '별섬' }),
  ) as FocusSessionView;
  const h = harness({ current: async () => wire });
  const before = Date.now();
  assert.equal(await h.cmds.recover(), 'sea');
  const session = h.state().session!;
  assert.equal(session.kind, 'sea');
  assert.equal(session.targetMinutes, 45);
  assert.equal(session.destinationIslandName, '별섬');
  assert.ok(session.syncedAt! >= before);
  // 섬 집중(kind=island)은 휴식·집중 분기 그대로다
  const h2 = harness({ current: async () => view({ kind: 'island', targetMinutes: 25 }) });
  assert.equal(await h2.cmds.recover(), 'focus');
  assert.equal('targetMinutes' in h2.state().session!, false);
});

test('startSea — 응답 유실 뒤 같은 키 재시도면 시계 차이와 무관하게 current 를 1회 읽어 그 값으로 맞춘다', async () => {
  let n = 0;
  // 재생 응답은 최초 응답 그대로(activeSeconds 0) 이고 serverNow 도 몇 초 전이라 시계 차로는 구분되지 않는다
  const replayed = seaView({
    activeSeconds: 0,
    serverNow: new Date(Date.now() - 5_000).toISOString(),
  });
  const currentNow = new Date(Date.now() - 1_000).toISOString();
  const h = harness({
    startSea: async () => {
      n += 1;
      if (n === 1) throw new ApiError('CLIENT_NETWORK_ERROR', '유실', 0);
      return replayed;
    },
    current: async () => seaView({ activeSeconds: 40, serverNow: currentNow }),
  });
  const error = await h.cmds.startSea('dest-island').catch((thrown) => thrown);
  assert.equal(error.code, 'CLIENT_NETWORK_ERROR');
  const latest = await h.cmds.startSea('dest-island');
  assert.deepEqual(h.calls, [
    'startSea(["dest-island","k1"])',
    'startSea(["dest-island","k1"])',
    'current([])',
  ]);
  assert.equal(latest?.activeSeconds, 40);
  assert.equal(h.state().session?.seconds, 40);
  assert.equal(h.state().session?.startedAt, Date.parse(currentNow));
  // 첫 시도 성공(재생처럼 보이는 옛 serverNow 라도)은 current 를 읽지 않는다
  const h2 = harness({
    startSea: async () => seaView({ serverNow: new Date(Date.now() - 20 * 60_000).toISOString() }),
  });
  await h2.cmds.startSea('dest-island');
  assert.deepEqual(h2.calls, ['startSea(["dest-island","k1"])']);
});

test('startSea — 재시도 사이 다른 기기가 항해를 끝내고 섬 집중을 시작했으면 그 섬 집중을 돌려주고 반영한다', async () => {
  let n = 0;
  const h = harness({
    startSea: async () => {
      n += 1;
      if (n === 1) throw new ApiError('CLIENT_NETWORK_ERROR', '유실', 0);
      return seaView({ activeSeconds: 0 });
    },
    current: async () => view({ kind: 'island' }),
  });
  await h.cmds.startSea('dest-island').catch(() => {});
  const latest = await h.cmds.startSea('dest-island');
  assert.equal(latest?.kind, 'island');
  assert.equal(h.state().session?.id, 'sess-1');
  assert.equal(h.state().session?.kind, 'island');
});

test('바다 항해 기록은 목적지 섬의 오늘 집중·퀘스트에 들어가지 않고, 섬 집중·kind 없는 옛 기록은 들어간다', () => {
  const base = initialState(true),
    islandId = base.islandId;
  const quest = { id: 'q', title: '집중', type: 'focus' as const, target: 10, claimed: false };
  const settle = (over: Partial<FocusFinishView>) =>
    reducer(base, {
      type: 'SESSION_RESULT',
      record: recordFromFinish(
        finish({ islandId, activeSeconds: 60, completedAt: new Date().toISOString(), ...over }),
      ),
    } as never);
  const sea = settle({ recordId: 'sea-1', kind: 'sea', arrived: true } as never);
  assert.equal(sea.records[0].kind, 'sea');
  assert.equal(todayFocusSeconds(sea, islandId), todayFocusSeconds(base, islandId));
  assert.equal(questRate(sea, quest, islandId), questRate(base, quest, islandId));
  const island = settle({ recordId: 'isl-1', kind: 'island' } as never);
  assert.equal(todayFocusSeconds(island, islandId) - todayFocusSeconds(base, islandId), 60);
  assert.equal(questRate(island, quest, islandId), (questRate(base, quest, islandId) ?? 0) + 10);
  const legacy = settle({ recordId: 'old-1' });
  assert.equal('kind' in legacy.records[0], false);
  assert.equal(todayFocusSeconds(legacy, islandId) - todayFocusSeconds(base, islandId), 60);
  // 진행 중 바다 항해도 목적지 섬 퀘스트의 실시간 꼬리로 더하지 않는다
  const sailing = {
    ...base,
    session: sessionFromServer(seaView({ islandId, activeSeconds: 300 })),
  };
  assert.equal(
    questMemberRate(sailing, quest, 'me', islandId),
    questMemberRate(base, quest, 'me', islandId),
  );
});

test('ISLAND_SYNC — 가입하지 않은 섬을 목적지로 한 바다 세션은 남기고, 비소속 섬 집중은 정리한다', () => {
  const sync = (session: unknown) =>
    reducer(
      { ...initialState(true), session } as never,
      {
        type: 'ISLAND_SYNC',
        memberships: {
          items: [{ id: 'home-island' }],
          nextCursor: null,
          currentIslandId: 'home-island',
          lossReason: null,
        },
      } as never,
    ).session;
  const sea = sessionFromServer(seaView({ islandId: 'not-mine' }));
  assert.equal(sync(sea)?.id, 'sea-1');
  assert.equal(sync(sessionFromServer(view({ islandId: 'not-mine' }))), null);
});

test('seaRouteHeld — 소속 0 이어도 항해·표류(세션 없음)·결과창은 지키고 바다 밖 라우트는 지키지 않는다', () => {
  assert.equal(seaRouteHeld('sea'), true); // 세션이 끝난 표류도 정상 상태
  assert.equal(seaRouteHeld('seaArrival'), true);
  assert.equal(seaRouteHeld('seaMagazine'), true); // 바다에서 펼친 잡지(GROMO-2314)
  assert.equal(seaRouteHeld('home'), false);
  assert.equal(seaRouteHeld('focus'), false);
});

test('visitRouteHeld — 방문 중인 방문 지도만 지키고, 방문이 끝나면(id 없음) 평소 검사로 돌아간다', () => {
  assert.equal(visitRouteHeld('visitIsland', 'isl'), true);
  assert.equal(visitRouteHeld('visitIsland', null), false);
  for (const r of ['manage', 'raft', 'board', 'notice', 'members', 'visitIslandFocus'] as const)
    assert.equal(visitRouteHeld(r, 'isl'), true);
  assert.equal(visitRouteHeld('manage', null), false);
  assert.equal(visitRouteHeld('home', 'isl'), false);
});

test('바다 finish 응답을 잃으면(결과 불명) 세션을 지우지 않고, 재시도는 같은 키로 나간다', async () => {
  let n = 0;
  const h = harness({
    current: async () => seaView(),
    finish: async () => {
      n += 1;
      if (n === 1) throw new ApiError('CLIENT_NETWORK_ERROR', '유실', 0);
      return { ...finish(), recordId: 'sea-1', arrived: true } as never;
    },
  });
  await h.cmds.recover();
  const error = await h.cmds.finish().catch((thrown) => thrown);
  assert.equal(error.code, 'CLIENT_NETWORK_ERROR');
  assert.equal(h.state().session?.id, 'sea-1'); // 결과 불명 — current 재조회로 지우지 않는다
  await h.cmds.finish();
  const keys = h.calls
    .filter((c) => c.startsWith('finish'))
    .map((c) => JSON.parse(c.slice(7, -1))[2]);
  assert.equal(keys.length, 2);
  assert.equal(keys[1], keys[0]);
});

test('출항은 recover 의 옛 응답 무효화 대상 — 표류 화면 조회(current=null) 중 출항해도 새 세션이 남는다', async () => {
  let answer!: (v: FocusSessionView | null) => void;
  let calls = 0;
  const h = harness({
    current: () => {
      calls += 1;
      return calls === 1 ? new Promise((r) => (answer = r)) : Promise.resolve(null);
    },
  });
  const recovering = h.cmds.recover().catch((thrown) => thrown);
  await h.cmds.startSea('dest-island');
  assert.equal(h.state().session?.id, 'sea-1');
  answer(null); // 출항 전에 읽은 «세션 없음» 이 늦게 도착
  const result = await recovering;
  assert.equal(result.code, 'CLIENT_RECOVERY_DEFERRED');
  assert.equal(h.state().session?.id, 'sea-1');
});

test('startSea — 확정 4xx(STATE_CONFLICT·403)는 의도 키를 풀고, 결과 불명(네트워크)은 같은 키를 지킨다', async () => {
  const errors = [
    new ApiError('STATE_CONFLICT', '이미 진행 중', 409),
    new ApiError('SOCIAL_LOGIN_REQUIRED', '게스트', 403),
    new ApiError('CLIENT_NETWORK_ERROR', '유실', 0),
  ];
  const h = harness({
    startSea: async () => {
      const next = errors.shift();
      if (next) throw next;
      return seaView();
    },
  });
  for (let i = 0; i < 3; i += 1) await h.cmds.startSea('dest-island').catch(() => {});
  await h.cmds.startSea('dest-island');
  assert.deepEqual(
    h.calls.filter((c) => c.startsWith('startSea')),
    [
      'startSea(["dest-island","k1"])',
      'startSea(["dest-island","k2"])',
      'startSea(["dest-island","k3"])',
      'startSea(["dest-island","k3"])',
    ],
  );
});

test('finish(target) — 결과 불명 뒤 복구가 로컬 세션을 지웠어도 같은 (세션, version) 키로 한 번 더 묻는다', async () => {
  let n = 0,
    live = true;
  const h = harness({
    current: async () => (live ? seaView() : null),
    finish: async () => {
      n += 1;
      if (n === 1) throw new ApiError('CLIENT_NETWORK_ERROR', '유실', 0);
      return { ...finish(), recordId: 'sea-1', kind: 'sea', arrived: true } as never;
    },
  });
  await h.cmds.recover();
  await h.cmds.finish().catch(() => {});
  // App 쪽 복구가 current=null 을 읽어 로컬 세션을 지웠다
  live = false;
  await h.cmds.recover();
  assert.equal(h.state().session, null);
  const result = await h.cmds.finish({ id: 'sea-1', version: 1 });
  assert.equal(result.recordId, 'sea-1');
  const finishes = h.calls.filter((c) => c.startsWith('finish'));
  assert.equal(finishes.length, 2);
  assert.equal(finishes[1], finishes[0]);
  // 대상 없이 세션도 없으면 서버에 묻지 않는다(기존 동작)
  await assert.rejects(h.cmds.finish(), { code: 'STATE_CONFLICT' });
  assert.equal(h.calls.filter((c) => c.startsWith('finish')).length, 2);
});

test('finish(target) — 로컬에 대상과 다른 진행 세션이 있으면 서버를 부르지 않고 STATE_CONFLICT', async () => {
  const h = harness({ current: async () => seaView({ id: 'sea-2' }) });
  await h.cmds.recover();
  await assert.rejects(h.cmds.finish({ id: 'sea-1', version: 1 }), { code: 'STATE_CONFLICT' });
  assert.equal(h.calls.filter((c) => c.startsWith('finish')).length, 0);
  assert.equal(h.state().session?.id, 'sea-2');
});
