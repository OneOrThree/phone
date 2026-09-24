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
  questMemberRate,
  reducer,
  sessionSeconds,
} from '@/services/model';
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
