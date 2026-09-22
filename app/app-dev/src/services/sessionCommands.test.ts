/**
 * GROMO-2009 집중 세션 명령 회귀 — App이 쓰는 실제 createSessionCommands를
 * 실제 reducer와 함께 돌려 멱등 키 수명주기·세대 fence·정본 동기화·결과 1회 표시를 고정한다.
 */
import assert from 'node:assert/strict';
import { createSessionCommands, FocusApi, sessionFromServer } from '@/services/sessionCommands';
import { initialState, reducer, sessionSeconds } from '@/services/model';
import { ApiError } from '@/services/api/client';
import type { FocusFinishView, FocusSessionView } from '@/services/api/focusSessions';

jest.mock('@/services/api/session', () => ({ sessionGeneration: () => 0 }));

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
