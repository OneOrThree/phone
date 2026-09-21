import assert from 'node:assert/strict';
import { CLIENT_CONTRACT_ERROR } from '@/services/api/home';
import { CLIENT_STALE_SESSION } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import { CLIENT_SNAPSHOT_STALE, loadHomeSnapshot } from '@/services/homeSnapshot';

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

const path = (call: Call) => new URL(call.url).pathname;

const summary = (id: string, over: object = {}) => ({
  id,
  name: '섬 ' + id,
  intro: '',
  visibility: 'public',
  approvalRequired: false,
  memberCount: 3,
  maxMembers: 15,
  membershipStatus: 'active',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
  ...over,
});

const memberships = (
  currentIslandId: string | null,
  items: object[] = currentIslandId === null ? [] : [summary(currentIslandId)],
  lossReason: 'LEFT' | 'KICKED' | null = null,
) => ({ items, nextCursor: null, currentIslandId, lossReason });

const homeScreen = (islandId: string, villagePoints = 1500, memberCount = 1) => ({
  island: {
    id: islandId,
    name: '모래섬',
    intro: '',
    visibility: 'public',
    approvalRequired: false,
    memberCount,
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
  wallets: { fish: 500, villagePoints, fishVersion: null, villagePointsVersion: 7 },
  playback: null,
  playbackAvailability: 'available',
});

const optionItem = (id: string, over: object = {}) => ({
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

const member = (id: string, over: object = {}) => ({
  id,
  name: '주민 ' + id,
  catColor: 'ginger',
  role: 'member',
  appearance: null,
  ...over,
});

const membersPage = (items: object[], nextCursor: string | null = null, version = 5) => ({
  items,
  nextCursor,
  version,
});

const ok = (data: unknown) => ({ status: 200, body: { data } });
const envelope = (code: string, field: string | null = null) => ({
  error: { code, message: '실패했습니다.', field, retryable: false },
  requestId: 'req-x',
});

/** memberships → home+options+members → memberships 재확인까지 정상인 최소 응답 열. */
const happyPath = (over: { optionsItems?: object[]; membersItems?: object[] } = {}) => [
  ok(memberships('i1')),
  ok(homeScreen('i1')),
  ok(options(over.optionsItems ?? [])),
  ok(membersPage(over.membersItems ?? [member('m1')])),
  ok(memberships('i1')),
];

const args = { date: '2026-09-21', timezone: 'Asia/Seoul' };

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('성공 — memberships → 병렬 3조각 → 재확인을 거쳐 원자적 facts 하나를 돌려준다', async () => {
  stub(happyPath({ optionsItems: [optionItem('gram'), optionItem('shop')] }));

  const snap = await loadHomeSnapshot(args);

  assert.deepEqual(calls.map(path), [
    '/me/islands',
    '/screens/home',
    '/islands/i1/construction-options',
    '/islands/i1/members',
    '/me/islands',
  ]);
  assert.equal(snap.status, 'loaded');
  if (snap.status !== 'loaded') return;
  assert.equal(snap.facts.islandId, 'i1');
  assert.equal(snap.facts.home.island.name, '모래섬');
  assert.equal(snap.facts.home.focusSummary.totalSeconds, 90);
  assert.deepEqual(snap.facts.completedBuildings, ['hall', 'board', 'library', 'mail', 'tower']);
  assert.equal(snap.facts.members.length, 1);
});

test('서로 다른 잔액 — options 잔액이 home 지갑을 덮어쓰지 않는다', async () => {
  stub(happyPath());

  const snap = await loadHomeSnapshot(args);

  assert.equal(snap.status, 'loaded');
  if (snap.status !== 'loaded') return;
  // home 스냅샷의 공동 잔액(1500)이 options 의 별도 스냅샷(800)으로 바뀌지 않는다.
  assert.equal(snap.facts.home.wallets.villagePoints, 1500);
  assert.equal(snap.facts.home.wallets.fish, 500);
});

test('current null — 소속 목록·lossReason 을 담은 선택 상태, 추가 호출 없다', async () => {
  stub([ok(memberships(null, [summary('i1'), summary('i2')]))]);

  const snap = await loadHomeSnapshot(args);

  assert.equal(snap.status, 'select');
  if (snap.status !== 'select') return;
  assert.equal(snap.memberships.items.length, 2);
  assert.equal(snap.memberships.currentIslandId, null);
  assert.equal(calls.length, 1); // 홈 조각을 부르지 않는다
});

test('current null + 무소속 — lossReason 을 그대로 실어 돌려준다', async () => {
  stub([ok(memberships(null, [], 'KICKED'))]);

  const snap = await loadHomeSnapshot(args);

  assert.equal(snap.status, 'select');
  if (snap.status !== 'select') return;
  assert.equal(snap.memberships.lossReason, 'KICKED');
});

test('non-null current 가 소속 목록 밖이면 계약 오류 — 임의 섬으로 고르지 않는다', async () => {
  stub([ok(memberships('i9', [summary('i1')]))]);

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_CONTRACT_ERROR);
  assert.equal(calls.length, 1);
});

test('home.island.id 가 캡처한 current 와 다르면 계약 오류', async () => {
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i2')), // 서버가 다른 섬의 홈을 줬다
    ok(options([])),
    ok(membersPage([])),
  ]);

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_CONTRACT_ERROR);
  assert.equal(calls.length, 4); // 재확인까지 가지 않는다
});

test('재확인에서 current 가 바뀌었으면 옛 섬 스냅샷을 돌려주지 않는다', async () => {
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1', 1500, 0)),
    ok(options([])),
    ok(membersPage([])),
    ok(memberships('i2', [summary('i1'), summary('i2')])), // 그 사이 전환됐다
  ]);

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_SNAPSHOT_STALE);
});

test('재확인에서 소속이 빠졌으면(강퇴) stale — current 만 같아도 안 된다', async () => {
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1', 1500, 0)),
    ok(options([])),
    ok(membersPage([])),
    ok({ items: [], nextCursor: null, currentIslandId: 'i1', lossReason: 'KICKED' }),
  ]);

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_SNAPSHOT_STALE);
});

test('isCurrent 가 처음부터 false 면 요청을 하나도 보내지 않는다', async () => {
  stub(happyPath());

  const error = await loadHomeSnapshot({ ...args, isCurrent: () => false }).catch((e) => e);

  assert.equal(error.code, CLIENT_STALE_SESSION);
  assert.equal(calls.length, 0);
});

test('수집 도중 인증 세대가 바뀌면 CLIENT_STALE_SESSION — 재확인을 부르지 않는다', async () => {
  let index = 0;
  const responses = happyPath();
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = responses[index++];
    if (calls.length === 2) {
      // home 응답이 돌아오는 사이 계정 전환이 끝났다.
      await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' });
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_STALE_SESSION);
  assert.equal(calls.length, 4); // memberships + 병렬 3 — 그 뒤로 나가지 않는다
});

test('members 멀티페이지 — nextCursor 를 끝까지 이어 전원을 모은다', async () => {
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1', 1500, 2)),
    ok(options([])),
    ok(membersPage([member('m1')], 'c2', 5)),
    ok(membersPage([member('m2', { catColor: null })], null, 5)),
    ok(memberships('i1')),
  ]);

  const snap = await loadHomeSnapshot(args);

  assert.equal(snap.status, 'loaded');
  if (snap.status !== 'loaded') return;
  assert.deepEqual(
    snap.facts.members.map((m) => m.id),
    ['m1', 'm2'],
  );
  // null catColor 는 임의색으로 채우지 않고 보존한다.
  assert.equal(snap.facts.members[1].catColor, null);
  const second = new URL(calls[3 + 1].url);
  assert.equal(second.pathname, '/islands/i1/members');
  assert.equal(second.searchParams.get('cursor'), 'c2');
});

test('members 첫 페이지 내부 중복도 실패 — 두 번째 페이지 없이 reject', async () => {
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    ok(options([])),
    ok(membersPage([member('m1'), member('m1')])), // 같은 페이지 안의 중복
    ok(memberships('i1')),
  ]);

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_CONTRACT_ERROR);
  assert.equal(calls.length, 4); // 재확인까지 가지 않는다
});

test('응답 필수 필드가 빠지면 TypeError 가 아니라 CLIENT_CONTRACT_ERROR 다', async () => {
  // memberships 에 items 가 없다
  stub([ok({ nextCursor: null, currentIslandId: 'i1', lossReason: null })]);
  const noItems = await loadHomeSnapshot(args).catch((e) => e);
  assert.equal(noItems.code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // home 에 island 가 없다
  stub([
    ok(memberships('i1')),
    ok({
      focusSummary: {},
      session: null,
      restMembers: {},
      wallets: {},
      playback: null,
      playbackAvailability: 'available',
    }),
    ok(options([])),
    ok(membersPage([])),
  ]);
  const noIsland = await loadHomeSnapshot(args).catch((e) => e);
  assert.equal(noIsland.code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // members 단일 페이지에 version 이 없다 — 끝까지 읽어도 계약 오류
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    ok(options([])),
    ok({ items: [member('m1')], nextCursor: null }),
  ]);
  const noVersion = await loadHomeSnapshot(args).catch((e) => e);
  assert.equal(noVersion.code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // items 가 배열이 아니다
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    ok(options([])),
    ok({ items: 'oops', nextCursor: null, version: 5 }),
  ]);
  const badItems = await loadHomeSnapshot(args).catch((e) => e);
  assert.equal(badItems.code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // 주민에 id 가 없다 — Set 에 undefined 로 들어가 조용히 넘기면 안 된다
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    ok(options([])),
    ok({ items: [{ name: 'id 없음' }], nextCursor: null, version: 5 }),
  ]);
  const noId = await loadHomeSnapshot(args).catch((e) => e);
  assert.equal(noId.code, CLIENT_CONTRACT_ERROR);
});

test('members — 되돌아온 cursor·중복 주민·version 변경은 불완전 목록을 완료로 보이지 않게 실패', async () => {
  // 같은 cursor 재등장
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    ok(options([])),
    ok(membersPage([member('m1')], 'c2')),
    ok(membersPage([member('m3')], 'c2')),
  ]);
  const loop = await loadHomeSnapshot(args).catch((e) => e);
  assert.equal(loop.code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // 중복 주민
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    ok(options([])),
    ok(membersPage([member('m1')], 'c2')),
    ok(membersPage([member('m1')], null)),
  ]);
  const dup = await loadHomeSnapshot(args).catch((e) => e);
  assert.equal(dup.code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // 페이지 사이 version 변경
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    ok(options([])),
    ok(membersPage([member('m1')], 'c2', 5)),
    ok(membersPage([member('m2')], null, 6)),
  ]);
  const drift = await loadHomeSnapshot(args).catch((e) => e);
  assert.equal(drift.code, CLIENT_CONTRACT_ERROR);
});

test('조각 API 실패를 빈 성공으로 바꾸지 않는다 — 403·409 코드가 그대로 올라온다', async () => {
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    { status: 403, body: envelope('FORBIDDEN', 'islandId') },
    ok(membersPage([])),
  ]);

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, 'FORBIDDEN');
  assert.equal(error.status, 403);
});

test('memberships 의 409 STATE_CONFLICT 도 그대로 — current 없음을 빈 선택으로 접지 않는다', async () => {
  stub([{ status: 409, body: envelope('STATE_CONFLICT', 'currentIslandId') }]);

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, 'STATE_CONFLICT');
  assert.equal(error.status, 409);
});

test('home.memberCount 와 모은 주민 수가 다르면 stale — 수집 도중 소속이 바뀐 것이다', async () => {
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1', 1500, 2)), // 홈은 2명이라는데
    ok(options([])),
    ok(membersPage([member('m1')])), // 모인 건 1명
    ok(memberships('i1')),
  ]);

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_SNAPSHOT_STALE);
  assert.equal(calls.length, 4); // 재확인까지 가지 않는다
});

test('home.memberCount 자체가 비정상이면 계약 오류다', async () => {
  const noCount = { ...homeScreen('i1') };
  delete (noCount.island as Record<string, unknown>).memberCount;
  stub([ok(memberships('i1')), ok(noCount), ok(options([])), ok(membersPage([member('m1')]))]);
  assert.equal((await loadHomeSnapshot(args).catch((e) => e)).code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  const negative = { ...homeScreen('i1') };
  negative.island = { ...negative.island, memberCount: -1 };
  stub([ok(memberships('i1')), ok(negative), ok(options([])), ok(membersPage([member('m1')]))]);
  assert.equal((await loadHomeSnapshot(args).catch((e) => e)).code, CLIENT_CONTRACT_ERROR);
});

test('최상위 null·비객체·null 항목은 TypeError 가 아니라 CLIENT_CONTRACT_ERROR 다', async () => {
  // memberships 응답 자체가 null
  stub([{ status: 200, body: { data: null } }]);
  assert.equal((await loadHomeSnapshot(args).catch((e) => e)).code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // memberships.items 안에 null 항목
  stub([ok({ items: [null, summary('i1')], nextCursor: null, currentIslandId: 'i1' })]);
  assert.equal((await loadHomeSnapshot(args).catch((e) => e)).code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // home 응답 자체가 null
  stub([
    ok(memberships('i1')),
    { status: 200, body: { data: null } },
    ok(options([])),
    ok(membersPage([])),
  ]);
  assert.equal((await loadHomeSnapshot(args).catch((e) => e)).code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // members 첫 페이지가 null
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    ok(options([])),
    { status: 200, body: { data: null } },
  ]);
  assert.equal((await loadHomeSnapshot(args).catch((e) => e)).code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // members 후속 페이지가 null
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1', 1500, 2)),
    ok(options([])),
    ok(membersPage([member('m1')], 'c2', 5)),
    { status: 200, body: { data: null } },
  ]);
  assert.equal((await loadHomeSnapshot(args).catch((e) => e)).code, CLIENT_CONTRACT_ERROR);

  calls.length = 0;
  // 재확인 memberships 가 null
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    ok(options([])),
    ok(membersPage([member('m1')])),
    { status: 200, body: { data: null } },
  ]);
  assert.equal((await loadHomeSnapshot(args).catch((e) => e)).code, CLIENT_CONTRACT_ERROR);
});

test('reject 도 세대·isCurrent 를 검사한다 — 죽은 호출의 5xx 는 stale, 살아 있으면 원래 코드', async () => {
  let current = true;
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const alive = [
      ok(memberships('i1')),
      ok(homeScreen('i1')),
      ok(options([])),
      ok(membersPage([])),
    ][Math.min(calls.length - 1, 3)];
    if (calls.length === 2) current = false; // home 응답이 오는 사이 화면 세대가 죽었다
    const { status, body } =
      calls.length === 2 ? { status: 500, body: envelope('INTERNAL_ERROR') } : alive;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });

  const error = await loadHomeSnapshot({ ...args, isCurrent: () => current }).catch((e) => e);

  // 죽은 호출의 늦은 500 은 원래 코드가 아니라 CLIENT_STALE_SESSION 이다.
  assert.equal(error.code, CLIENT_STALE_SESSION);

  calls.length = 0;
  // 살아 있는 호출의 같은 500 은 코드를 그대로 보존한다.
  stub([
    ok(memberships('i1')),
    ok(homeScreen('i1')),
    { status: 500, body: envelope('INTERNAL_ERROR') },
    ok(membersPage([])),
  ]);
  const alive500 = await loadHomeSnapshot(args).catch((e) => e);
  assert.equal(alive500.code, 'INTERNAL_ERROR');
  assert.equal(alive500.status, 500);
});
