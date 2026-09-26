import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getLibraryScreen, type LibraryScreen } from '@/services/api/records';
import { clearSession } from '@/services/api/session';
import { useBuildingIndicatorSeen } from './useBuildingIndicatorSeen';

jest.mock('@/services/api/records', () => ({ getLibraryScreen: jest.fn() }));
const load = getLibraryScreen as jest.Mock;
const screen: LibraryScreen = {
  island: { id: 'i1', name: '섬', role: 'member' },
  statisticsAvailability: 'available',
  focusStatistics: null,
  screenTimeStatistics: null,
  fishEarnings: null,
};

beforeEach(() => jest.clearAllMocks());

test('도서관 성공 진입에서만 관측값을 전달한다', async () => {
  load.mockResolvedValue(screen);
  const onLoaded = jest.fn();
  const hook = await renderHook(() =>
    useBuildingIndicatorSeen({ active: true, islandId: 'i1', onLoaded }),
  );
  await waitFor(() => assert.equal(onLoaded.mock.calls.length, 1));
  assert.equal(onLoaded.mock.calls[0][0], screen);
  await hook.unmount();
});

test.each([
  ['조회 실패', new Error('offline')],
  ['다른 섬', { ...screen, island: { ...screen.island, id: 'i2' } }],
  ['미완공', { ...screen, statisticsAvailability: 'facility_locked' }],
  ['누락 조각', { ...screen, missingFragments: ['focusStatistics'] }],
])('%s는 확인 처리하지 않는다', async (_label, response) => {
  if (response instanceof Error) load.mockRejectedValue(response);
  else load.mockResolvedValue(response);
  const onLoaded = jest.fn();
  const hook = await renderHook(() =>
    useBuildingIndicatorSeen({ active: true, islandId: 'i1', onLoaded }),
  );
  await act(async () => {});
  assert.equal(onLoaded.mock.calls.length, 0);
  await hook.unmount();
});

test('비활성 도서관은 조회하지 않는다', async () => {
  const hook = await renderHook(() =>
    useBuildingIndicatorSeen({ active: false, islandId: 'i1', onLoaded: jest.fn() }),
  );
  assert.equal(load.mock.calls.length, 0);
  await hook.unmount();
});

test.each(['unmount', 'session'])(
  '%s 이후 늦게 도착한 성공은 확인 처리하지 않는다',
  async (change) => {
    let resolve!: (value: LibraryScreen) => void;
    load.mockReturnValue(
      new Promise<LibraryScreen>((done) => {
        resolve = done;
      }),
    );
    const onLoaded = jest.fn();
    const hook = await renderHook(() =>
      useBuildingIndicatorSeen({ active: true, islandId: 'i1', onLoaded }),
    );
    if (change === 'unmount') await hook.unmount();
    else
      await act(async () => {
        await clearSession();
      });
    await act(async () => {
      resolve(screen);
    });
    assert.equal(onLoaded.mock.calls.length, 0);
    if (change !== 'unmount') await hook.unmount();
  },
);
