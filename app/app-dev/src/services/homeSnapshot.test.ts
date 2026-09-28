import assert from 'node:assert/strict';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { CLIENT_CONTRACT_ERROR } from '@/services/api/home';
import { clearSession, saveSession } from '@/services/api/session';

jest.mock('@/services/api/home', () => ({
  ...jest.requireActual('@/services/api/home'),
  getHome: jest.fn(),
  getConstructionOptions: jest.fn(),
  getMembers: jest.fn(),
}));
jest.mock('@/services/api/islands', () => ({
  ...jest.requireActual('@/services/api/islands'),
  myIslands: jest.fn(),
}));

import { getConstructionOptions, getHome, getMembers } from '@/services/api/home';
import { myIslands } from '@/services/api/islands';
import { loadHomeSnapshot } from '@/services/homeSnapshot';

const mockedGetHome = getHome as jest.Mock;
const mockedGetConstructionOptions = getConstructionOptions as jest.Mock;
const mockedGetMembers = getMembers as jest.Mock;
const mockedMyIslands = myIslands as jest.Mock;

const member = (id: string, over: object = {}) => ({
  id,
  name: '주민 ' + id,
  catColor: 'ginger',
  role: 'member',
  appearance: null,
  ...over,
});

const homeScreen = (islandId: string, over: object = {}) => ({
  island: {
    id: islandId,
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
  playbackAvailability: 'available',
  buildings: ['hall', 'board'],
  members: { items: [member('m1')], nextCursor: null, version: 5 },
  ...over,
});

const stateConflict = (field: string) =>
  new ApiError('STATE_CONFLICT', '현재 상태에서 실행할 수 없어요.', 409, { field });

const args = { date: '2026-09-21', timezone: 'Asia/Seoul' };

beforeEach(async () => {
  jest.clearAllMocks();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('성공 — GET /screens/home 한 번으로 원자적 facts 하나를 돌려준다', async () => {
  mockedGetHome.mockResolvedValue(homeScreen('i1'));

  const snap = await loadHomeSnapshot(args);

  assert.equal(mockedGetHome.mock.calls.length, 1);
  assert.equal(mockedGetHome.mock.calls[0][0], '2026-09-21');
  assert.equal(mockedGetHome.mock.calls[0][1], 'Asia/Seoul');
  // 이전 5콜 흐름의 조각은 하나도 부르지 않는다.
  assert.equal(mockedMyIslands.mock.calls.length, 0);
  assert.equal(mockedGetConstructionOptions.mock.calls.length, 0);
  assert.equal(mockedGetMembers.mock.calls.length, 0);
  assert.equal(snap.status, 'loaded');
});

test('facts 매핑 — islandId·completedBuildings·members 는 응답 필드를 그대로 옮긴다', async () => {
  mockedGetHome.mockResolvedValue(
    homeScreen('i1', {
      buildings: ['hall', 'board', 'library'],
      members: {
        items: [member('m1'), member('m2', { catColor: null })],
        nextCursor: null,
        version: 5,
      },
    }),
  );

  const snap = await loadHomeSnapshot(args);

  assert.equal(snap.status, 'loaded');
  if (snap.status !== 'loaded') return;
  assert.equal(snap.facts.islandId, 'i1');
  assert.equal(snap.facts.home.island.name, '모래섬');
  assert.deepEqual(snap.facts.completedBuildings, ['hall', 'board', 'library']);
  assert.deepEqual(
    snap.facts.members.map((m) => m.id),
    ['m1', 'm2'],
  );
  // null catColor 는 임의색으로 채우지 않고 보존한다.
  assert.equal(snap.facts.members[1].catColor, null);
});

test('current 없음 — 서버 409 STATE_CONFLICT/currentIslandId 는 select 상태로 접는다', async () => {
  mockedGetHome.mockRejectedValue(stateConflict('currentIslandId'));

  const snap = await loadHomeSnapshot(args);

  assert.deepEqual(snap, { status: 'select' });
  assert.equal(mockedGetHome.mock.calls.length, 1);
  assert.equal(mockedMyIslands.mock.calls.length, 0);
});

test('다른 409 STATE_CONFLICT 는 select 로 접지 않고 그대로 올라온다', async () => {
  mockedGetHome.mockRejectedValue(stateConflict('expectedVersion'));

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, 'STATE_CONFLICT');
  assert.equal(error.field, 'expectedVersion');
});

test('현재 섬 없음이 아닌 다른 실패는 코드를 보존한 채 그대로 올라온다', async () => {
  mockedGetHome.mockRejectedValue(
    new ApiError('FORBIDDEN', '권한이 없어요.', 403, { field: 'islandId' }),
  );

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, 'FORBIDDEN');
  assert.equal(error.status, 403);
});

test('buildings 가 배열이 아니면 계약 오류다', async () => {
  mockedGetHome.mockResolvedValue(homeScreen('i1', { buildings: 'hall' }));

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_CONTRACT_ERROR);
});

test('buildings 에 모르는 건물 id 가 있으면 계약 오류다', async () => {
  mockedGetHome.mockResolvedValue(homeScreen('i1', { buildings: ['hall', 'lighthouse'] }));

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_CONTRACT_ERROR);
});

test('members 가 빠진 응답은 TypeError 가 아니라 계약 오류다', async () => {
  mockedGetHome.mockResolvedValue(homeScreen('i1', { members: null }));

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_CONTRACT_ERROR);
});

test('isCurrent 가 처음부터 false 면 요청을 하나도 보내지 않는다', async () => {
  mockedGetHome.mockResolvedValue(homeScreen('i1'));

  const error = await loadHomeSnapshot({ ...args, isCurrent: () => false }).catch((e) => e);

  assert.equal(error.code, CLIENT_STALE_SESSION);
  assert.equal(mockedGetHome.mock.calls.length, 0);
});

test('getHome 응답이 오는 사이 인증 세대가 바뀌면 CLIENT_STALE_SESSION 이다', async () => {
  mockedGetHome.mockImplementation(async () => {
    // 응답이 돌아오는 사이 계정 전환이 끝났다.
    await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' });
    return homeScreen('i1');
  });

  const error = await loadHomeSnapshot(args).catch((e) => e);

  assert.equal(error.code, CLIENT_STALE_SESSION);
});

test('getHome 응답이 오는 사이 isCurrent 가 false 로 바뀌면 CLIENT_STALE_SESSION 이다', async () => {
  let live = true;
  mockedGetHome.mockImplementation(async () => {
    live = false;
    return homeScreen('i1');
  });

  const error = await loadHomeSnapshot({ ...args, isCurrent: () => live }).catch((e) => e);

  assert.equal(error.code, CLIENT_STALE_SESSION);
});

test('죽은 호출의 실패는 원래 코드가 아니라 CLIENT_STALE_SESSION — 살아 있으면 원래 코드를 보존한다', async () => {
  let live = true;
  mockedGetHome.mockImplementation(async () => {
    live = false;
    throw new ApiError('INTERNAL_ERROR', '서버 오류.', 500);
  });

  const dead = await loadHomeSnapshot({ ...args, isCurrent: () => live }).catch((e) => e);
  assert.equal(dead.code, CLIENT_STALE_SESSION);

  mockedGetHome.mockRejectedValue(new ApiError('INTERNAL_ERROR', '서버 오류.', 500));
  const alive500 = await loadHomeSnapshot(args).catch((e) => e);
  assert.equal(alive500.code, 'INTERNAL_ERROR');
  assert.equal(alive500.status, 500);
});
