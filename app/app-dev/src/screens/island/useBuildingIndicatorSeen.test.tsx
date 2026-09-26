import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react-native';
import type { LibraryScreen } from '@/services/api/records';
import { useBuildingIndicatorSeen } from './useBuildingIndicatorSeen';

const screen: LibraryScreen = {
  island: { id: 'i1', name: '섬', role: 'member' },
  statisticsAvailability: 'available',
  focusStatistics: null,
  screenTimeStatistics: null,
  fishEarnings: null,
};

test('실제로 표시된 성공 도서관 화면만 확인 처리한다', async () => {
  const onLoaded = jest.fn();
  const hook = await renderHook(
    ({
      active,
      islandId,
      value,
    }: {
      active: boolean;
      islandId: string | null;
      value: LibraryScreen | null;
    }) => useBuildingIndicatorSeen({ active, islandId, screen: value, onLoaded }),
    { initialProps: { active: true, islandId: 'i1', value: screen } },
  );
  assert.equal(onLoaded.mock.calls.length, 1);
  assert.equal(onLoaded.mock.calls[0][0], screen);
  await hook.unmount();
});

test.each([
  ['화면 로딩 중', false, 'i1', screen],
  ['화면 조회 실패', false, 'i1', screen],
  ['아직 화면 데이터 없음', true, 'i1', null],
  ['다른 섬', true, 'i2', screen],
  ['미완공', true, 'i1', { ...screen, statisticsAvailability: 'facility_locked' }],
  ['누락 조각', true, 'i1', { ...screen, missingFragments: ['focusStatistics'] }],
])('%s는 확인 처리하지 않는다', async (_label, active, islandId, value) => {
  const onLoaded = jest.fn();
  const hook = await renderHook(() =>
    useBuildingIndicatorSeen({ active, islandId, screen: value as LibraryScreen | null, onLoaded }),
  );
  assert.equal(onLoaded.mock.calls.length, 0);
  await hook.unmount();
});

test('화면 데이터가 바뀐 뒤 실제 표시값으로 확인 상태를 갱신한다', async () => {
  const onLoaded = jest.fn();
  const updated = { ...screen, fishEarnings: { members: [] } } as LibraryScreen;
  const hook = await renderHook(
    ({ value }: { value: LibraryScreen | null }) =>
      useBuildingIndicatorSeen({ active: true, islandId: 'i1', screen: value, onLoaded }),
    { initialProps: { value: null as LibraryScreen | null } },
  );
  await act(async () => {
    await hook.rerender({ value: screen });
  });
  await act(async () => {
    await hook.rerender({ value: updated });
  });
  assert.equal(onLoaded.mock.calls.length, 2);
  assert.equal(onLoaded.mock.calls[0][0], screen);
  assert.equal(onLoaded.mock.calls[1][0], updated);
  await hook.unmount();
});
