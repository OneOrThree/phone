/**
 * GROMO-2006 명령 오케스트레이션 회귀 — App이 쓰는 실제 createIslandCommands를
 * 실제 reducer와 함께 돌려 멱등 키 수명주기·세대 fence·정본 동기화 순서를 고정한다.
 */
import assert from 'node:assert/strict';
import { createIslandCommands, IslandApi } from '@/services/islandCommands';
import { initialState, reducer } from '@/services/model';
import { ApiError } from '@/services/api/client';
import type { Account } from '@/services/api/auth';
import type { IslandSummary, MyIslands, MyJoinRequest } from '@/services/api/islands';

jest.mock('@/services/api/session', () => ({ sessionGeneration: () => 0 }));

const island = (over: Partial<IslandSummary> = {}): IslandSummary => ({
  id: 'i1',
  name: '섬',
  intro: '',
  visibility: 'public',
  approvalRequired: false,
  memberCount: 1,
  maxMembers: 15,
  membershipStatus: 'none',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
  ...over,
});
const myIslands = (over: Partial<MyIslands> = {}): MyIslands => ({
  items: [],
  nextCursor: null,
  currentIslandId: null,
  lossReason: null,
  ...over,
});
const account = (over: Partial<Account> = {}): Account => ({
  id: 'u1',
  name: '수빈',
  catColor: 'black',
  mainIslandId: null,
  linkedProviders: [],
  onboardingComplete: true,
  ...over,
});
const myReq = (over: Partial<MyJoinRequest> = {}): MyJoinRequest => ({
  id: 'r1',
  islandId: 'i1',
  status: 'pending',
  version: 3,
  islandName: '섬',
  memberCount: 2,
  maxMembers: 15,
  createdAt: '2026-09-21T00:00:00Z',
  ...over,
});

// 실제 reducer로 state를 돌리고 dispatch·go·세대·키 생성을 전부 기록한다.
const harness = (api: Partial<IslandApi> = {}) => {
  let state = initialState(false),
    gen = 0,
    keyN = 0;
  const dispatched: { type: string; [k: string]: unknown }[] = [],
    went: [string, string | undefined][] = [],
    bootErrors: boolean[] = [];
  const cmds = createIslandCommands({
    dispatch: (a) => {
      dispatched.push(a);
      state = reducer(state, a as never);
    },
    go: (r, id) => went.push([r, id]),
    getSnap: () => state.serverIslands,
    generation: () => gen,
    newKey: () => `key-${++keyN}`,
    setBootError: (on) => bootErrors.push(on),
    // syncIslands가 /me도 읽는다 — 지정 없으면 무소속 계정 기본값으로 막아 진짜 fetch를 막는다
    api: { me: async () => account(), ...api },
  });
  return {
    cmds,
    dispatched,
    went,
    bootErrors,
    state: () => state,
    setGen: (g: number) => {
      gen = g;
    },
  };
};
const types = (h: ReturnType<typeof harness>) => h.dispatched.map((a) => a.type);

test('join pending — requestId를 requestStatus에 남기고 approval로 간다', async () => {
  const join = jest.fn(async () => ({
    status: 'pending' as const,
    requestId: 'r1',
    islandId: 'i1',
    currentIslandId: null,
    version: 3,
  }));
  const h = harness({ join });
  const r = await h.cmds.commands.join('i1');
  assert.equal(r.status, 'pending');
  assert.ok(types(h).includes('ISLAND_REQUEST'));
  assert.deepEqual(h.went, [['approval', 'i1']]);
  assert.equal(h.state().serverIslands!.requestStatus[0].status, 'pending');
});

test('join 키 수명주기 — 응답 유실 재시도는 같은 키, 확정 후 재신청은 새 키', async () => {
  const calls: { idempotencyKey: string }[] = [];
  let failFirst = true;
  const join = jest.fn(async (_id: string, opts: { idempotencyKey: string }) => {
    calls.push(opts);
    if (failFirst) {
      failFirst = false;
      throw new ApiError('CLIENT_NETWORK_ERROR', 'lost', 0);
    }
    return {
      status: 'pending' as const,
      requestId: 'r1',
      islandId: 'i1',
      currentIslandId: null,
      version: 3,
    };
  });
  // 결과 불명 오류는 /me/islands 를 재조회한다(GROMO-2118) — 실제 네트워크로 새지 않게 막는다.
  const h = harness({
    join,
    myIslands: async () => myIslands(),
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await assert.rejects(h.cmds.commands.join('i1'));
  await h.cmds.commands.join('i1');
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey); // 재시도는 같은 키
  await h.cmds.commands.join('i1'); // 취소·거절 뒤 같은 섬 재신청 = 새 의도
  assert.notEqual(calls[2].idempotencyKey, calls[1].idempotencyKey); // 새 키
});

test('join active — /me/islands 재조회로 current를 확정한다', async () => {
  const join = jest.fn(async () => ({
    status: 'active' as const,
    requestId: null,
    islandId: 'i1',
    currentIslandId: 'i1',
    version: 1,
  }));
  const my = jest.fn(async () => myIslands({ items: [island()], currentIslandId: 'i1' }));
  const h = harness({
    join,
    myIslands: my,
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await h.cmds.commands.join('i1');
  assert.equal(my.mock.calls.length, 1);
  assert.ok(types(h).includes('ISLAND_SYNC'));
  assert.equal(h.state().onboarded, true);
});

test('join active — 두 번째 섬 가입 뒤 /me 정본으로 mainIslandId가 최신 가입 섬으로 갱신된다', async () => {
  // GROMO-2054: 서버 도출은 «가장 최근 가입»이라 두 번째 가입 성공 순간 메인이 i2로 바뀐다.
  // ISLAND_SYNC가 mainIslandId를 싣지 않으면 앱 상태는 첫 섬에 남아 프로필·선택값이 갈린다.
  const me = jest
    .fn<Promise<Account>, []>()
    .mockResolvedValueOnce(account({ mainIslandId: 'i1' }))
    .mockResolvedValue(account({ mainIslandId: 'i2' }));
  const h = harness({
    me,
    join: async () => ({
      status: 'active' as const,
      requestId: null,
      islandId: 'i2',
      currentIslandId: 'i2',
      version: 1,
    }),
    myIslands: jest
      .fn<Promise<MyIslands>, []>()
      .mockResolvedValueOnce(myIslands({ items: [island({ id: 'i1' })], currentIslandId: 'i1' }))
      .mockResolvedValue(
        myIslands({
          items: [island({ id: 'i1' }), island({ id: 'i2' })],
          currentIslandId: 'i2',
        }),
      ),
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await h.cmds.commands.sync(); // 부팅 동기화 — 서버는 i1이 메인
  assert.equal(h.state().mainIslandId, 'i1');

  await h.cmds.commands.join('i2');

  assert.equal(h.state().mainIslandId, 'i2');
  assert.ok(me.mock.calls.length >= 2); // 동기화마다 /me 정본을 읽는다
});

test('status approved — memberships 재조회 성공 뒤에만 종결을 공개한다', async () => {
  const approved = {
    id: 'r1',
    islandId: 'i1',
    status: 'approved' as const,
    version: 4,
  };
  let syncFails = true;
  const h = harness({
    joinRequest: async () => approved,
    myIslands: async () => {
      if (syncFails) throw new ApiError('CLIENT_NETWORK_ERROR', 'lost', 0);
      return myIslands({ items: [island()], currentIslandId: 'i1' });
    },
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  // 재조회 실패 → ISLAND_REQUEST를 공개하지 않는다(미확정 성공 카드 방지)
  await assert.rejects(h.cmds.commands.status('r1'));
  assert.ok(!types(h).includes('ISLAND_REQUEST'));
  // 재시도 성공 → ISLAND_SYNC가 ISLAND_REQUEST보다 먼저다
  syncFails = false;
  await h.cmds.commands.status('r1');
  const t = types(h);
  assert.ok(t.indexOf('ISLAND_SYNC') < t.indexOf('ISLAND_REQUEST'));
});

test('cancel — 실제 cancelled를 requestStatus에 기록하고 version을 합성하지 않는다', async () => {
  const h = harness({
    cancelJoinRequest: async () => ({ id: 'r1', status: 'cancelled' as const }),
    myJoinRequests: jest
      .fn()
      .mockResolvedValueOnce({ items: [myReq()], nextCursor: null }) // 시드 목록
      .mockResolvedValueOnce({ items: [], nextCursor: null }), // 취소 후 재조회
  });
  await h.cmds.commands.requests();
  await h.cmds.commands.cancel('r1');
  const entry = h.state().serverIslands!.requestStatus.find((x) => x.id === 'r1');
  assert.equal(entry?.status, 'cancelled');
  assert.equal(entry?.version, 3); // 합성 없이 기존 version 유지
  assert.ok(h.state().serverIslands!.joinRequests.every((x) => x.id !== 'r1'));
});

test('세대가 바뀐 늦은 응답은 dispatch·go·반환 없이 CLIENT_STALE_SESSION으로 버린다', async () => {
  const h = harness({
    join: async () => ({
      status: 'pending' as const,
      requestId: 'r1',
      islandId: 'i1',
      currentIslandId: null,
      version: 3,
    }),
  });
  const join = h.cmds.commands.join('i1');
  h.setGen(1); // 응답 도착 전 계정이 바뀌었다
  await assert.rejects(join, /세대|로그인 정보/);
  assert.equal(h.dispatched.length, 0);
  assert.equal(h.went.length, 0);
});

test('세대 전환은 멱등 키·초대 token을 버린다', async () => {
  const joins: { idempotencyKey: string; invitationToken?: string }[] = [];
  const h = harness({
    resolveInvite: async () => ({
      island: island({ id: 'i9' }),
      invitationToken: 'tok-a',
    }),
    join: jest.fn(
      async (_id: string, opts: { idempotencyKey: string; invitationToken?: string }) => {
        joins.push(opts);
        return {
          status: 'pending' as const,
          requestId: 'r9',
          islandId: 'i9',
          currentIslandId: null,
          version: 1,
        };
      },
    ),
  });
  await h.cmds.commands.resolveInvite('CODE');
  await h.cmds.commands.join('i9');
  assert.equal(joins[0].invitationToken, 'tok-a');
  h.setGen(1); // 세션 교체 — 옛 token·키를 들고 있으면 안 된다
  await h.cmds.commands.join('i9');
  assert.equal(joins[1].invitationToken, undefined);
  assert.notEqual(joins[1].idempotencyKey, joins[0].idempotencyKey);
});

test('call 오류 경로 — 세대 전환 뒤 도착한 409는 재조회·rethrow 없이 CLIENT_STALE_SESSION으로 버린다', async () => {
  const myMock = jest.fn(async () => myIslands());
  let h: ReturnType<typeof harness>;
  h = harness({
    join: async () => {
      h.setGen(1); // 요청이 날아간 뒤 계정이 바뀌었다 — 늦게 도착한 409
      throw new ApiError('STATE_CONFLICT', 'conflict', 409);
    },
    myIslands: myMock,
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await assert.rejects(h.cmds.commands.join('i1'), (e: ApiError) => {
    assert.equal(e.code, 'CLIENT_STALE_SESSION');
    return true;
  });
  assert.equal(myMock.mock.calls.length, 0); // recovery GET 없음
  assert.equal(h.dispatched.length, 0); // 새 세션 스냅샷도 건드리지 않는다
});

test('call 오류 경로 — 같은 세대의 409는 memberships를 재조회하고 원 오류를 던진다', async () => {
  const my = jest.fn(async () => myIslands());
  const h = harness({
    join: async () => {
      throw new ApiError('STATE_CONFLICT', 'conflict', 409);
    },
    myIslands: my,
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await assert.rejects(h.cmds.commands.join('i1'), (e: ApiError) => {
    assert.equal(e.code, 'STATE_CONFLICT'); // 원 오류가 호출부로 간다
    return true;
  });
  assert.equal(my.mock.calls.length, 1); // 재조회는 살아 있는 세대에서만
});

const createInput = { name: '빛섬', intro: '', approvalRequired: false, maxMembers: 15 };
const timedOutCreate = async () => {
  throw new ApiError('UPSTREAM_TIMEOUT', '응답 시간이 초과되었습니다.', 400);
};

test('create 결과 불명 — 재조회에서 입력한 이름의 새 섬이 current면 성공으로 끝낸다', async () => {
  // GROMO-2118: Business→Data 타임아웃이어도 Data는 섬을 이미 만들었다. 실패로 보이면 다시 만든다.
  const created = island({ id: 'new', name: '빛섬', membershipStatus: 'active' });
  const h = harness({
    createIsland: timedOutCreate,
    myIslands: async () => myIslands({ items: [created], currentIslandId: 'new' }),
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await h.cmds.commands.create(createInput);
  assert.equal(h.state().serverIslands?.currentIslandId, 'new');
});

test('create 결과 불명 — 재조회에 새 섬이 없으면 원 오류를 던진다', async () => {
  const mine = island({ id: 'old', name: '빛섬', membershipStatus: 'active' });
  const h = harness({
    createIsland: timedOutCreate,
    myIslands: async () => myIslands({ items: [mine], currentIslandId: 'old' }),
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await h.cmds.commands.sync(); // 이미 소속된 같은 이름의 섬 — 새로 생긴 게 아니다
  await assert.rejects(h.cmds.commands.create(createInput), (e: ApiError) => {
    assert.equal(e.code, 'UPSTREAM_TIMEOUT');
    return true;
  });
});

test('쓰기 결과 불명 — 재조회가 실패해도 원 오류를 던진다', async () => {
  for (const code of [
    'UPSTREAM_TIMEOUT',
    'REQUEST_IN_PROGRESS',
    'CLIENT_TIMEOUT',
    'CLIENT_NETWORK_ERROR',
  ]) {
    const my = jest.fn(async (): Promise<MyIslands> => {
      throw new ApiError('CLIENT_NETWORK_ERROR', 'offline', 0);
    });
    const h = harness({
      join: async () => {
        throw new ApiError(code, 'unknown outcome', 0);
      },
      myIslands: my,
      myJoinRequests: async () => ({ items: [], nextCursor: null }),
    });
    await assert.rejects(h.cmds.commands.join('i1'), (e: ApiError) => {
      assert.equal(e.code, code);
      return true;
    });
    assert.equal(my.mock.calls.length, 1, code); // 쓰기는 재조회를 시도한다
  }
});

test('조회 결과 불명 — 승인 대기 폴링의 타임아웃은 소속을 재조회하지 않는다', async () => {
  const my = jest.fn(async () => myIslands());
  const h = harness({
    joinRequest: async () => {
      throw new ApiError('CLIENT_TIMEOUT', 'slow', 0);
    },
    myIslands: my,
  });
  await assert.rejects(h.cmds.commands.status('r1'));
  assert.equal(my.mock.calls.length, 0);
});

test('call 오류 경로 — 재조회 도중 세대가 죽으면 원 오류 대신 CLIENT_STALE_SESSION', async () => {
  let h: ReturnType<typeof harness>;
  h = harness({
    join: async () => {
      throw new ApiError('STATE_CONFLICT', 'conflict', 409); // join 시점엔 gen0 — 살아 있음
    },
    myIslands: async () => {
      h.setGen(1); // recovery GET 도중 계정이 바뀌었다
      return myIslands();
    },
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await assert.rejects(h.cmds.commands.join('i1'), (e: ApiError) => {
    assert.equal(e.code, 'CLIENT_STALE_SESSION'); // 원 오류 STATE_CONFLICT를 rethrow하지 않는다
    return true;
  });
  assert.equal(h.dispatched.length, 0); // 죽은 세대의 재조회 결과는 dispatch되지 않는다
});

test('commands.sync — 세대가 죽은 채 동기화가 끝나면 오류 플래그를 내리지 않는다', async () => {
  let h: ReturnType<typeof harness>;
  h = harness({
    myIslands: async () => {
      h.setGen(1); // 응답 도착 직전에 계정이 바뀌었다
      return myIslands({ items: [island()], currentIslandId: 'i1' });
    },
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await assert.rejects(h.cmds.commands.sync(), (e: ApiError) => {
    assert.equal(e.code, 'CLIENT_STALE_SESSION');
    return true;
  });
  assert.equal(h.bootErrors.length, 0); // setBootError(false)를 쓰지 않는다
});

test('syncIslands — null current+소속은 유효(첫 pending 승인), items 밖 current만 계약 결함', async () => {
  // 첫 승인 필요 섬 가입 신청이 소속을 만들어도 current는 안 옮는다 — 정상 응답
  const h = harness({
    myIslands: async () => myIslands({ items: [island()], currentIslandId: null }),
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  const my = await h.cmds.syncIslands();
  assert.equal(my.currentIslandId, null);
  assert.ok(types(h).includes('ISLAND_SYNC'));
  assert.equal(h.state().onboarded, false);
  assert.equal(h.state().serverIslands!.memberships.length, 1);
  // items 밖 current는 계약 결함 — fail closed
  const bad = harness({
    myIslands: async () => myIslands({ items: [island()], currentIslandId: 'ghost' }),
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await assert.rejects(bad.cmds.syncIslands(), (e: ApiError) => {
    assert.equal(e.code, 'UPSTREAM_CONTRACT_ERROR');
    return true;
  });
  assert.equal(bad.dispatched.length, 0);
});

test('explore의 memberships도 같은 정합 검사를 거친다', async () => {
  const h = harness({
    explore: async () => ({
      memberships: myIslands({ items: [island()], currentIslandId: 'ghost' }),
      islands: { items: [island()], nextCursor: null },
    }),
    myJoinRequests: async () => ({ items: [], nextCursor: null }),
  });
  await assert.rejects(h.cmds.commands.explore(), (e: ApiError) => {
    assert.equal(e.code, 'UPSTREAM_CONTRACT_ERROR');
    return true;
  });
  assert.equal(h.dispatched.length, 0);
});

test('sync·explore·requests는 21개 이상 신청을 모든 cursor에서 모아 중복 없이 반영한다', async () => {
  const first = Array.from({ length: 20 }, (_, n) => myReq({ id: `r${n}` }));
  const rest = [myReq({ id: 'r19' }), myReq({ id: 'r20' })];
  const pages = jest.fn(async ({ cursor }: { cursor?: string } = {}) =>
    cursor ? { items: rest, nextCursor: null } : { items: first, nextCursor: 'next' },
  );
  const h = harness({
    myIslands: async () => myIslands(),
    myJoinRequests: pages,
    explore: async () => ({ memberships: myIslands(), islands: { items: [], nextCursor: null } }),
  });
  await h.cmds.commands.sync();
  assert.equal(h.state().serverIslands!.joinRequests.length, 21);
  await h.cmds.commands.explore();
  const recovered = await h.cmds.commands.requests();
  assert.equal(recovered.nextCursor, null);
  assert.equal(recovered.items.length, 21);
  assert.equal(h.state().serverIslands!.joinRequests.length, 21);
  assert.ok(pages.mock.calls.some((args) => args[0]?.cursor === 'next'));
});

test('반복 cursor와 세대 변경 중 페이지 수집은 정본을 dispatch하지 않는다', async () => {
  const cyclic = harness({
    myIslands: async () => myIslands(),
    myJoinRequests: async () => ({ items: [myReq()], nextCursor: 'same' }),
  });
  await assert.rejects(
    cyclic.cmds.commands.sync(),
    (e: ApiError) => e.code === 'UPSTREAM_CONTRACT_ERROR',
  );
  assert.equal(cyclic.dispatched.length, 0);
  let changing: ReturnType<typeof harness>;
  changing = harness({
    myIslands: async () => myIslands(),
    myJoinRequests: async ({ cursor } = {}) => {
      if (!cursor) return { items: [myReq()], nextCursor: 'next' };
      changing.setGen(1);
      return { items: [myReq({ id: 'r2' })], nextCursor: null };
    },
  });
  await assert.rejects(
    changing.cmds.commands.sync(),
    (e: ApiError) => e.code === 'CLIENT_STALE_SESSION',
  );
  assert.equal(changing.dispatched.length, 0);
});

test('취소와 진행 중 폴링, 승인 뒤의 오래된 pending, 오래된 목록 경쟁은 종결 상태를 되돌리지 않는다', async () => {
  let release!: (value: Awaited<ReturnType<IslandApi['joinRequest']>>) => void;
  const delayed = new Promise<Awaited<ReturnType<IslandApi['joinRequest']>>>((resolve) => {
    release = resolve;
  });
  const h = harness({
    joinRequest: async () => delayed,
    cancelJoinRequest: async () => ({ id: 'r1', status: 'cancelled' as const }),
    myJoinRequests: async () => ({ items: [myReq()], nextCursor: null }),
  });
  await h.cmds.commands.requests();
  const polling = h.cmds.commands.status('r1');
  await h.cmds.commands.cancel('r1');
  release({ id: 'r1', islandId: 'i1', status: 'pending', version: 3 });
  await polling;
  assert.equal(h.state().serverIslands!.requestStatus[0].status, 'cancelled');
  const approved = reducer(h.state(), {
    type: 'ISLAND_REQUEST',
    request: { id: 'r1', islandId: 'i1', status: 'approved', version: 4 },
  } as never);
  const protectedState = reducer(approved, {
    type: 'ISLAND_REQUEST',
    request: { id: 'r1', islandId: 'i1', status: 'pending', version: 3 },
  } as never);
  assert.equal(protectedState.serverIslands!.requestStatus[0].status, 'approved');
  const listed = reducer(protectedState, {
    type: 'ISLAND_SYNC_REQUESTS',
    requests: [myReq()],
  } as never);
  assert.equal(listed.serverIslands!.requestStatus[0].status, 'approved');
  assert.equal(listed.serverIslands!.joinRequests.length, 0);
  const synced = reducer(listed, {
    type: 'ISLAND_SYNC',
    memberships: myIslands(),
    requests: [myReq()],
  } as never);
  assert.equal(synced.serverIslands!.joinRequests.length, 0);
});

test('LOGOUT은 서버 스냅샷을 비워 orphan 신청이 다음 계정에 섞이지 않는다', () => {
  const h = harness({ myJoinRequests: async () => ({ items: [myReq()], nextCursor: null }) });
  return h.cmds.commands.requests().then(() => {
    assert.equal(h.state().serverIslands!.joinRequests.length, 1);
    // reducer를 직접 돌려 로그아웃을 재현한다
    const loggedOut = reducer(h.state(), { type: 'LOGOUT' } as never);
    assert.equal(loggedOut.serverIslands, null);
  });
});
