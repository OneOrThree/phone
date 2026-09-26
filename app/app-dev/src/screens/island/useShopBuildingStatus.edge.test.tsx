import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getShopProducts, type ShopProductPage } from '@/services/api/shop';
import {
  acknowledgeShopForScope,
  updateShopCatalogSnapshot,
  useShopBuildingStatus,
} from './useShopBuildingStatus';

const mockStorage = new Map<string, string>();
const api = jest.mocked(getShopProducts);
const storage = jest.mocked(AsyncStorage);
const appState = jest.spyOn(AppState, 'addEventListener');
let key = '';
let scope = 0;
let appStateHandler: ((state: AppStateStatus) => void) | null = null;

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

const item = (id: string, price: number | null = 10) => ({
  id,
  title: id,
  kind: 'clothes',
  price,
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
  scope += 1;
  key = `gromo:shop-catalog:user-${scope}:island-${scope}`;
  mockStorage.clear();
  appStateHandler = null;
  appState.mockClear().mockImplementation(((
    eventType: 'change',
    handler: (state: AppStateStatus) => void,
  ) => {
    if (eventType === 'change') appStateHandler = handler;
    return { remove: jest.fn() };
  }) as typeof AppState.addEventListener);
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

it('상점 훅이 재마운트되어도 같은 scope의 진행 중 읽음 처리를 공유한다', async () => {
  let resolvePersonal!: (value: ShopProductPage) => void;
  let resolveIsland!: (value: ShopProductPage) => void;
  api.mockImplementation(
    async (_islandId, category) =>
      new Promise((resolve) => {
        if (category === 'personal') resolvePersonal = resolve;
        else resolveIsland = resolve;
      }),
  );
  const first = acknowledgeShopForScope(key, `island-${scope}`);
  // 홈 화면의 새 훅 인스턴스가 같은 scope를 확인했을 때 작업을 재사용한다.
  const remounted = acknowledgeShopForScope(key, `island-${scope}`);
  expect(remounted).toBe(first);
  await waitFor(() => expect(api).toHaveBeenCalledWith(`island-${scope}`, 'personal', undefined));
  resolvePersonal(page(item('shirt'), item('new-hat')));
  await new Promise((resolve) => setTimeout(resolve, 0));
  resolveIsland(page(item('island-lantern')));
  const acknowledgedStatus = await remounted;
  expect(api).toHaveBeenCalledTimes(2);
  const stored = JSON.parse(mockStorage.get(key)!);
  expect(stored.knownIds).toContain('new-hat');
  expect(stored.pendingIds).toEqual([]);
  expect(acknowledgedStatus).toBe('purchasable');
});

it('읽음 완료 대기 후 최신 카탈로그로 구매 가능 상태를 다시 계산한다', async () => {
  let resolveAcknowledgementCatalog!: (value: ShopProductPage) => void;
  let apiCallCount = 0;
  mockStorage.set(key, JSON.stringify({ knownIds: ['old-item'], pendingIds: ['new-hat'] }));
  api.mockImplementation(async (_islandId, category) => {
    apiCallCount += 1;
    if (apiCallCount === 1 && category === 'personal') {
      return new Promise((resolve) => {
        resolveAcknowledgementCatalog = resolve;
      });
    }
    if (apiCallCount === 2) return page();
    // 읽음 처리 도중 마지막 구매 가능 상품이 구매된 상태를 나타내는 최신 홈 조회.
    return page();
  });

  const acknowledgement = acknowledgeShopForScope(key, `island-${scope}`);
  const hook = await renderHook(() =>
    useShopBuildingStatus({
      active: true,
      acknowledge: false,
      islandId: `island-${scope}`,
      userId: `user-${scope}`,
    }),
  );
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  resolveAcknowledgementCatalog(page(item('new-hat')));
  await acknowledgement;

  await waitFor(() => expect(api).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(hook.result.current).toBe('normal'));
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
        islandId: `island-${scope}`,
        userId: `user-${scope}`,
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
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
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
      islandId: `island-${scope}`,
      userId: `user-${scope}`,
    }),
  );
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(api.mock.calls.map(([, category]) => category)).toEqual(['personal', 'personal']);
  expect(api.mock.calls[1][2]).toBe('repeated');
  await waitFor(() => expect(hook.result.current).toBe('normal'));
  expect(api).not.toHaveBeenCalledWith(`island-${scope}`, 'island', undefined);
  expect(mockStorage.get(key)).toBe(previous);
  hook.unmount();
});

it('첫 상점 카탈로그 조회가 실패하면 빈 기준점을 저장하지 않는다', async () => {
  api.mockRejectedValueOnce(new Error('catalog unavailable'));
  const props = {
    active: false,
    acknowledge: true,
    islandId: `island-${scope}`,
    userId: `user-${scope}`,
  };
  const hook = await renderHook((value: typeof props) => useShopBuildingStatus(value), {
    initialProps: props,
  });
  await waitFor(() => expect(api).toHaveBeenCalledWith(`island-${scope}`, 'personal', undefined));
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

it('가격이 null인 상품은 새 상품 또는 구매 가능 상태로 표시하지 않는다', async () => {
  api.mockImplementation(async (_islandId, category) =>
    category === 'personal' ? page(item('unapproved', null)) : page(),
  );
  const hook = await renderHook(() =>
    useShopBuildingStatus({
      active: true,
      acknowledge: false,
      islandId: `island-${scope}`,
      userId: `user-${scope}`,
    }),
  );
  await waitFor(() => expect(api).toHaveBeenCalledWith(`island-${scope}`, 'island', undefined));
  expect(hook.result.current).toBe('normal');
  expect(
    updateShopCatalogSnapshot({ knownIds: [], pendingIds: [] }, [item('unapproved', null)])
      .pendingIds,
  ).toEqual([]);
  hook.unmount();
});

it('앱이 백그라운드에서 복귀하면 홈 상품 상태를 다시 조회한다', async () => {
  const hook = await renderHook(() =>
    useShopBuildingStatus({
      active: true,
      acknowledge: false,
      islandId: `island-${scope}`,
      userId: `user-${scope}`,
    }),
  );
  await waitFor(() => expect(hook.result.current).toBe('purchasable'));
  api.mockImplementation(async (_islandId, category) =>
    category === 'personal' ? page(item('shirt'), item('new-hat')) : page(),
  );
  await act(async () => {
    appStateHandler?.('background');
    appStateHandler?.('active');
  });
  await waitFor(() => expect(hook.result.current).toBe('new-product'));
  expect(api).toHaveBeenCalledTimes(4);
  hook.unmount();
});
