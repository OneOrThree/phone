import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getShopProducts, type ShopProductPage } from '@/services/api/shop';
import { useShopBuildingStatus, updateShopCatalogSnapshot } from './useShopBuildingStatus';

const mockStorage = new Map<string, string>();
const api = jest.mocked(getShopProducts);
type StatusProps = Parameters<typeof useShopBuildingStatus>[0];

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
  },
}));
jest.mock('@/services/api/shop', () => ({ getShopProducts: jest.fn() }));

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  kind: 'clothes',
  price: 10,
  currency: 'village_points',
  ownerType: 'user',
  owned: false,
  available: true,
  reason: null,
  productVersion: 1,
  ...over,
});

const page = (...items: ReturnType<typeof item>[]): ShopProductPage => ({
  items,
  nextCursor: null,
});

beforeEach(() => {
  mockStorage.clear();
  api.mockReset();
  api.mockImplementation(async (_islandId, category) =>
    category === 'personal' ? page(item('shirt')) : page(),
  );
});

it('첫 카탈로그를 기준으로 삼고 새 상품을 읽기 전까지 표시한다', async () => {
  const props = { active: true, acknowledge: false, islandId: 'island-1', userId: 'user-1' };
  const hook = await renderHook((value: StatusProps) => useShopBuildingStatus(value), {
    initialProps: props,
  });
  await waitFor(() => expect(hook.result.current).toBe('purchasable'));

  api.mockImplementation(async (_islandId, category) =>
    category === 'personal' ? page(item('shirt'), item('new-hat')) : page(),
  );
  await act(async () => {
    hook.rerender({ ...props, active: false });
  });
  await act(async () => {
    hook.rerender(props);
  });
  await waitFor(() => expect(hook.result.current).toBe('new-product'));

  await act(async () => {
    hook.rerender({ ...props, active: false, acknowledge: true });
  });
  await waitFor(() => expect(hook.result.current).toBe('normal'));
  await act(async () => {
    hook.rerender(props);
  });
  await waitFor(() => expect(hook.result.current).toBe('purchasable'));
  hook.unmount();
});

it('사용 불가이거나 이미 보유한 상품은 구매 상태로 표시하지 않는다', async () => {
  const previous = { knownIds: ['shirt', 'hat'], pendingIds: [] };
  const next = updateShopCatalogSnapshot(previous, [
    item('shirt', { owned: true }),
    item('hat', { available: false }),
  ] as any);
  expect(next.pendingIds).toEqual([]);
});

it('판매 중지되거나 이미 보유하게 된 신규 상품은 pending 상태에서 제거한다', () => {
  const previous = { knownIds: ['shirt', 'hat'], pendingIds: ['hat', 'scarf'] };
  const next = updateShopCatalogSnapshot(previous, [
    item('shirt'),
    item('hat', { available: false }),
    item('scarf', { owned: true }),
  ] as any);
  expect(next.pendingIds).toEqual([]);
});

it('새 상품 알림을 서버 카탈로그에서 관찰하고 scope별로 저장한다', async () => {
  const hook = await renderHook(() =>
    useShopBuildingStatus({
      active: true,
      acknowledge: false,
      islandId: 'island-1',
      userId: 'user-1',
    }),
  );
  await waitFor(() => expect(hook.result.current).toBe('purchasable'));
  expect(mockStorage.has('gromo:shop-catalog:user-1:island-1')).toBe(true);
  expect(api).toHaveBeenCalledWith('island-1', 'personal', undefined);
  expect(api).toHaveBeenCalledWith('island-1', 'island', undefined);
  hook.unmount();
});

it('홈 조회 전에 상점에 진입하면 현재 카탈로그를 읽음 기준에 포함한다', async () => {
  mockStorage.set(
    'gromo:shop-catalog:user-1:island-1',
    JSON.stringify({ knownIds: ['shirt'], pendingIds: [] }),
  );
  api.mockImplementation(async (_islandId, category) =>
    category === 'personal' ? page(item('shirt'), item('new-hat')) : page(),
  );

  const props = { active: false, acknowledge: true, islandId: 'island-1', userId: 'user-1' };
  const hook = await renderHook((value: StatusProps) => useShopBuildingStatus(value), {
    initialProps: props,
  });
  await waitFor(() => {
    const stored = JSON.parse(mockStorage.get('gromo:shop-catalog:user-1:island-1')!);
    expect(stored.knownIds).toContain('new-hat');
  });
  await act(async () => hook.rerender({ ...props, active: true, acknowledge: false }));
  await waitFor(() => expect(hook.result.current).toBe('purchasable'));
  const stored = JSON.parse(mockStorage.get('gromo:shop-catalog:user-1:island-1')!);
  expect(stored.pendingIds).toEqual([]);
  hook.unmount();
});
