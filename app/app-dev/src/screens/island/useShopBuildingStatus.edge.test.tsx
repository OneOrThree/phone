import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getShopProducts, type ShopProductPage } from '@/services/api/shop';
import { useShopBuildingStatus } from './useShopBuildingStatus';

const mockStorage = new Map<string, string>();
const api = jest.mocked(getShopProducts);
const storage = jest.mocked(AsyncStorage);
const key = 'gromo:shop-catalog:user-1:island-1';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (storageKey: string) => mockStorage.get(storageKey) ?? null),
    setItem: jest.fn(async (storageKey: string, value: string) => {
      mockStorage.set(storageKey, value);
    }),
  },
}));
jest.mock('@/services/api/shop', () => ({ getShopProducts: jest.fn() }));

const item = (id: string) => ({
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
});
const page = (...items: ReturnType<typeof item>[]): ShopProductPage => ({
  items,
  nextCursor: null,
});

beforeEach(() => {
  mockStorage.clear();
  api
    .mockReset()
    .mockImplementation(async (_islandId, category) =>
      category === 'personal' ? page(item('shirt')) : page(),
    );
  storage.getItem
    .mockReset()
    .mockImplementation(async (storageKey: string) => mockStorage.get(storageKey) ?? null);
  storage.setItem.mockReset().mockImplementation(async (storageKey: string, value: string) => {
    mockStorage.set(storageKey, value);
  });
});

it('상점을 빠르게 닫아도 시작된 읽음 처리는 카탈로그 조회 후 저장한다', async () => {
  let resolvePersonal!: (value: ShopProductPage) => void;
  let resolveIsland!: (value: ShopProductPage) => void;
  api.mockImplementation(
    async (_islandId, category) =>
      new Promise((resolve) => {
        if (category === 'personal') resolvePersonal = resolve;
        else resolveIsland = resolve;
      }),
  );
  const props = { active: false, acknowledge: true, islandId: 'island-1', userId: 'user-1' };
  const hook = await renderHook((value: typeof props) => useShopBuildingStatus(value), {
    initialProps: props,
  });
  await waitFor(() => expect(api).toHaveBeenCalledWith('island-1', 'personal', undefined));

  await act(async () => {
    hook.rerender({ ...props, active: true, acknowledge: false });
    resolvePersonal(page(item('shirt'), item('new-hat')));
  });
  await waitFor(() => expect(api).toHaveBeenCalledWith('island-1', 'island', undefined));
  await act(async () => {
    resolveIsland(page(item('island-lantern')));
    api.mockImplementation(async (_islandId, category) =>
      category === 'personal' ? page(item('shirt'), item('new-hat')) : page(item('island-lantern')),
    );
  });

  await waitFor(() => {
    const stored = JSON.parse(mockStorage.get(key)!);
    expect(stored.knownIds).toContain('new-hat');
    expect(stored.pendingIds).toEqual([]);
  });
  await waitFor(() => expect(hook.result.current).toBe('purchasable'));
  hook.unmount();
});

it.each(['getItem', 'setItem'] as const)(
  '%s 오류가 읽음 작업의 거부로 전파되지 않는다',
  async (operation) => {
    if (operation === 'getItem')
      storage.getItem.mockRejectedValueOnce(new Error('storage unavailable'));
    else storage.setItem.mockRejectedValueOnce(new Error('storage full'));

    const hook = await renderHook(() =>
      useShopBuildingStatus({
        active: false,
        acknowledge: true,
        islandId: 'island-1',
        userId: 'user-1',
      }),
    );
    await waitFor(() =>
      expect(operation === 'getItem' ? storage.getItem : storage.setItem).toHaveBeenCalled(),
    );
    if (operation === 'setItem') {
      const failedWrite = storage.setItem.mock.results.at(-1)?.value as Promise<void>;
      await expect(failedWrite).rejects.toThrow('storage full');
    }
    await waitFor(() => expect(hook.result.current).toBe('normal'));
    hook.unmount();
  },
);

it('반복 커서면 불완전한 카탈로그를 저장하지 않고 다음 카테고리도 건너뛴다', async () => {
  const previous = JSON.stringify({ knownIds: ['old-island-item'], pendingIds: ['new-hat'] });
  mockStorage.set(key, previous);
  api.mockImplementation(async (_islandId, category) =>
    category === 'personal'
      ? { items: [item('new-hat')], nextCursor: 'repeated' }
      : page(item('island-item')),
  );

  const hook = await renderHook(() =>
    useShopBuildingStatus({
      active: true,
      acknowledge: false,
      islandId: 'island-1',
      userId: 'user-1',
    }),
  );
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(api.mock.calls.map(([, category]) => category)).toEqual(['personal', 'personal']);
  expect(api.mock.calls[1][2]).toBe('repeated');
  await waitFor(() => expect(hook.result.current).toBe('normal'));
  expect(api).not.toHaveBeenCalledWith('island-1', 'island', undefined);
  expect(mockStorage.get(key)).toBe(previous);
  hook.unmount();
});

it('첫 상점 카탈로그 조회가 실패하면 빈 기준점을 저장하지 않는다', async () => {
  api.mockRejectedValueOnce(new Error('catalog unavailable'));
  const props = { active: false, acknowledge: true, islandId: 'island-1', userId: 'user-1' };
  const hook = await renderHook((value: typeof props) => useShopBuildingStatus(value), {
    initialProps: props,
  });
  await waitFor(() => expect(api).toHaveBeenCalledWith('island-1', 'personal', undefined));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(mockStorage.has(key)).toBe(false);
  expect(storage.setItem).not.toHaveBeenCalled();

  api.mockImplementation(async (_islandId, category) =>
    category === 'personal' ? page(item('shirt')) : page(),
  );
  await act(async () => hook.rerender({ ...props, active: true, acknowledge: false }));
  await waitFor(() => expect(hook.result.current).toBe('purchasable'));
  const stored = JSON.parse(mockStorage.get(key)!);
  expect(stored.pendingIds).toEqual([]);
  hook.unmount();
});
