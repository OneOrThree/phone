/**
 * useLibraryDiary (GROMO-2018) — `/screens/library` 진입 집계 + 도메인 통계 조합.
 * empty(locked·미집계)·error·retry·페이지 합치기를 검증한다.
 */
import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import {
  getFocusStatistics,
  getLibraryScreen,
  getScreenTimeStatistics,
  utcPeriodRange,
  type FocusStatsIsland,
  type FocusStatsMe,
  type LibraryScreen,
  type ScreenStatsMe,
} from '@/services/api/records';
import { useLibraryDiary } from '@/screens/island/useLibraryDiary';

jest.mock('@/services/api/records', () => ({
  ...jest.requireActual('@/services/api/records'),
  getLibraryScreen: jest.fn(),
  getFocusStatistics: jest.fn(),
  getScreenTimeStatistics: jest.fn(),
}));

const libMock = getLibraryScreen as jest.Mock;
const focusMock = getFocusStatistics as jest.Mock;
const screenMock = getScreenTimeStatistics as jest.Mock;

const FOCUS_ME: FocusStatsMe = {
  scope: 'me',
  totalSeconds: 3600,
  series: [{ date: '2026-09-20', seconds: 3600 }],
  records: [
    { id: 'r1', subject: '수학', activeSeconds: 3600, completedAt: '2026-09-20T01:00:00Z' },
  ],
  nextCursor: null,
  asOf: '2026-09-20T12:00:00Z',
};
const SCREEN_ME: ScreenStatsMe = {
  scope: 'me',
  measurementStatus: 'authorized',
  totalMinutes: 45,
  series: [{ date: '2026-09-20', minutes: 45, measurementStatus: 'authorized', updatedAt: null }],
  updatedAt: '2026-09-20T02:00:00Z',
};
const ISLAND_FOCUS: FocusStatsIsland = {
  scope: 'island',
  members: [{ userId: 'u2', name: '물결', catColor: 'sky', totalSeconds: 120, series: [] }],
  nextCursor: null,
};

const lib = (over: Partial<LibraryScreen> = {}): LibraryScreen => ({
  island: { id: 'isl-1', name: '소금빵', role: 'owner' },
  statisticsAvailability: 'available',
  focusStatistics: FOCUS_ME,
  screenTimeStatistics: SCREEN_ME,
  fishEarnings: { members: [{ userId: 'u1', name: '나', earnedFish: 3 }] },
  missingFragments: [],
  ...over,
});

const props: {
  active: boolean;
  nb: boolean;
  page: number;
  period: '일' | '주' | '월';
  offset: number;
  combined?: boolean;
  focusSummaryOnly?: boolean;
} = { active: true, nb: false, page: 0, period: '주', offset: 0 };
const mount = (over: Partial<typeof props> = {}) =>
  renderHook((p: typeof props) => useLibraryDiary(p), { initialProps: { ...props, ...over } });

beforeEach(() => jest.clearAllMocks());

test('비활성(모크)이면 어떤 API 도 부르지 않는다', async () => {
  const { result } = await renderHook(() => useLibraryDiary({ ...props, active: false }));
  assert.equal(result.current.status, 'mock');
  assert.equal(libMock.mock.calls.length, 0);
});

test('내 일기장 이번 주 집중은 진입 집계 1회만으로 조각을 채운다', async () => {
  libMock.mockResolvedValue(lib());
  const { result } = await mount();

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(libMock.mock.calls.length, 1);
  assert.equal(focusMock.mock.calls.length, 0);
  assert.equal(screenMock.mock.calls.length, 0);
  assert.equal(result.current.focusMe?.totalSeconds, 3600);
  assert.equal(result.current.focusMe?.records[0]?.id, 'r1');
  assert.equal(result.current.screen?.fishEarnings?.members[0]?.earnedFish, 3);
});

test('스크린타임 장도 진입 집계 조각을 그대로 쓴다', async () => {
  libMock.mockResolvedValue(lib());
  const { result } = await mount({ page: 1 });

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(screenMock.mock.calls.length, 0);
  assert.equal(result.current.screenMe?.totalMinutes, 45);
});

test('이번 주가 아닌 기간은 UTC from/to 로 도메인 GET 을 부른다', async () => {
  libMock.mockResolvedValue(lib());
  focusMock.mockResolvedValue({ ...FOCUS_ME, records: [], totalSeconds: 0 });
  const { result } = await mount({ period: '월' });

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(focusMock.mock.calls.length, 1);
  const [islandId, query] = focusMock.mock.calls[0];
  const range = utcPeriodRange('월', 0);
  assert.equal(islandId, 'isl-1');
  assert.deepEqual(query, { scope: 'me', from: range.from, to: range.to });
});

test('이웃 장은 scope=island 주민 한 번에 읽고 탭 전환에 다시 부르지 않는다', async () => {
  libMock.mockResolvedValue(lib());
  focusMock.mockResolvedValue(ISLAND_FOCUS);
  const { result } = await mount({ nb: true });

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(focusMock.mock.calls.length, 1);
  assert.deepEqual(focusMock.mock.calls[0][1].scope, 'island');
  assert.equal(result.current.focusIsland?.members[0]?.userId, 'u2');
});

test('facility_locked 은 통계 호출 없이 locked 로 끝낸다', async () => {
  libMock.mockResolvedValue(
    lib({ statisticsAvailability: 'facility_locked', focusStatistics: null }),
  );
  const { result } = await mount();

  await waitFor(() => assert.equal(result.current.status, 'locked'));
  assert.equal(focusMock.mock.calls.length, 0);
  assert.equal(result.current.focusMe, null);
});

test('missingFragments 의 조각은 다시 묻지 않고 준비 중(null)으로 둔다', async () => {
  libMock.mockResolvedValue(lib({ focusStatistics: null, missingFragments: ['focusStatistics'] }));
  const { result } = await mount();

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(focusMock.mock.calls.length, 0);
  assert.equal(result.current.focusMe, null);
});

test('records nextCursor 는 끝까지 이어서 합친다', async () => {
  libMock.mockResolvedValue(lib({ focusStatistics: null }));
  focusMock.mockResolvedValueOnce({ ...FOCUS_ME, nextCursor: 'c2' }).mockResolvedValueOnce({
    ...FOCUS_ME,
    records: [
      { id: 'r2', subject: '영어', activeSeconds: 60, completedAt: '2026-09-21T00:00:00Z' },
    ],
    nextCursor: null,
  });
  const { result } = await mount();

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(focusMock.mock.calls.length, 2);
  assert.equal(focusMock.mock.calls[1][1].cursor, 'c2');
  assert.deepEqual(
    result.current.focusMe?.records.map((r) => r.id),
    ['r1', 'r2'],
  );
});

test('이번 주 진입 조각의 nextCursor부터 나머지 기록을 이어 붙인다', async () => {
  libMock.mockResolvedValue(lib({ focusStatistics: { ...FOCUS_ME, nextCursor: 'c2' } }));
  focusMock.mockResolvedValue({
    ...FOCUS_ME,
    records: [
      { id: 'r2', subject: '영어', activeSeconds: 60, completedAt: '2026-09-21T00:00:00Z' },
    ],
    nextCursor: null,
  });
  const { result } = await mount();

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(focusMock.mock.calls.length, 1);
  assert.equal(focusMock.mock.calls[0][1].cursor, 'c2');
  assert.deepEqual(
    result.current.focusMe?.records.map((r) => r.id),
    ['r1', 'r2'],
  );
});

test('월간 요약은 첫 페이지의 합계와 수열만 사용한다', async () => {
  libMock.mockResolvedValue(lib({ focusStatistics: null }));
  focusMock.mockResolvedValue({ ...FOCUS_ME, nextCursor: 'unused' });
  screenMock.mockResolvedValue(SCREEN_ME);
  const { result } = await mount({
    period: '월',
    combined: true,
    focusSummaryOnly: true,
  });

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(focusMock.mock.calls.length, 1);
  assert.equal(result.current.focusMe?.totalSeconds, 3600);
  assert.equal(result.current.focusMe?.nextCursor, 'unused');
});

test('API 오류는 error 상태로 두고 retry 가 진입 집계부터 다시 읽는다', async () => {
  libMock
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0))
    .mockResolvedValueOnce(lib());
  const { result } = await mount();

  await waitFor(() => assert.equal(result.current.status, 'error'));
  assert.equal(result.current.error?.code, 'CLIENT_NETWORK_ERROR');

  await act(async () => result.current.retry());
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(libMock.mock.calls.length, 2);
  assert.equal(result.current.focusMe?.totalSeconds, 3600);
});
