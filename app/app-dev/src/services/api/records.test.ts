import assert from 'node:assert/strict';
import { API_URL, ApiError } from '@/services/api/client';
import { CLIENT_CONTRACT_ERROR } from '@/services/api/home';
import { clearSession, saveSession } from '@/services/api/session';
import {
  getFocusStatistics,
  getLibraryScreen,
  getScreenTimeStatistics,
  utcPeriodRange,
} from '@/services/api/records';

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];

const failed = (p: Promise<unknown>): Promise<ApiError> =>
  p.then(
    () => {
      throw new Error('요청이 거절돼야 한다');
    },
    (e: unknown) => e as ApiError,
  );

function stub(status: number, body: unknown) {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
}

const ISLAND = '3f6b9c2a-7d4e-4a1b-8c5d-2e9f0a1b3c4d';
const Q = { from: '2026-09-13', to: '2026-09-19' };

const focusMe = {
  scope: 'me',
  totalSeconds: 1500,
  series: [{ date: '2026-09-15', seconds: 1500 }],
  records: [
    { id: 'r1', subject: '수학', activeSeconds: 1500, completedAt: '2026-09-15T09:10:00Z' },
  ],
  nextCursor: null,
  asOf: '2026-09-19T00:00:00Z',
};

const libraryBody = {
  island: { id: ISLAND, name: '소다 섬', role: 'member' },
  statisticsAvailability: 'available',
  focusStatistics: focusMe,
  screenTimeStatistics: {
    scope: 'me',
    measurementStatus: 'authorized',
    totalMinutes: 90,
    series: [
      {
        date: '2026-09-15',
        minutes: 90,
        measurementStatus: 'authorized',
        updatedAt: '2026-09-15T10:00:00Z',
      },
    ],
    updatedAt: '2026-09-15T10:00:00Z',
  },
  fishEarnings: { members: [{ userId: 'u1', name: '민지', earnedFish: 12 }] },
};

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
});

test('getLibraryScreen — 무접두 /screens/library 를 query 없이 GET 한다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub(200, { data: libraryBody });

  const screen = await getLibraryScreen();

  assert.equal(calls[0].url, `${API_URL}/screens/library`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(screen.island.id, ISLAND);
  assert.equal(screen.statisticsAvailability, 'available');
  assert.equal(screen.focusStatistics?.totalSeconds, 1500);
  assert.equal(screen.fishEarnings?.members[0].earnedFish, 12);
});

test('getLibraryScreen — 도서관 미완공이면 조각 셋이 null 이고 facility_locked 다', async () => {
  stub(200, {
    data: {
      island: { id: ISLAND, name: '소다 섬', role: 'member' },
      statisticsAvailability: 'facility_locked',
      focusStatistics: null,
      screenTimeStatistics: null,
      fishEarnings: null,
    },
  });

  const screen = await getLibraryScreen();

  assert.equal(screen.statisticsAvailability, 'facility_locked');
  assert.equal(screen.focusStatistics, null);
  assert.equal(screen.screenTimeStatistics, null);
  assert.equal(screen.fishEarnings, null);
});

test('getFocusStatistics — from·to·timezone=UTC·scope·cursor 만 보낸다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub(200, { data: focusMe });

  const stats = await getFocusStatistics(ISLAND, { ...Q, scope: 'me', cursor: 'sig.abc+/==' });

  const url = calls[0].url;
  assert.ok(url.startsWith(`${API_URL}/islands/${ISLAND}/statistics/focus?`));
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  assert.deepEqual([...params.keys()].sort(), ['cursor', 'from', 'scope', 'timezone', 'to']);
  assert.equal(params.get('from'), '2026-09-13');
  assert.equal(params.get('to'), '2026-09-19');
  assert.equal(params.get('timezone'), 'UTC');
  assert.equal(params.get('scope'), 'me');
  assert.equal(stats.scope, 'me');
  assert.equal(stats.totalSeconds, 1500);
});

test('getFocusStatistics scope=island — members 배열과 nextCursor 를 돌려준다', async () => {
  stub(200, {
    data: {
      scope: 'island',
      members: [
        {
          userId: 'u1',
          name: '민지',
          catColor: 'ginger',
          totalSeconds: 600,
          series: [{ date: '2026-09-15', seconds: 600 }],
        },
      ],
      nextCursor: 'cur2',
      asOf: '2026-09-19T00:00:00Z',
    },
  });

  const stats = await getFocusStatistics(ISLAND, { ...Q, scope: 'island' });

  assert.equal(stats.scope, 'island');
  assert.equal(stats.members[0].userId, 'u1');
  assert.equal(stats.nextCursor, 'cur2');
});

test('getFocusStatistics — 요청한 scope 와 다른 응답은 계약 오류다', async () => {
  stub(200, { data: focusMe });

  const error = await failed(getFocusStatistics(ISLAND, { ...Q, scope: 'island' }));
  assert.equal(error.code, CLIENT_CONTRACT_ERROR);
});

test('getScreenTimeStatistics — 미집계(unavailable·null) 를 0으로 접지 않고 보존한다', async () => {
  stub(200, {
    data: {
      scope: 'me',
      measurementStatus: 'unavailable',
      totalMinutes: null,
      series: [],
      updatedAt: null,
    },
  });

  const stats = await getScreenTimeStatistics(ISLAND, { ...Q, scope: 'me' });

  assert.equal(stats.measurementStatus, 'unavailable');
  assert.equal(stats.totalMinutes, null);
  assert.deepEqual(stats.series, []);
  assert.equal(stats.updatedAt, null);
});

test('getScreenTimeStatistics — 미측정 날짜의 minutes:null 을 유지한다', async () => {
  stub(200, {
    data: {
      scope: 'me',
      measurementStatus: 'authorized',
      totalMinutes: 30,
      series: [
        {
          date: '2026-09-14',
          minutes: null,
          measurementStatus: 'pending',
          updatedAt: null,
        },
        {
          date: '2026-09-15',
          minutes: 30,
          measurementStatus: 'authorized',
          updatedAt: '2026-09-15T10:00:00Z',
        },
      ],
      updatedAt: '2026-09-15T10:00:00Z',
    },
  });

  const stats = await getScreenTimeStatistics(ISLAND, { ...Q, scope: 'me' });

  assert.equal(stats.series[0].minutes, null);
  assert.equal(stats.series[0].measurementStatus, 'pending');
});

test('통계 GET 은 403 을 빈 기록으로 접지 않고 ApiError 그대로 던진다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub(403, {
    error: { code: 'FORBIDDEN', message: '섬 주민만 볼 수 있어요.', field: 'islandId' },
    requestId: 'r1',
  });

  const error = await failed(getFocusStatistics(ISLAND, { ...Q, scope: 'me' }));
  assert.equal(error.code, 'FORBIDDEN');
  assert.equal(error.status, 403);
});

// ── utcPeriodRange — 통계·랭킹이 공유하는 UTC 축 ──

test('utcPeriodRange 주 — UTC 일요일~토요일 범위다(월요일 시작이 아니다)', () => {
  // 2026-09-22 는 화요일 — 같은 주는 9/20(일)~9/26(토)
  const range = utcPeriodRange('주', 0, Date.UTC(2026, 8, 22, 15));
  assert.deepEqual(range, { from: '2026-09-20', to: '2026-09-26' });
});

test('utcPeriodRange 주 — 일요일 당일은 그날이 주 시작이다', () => {
  const range = utcPeriodRange('주', 0, Date.UTC(2026, 8, 20, 0, 30));
  assert.deepEqual(range, { from: '2026-09-20', to: '2026-09-26' });
});

test('utcPeriodRange 주 — 토요일은 같은 주의 끝, 다음 offset 은 다음 일요일이다', () => {
  assert.deepEqual(utcPeriodRange('주', 0, Date.UTC(2026, 8, 26, 23)), {
    from: '2026-09-20',
    to: '2026-09-26',
  });
  assert.deepEqual(utcPeriodRange('주', -1, Date.UTC(2026, 8, 22)), {
    from: '2026-09-13',
    to: '2026-09-19',
  });
});

test('utcPeriodRange 일 — UTC 그날 하루다(기기 타임존과 무관)', () => {
  // KST 9/22 08:30 = UTC 9/21 23:30 — UTC 축에서는 9/21 이다
  assert.deepEqual(utcPeriodRange('일', 0, Date.UTC(2026, 8, 21, 23, 30)), {
    from: '2026-09-21',
    to: '2026-09-21',
  });
});

test('utcPeriodRange 월 — UTC 달력 월 전체다(말일·월 경계 포함)', () => {
  assert.deepEqual(utcPeriodRange('월', 0, Date.UTC(2026, 8, 22)), {
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.deepEqual(utcPeriodRange('월', -1, Date.UTC(2026, 0, 15)), {
    from: '2025-12-01',
    to: '2025-12-31',
  });
});
