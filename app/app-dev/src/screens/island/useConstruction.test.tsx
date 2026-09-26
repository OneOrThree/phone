import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react-native';
import {
  CLIENT_IN_FLIGHT,
  CLIENT_INACTIVE,
  CLIENT_NOT_SELECTABLE,
  useConstruction,
} from '@/screens/island/useConstruction';
import { CLIENT_NETWORK_ERROR } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];

type Resp = { status: number; body?: unknown };
const data = (body: unknown): Resp => ({ status: 200, body: { data: body } });
const envelope = (code: string, status = 500): Resp => ({
  status,
  body: { error: { code, message: '실패했습니다.', field: null, retryable: false } },
});

function stub(handler: (url: string, init: RequestInit) => Resp | Promise<Resp>) {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = await handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
}

function serve(handlers: Record<string, Resp | ((url: string) => Resp | Promise<Resp>)>) {
  stub((url, init) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    const h = handlers[key];
    if (!h) throw new Error(`unexpected ${key}`);
    return typeof h === 'function' ? h(url) : h;
  });
}

const path = (c: Call) => new URL(c.url).pathname;
const gets = (p: string) =>
  calls.filter((c) => (c.init.method ?? 'GET') === 'GET' && path(c) === p);
const writes = (p: string, method: string) =>
  calls.filter((c) => c.init.method === method && path(c) === p);
const idemKey = (c: Call) => (c.init.headers as Record<string, string>)['Idempotency-Key'];
const sentBody = (c: Call) => JSON.parse(c.init.body as string);
const UUID36 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isle = (id: string) => ({
  id,
  name: id,
  intro: '',
  visibility: 'public',
  approvalRequired: false,
  memberCount: 2,
  maxMembers: 15,
  membershipStatus: 'active',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
});
const mine = (currentId: string) => ({
  items: [isle(currentId)],
  nextCursor: null,
  currentIslandId: currentId,
  lossReason: null,
});
const item = (id: string, over: object = {}) => ({
  id,
  name: `시설 ${id}`,
  cost: 100,
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
  activeConstruction: null,
  items,
  ...over,
});
const member = (id: string) => ({ id, name: id, catColor: null, role: 'member', appearance: null });
const membersPage = (items: unknown[], nextCursor: string | null = null, version = 1) => ({
  items,
  nextCursor,
  version,
});
const startedBody = {
  buildingId: 'library',
  status: 'BUILDING',
  spent: { currency: 'village_points', amount: 100 },
  version: 5,
  villagePoints: 700,
  walletVersion: 8,
  startedAt: '2026-09-21T00:00:00Z',
  completesAt: '2026-09-21T01:00:00Z',
};

/** 정상 경로 한 벌 — 화면의 로컬 id 와 다른 서버 섬 id(srv1)로 읽는다. */
const live = (optsBody: unknown = options([item('library'), item('mail')])) => ({
  'GET /me/islands': data(mine('srv1')),
  'GET /islands/srv1/members': data(membersPage([member('u1'), member('u2')])),
  'GET /islands/srv1/construction-options': data(optsBody),
});

type Props = { active: boolean; islandId: string | null; now: number };
const mount = (props: Props) =>
  renderHook((p: Props) => useConstruction(p), { initialProps: props });
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const NOW = Date.parse('2026-09-21T00:10:00Z');

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('inactive / islandId null — 보호 GET 0건, select·build·reload 는 CLIENT_INACTIVE', async () => {
  serve({});
  const h = await mount({ active: false, islandId: 'local1', now: NOW });
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(h.result.current.status, 'loading'); // 미확정 — 빈 목록과 구별
  assert.equal(h.result.current.options, null);

  await h.rerender({ active: true, islandId: null, now: NOW });
  await flush();
  assert.equal(calls.length, 0);
  assert.equal((await h.result.current.reload().catch((e) => e)).code, CLIENT_INACTIVE);
  assert.equal((await h.result.current.select('library').catch((e) => e)).code, CLIENT_INACTIVE);
  assert.equal((await h.result.current.build('library').catch((e) => e)).code, CLIENT_INACTIVE);
  await h.unmount();
});

test('ready — 화면의 로컬 id 가 아니라 /me/islands 의 current 로 읽고, items 순서·주민을 그대로 실는다', async () => {
  serve(live(options([item('shop'), item('mail'), item('gram')])));
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();

  assert.equal(path(calls[0]), '/me/islands');
  assert.equal(gets('/islands/srv1/construction-options').length, 1);
  assert.equal(gets('/islands/srv1/members').length, 1);
  // local1 같은 화면 식별자는 어떤 요청 경로에도 들어가지 않는다.
  assert.equal(
    calls.some((c) => c.url.includes('local1')),
    false,
  );
  assert.equal(h.result.current.status, 'ready');
  // 서버 자유 순서 그대로 — 앱이 재정렬하지 않는다.
  assert.deepEqual(
    h.result.current.options?.items.map((it) => it.id),
    ['shop', 'mail', 'gram'],
  );
  assert.equal(h.result.current.members?.length, 2);
  assert.equal(h.result.current.error, null);
  await h.unmount();
});

test('activeConstruction — 새 화면 진입과 다시 활성화할 때 GET 상태를 복원한다', async () => {
  const activeConstruction = {
    buildingId: 'library',
    status: 'BUILDING',
    startedAt: '2026-09-21T00:00:00Z',
    completesAt: '2026-09-21T01:00:00Z',
    serverNow: '2026-09-21T00:10:00Z',
    version: 5,
  };
  serve(live(options([item('library')], { activeConstruction })));
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();
  assert.deepEqual(h.result.current.started, activeConstruction);
  assert.equal(h.result.current.progress, 1 / 6);
  assert.equal(h.result.current.phase, 'building');

  await h.rerender({ active: false, islandId: 'local1', now: NOW });
  await h.rerender({ active: true, islandId: 'local1', now: NOW });
  await flush();
  assert.deepEqual(h.result.current.started, activeConstruction);
  assert.equal(gets('/islands/srv1/construction-options').length, 2);
  await h.unmount();
});

test('items 가 비었다 = 전부 완공 — ready 상태의 빈 목록이지 오류가 아니다', async () => {
  serve(live(options([])));
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();
  assert.equal(h.result.current.status, 'ready');
  assert.equal(h.result.current.options?.items.length, 0);
  await h.unmount();
});

test('select — PUT 본문은 {buildingId, expectedVersion} 뿐, 멱등 키는 UUID, 성공 뒤 재조회로 확정', async () => {
  let put = 0;
  serve({
    ...live(),
    'PUT /islands/srv1/construction-target': () => {
      put++;
      return data({ buildingId: 'library', selected: true, spent: 0, version: 5 });
    },
    // 두 번째 options 읽기부터는 목표가 잡힌 상태다.
    'GET /islands/srv1/construction-options': () =>
      put === 0
        ? data(options([item('library'), item('mail')]))
        : data(
            options([item('library'), item('mail')], {
              selectedBuildingId: 'library',
              islandVersion: 5,
            }),
          ),
  });
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();

  await act(async () => {
    await h.result.current.select('library');
  });

  const putCalls = writes('/islands/srv1/construction-target', 'PUT');
  assert.equal(putCalls.length, 1);
  assert.deepEqual(sentBody(putCalls[0]), { buildingId: 'library', expectedVersion: 4 });
  assert.equal(UUID36.test(idemKey(putCalls[0])), true);
  // POST 응답만으로 확정하지 않는다 — 재조회가 selectedBuildingId 를 가져왔다.
  assert.equal(gets('/islands/srv1/construction-options').length, 2);
  assert.equal(h.result.current.options?.selectedBuildingId, 'library');
  assert.equal(h.result.current.options?.islandVersion, 5);
  await h.unmount();
});

test('build — POST 세 필드·멱등 키, BUILDING·시각은 응답대로, 완공은 items 탈락만 본다', async () => {
  let optCalls = 0;
  serve({
    ...live(),
    'POST /islands/srv1/constructions': data(startedBody),
    'GET /islands/srv1/construction-options': () => {
      optCalls++;
      if (optCalls === 1) return data(options([item('library'), item('mail')]));
      if (optCalls === 2) {
        // 공사 중에도 library 는 items 에 남는다(IN_PROGRESS) — 조기 완공 오인 금지
        return data(
          options(
            [
              item('library', {
                selectable: false,
                buildable: false,
                blockedReason: 'IN_PROGRESS',
              }),
              item('mail'),
            ],
            {
              activeConstruction: {
                buildingId: 'library',
                status: 'BUILDING',
                startedAt: startedBody.startedAt,
                completesAt: startedBody.completesAt,
                serverNow: startedBody.startedAt,
                version: 5,
              },
            },
          ),
        );
      }
      // 서버가 완공으로 옮겼다 — items 에서 빠졌다.
      return data(options([item('mail')], { islandVersion: 6 }));
    },
  });
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();

  await act(async () => {
    await h.result.current.build('library');
  });

  const posts = writes('/islands/srv1/constructions', 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(sentBody(posts[0]), {
    buildingId: 'library',
    expectedVersion: 4,
    expectedCostPolicyVersion: 1,
  });
  assert.equal(UUID36.test(idemKey(posts[0])), true);
  const started = h.result.current.started;
  assert.equal(started?.status, 'BUILDING');
  assert.equal(started?.completesAt, '2026-09-21T01:00:00Z');
  assert.equal('serverNow' in (started ?? {}), true); // GET canonical 스냅샷이 POST receipt을 덮는다

  // completesAt 이 지나도 앱이 시각으로 완공 처리하지 않는다 — 아직 items 에 있다.
  await h.rerender({ active: true, islandId: 'local1', now: NOW + 55 * 60_000 });
  await flush();
  // 완공 예정 도달은 재조회 신호다 — 서버가 items 에서 빼야만 started 를 내린다.
  assert.equal(gets('/islands/srv1/construction-options').length, 3);
  assert.equal(h.result.current.started, null); // 세 번째 GET: items 에서 빠짐
  assert.equal(h.result.current.options?.items.length, 1);
  await h.unmount();
});

test('selectable:false / buildable:false 는 앱이 추측해 보내지 않는다 — 요청 0건', async () => {
  serve(
    live(
      options([
        item('library', { selectable: false, blockedReason: 'FORBIDDEN' }),
        item('mail', { selectable: false, buildable: false, blockedReason: 'IN_PROGRESS' }),
      ]),
    ),
  );
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();

  assert.equal(
    (await h.result.current.select('library').catch((e) => e)).code,
    CLIENT_NOT_SELECTABLE,
  );
  assert.equal((await h.result.current.build('mail').catch((e) => e)).code, CLIENT_NOT_SELECTABLE);
  assert.equal(writes('/islands/srv1/construction-target', 'PUT').length, 0);
  assert.equal(writes('/islands/srv1/constructions', 'POST').length, 0);
  await h.unmount();
});

test('403 FORBIDDEN(비방장) — 재조회로 화면을 맞추고 원래 오류를 그대로 올린다', async () => {
  serve({
    ...live(),
    'PUT /islands/srv1/construction-target': envelope('FORBIDDEN', 403),
  });
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();

  const error = await act(async () => h.result.current.select('library').catch((e) => e));
  assert.equal(error.code, 'FORBIDDEN');
  assert.equal(error.status, 403);
  // 실패를 성공으로 접지 않는다 — 목표는 그대로 null, 재조회만 한 번 더 갔다.
  assert.equal(h.result.current.options?.selectedBuildingId, null);
  assert.equal(gets('/islands/srv1/construction-options').length, 2);
  await h.unmount();
});

test('409 버전 충돌 — 재조회하고 충돌 코드로 거절, started 도 세우지 않는다', async () => {
  serve({
    ...live(options([item('library')], { selectedBuildingId: 'library' })),
    'POST /islands/srv1/constructions': envelope('STATE_CONFLICT', 409),
  });
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();

  const error = await act(async () => h.result.current.build('library').catch((e) => e));
  assert.equal(error.code, 'STATE_CONFLICT');
  assert.equal(error.status, 409);
  assert.equal(h.result.current.started, null);
  assert.equal(gets('/islands/srv1/construction-options').length, 2);
  await h.unmount();
});

test('응답 유실·네트워크 실패의 재시도는 같은 멱등 키·같은 본문이다', async () => {
  let n = 0;
  serve({
    ...live(),
    'PUT /islands/srv1/construction-target': () => {
      n++;
      if (n === 1) throw new TypeError('network down'); // CLIENT_NETWORK_ERROR 경로
      return data({ buildingId: 'library', selected: true, spent: 0, version: 5 });
    },
    'GET /islands/srv1/construction-options': () =>
      data(
        n === 0
          ? options([item('library'), item('mail')])
          : options([item('library'), item('mail')], {
              selectedBuildingId: 'library',
              islandVersion: 5,
            }),
      ),
  });
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();

  const first = await act(async () => h.result.current.select('library').catch((e) => e));
  assert.equal(first.code, CLIENT_NETWORK_ERROR);

  await act(async () => {
    await h.result.current.select('library');
  });
  const puts = writes('/islands/srv1/construction-target', 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(idemKey(puts[0]), idemKey(puts[1]));
  assert.equal(sentBody(puts[0]).buildingId, sentBody(puts[1]).buildingId);
  assert.equal(h.result.current.options?.selectedBuildingId, 'library');
  await h.unmount();
});

test('같은 의도의 중복 호출은 진행 중 flight 하나로 합류하고, 다른 의도는 CLIENT_IN_FLIGHT', async () => {
  let release: (r: Resp) => void = () => {};
  const gate = new Promise<Resp>((r) => (release = r));
  serve({
    ...live(),
    'PUT /islands/srv1/construction-target': () => gate,
  });
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();

  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = h.result.current.select('library');
    second = h.result.current.select('library'); // 같은 의도 — 합류
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(writes('/islands/srv1/construction-target', 'PUT').length, 1);
  // 다른 의도는 진행 중 거절 — act 밖에서 만들고 바로 잡는다(거절은 상태 갱신이 없다).
  assert.equal((await h.result.current.select('mail').catch((e) => e)).code, CLIENT_IN_FLIGHT);

  await act(async () => {
    release(data({ buildingId: 'library', selected: true, spent: 0, version: 5 }));
    await new Promise((r) => setTimeout(r, 0));
  });
  await first;
  await second;
  await h.unmount();
});

test('읽기 실패는 error 상태로 남고 retry 가 다시 읽는다 — 오류를 빈 목록으로 접지 않는다', async () => {
  let n = 0;
  serve({
    'GET /me/islands': data(mine('srv1')),
    'GET /islands/srv1/members': data(membersPage([member('u1')])),
    'GET /islands/srv1/construction-options': () =>
      n++ === 0 ? envelope('INTERNAL') : data(options([item('library')])),
  });
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();
  assert.equal(h.result.current.status, 'error');
  assert.equal(h.result.current.error?.code, 'INTERNAL');
  // === null 비교로만 본다 — assert.equal(x, null) 은 아래 ?.items 를 never 로 좁힌다.
  assert.equal(h.result.current.options === null, true);

  await act(async () => {
    await h.result.current.retry();
  });
  assert.equal(h.result.current.status, 'ready');
  assert.equal(h.result.current.options?.items.length, 1);
  await h.unmount();
});

test('기기 시각 점프는 재조회 신호다 — 완공 판정 없이 GET 만 다시 부른다', async () => {
  serve(live());
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();
  assert.equal(gets('/islands/srv1/construction-options').length, 1);

  await h.rerender({ active: true, islandId: 'local1', now: NOW + 60_000 });
  await flush();
  assert.equal(gets('/islands/srv1/construction-options').length, 2);
  await h.unmount();
});

test('기기 시계가 서버보다 빨라도 서버 기준 완공 전에는 조기 재조회하지 않는다', async () => {
  const deviceNow = Date.parse('2026-09-21T10:00:00Z');
  serve(
    live(
      options([item('library')], {
        activeConstruction: {
          buildingId: 'library',
          status: 'BUILDING',
          startedAt: '2026-09-21T00:00:00Z',
          completesAt: '2026-09-21T01:00:00Z',
          serverNow: '2026-09-21T00:10:00Z',
          version: 5,
        },
      }),
    ),
  );
  const h = await mount({ active: true, islandId: 'local1', now: deviceNow });
  await flush();

  await h.rerender({ active: true, islandId: 'local1', now: deviceNow + 1_000 });
  await flush();
  assert.equal(gets('/islands/srv1/construction-options').length, 1);
  await h.unmount();
});

test('응답 도착 전 세션 세대가 바뀌면 옛 계정 데이터를 싣지 않는다', async () => {
  let release: (r: Resp) => void = () => {};
  const gate = new Promise<Resp>((r) => (release = r));
  serve({
    'GET /me/islands': data(mine('srv1')),
    'GET /islands/srv1/members': data(membersPage([member('u1')])),
    'GET /islands/srv1/construction-options': () => gate,
  });
  const h = await mount({ active: true, islandId: 'local1', now: NOW });
  await flush();
  assert.equal(gets('/islands/srv1/construction-options').length, 1);

  // 옵션 응답이 날아간 사이 계정이 바뀌었다 — client 가 CLIENT_STALE_SESSION 을 던진다.
  await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' });
  await act(async () => {
    release(data(options([item('library')])));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.result.current.options, null);
  assert.equal(h.result.current.status === 'ready', false);

  // 리렌더로 새 세대가 관측되면 새 범위로 다시 읽는다.
  serve(live());
  await h.rerender({ active: true, islandId: 'local1', now: NOW });
  await flush();
  assert.equal(h.result.current.status, 'ready');
  assert.equal(gets('/me/islands').length, 2);
  await h.unmount();
});
