import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react-native';
import {
  CLIENT_BROKEN_PAGE,
  CLIENT_FORBIDDEN,
  CLIENT_IN_FLIGHT,
  CLIENT_INACTIVE,
  useIslandManagement,
} from '@/screens/interiors/useIslandManagement';
import { CLIENT_STALE_SESSION } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];

type Resp = { status: number; body?: unknown };
const data = (body: unknown): Resp => ({ status: 200, body: { data: body } });
const envelope = (code: string): Resp => ({
  status: 500,
  body: { error: { code, message: '실패했습니다.', field: null, retryable: false } },
});

/** handler 는 지연 promise 도 돌려줄 수 있다 — 경합·지연 응답 테스트용. */
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

/** `METHOD path` 정확히 일치하는 것만 응답 — 없는 경로 호출은 오류로 흘려 개수 assert 가 잡는다. */
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
const code = (e: unknown) => (e as { code?: string }).code;

type Props = { active: boolean; islandId: string | null };
const mount = (props: Props) =>
  renderHook((p: Props) => useIslandManagement(p), { initialProps: props });

/** 비동기 effect·promise 체인이 전부 정착할 때까지 — fetch stub 은 microtask 만 쓴다. */
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

const appearance = { clothes: null, decor: null, hull: 'round', position: 'idle', version: 1 };
const member = (id: string, role = 'member') => ({
  id,
  name: id,
  catColor: null,
  role,
  appearance,
});
const membersPage = (items: unknown[], nextCursor: string | null = null, version = 1) => ({
  items,
  nextCursor,
  version,
});
const requestsPage = (items: unknown[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});
const joinReq = (id: string) => ({
  id,
  applicantId: `a-${id}`,
  name: id,
  status: 'pending',
  version: 1,
});
const detail = (role: string, over: object = {}) => ({
  id: 'i1',
  name: '구름 섬',
  intro: '',
  visibility: 'public',
  approvalRequired: true,
  memberCount: 2,
  maxMembers: 15,
  membershipStatus: 'active',
  growthStage: null,
  themeId: null,
  role,
  version: 3,
  ...over,
});
/** 비주민에게 오는 공개 요약 — role/version 이 없다. */
const summary = () => ({
  id: 'i1',
  name: '구름 섬',
  intro: '',
  visibility: 'public',
  approvalRequired: true,
  memberCount: 2,
  maxMembers: 15,
  membershipStatus: 'none',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
});

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('inactive / islandId null — 보호 GET 0건, 빈 상태, reload 도 CLIENT_INACTIVE', async () => {
  serve({});
  const h = await mount({ active: false, islandId: 'i1' });
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(h.result.current.detail, null);
  assert.equal(h.result.current.loading, false);

  await h.rerender({ active: true, islandId: null });
  await flush();
  assert.equal(calls.length, 0);

  const error = await h.result.current.reload().catch((e) => e);
  assert.equal(error.code, CLIENT_INACTIVE);
  const writeError = await h.result.current.saveSettings({ name: 'x' }).catch((e) => e);
  assert.equal(writeError.code, CLIENT_INACTIVE);
  assert.equal(calls.length, 0);
  await h.unmount();
});

test('host 상세 — 주민·신청 첫 페이지를 limit=100 으로 읽고 role 을 그대로 돌려준다', async () => {
  serve({
    'GET /islands/i1': data(detail('host')),
    'GET /islands/i1/members': data(membersPage([member('u1', 'host'), member('u2')])),
    'GET /islands/i1/join-requests': data(requestsPage([joinReq('r1')])),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  assert.equal(gets('/islands/i1').length, 1);
  assert.equal(gets('/islands/i1/members').length, 1);
  assert.equal(gets('/islands/i1/join-requests').length, 1);
  assert.equal(new URL(calls[1].url).searchParams.get('limit'), '100');
  assert.equal(new URL(calls[2].url).searchParams.get('limit'), '100');
  assert.equal(h.result.current.role, 'host');
  assert.equal(h.result.current.detail?.version, 3);
  assert.equal(h.result.current.members?.length, 2);
  assert.equal(h.result.current.requests?.length, 1);
  assert.equal(h.result.current.loading, false);
  assert.equal(h.result.current.error, null);
  assert.equal(h.result.current.accessLost, false);
  assert.equal(calls.length, 3); // 상한 — 무한 effect 회귀 가드
  await h.unmount();
});

test('member 상세 — 주민만 읽고 방장 전용 신청 GET 은 0건', async () => {
  serve({
    'GET /islands/i1': data(detail('member')),
    'GET /islands/i1/members': data(membersPage([member('u1')])),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  assert.equal(h.result.current.role, 'member');
  assert.equal(h.result.current.members?.length, 1);
  assert.equal(h.result.current.requests, null);
  assert.equal(gets('/islands/i1/join-requests').length, 0);
  assert.equal(calls.length, 2);
  await h.unmount();
});

test('비주민 요약(role/version 없음) — 접근 상실, 주민·신청은 읽지 않는다', async () => {
  serve({ 'GET /islands/i1': data(summary()) });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  assert.equal(h.result.current.accessLost, true);
  assert.equal(h.result.current.detail, null);
  assert.equal(h.result.current.members, null);
  assert.equal(h.result.current.requests, null);
  assert.equal(h.result.current.error, null);
  assert.equal(calls.length, 1);
  await h.unmount();
});

test('기존 캐시 위에 요약이 오면 상세·주민·신청을 전부 비운다', async () => {
  let n = 0;
  serve({
    'GET /islands/i1': () => data(n++ === 0 ? detail('host') : summary()),
    'GET /islands/i1/members': data(membersPage([member('u1')])),
    'GET /islands/i1/join-requests': data(requestsPage([joinReq('r1')])),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(h.result.current.requests?.length, 1);

  await act(async () => {
    await h.result.current.reload();
  });
  assert.equal(h.result.current.accessLost, true);
  assert.equal(h.result.current.detail, null);
  assert.equal(h.result.current.members, null);
  assert.equal(h.result.current.requests, null);
  await h.unmount();
});

test('읽기 실패 — error 상태로 남고 reload 가 다시 읽는다', async () => {
  let n = 0;
  serve({
    'GET /islands/i1': () => (n++ === 0 ? envelope('INTERNAL') : data(detail('member'))),
    'GET /islands/i1/members': data(membersPage([])),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(h.result.current.error?.code, 'INTERNAL');
  assert.equal(h.result.current.detail, null);
  assert.equal(h.result.current.loading, false);

  await act(async () => {
    await h.result.current.reload();
  });
  assert.equal(h.result.current.error, null);
  assert.equal(h.result.current.role, 'member');
  assert.equal(h.result.current.members?.length, 0); // 빈 목록과 미확정(null)을 구별한다
  assert.equal(calls.length, 3);
  await h.unmount();
});

test('응답 도착 전 세션 세대가 바뀌면 옛 계정 데이터를 싣지 않는다', async () => {
  let release: (r: Resp) => void = () => {};
  const gate = new Promise<Resp>((r) => (release = r));
  serve({ 'GET /islands/i1': () => gate });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(calls.length, 1);

  // 요청이 날아간 사이 계정 전환이 끝났다 — client 가 CLIENT_STALE_SESSION 을 던진다.
  await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' });
  await act(async () => {
    release(data(detail('host')));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.result.current.detail, null);
  assert.equal(h.result.current.members, null);
  assert.equal(gets('/islands/i1/members').length, 0); // 옛 세대는 후속 GET 도 내지 않는다

  // 리렌더로 새 세대가 관측되면 새 범위로 다시 읽는다.
  serve({
    'GET /islands/i1': data(detail('member')),
    'GET /islands/i1/members': data(membersPage([])),
  });
  await h.rerender({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(h.result.current.role, 'member');
  assert.equal(gets('/islands/i1').length, 2);
  await h.unmount();
});

test('섬 이동 — 옛 scope 응답·콜백은 폐기하고 새 섬만 싣는다', async () => {
  let release: (r: Resp) => void = () => {};
  const gate = new Promise<Resp>((r) => (release = r));
  serve({
    'GET /islands/i1': () => gate,
    'GET /islands/i2': data(detail('host', { id: 'i2' })),
    'GET /islands/i2/members': data(membersPage([member('u9')])),
    'GET /islands/i2/join-requests': data(requestsPage([])),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  const staleReload = h.result.current.reload;

  await h.rerender({ active: true, islandId: 'i2' });
  await flush();
  assert.equal(h.result.current.detail?.id, 'i2');
  assert.equal(h.result.current.members?.length, 1);

  // 옛 scope 의 늦은 상세 응답은 폐기된다(후속 GET 도 없다).
  await act(async () => {
    release(data(detail('host')));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.result.current.detail?.id, 'i2');
  assert.equal(gets('/islands/i1/members').length, 0);

  // 옛 렌더의 콜백은 현재 scope 와 맞지 않아 거절되고 요청도 내지 않는다.
  const before = calls.length;
  const error = await staleReload().catch((e) => e);
  assert.equal(error.code, CLIENT_STALE_SESSION);
  assert.equal(calls.length, before);
  await h.unmount();
});

test('언마운트 — 늦은 응답은 상태를 건드리지 않고 콜백은 CLIENT_INACTIVE', async () => {
  let release: (r: Resp) => void = () => {};
  const gate = new Promise<Resp>((r) => (release = r));
  serve({ 'GET /islands/i1': () => gate });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(calls.length, 1);

  await h.unmount();
  await act(async () => {
    release(data(detail('host')));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(calls.length, 1); // 옛 scope 는 후속 GET 을 내지 않는다
  const error = await h.result.current.reload().catch((e) => e);
  assert.equal(error.code, CLIENT_INACTIVE);
});

test('reload 경합 — 늦게 시작한 읽기만 확정하고 옛 결과는 뒤늦게 싣지 않는다', async () => {
  let n = 0;
  let release: (r: Resp) => void = () => {};
  const gate = new Promise<Resp>((r) => (release = r));
  serve({
    'GET /islands/i1': () =>
      n++ === 0 ? gate : data(detail('host', { name: '새 이름', version: 9 })),
    'GET /islands/i1/members': data(membersPage([])),
    'GET /islands/i1/join-requests': data(requestsPage([])),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(calls.length, 1); // 첫 상세는 아직 지연 중

  // 두 번째 reload 가 먼저 끝나 최신 상세를 확정한다.
  await act(async () => {
    await h.result.current.reload();
  });
  assert.equal(h.result.current.detail?.name, '새 이름');

  // 옛 읽기의 늦은 상세는 seq fence 에 걸려 폐기 — 후속 GET 도 내지 않는다.
  await act(async () => {
    release(data(detail('host', { name: '옛 이름', version: 1 })));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.result.current.detail?.name, '새 이름');
  assert.equal(h.result.current.detail?.version, 9);
  assert.equal(gets('/islands/i1/members').length, 1);
  assert.equal(calls.length, 4); // 상세 2 + 주민 1 + 신청 1 — 옛 읽기는 상세 뒤 멈춘다
  await h.unmount();
});

test('상세 guard — host/member 가 아닌 role·정수 아닌 version 은 접근 상실이다', async () => {
  let body: unknown = detail('viewer'); // 계약에 없는 role
  serve({ 'GET /islands/i1': () => data(body) });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(h.result.current.accessLost, true);
  assert.equal(h.result.current.detail, null);
  assert.equal(gets('/islands/i1/members').length, 0);

  body = detail('host', { version: 3.5 }); // 정수가 아닌 version
  await act(async () => {
    await h.result.current.reload();
  });
  assert.equal(h.result.current.accessLost, true);
  assert.equal(h.result.current.detail, null);
  assert.equal(calls.length, 2); // 상세 2건뿐 — 목록은 읽지 않는다
  await h.unmount();
});

test('host — 주민·신청 읽기는 병렬로 나가고 둘 다 끝나야 확정된다', async () => {
  let releaseM: (r: Resp) => void = () => {};
  let releaseR: (r: Resp) => void = () => {};
  const gateM = new Promise<Resp>((r) => (releaseM = r));
  const gateR = new Promise<Resp>((r) => (releaseR = r));
  serve({
    'GET /islands/i1': data(detail('host')),
    'GET /islands/i1/members': () => gateM,
    'GET /islands/i1/join-requests': () => gateR,
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  // members 가 끝나기 전에 requests 도 이미 나갔다 — 직렬이면 여기서 1건만 보인다.
  assert.equal(gets('/islands/i1/members').length, 1);
  assert.equal(gets('/islands/i1/join-requests').length, 1);
  assert.equal(h.result.current.loading, true);
  // === null 비교로만 본다 — assert.equal(x, null) 은 속성을 null 로 좁혀 아래 ?.length 가 never 가 된다.
  assert.equal(h.result.current.members === null, true);

  await act(async () => {
    releaseM(data(membersPage([member('u1')])));
    releaseR(data(requestsPage([joinReq('r1')])));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.result.current.members?.length, 1);
  assert.equal(h.result.current.requests?.length, 1);
  assert.equal(h.result.current.loading, false);
  assert.equal(calls.length, 3);
  await h.unmount();
});

test('주민 cursor 체인 — 끝까지 모으고 각 요청은 limit=100·순서 보존', async () => {
  const members = (url: string): Resp => {
    const c = new URL(url).searchParams.get('cursor');
    if (c === null) return data(membersPage([member('u1'), member('u2')], 'c1', 7));
    if (c === 'c1') return data(membersPage([member('u3')], 'c2', 7));
    return data(membersPage([member('u4')], null, 7));
  };
  // 신청도 두 페이지로 — 체인이 양쪽 목록에서 돈다.
  const requests = (url: string): Resp =>
    new URL(url).searchParams.get('cursor') === 'q1'
      ? data(requestsPage([joinReq('r2')]))
      : data(requestsPage([joinReq('r1')], 'q1'));
  serve({
    'GET /islands/i1': data(detail('host')),
    'GET /islands/i1/members': members,
    'GET /islands/i1/join-requests': requests,
  });

  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  assert.deepEqual(
    h.result.current.members?.map((m) => m.id),
    ['u1', 'u2', 'u3', 'u4'],
  );
  assert.deepEqual(
    h.result.current.requests?.map((r) => r.id),
    ['r1', 'r2'],
  );
  for (const c of [...gets('/islands/i1/members'), ...gets('/islands/i1/join-requests')])
    assert.equal(new URL(c.url).searchParams.get('limit'), '100');
  assert.equal(gets('/islands/i1/members').length, 3);
  assert.equal(gets('/islands/i1/join-requests').length, 2);
  assert.equal(calls.length, 6); // 상세 1 + 주민 3 + 신청 2
  await h.unmount();
});

test('첫 페이지 안의 중복 ID 도 오류 — 부분 목록을 싣지 않고 다음 페이지도 읽지 않는다', async () => {
  serve({
    'GET /islands/i1': data(detail('member')),
    'GET /islands/i1/members': data(membersPage([member('u1'), member('u1')], 'c1')),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  assert.equal(h.result.current.error?.code, CLIENT_BROKEN_PAGE);
  assert.equal(h.result.current.members, null);
  assert.equal(gets('/islands/i1/members').length, 1);
  assert.equal(calls.length, 2);
  await h.unmount();
});

test('페이지를 넘은 중복 ID 도 오류다', async () => {
  const members = (url: string): Resp =>
    new URL(url).searchParams.get('cursor') === 'c1'
      ? data(membersPage([member('u1')])) // u1 이 첫 페이지와 겹친다
      : data(membersPage([member('u1')], 'c1', 1));
  serve({
    'GET /islands/i1': data(detail('member')),
    'GET /islands/i1/members': members,
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  assert.equal(h.result.current.error?.code, CLIENT_BROKEN_PAGE);
  assert.equal(h.result.current.members, null);
  assert.equal(gets('/islands/i1/members').length, 2);
  await h.unmount();
});

test('반복 cursor — 같은 cursor 재요청 전에 오류로 끊는다(요청도 내지 않는다)', async () => {
  const members = (url: string): Resp =>
    new URL(url).searchParams.get('cursor') === 'c1'
      ? data(membersPage([member('u2')], 'c1', 1)) // 이미 쓴 cursor 를 또 돌려준다
      : data(membersPage([member('u1')], 'c1', 1));
  serve({
    'GET /islands/i1': data(detail('member')),
    'GET /islands/i1/members': members,
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  assert.equal(h.result.current.error?.code, CLIENT_BROKEN_PAGE);
  assert.equal(h.result.current.members, null);
  assert.equal(gets('/islands/i1/members').length, 2); // 세 번째 요청은 나가지 않는다
  await h.unmount();
});

test('주민 페이지 version 이 중간에 바뀌면 오류 — 섞인 snapshot 을 싣지 않는다', async () => {
  const members = (url: string): Resp =>
    new URL(url).searchParams.get('cursor') === 'c1'
      ? data(membersPage([member('u2')], null, 8)) // 첫 페이지는 7
      : data(membersPage([member('u1')], 'c1', 7));
  serve({
    'GET /islands/i1': data(detail('member')),
    'GET /islands/i1/members': members,
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  assert.equal(h.result.current.error?.code, CLIENT_BROKEN_PAGE);
  assert.equal(h.result.current.members, null);
  assert.equal(calls.length, 3);
  await h.unmount();
});

test('깨진 페이지(items 없음·id 없는 항목)는 빈 목록이 아니라 오류다', async () => {
  let body: unknown = { nextCursor: null }; // items 키 자체가 없다
  serve({
    'GET /islands/i1': data(detail('member')),
    'GET /islands/i1/members': () => data(body),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(h.result.current.error?.code, CLIENT_BROKEN_PAGE);
  assert.equal(h.result.current.members, null);

  body = membersPage([{ name: 'id없음' }]);
  await act(async () => {
    await h.result.current.reload().catch(() => undefined);
  });
  assert.equal(h.result.current.error?.code, CLIENT_BROKEN_PAGE);
  assert.equal(h.result.current.members, null);
  assert.equal(calls.length, 4); // 상세 2 + 주민 2
  await h.unmount();
});

test('페이지 도중 세대 교체 — 나머지를 읽지 않고 아무것도 싣지 않는다', async () => {
  let n = 0;
  serve({
    'GET /islands/i1': data(detail('member')),
    'GET /islands/i1/members': async () => {
      if (n++ === 0) return data(membersPage([member('u1')], 'c1', 1));
      // 두 번째 페이지 요청이 날아간 사이 계정이 바뀌었다.
      await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' });
      return data(membersPage([member('u2')], null, 1));
    },
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  assert.equal(h.result.current.detail, null); // 옛 세대 결과는 확정되지 않는다
  assert.equal(h.result.current.members, null);
  assert.equal(gets('/islands/i1/members').length, 2);
  assert.equal(calls.length, 3);
  await h.unmount();
});

test('수동 reload 실패는 원래 오류를 호출부에 그대로 돌려준다', async () => {
  serve({ 'GET /islands/i1': envelope('INTERNAL') });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(h.result.current.error?.code, 'INTERNAL');

  let thrown: unknown;
  await act(async () => {
    thrown = await h.result.current.reload().catch((e) => e);
  });
  assert.equal((thrown as { code?: string }).code, 'INTERNAL');
  assert.equal(gets('/islands/i1').length, 2);
  await h.unmount();
});

const managed = (over: object = {}) => ({
  id: 'i1',
  name: '구름 섬',
  intro: '',
  approvalRequired: true,
  maxMembers: 15,
  version: 4,
  ...over,
});
const errResp = (status: number, errCode: string): Resp => ({
  status,
  body: { error: { code: errCode, message: '거절', field: null, retryable: false } },
});
const serveHost = (over: Record<string, Resp | ((url: string) => Resp | Promise<Resp>)> = {}) =>
  serve({
    'GET /islands/i1': data(detail('host')),
    'GET /islands/i1/members': data(membersPage([member('u1', 'host')])),
    'GET /islands/i1/join-requests': data(requestsPage([joinReq('r1')])),
    ...over,
  });

test('saveSettings — PATCH 뒤 상세·주민·신청 재조회가 끝나야 resolve 한다', async () => {
  let detailN = 0;
  let releaseD: (r: Resp) => void = () => {};
  const gateD = new Promise<Resp>((r) => (releaseD = r));
  serve({
    'GET /islands/i1': () => (detailN++ === 0 ? data(detail('host')) : gateD),
    'GET /islands/i1/members': data(membersPage([member('u1', 'host')])),
    'GET /islands/i1/join-requests': data(requestsPage([joinReq('r1')])),
    'PATCH /islands/i1': data(managed({ name: '새 섬', maxMembers: 10 })),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(h.result.current.role, 'host');

  let settled: string | null = null;
  await act(async () => {
    const w = h.result.current.saveSettings({ name: '새 섬', maxMembers: 10 });
    w.then(
      () => (settled = 'ok'),
      () => (settled = 'fail'),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
  // PATCH 는 나갔고 재조회 상세가 gate 에 걸려 있다 — 그 전에는 resolve 되지 않는다.
  const patches = writes('/islands/i1', 'PATCH');
  assert.equal(patches.length, 1);
  assert.deepEqual(sentBody(patches[0]), { name: '새 섬', maxMembers: 10 });
  assert.equal('expectedVersion' in sentBody(patches[0]), false); // 공개 계약에 없는 키
  assert.match(idemKey(patches[0]), UUID36);
  assert.equal(gets('/islands/i1').length, 2);
  assert.equal(settled, null);

  await act(async () => {
    releaseD(data(detail('host', { name: '새 섬', version: 4 })));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(settled, 'ok');
  assert.equal(h.result.current.detail?.name, '새 섬'); // 재조회 결과로 확정됐다
  assert.equal(gets('/islands/i1/members').length, 2);
  assert.equal(gets('/islands/i1/join-requests').length, 2);
  await h.unmount();
});

test('saveSettings — 응답 유실 재시도는 같은 UUID36 key·같은 body 로 다시 보낸다', async () => {
  let fail = true;
  serveHost({
    'PATCH /islands/i1': () => {
      if (fail) {
        fail = false;
        throw new TypeError('Network request failed'); // 응답 유실
      }
      return data(managed({ version: 5 }));
    },
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  let first: unknown;
  await act(async () => {
    first = await h.result.current.saveSettings({ maxMembers: 10 }).catch((e) => e);
  });
  assert.equal(code(first), 'CLIENT_NETWORK_ERROR');

  await act(async () => {
    await h.result.current.saveSettings({ maxMembers: 10 }); // 같은 의도 재시도
  });
  const patches = writes('/islands/i1', 'PATCH');
  assert.equal(patches.length, 2);
  assert.match(idemKey(patches[0]), UUID36);
  assert.equal(idemKey(patches[0]), idemKey(patches[1])); // 같은 의도 — 같은 key
  assert.equal(patches[0].init.body, patches[1].init.body); // 같은 body
  await h.unmount();
});

test('saveSettings — 진행 중 같은 payload 는 합류하고 다른 payload 는 거절한다', async () => {
  let release: (r: Resp) => void = () => {};
  const gate = new Promise<Resp>((r) => (release = r));
  serveHost({ 'PATCH /islands/i1': () => gate });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  let ok1 = false,
    ok2 = false,
    diffErr: unknown;
  await act(async () => {
    const w1 = h.result.current.saveSettings({ name: 'a' });
    const w2 = h.result.current.saveSettings({ name: 'a' }); // 같은 의도 — 합류
    w1.then(
      () => (ok1 = true),
      () => {},
    );
    w2.then(
      () => (ok2 = true),
      () => {},
    );
    diffErr = await h.result.current.saveSettings({ name: 'b' }).catch((e) => e);
  });
  assert.equal(code(diffErr), CLIENT_IN_FLIGHT);
  assert.equal(writes('/islands/i1', 'PATCH').length, 1); // 중복 요청 없음

  await act(async () => {
    release(data(managed({ name: 'a', version: 4 })));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(ok1, true); // 합류한 양쪽이 같은 결과를 받는다
  assert.equal(ok2, true);
  assert.equal(gets('/islands/i1').length, 2); // 성공 뒤 재조회가 돌았다
  await h.unmount();
});

test('saveSettings — 성공 뒤 같은 payload 도 새 intent(새 key)다', async () => {
  serveHost({ 'PATCH /islands/i1': data(managed({ version: 5 })) });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  await act(async () => {
    await h.result.current.saveSettings({ maxMembers: 10 });
  });
  await act(async () => {
    await h.result.current.saveSettings({ maxMembers: 10 });
  });
  const patches = writes('/islands/i1', 'PATCH');
  assert.equal(patches.length, 2);
  assert.notEqual(idemKey(patches[0]), idemKey(patches[1]));
  await h.unmount();
});

test('saveSettings — 409 충돌은 재조회를 시도하고 원래 오류를 올리며 재시도는 새 key', async () => {
  let conflict = true;
  serveHost({
    'PATCH /islands/i1': () =>
      conflict ? errResp(409, 'STATE_CONFLICT') : data(managed({ version: 5 })),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  let e1: unknown;
  await act(async () => {
    e1 = await h.result.current.saveSettings({ maxMembers: 10 }).catch((e) => e);
  });
  assert.equal(code(e1), 'STATE_CONFLICT'); // 원래 오류 그대로
  assert.equal((e1 as { status: number }).status, 409);
  assert.equal(gets('/islands/i1').length, 2); // 최신 상세 재조회가 돌았다
  assert.equal(h.result.current.role, 'host');

  conflict = false;
  await act(async () => {
    await h.result.current.saveSettings({ maxMembers: 10 });
  });
  const patches = writes('/islands/i1', 'PATCH');
  assert.equal(patches.length, 2);
  assert.notEqual(idemKey(patches[0]), idemKey(patches[1])); // terminal — 새 의도
  await h.unmount();
});

test('saveSettings — 403 은 재조회로 권한 상실을 반영하고 원래 오류를 올린다', async () => {
  let detailN = 0;
  serve({
    'GET /islands/i1': () => data(detailN++ === 0 ? detail('host') : detail('member')),
    'GET /islands/i1/members': data(membersPage([member('u1')])),
    'GET /islands/i1/join-requests': data(requestsPage([joinReq('r1')])),
    'PATCH /islands/i1': errResp(403, 'FORBIDDEN'),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(h.result.current.requests?.length, 1);

  let e: unknown;
  await act(async () => {
    e = await h.result.current.saveSettings({ name: 'x' }).catch((x) => x);
  });
  assert.equal(code(e), 'FORBIDDEN');
  assert.equal((e as { status: number }).status, 403);
  // 재조회 결과 role member — 신청 캐시는 비워지고 join-requests 는 다시 읽지 않는다.
  assert.equal(h.result.current.role, 'member');
  assert.equal(h.result.current.requests, null);
  assert.equal(gets('/islands/i1/join-requests').length, 1);

  // 오래된 권한 버튼이 성공으로 남지 않는다 — 이후 쓰기는 요청 없이 거절.
  const before = calls.length;
  const e2 = await h.result.current.saveSettings({ name: 'y' }).catch((x) => x);
  assert.equal(code(e2), CLIENT_FORBIDDEN);
  assert.equal(calls.length, before);
  await h.unmount();
});

test('쓰기는 host 확정에서만 나간다 — member·읽기 실패 상태는 요청 없이 거절, reload 로 회복', async () => {
  serve({
    'GET /islands/i1': data(detail('member')),
    'GET /islands/i1/members': data(membersPage([])),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  const memberErr = await h.result.current.saveSettings({ name: 'x' }).catch((e) => e);
  assert.equal(code(memberErr), CLIENT_FORBIDDEN);
  assert.equal(writes('/islands/i1', 'PATCH').length, 0);
  await h.unmount();

  // 읽기 실패로 host 캐시가 없으면 쓰기도 막힌다 — 명시 reload 로 회복해야 한다.
  let ok = false;
  calls.length = 0;
  serve({
    'GET /islands/i1': () => (ok ? data(detail('host')) : envelope('INTERNAL')),
    'GET /islands/i1/members': data(membersPage([])),
    'GET /islands/i1/join-requests': data(requestsPage([])),
    'PATCH /islands/i1': data(managed()),
  });
  const h2 = await mount({ active: true, islandId: 'i1' });
  await flush();
  const errState = await h2.result.current.saveSettings({ name: 'x' }).catch((e) => e);
  assert.equal(code(errState), CLIENT_FORBIDDEN);
  assert.equal(writes('/islands/i1', 'PATCH').length, 0);

  ok = true;
  await act(async () => {
    await h2.result.current.reload();
  });
  await act(async () => {
    await h2.result.current.saveSettings({ name: 'x' });
  });
  assert.equal(writes('/islands/i1', 'PATCH').length, 1);
  await h2.unmount();
});

test('쓰기 후 재조회가 supersede 되면 성공으로 끝내지 않는다 — 최신 읽기 확정 전까지 STALE', async () => {
  // PATCH 뒤 쓰기의 재조회가 도는 사이 수동 reload 가 확정권(seq)을 가져간다.
  // supersede 된 재조회는 STALE 로 끝나지만, 살아 있는 scope 라는 이유만으로 resolve 하면
  // 안 된다 — 최신 canonical 읽기가 실제 성공할 때까지 쓰기 결과는 미확정이다.
  const gates: ((r: Resp) => void)[] = [];
  const membersRel: ((r: Resp) => void)[] = [];
  const requestsRel: ((r: Resp) => void)[] = [];
  serve({
    'GET /islands/i1': () => new Promise<Resp>((r) => gates.push(r)),
    'GET /islands/i1/members': () => new Promise<Resp>((r) => membersRel.push(r)),
    'GET /islands/i1/join-requests': () => new Promise<Resp>((r) => requestsRel.push(r)),
    'PATCH /islands/i1': data(managed()),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await act(async () => {
    gates[0](data(detail('host'))); // 첫 로드 — 상세가 풀려야 목록 GET 이 나간다
    await new Promise((r) => setTimeout(r, 0));
    membersRel[0](data(membersPage([member('u1', 'host')])));
    requestsRel[0](data(requestsPage([])));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.result.current.role, 'host');

  let writeErr: unknown = 'pending';
  await act(async () => {
    const w = h.result.current.saveSettings({ name: 'x' }).then(
      () => (writeErr = 'resolved'),
      (e) => (writeErr = e),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
  // PATCH 성공, 쓰기의 재조회 상세 GET 이 나갔다.
  assert.equal(writes('/islands/i1', 'PATCH').length, 1);
  assert.equal(gates.length, 2);

  // 이제 수동 reload 가 더 늦은 seq 로 쓰기의 재조회를 supersede 한다.
  let manualSettled: string | undefined;
  let manual!: Promise<unknown>;
  await act(async () => {
    manual = h.result.current.reload().then(
      () => (manualSettled = 'ok'),
      () => (manualSettled = 'fail'),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(gates.length, 3);

  await act(async () => {
    gates[1](data(detail('host'))); // 쓰기의 재조회 — supersede 돼 목록 GET 없이 STALE
    await new Promise((r) => setTimeout(r, 0));
  });
  // 최신 읽기는 아직 pending — 쓰기를 성공으로 끝내면 안 된다.
  assert.equal(code(writeErr), CLIENT_STALE_SESSION);
  assert.equal(manualSettled, undefined);

  await act(async () => {
    gates[2](data(detail('host'))); // 최신 읽기가 실제로 확정된다
    await new Promise((r) => setTimeout(r, 0));
    membersRel[1](data(membersPage([])));
    requestsRel[1](data(requestsPage([])));
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await manual;
  });
  assert.equal(manualSettled, 'ok');
  assert.equal(h.result.current.detail?.id, 'i1');
  await h.unmount();
});

test('쓰기 후 재조회 supersede — 최신 읽기가 실패해도 쓰기는 성공으로 끝나지 않는다', async () => {
  const gates: ((r: Resp) => void)[] = [];
  serve({
    'GET /islands/i1': () => new Promise<Resp>((r) => gates.push(r)),
    'GET /islands/i1/members': data(membersPage([member('u1', 'host')])),
    'GET /islands/i1/join-requests': data(requestsPage([])),
    'PATCH /islands/i1': data(managed()),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await act(async () => {
    gates[0](data(detail('host')));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.result.current.role, 'host');

  let writeErr: unknown = 'pending';
  await act(async () => {
    const w = h.result.current.saveSettings({ name: 'x' }).then(
      () => (writeErr = 'resolved'),
      (e) => (writeErr = e),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(gates.length, 2); // 쓰기의 재조회 상세 GET 이 나갔다

  await act(async () => {
    const manual = h.result.current.reload().catch((e) => e); // 더 늦은 seq — supersede
    await new Promise((r) => setTimeout(r, 0));
    gates[1](data(detail('host'))); // 쓰기의 재조회 — supersede 돼 STALE
    gates[2](envelope('INTERNAL')); // 최신 읽기는 실패
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(code(await manual), 'INTERNAL');
  });
  assert.equal(code(writeErr), CLIENT_STALE_SESSION);
  assert.equal(h.result.current.error?.code, 'INTERNAL');
  await h.unmount();
});

test('세대 교체 뒤 옛 flight 의 늦은 정리가 새 scope 의 같은 slot 을 지우지 않는다', async () => {
  // 옛 scope 의 쓰기가 pending 인 채로 계정이 바뀌면 새 scope 는 같은 'settings' slot 에
  // 새 flight·의도·busy 를 올린다. 옛 flight 의 finally 가 슬롯 문자열로 무조건 지우면
  // 새 flight 가 증발해 병렬 쓰기가 열린다 — 정리는 객체 identity 로만.
  const patchGates: ((r: Resp) => void)[] = [];
  const detailGates: ((r: Resp) => void)[] = [];
  serve({
    'GET /islands/i1': () => new Promise<Resp>((r) => detailGates.push(r)),
    'GET /islands/i1/members': data(membersPage([member('u1', 'host')])),
    'GET /islands/i1/join-requests': data(requestsPage([])),
    'PATCH /islands/i1': () => new Promise<Resp>((r) => patchGates.push(r)),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await act(async () => {
    detailGates[0](data(detail('host')));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.result.current.role, 'host');

  // 옛 scope 에서 쓰기 시작 — PATCH pending.
  await act(async () => {
    h.result.current.saveSettings({ name: 'old' }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(writes('/islands/i1', 'PATCH').length, 1);

  // 계정 교체 → 새 scope. 새 scope 의 재조회가 host 를 다시 확정한다.
  await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' });
  await h.rerender({ active: true, islandId: 'i1' });
  await act(async () => {
    detailGates[1](data(detail('host')));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.result.current.role, 'host');

  // 새 scope 의 같은 slot 쓰기 — 새 flight·의도·busy.
  await act(async () => {
    h.result.current.saveSettings({ name: 'new' }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(writes('/islands/i1', 'PATCH').length, 2);

  // 옛 PATCH 가 늦게 성공한다 — 옛 finally 가 돌아도 새 slot 항목은 살아 있어야 한다.
  await act(async () => {
    patchGates[0](data(managed()));
    await new Promise((r) => setTimeout(r, 0));
  });
  const third = await h.result.current.saveSettings({ name: 'third' }).catch((e) => e);
  assert.equal(code(third), CLIENT_IN_FLIGHT); // 새 flight·busy 가 보존됐다

  // 새 쓰기를 끝낸다 — post-write 재조회 상세도 푼다.
  await act(async () => {
    patchGates[1](data(managed()));
    await new Promise((r) => setTimeout(r, 0));
    detailGates[2](data(detail('host')));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(writes('/islands/i1', 'PATCH').length, 2); // 거절된 third 는 요청 없음
  await h.unmount();
});

test('saveSettings — 호출 뒤 patch 객체를 바꿔도 진행 의도의 key·body 는 그대로다', async () => {
  // 쓰기는 호출 시점에 허용 필드만 복사·freeze 한다 — 재시도 사이 호출부 mutation 이
  // 같은 key 의 body 를 바꾸면 서버 멱등이 깨진다.
  let fail = true;
  serveHost({
    'PATCH /islands/i1': () => {
      if (fail) {
        fail = false;
        throw new TypeError('Network request failed'); // 응답 유실 — 의도 유지
      }
      return data(managed({ version: 5 }));
    },
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  const patch = { name: 'A' } as Parameters<typeof h.result.current.saveSettings>[0];
  let first: unknown;
  await act(async () => {
    first = await h.result.current.saveSettings(patch).catch((e) => e);
    patch.name = 'B'; // 진행 의도에 영향을 주면 안 되는 늦은 mutation
    patch.maxMembers = 9;
    (patch as Record<string, unknown>).evil = 1; // 계약 밖 키는 어디에도 실리지 않는다
  });
  assert.equal(code(first), 'CLIENT_NETWORK_ERROR');
  assert.deepEqual(sentBody(writes('/islands/i1', 'PATCH')[0]), { name: 'A' });

  // mutation 된 객체로 다시 부르면 다른 payload — 새 의도, 스냅샷 body 로만 나간다.
  await act(async () => {
    await h.result.current.saveSettings(patch);
  });
  const patches = writes('/islands/i1', 'PATCH');
  assert.equal(patches.length, 2);
  assert.notEqual(idemKey(patches[0]), idemKey(patches[1]));
  assert.deepEqual(sentBody(patches[1]), { name: 'B', maxMembers: 9 });
  assert.equal('evil' in sentBody(patches[1]), false);
  await h.unmount();
});

test('answerRequest — PATCH {decision} 에 UUID36 key, 성공 뒤 재조회로 확정한다', async () => {
  let detailN = 0;
  serveHost({
    'GET /islands/i1': () => data(detail('host', detailN++ === 0 ? {} : { version: 4 })),
    'PATCH /islands/i1/join-requests/r1': data({
      status: 'approved',
      memberId: 'u9',
      version: 3,
    }),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(h.result.current.requests?.length, 1);

  await act(async () => {
    await h.result.current.answerRequest('r1', 'approve');
  });

  const answers = writes('/islands/i1/join-requests/r1', 'PATCH');
  assert.equal(answers.length, 1);
  assert.deepEqual(sentBody(answers[0]), { decision: 'approve' });
  assert.match(idemKey(answers[0]), UUID36);
  assert.equal(gets('/islands/i1').length, 2); // 성공 뒤 canonical 재조회
  assert.equal(gets('/islands/i1/members').length, 2);
  assert.equal(gets('/islands/i1/join-requests').length, 2);
  assert.equal(h.result.current.detail?.version, 4); // 재조회 결과로 확정됐다
  await h.unmount();
});

test('answerRequest — 응답 유실 재시도는 같은 UUID36 key·같은 body', async () => {
  let fail = true;
  serveHost({
    'PATCH /islands/i1/join-requests/r1': () => {
      if (fail) {
        fail = false;
        throw new TypeError('Network request failed');
      }
      return data({ status: 'rejected', memberId: null, version: 2 });
    },
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  const first = await h.result.current.answerRequest('r1', 'reject').catch((e) => e);
  assert.equal(code(first), 'CLIENT_NETWORK_ERROR');
  await act(async () => {
    await h.result.current.answerRequest('r1', 'reject');
  });

  const answers = writes('/islands/i1/join-requests/r1', 'PATCH');
  assert.equal(answers.length, 2);
  assert.equal(idemKey(answers[0]), idemKey(answers[1]));
  assert.equal(answers[0].init.body, answers[1].init.body);
  await h.unmount();
});

test('kickMember — DELETE 에 UUID36 key, body 없음, 성공 뒤 주민 재조회', async () => {
  serveHost({ 'DELETE /islands/i1/members/u9': data({ removed: true }) });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  await act(async () => {
    await h.result.current.kickMember('u9');
  });

  const kicks = writes('/islands/i1/members/u9', 'DELETE');
  assert.equal(kicks.length, 1);
  assert.equal(kicks[0].init.body, undefined);
  assert.match(idemKey(kicks[0]), UUID36);
  assert.equal(gets('/islands/i1').length, 2); // 재조회가 돌았다
  assert.equal(gets('/islands/i1/members').length, 2);
  await h.unmount();
});

test('transferHost — POST {targetUserId}, 성공 뒤 member 강등과 신청 캐시 비움은 재조회 결과', async () => {
  let detailN = 0;
  serve({
    // 위임 후 재조회는 member — 신청 목록은 다시 읽지 않고 캐시도 비운다.
    'GET /islands/i1': () => data(detail(detailN++ === 0 ? 'host' : 'member')),
    'GET /islands/i1/members': data(membersPage([member('u9', 'host')])),
    'GET /islands/i1/join-requests': data(requestsPage([joinReq('r1')])),
    'POST /islands/i1/host-transfer': data({ hostUserId: 'u9', version: 8 }),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();
  assert.equal(h.result.current.requests?.length, 1);

  await act(async () => {
    await h.result.current.transferHost('u9');
  });

  const transfers = writes('/islands/i1/host-transfer', 'POST');
  assert.equal(transfers.length, 1);
  assert.deepEqual(sentBody(transfers[0]), { targetUserId: 'u9' });
  assert.match(idemKey(transfers[0]), UUID36);
  assert.equal(new URL(transfers[0].url).search, '');
  assert.equal(h.result.current.role, 'member'); // 응답이 아니라 재조회로 강등 확정
  assert.equal(h.result.current.requests, null);
  assert.equal(gets('/islands/i1/join-requests').length, 1); // member 재조회는 신청을 읽지 않는다
  await h.unmount();
});

test('다른 명령이 진행 중이면 어떤 쓰기든 CLIENT_IN_FLIGHT — 병렬 쓰기 없음', async () => {
  let release: (r: Resp) => void = () => {};
  const gate = new Promise<Resp>((r) => (release = r));
  serveHost({ 'DELETE /islands/i1/members/u9': () => gate });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  let answerErr: unknown;
  let transferErr: unknown;
  let settingsErr: unknown;
  await act(async () => {
    h.result.current.kickMember('u9').catch(() => undefined); // 단일 flight 점유
    await new Promise((r) => setTimeout(r, 0));
    answerErr = await h.result.current.answerRequest('r1', 'approve').catch((e) => e);
    transferErr = await h.result.current.transferHost('u9').catch((e) => e);
    settingsErr = await h.result.current.saveSettings({ name: 'x' }).catch((e) => e);
  });
  assert.equal(code(answerErr), CLIENT_IN_FLIGHT);
  assert.equal(code(transferErr), CLIENT_IN_FLIGHT);
  assert.equal(code(settingsErr), CLIENT_IN_FLIGHT);
  assert.equal(writes('/islands/i1/members/u9', 'DELETE').length, 1);
  assert.equal(writes('/islands/i1/join-requests/r1', 'PATCH').length, 0);
  assert.equal(writes('/islands/i1/host-transfer', 'POST').length, 0);
  assert.equal(writes('/islands/i1', 'PATCH').length, 0);

  await act(async () => {
    release(data({ removed: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(gets('/islands/i1').length, 2); // kick 재조회로 정상 종료
  await h.unmount();
});

test('쓰기 실패 처리 도중 scope 가 죽으면 원래 오류가 아니라 STALE 로 끝난다', async () => {
  // 403 회복 재조회가 도는 사이 계정이 바뀌었다 — 옛 화면에 FORBIDDEN 을 올리지 않는다.
  let detailN = 0;
  serve({
    'GET /islands/i1': async () => {
      if (detailN++ === 0) return data(detail('host'));
      await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' }); // 회복 GET 도중 교체
      return data(detail('host'));
    },
    'GET /islands/i1/members': data(membersPage([member('u1', 'host')])),
    'GET /islands/i1/join-requests': data(requestsPage([])),
    'DELETE /islands/i1/members/u9': errResp(403, 'FORBIDDEN'),
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  let e: unknown;
  await act(async () => {
    e = await h.result.current.kickMember('u9').catch((x) => x);
  });
  assert.equal(code(e), CLIENT_STALE_SESSION); // 원래 403 이 아니라 STALE
  assert.equal(h.result.current.error, null); // 죽은 scope 의 재조회는 오류 상태도 발행하지 않는다
  assert.equal(h.result.current.accessLost, false);
  await h.unmount();
});

test('쓰기 응답 전 세대 교체 — CLIENT_STALE_SESSION 으로 끝나고 재조회도 나가지 않는다', async () => {
  serveHost({
    'PATCH /islands/i1': async () => {
      await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' });
      return data(managed());
    },
  });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  let e: unknown;
  await act(async () => {
    e = await h.result.current.saveSettings({ name: 'x' }).catch((x) => x);
  });
  assert.equal(code(e), CLIENT_STALE_SESSION);
  assert.equal(gets('/islands/i1').length, 1); // 옛 세대의 후속 GET 없음
  await h.unmount();
});

test('쓰기 도중 언마운트 — 늦은 성공도 STALE 로 끝나고 상태는 건드리지 않는다', async () => {
  let release: (r: Resp) => void = () => {};
  const gate = new Promise<Resp>((r) => (release = r));
  serveHost({ 'PATCH /islands/i1': () => gate });
  const h = await mount({ active: true, islandId: 'i1' });
  await flush();

  const w = h.result.current.saveSettings({ name: 'x' }).catch((e) => e);
  await flush();
  assert.equal(writes('/islands/i1', 'PATCH').length, 1);

  await h.unmount();
  release(data(managed()));
  const e = await w;
  assert.equal(code(e), CLIENT_STALE_SESSION);
});
