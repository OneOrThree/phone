import assert from 'node:assert/strict';
import {
  CLIENT_CONTRACT_ERROR,
  completedBuildings,
  getConstructionOptions,
  getHome,
  getMembers,
  leaveIsland,
  selectConstructionTarget,
  startConstruction,
  switchCurrentIsland,
} from '@/services/api/home';
import { clearSession, saveSession } from '@/services/api/session';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];

function stub(responses: { status: number; body?: unknown }[]) {
  let index = 0;
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = responses[Math.min(index++, responses.length - 1)];
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
}

const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];
const body = (call: Call) => JSON.parse(call.init.body as string);
const path = (call: Call) => new URL(call.url).pathname;

const item = (id: string, over: object = {}) => ({
  id,
  name: '시설 ' + id,
  cost: 1360,
  currency: 'village_points',
  selectable: true,
  buildable: true,
  blockedReason: null,
  ...over,
});

const options = (items: object[], over: object = {}) => ({
  islandVersion: 4,
  costPolicyVersion: 1,
  selectedBuildingId: null,
  villagePoints: 800,
  walletVersion: 7,
  items,
  ...over,
});

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('getHome — date·timezone 을 인코딩해 보내고 조각을 그대로 돌려준다', async () => {
  const home = {
    island: {
      id: 'i1',
      name: '모래섬',
      intro: '',
      visibility: 'public',
      approvalRequired: false,
      memberCount: 1,
      maxMembers: 15,
      membershipStatus: 'active',
      growthStage: null,
      themeId: null,
      role: 'host',
      version: 3,
    },
    focusSummary: {
      date: '2026-09-21',
      completedSeconds: 60,
      currentSessionSecondsToday: 30,
      totalSeconds: 90,
      serverNow: '2026-09-21T00:00:00Z',
    },
    session: null,
    restMembers: { items: [], serverNow: '2026-09-21T00:00:00Z', watermarks: [] },
    wallets: { fish: 500, villagePoints: 1500, fishVersion: null, villagePointsVersion: 7 },
    playback: null,
    playbackAvailability: 'facility_locked',
  };
  stub([{ status: 200, body: { data: home } }]);

  const result = await getHome('2026-09-21', 'Asia/Seoul');

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/screens/home');
  assert.equal(url.searchParams.get('date'), '2026-09-21');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Seoul');
  assert.equal(result.island.role, 'host');
  assert.equal(result.focusSummary.totalSeconds, 90);
});

test('지갑 두 축 — home 의 fish/villagePoints 와 options 의 villagePoints 를 합산·덮어쓰지 않는다', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          island: {},
          focusSummary: {},
          session: null,
          restMembers: {},
          wallets: { fish: 500, villagePoints: 1500, fishVersion: null, villagePointsVersion: 7 },
          playback: null,
          playbackAvailability: 'available',
        },
      },
    },
    { status: 200, body: { data: options([], { villagePoints: 800, walletVersion: 3 }) } },
  ]);

  const home = await getHome('2026-09-21', 'Asia/Seoul');
  const opts = await getConstructionOptions('i1');

  // 개인 fish 와 공동 villagePoints 는 다른 축이고, 두 응답은 별도 스냅샷이다.
  assert.equal(home.wallets.fish, 500);
  assert.equal(home.wallets.villagePoints, 1500);
  assert.equal(opts.villagePoints, 800);
  assert.equal(opts.walletVersion, 3);
});

test('options complement — 미완공 5개(공사 중 포함)면 완공은 정확히 hall·board', async () => {
  stub([
    {
      status: 200,
      body: {
        data: options([
          item('gram'),
          item('library'),
          // 공사 중(BUILDING) 건물도 items 에 남는다 — 조기 완공으로 오인하지 않는다.
          item('mail', { selectable: false, buildable: false, blockedReason: 'IN_PROGRESS' }),
          item('tower'),
          item('shop'),
        ]),
      },
    },
  ]);

  const opts = await getConstructionOptions('i1');

  assert.equal(path(calls[0]), '/islands/i1/construction-options');
  assert.deepEqual(completedBuildings(opts), ['hall', 'board']);
});

test('options complement — items 가 비면 7개 모두 완공이다', async () => {
  stub([{ status: 200, body: { data: options([]) } }]);

  const opts = await getConstructionOptions('i1');

  assert.deepEqual(completedBuildings(opts), [
    'hall',
    'board',
    'gram',
    'library',
    'mail',
    'tower',
    'shop',
  ]);
});

test('options 검증 — 모르는 ID·중복·빠진 필수 필드를 fake 건물로 보완하지 않고 실패한다', async () => {
  stub([
    { status: 200, body: { data: options([item('castle')]) } }, // canonical7 밖 ID
    { status: 200, body: { data: options([item('hall'), item('hall')]) } }, // 중복
    { status: 200, body: { data: options([{ id: 'hall', name: '회관' }]) } }, // item 필수 필드 누락
    { status: 200, body: { data: options([], { villagePoints: undefined }) } }, // 응답 필수 필드 누락
  ]);

  for (let i = 0; i < 4; i++) {
    const error = await getConstructionOptions('i1').catch((e) => e);
    assert.equal(error.code, CLIENT_CONTRACT_ERROR);
  }
});

test('getMembers — cursor·limit 인코딩, null catColor 와 nextCursor 를 그대로 보존한다', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          items: [
            { id: 'm1', name: '민지', catColor: null, role: 'host', appearance: null },
            { id: 'm2', name: null, catColor: 'ginger', role: 'member', appearance: {} },
          ],
          nextCursor: 'c2',
          version: 5,
        },
      },
    },
  ]);

  const page = await getMembers('i1', 'c1 +/=');

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/islands/i1/members');
  assert.equal(url.searchParams.get('cursor'), 'c1 +/=');
  assert.equal(url.searchParams.get('limit'), '100');
  // null 색은 임의 색으로 대체하지 않고 보존하고, 페이지 DTO 는 호출부가 잇도록 그대로다.
  assert.equal(page.items[0].catColor, null);
  assert.equal(page.items[1].name, null);
  assert.equal(page.nextCursor, 'c2');
  assert.equal(page.version, 5);
});

test('switchCurrentIsland — PUT /me/current-island 에 같은 멱등 키와 {islandId} 만 보낸다', async () => {
  stub([
    { status: 200, body: { data: { currentIslandId: 'i2' } } },
    { status: 200, body: { data: { currentIslandId: 'i2' } } },
  ]);

  const first = await switchCurrentIsland('i2', 'idem-switch');
  const retry = await switchCurrentIsland('i2', 'idem-switch'); // 응답 유실 재시도 — 같은 키

  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(path(calls[0]), '/me/current-island');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-switch');
  assert.deepEqual(body(calls[0]), { islandId: 'i2' });
  assert.equal(header(calls[1], 'Idempotency-Key'), 'idem-switch');
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(first.currentIslandId, 'i2');
  assert.equal(retry.currentIslandId, 'i2');
});

test('leaveIsland — DELETE /islands/{id}/memberships/me, 본문 없이 같은 멱등 키', async () => {
  stub([{ status: 200, body: { data: { left: true } } }]);

  const result = await leaveIsland('i1', 'idem-leave');

  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(path(calls[0]), '/islands/i1/memberships/me');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-leave');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(result.left, true);
});

test('selectConstructionTarget — PUT 에 {buildingId, expectedVersion}·멱등 키만 보낸다', async () => {
  stub([
    {
      status: 200,
      body: { data: { buildingId: 'library', selected: true, spent: 0, version: 5 } },
    },
  ]);

  const result = await selectConstructionTarget('i1', 'library', 4, 'idem-target');

  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(path(calls[0]), '/islands/i1/construction-target');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-target');
  // 필드 수 계약 — cost·expectedCostPolicyVersion 같은 여분은 붙이지 않는다.
  assert.deepEqual(body(calls[0]), { buildingId: 'library', expectedVersion: 4 });
  assert.equal(result.selected, true);
  assert.equal(result.version, 5);
});

test('startConstruction — POST 에 세 필드·멱등 키, BUILDING 응답의 시각을 그대로 돌려준다', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          buildingId: 'library',
          status: 'BUILDING',
          spent: { currency: 'village_points', amount: 1360 },
          version: 5,
          villagePoints: 200,
          walletVersion: 8,
          startedAt: '2026-09-21T00:00:00Z',
          completesAt: '2026-09-21T01:00:00Z',
        },
      },
    },
  ]);

  const result = await startConstruction('i1', 'library', 4, 1, 'idem-build');

  assert.equal(calls[0].init.method, 'POST');
  assert.equal(path(calls[0]), '/islands/i1/constructions');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-build');
  assert.deepEqual(body(calls[0]), {
    buildingId: 'library',
    expectedVersion: 4,
    expectedCostPolicyVersion: 1,
  });
  assert.equal(result.status, 'BUILDING');
  assert.equal(result.spent.amount, 1360);
  assert.equal(result.completesAt, '2026-09-21T01:00:00Z');
});

test('서버 오류는 코드를 그대로 올린다 — 성공으로 접지 않는다', async () => {
  const envelope = (code: string, field: string | null = null) => ({
    error: { code, message: '실패했습니다.', field, retryable: false },
    requestId: 'req-x',
  });
  stub([
    { status: 409, body: envelope('STATE_CONFLICT', 'currentIslandId') },
    { status: 403, body: envelope('FORBIDDEN', 'islandId') },
  ]);

  const conflict = await getHome('2026-09-21', 'Asia/Seoul').catch((e) => e);
  assert.equal(conflict.code, 'STATE_CONFLICT');
  assert.equal(conflict.status, 409);

  const forbidden = await leaveIsland('i1', 'k').catch((e) => e);
  assert.equal(forbidden.code, 'FORBIDDEN');
  assert.equal(forbidden.status, 403);
});
