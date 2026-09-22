/**
 * useShop (GROMO-2017) — 상점·주문·인벤토리·꾸미기의 서버 계약 연결.
 * 멱등 키 재사용·중복 탭 dedupe·성공 뒤 정본 재조회·실패 시 성공 경로 차단을 직접 본다.
 */
import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import {
  getIslandInventory,
  getMyInventory,
  getShopOrders,
  getShopProduct,
  getShopProducts,
  getShopScreen,
  getShopWallets,
  patchIslandAppearance,
  patchMyAppearance,
  purchaseProduct,
} from '@/services/api/shop';
import { useShop } from '@/screens/island/useShop';

jest.mock('@/services/api/shop', () => ({
  getIslandInventory: jest.fn(),
  getMyInventory: jest.fn(),
  getShopOrders: jest.fn(),
  getShopProduct: jest.fn(),
  getShopProducts: jest.fn(),
  getShopScreen: jest.fn(),
  getShopWallets: jest.fn(),
  patchIslandAppearance: jest.fn(),
  patchMyAppearance: jest.fn(),
  purchaseProduct: jest.fn(),
}));

const ISLAND = '11111111-2222-4333-8444-555555555555';

const screenBody = (over: Record<string, unknown> = {}) => ({
  island: { id: ISLAND, name: '딸기소다', role: 'member' },
  sharedInventory: {
    audio: ['waves'],
    islandThemes: ['pine'],
    buildingThemes: [{ buildingId: 'hall', themeId: 'hall_theme' }],
    inventoryVersion: 1,
    appearance: { islandThemeId: 'pine', buildingThemes: { hall: 'default' }, version: 5 },
  },
  wallets: { fish: 0, villagePoints: 1500, fishVersion: null, villagePointsVersion: 7 },
  products: {
    items: [
      {
        id: 'scarf',
        title: '바다 스카프',
        kind: 'clothes',
        price: 20,
        currency: 'village_points',
        ownerType: 'user',
        owned: false,
        available: true,
        reason: null,
        productVersion: 3,
      },
    ],
    nextCursor: null,
  },
  ...over,
});

const myInventory = {
  clothes: ['scarf'],
  decor: [],
  hulls: ['raft'],
  inventoryVersion: 3,
  equipped: { clothes: 'scarf', decor: null, hull: 'raft', position: 'front', version: 2 },
};

const params = (over: Record<string, unknown> = {}) => ({
  active: true,
  islandId: ISLAND,
  route: 'shop',
  category: 'personal' as const,
  orderScope: 'personal' as const,
  productId: null,
  dispatch: jest.fn(),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (getShopScreen as jest.Mock).mockResolvedValue(screenBody());
  (getShopProducts as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
  (getShopOrders as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
  (getMyInventory as jest.Mock).mockResolvedValue(myInventory);
  (getShopWallets as jest.Mock).mockResolvedValue(screenBody().wallets);
  (getIslandInventory as jest.Mock).mockResolvedValue(screenBody().sharedInventory);
});

test('비활성이면 API 를 부르지 않는다', async () => {
  await renderHook((p: Parameters<typeof useShop>[0]) => useShop(p), {
    initialProps: params({ active: false }),
  });
  assert.equal((getShopScreen as jest.Mock).mock.calls.length, 0);
});

test('shop route — /screens/shop 을 읽고 지갑·공동 인벤토리·상품을 싣는다', async () => {
  const dispatch = jest.fn();
  const { result } = await renderHook((p: Parameters<typeof useShop>[0]) => useShop(p), {
    initialProps: params({ dispatch }),
  });

  await waitFor(() => assert.equal(result.current.loading, false));
  assert.equal((getShopScreen as jest.Mock).mock.calls.length, 1);
  assert.equal((getShopScreen as jest.Mock).mock.calls[0][0], 'personal');
  assert.equal(result.current.items[0].id, 'scarf');
  assert.equal(result.current.wallets?.villagePoints, 1500);
  assert.equal(result.current.shared?.appearance.version, 5);
  // SHOP_SYNC — 화면 밖 표시 상태(지갑·공동 보유·적용 테마)도 서버 정본으로 간다.
  const syncs = dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === 'SHOP_SYNC');
  assert.equal(syncs.length >= 1, true);
  assert.equal(syncs[0].islandId, ISLAND);
  assert.equal(syncs[0].wallets?.villagePoints, 1500);
});

test('탭 전환은 category=island 로 /screens/shop 을 다시 읽는다', async () => {
  const { rerender } = await renderHook((p) => useShop(p as any), {
    initialProps: params(),
  });
  await waitFor(() => assert.equal((getShopScreen as jest.Mock).mock.calls.length, 1));

  rerender(params({ category: 'island' }) as any);
  await waitFor(() => assert.equal((getShopScreen as jest.Mock).mock.calls.length, 2));
  assert.equal((getShopScreen as jest.Mock).mock.calls[1][0], 'island');
});

test('구매 — 멱등 키·지갑·상품 버전을 싣고 성공 뒤 정본을 다시 읽는다', async () => {
  (purchaseProduct as jest.Mock).mockResolvedValue({
    id: 'o1',
    productId: 'scarf',
    spent: 20,
    currency: 'village_points',
    ownerType: 'user',
    owned: true,
    walletVersion: 8,
  });
  const { result } = await renderHook((p: Parameters<typeof useShop>[0]) => useShop(p), {
    initialProps: params(),
  });
  await waitFor(() => assert.equal(result.current.loading, false));
  (getShopScreen as jest.Mock).mockClear();

  await act(async () => {
    await result.current.buy({ id: 'scarf', productVersion: 3 });
  });

  const [island, body, key] = (purchaseProduct as jest.Mock).mock.calls[0];
  assert.equal(island, ISLAND);
  // 서버가 준 버전을 그대로 싣는다 — 가격·owner·수량은 보내지 않는다.
  assert.deepEqual(body, {
    productId: 'scarf',
    expectedWalletVersion: 7,
    expectedProductVersion: 3,
  });
  assert.match(key, /^[0-9a-f-]{36}$/);
  // 성공 뒤 balance(지갑)·inventory·목록을 다시 읽는다.
  assert.equal((getShopScreen as jest.Mock).mock.calls.length, 1);
  assert.equal((getMyInventory as jest.Mock).mock.calls.length, 1);
});

test('구매 실패는 호출부에 던지고, 같은 의도의 재시도는 같은 멱등 키로 간다', async () => {
  (purchaseProduct as jest.Mock)
    .mockRejectedValueOnce(new ApiError('CLIENT_TIMEOUT', 'timeout', 0, { retryable: true }))
    .mockResolvedValueOnce({ id: 'o1', productId: 'scarf', walletVersion: 8 });
  const { result } = await renderHook((p: Parameters<typeof useShop>[0]) => useShop(p), {
    initialProps: params(),
  });
  await waitFor(() => assert.equal(result.current.loading, false));

  const first = await act(async () =>
    result.current.buy({ id: 'scarf', productVersion: 3 }).catch((e) => e),
  );
  assert.equal((first as ApiError).code, 'CLIENT_TIMEOUT');
  // 실패한 쓰기는 재조회(정본 다시 읽기)를 시도하지 않는다 — 성공 토스트 경로가 아니다.
  assert.equal(result.current.items[0].owned, false);

  await act(async () => {
    await result.current.buy({ id: 'scarf', productVersion: 3 });
  });
  const keys = (purchaseProduct as jest.Mock).mock.calls.map((c) => c[2]);
  assert.equal(keys[0], keys[1]); // 응답 유실 재시도 = 같은 Idempotency-Key
});

test('같은 상품의 중복 탭은 진행 중인 promise 를 공유해 요청 1건만 나간다', async () => {
  let release: (v: unknown) => void;
  (purchaseProduct as jest.Mock).mockImplementation(() => new Promise((r) => (release = r)));
  const { result } = await renderHook((p: Parameters<typeof useShop>[0]) => useShop(p), {
    initialProps: params(),
  });
  await waitFor(() => assert.equal(result.current.loading, false));

  let a: Promise<unknown>, b: Promise<unknown>;
  await act(async () => {
    a = result.current.buy({ id: 'scarf', productVersion: 3 });
    b = result.current.buy({ id: 'scarf', productVersion: 3 });
    assert.equal((purchaseProduct as jest.Mock).mock.calls.length, 1);
    release!({ id: 'o1', walletVersion: 8 });
    await a!;
    await b!;
  });
});

test('orders route — scope 필수로 내역을 읽고 모르는 상품 제목을 채운다', async () => {
  (getShopOrders as jest.Mock).mockResolvedValue({
    items: [
      {
        id: 'o1',
        productId: 'rain',
        price: 30,
        currency: 'village_points',
        createdAt: '2026-09-19T01:02:03Z',
      },
    ],
    nextCursor: null,
  });
  (getShopProduct as jest.Mock).mockResolvedValue({
    id: 'rain',
    kind: 'audio',
    title: '오두막의 빗소리',
    productVersion: 5,
  });
  const { result } = await renderHook((p: Parameters<typeof useShop>[0]) => useShop(p), {
    initialProps: params({ route: 'orders' }),
  });

  await waitFor(() => assert.equal(result.current.ordersLoading, false));
  assert.equal((getShopOrders as jest.Mock).mock.calls[0][1], 'personal');
  await waitFor(() => assert.equal(result.current.titles.rain, '오두막의 빗소리'));
  assert.equal(result.current.orders[0].productId, 'rain');
});

test('wardrobe route — 개인 인벤토리를 읽어 SHOP_SYNC 로 equipped·owned 를 맞춘다', async () => {
  const dispatch = jest.fn();
  await renderHook((p: Parameters<typeof useShop>[0]) => useShop(p), {
    initialProps: params({ route: 'wardrobe', dispatch }),
  });

  await waitFor(() => assert.equal((getMyInventory as jest.Mock).mock.calls.length, 1));
  const syncs = dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === 'SHOP_SYNC');
  const mine = syncs.find((a) => a.myInventory);
  assert.deepEqual(mine.myInventory.equipped.clothes, 'scarf');
});

test('개인 외양 PATCH — 명시 null 을 본문에 보존하고 성공 뒤 인벤토리를 다시 읽는다', async () => {
  (patchMyAppearance as jest.Mock).mockResolvedValue({
    clothes: 'jacket',
    decor: null,
    hull: 'raft',
    position: 'front',
    version: 3,
  });
  const { result } = await renderHook((p: Parameters<typeof useShop>[0]) => useShop(p), {
    initialProps: params({ route: 'wardrobe' }),
  });
  await waitFor(() => assert.equal((getMyInventory as jest.Mock).mock.calls.length, 1));
  (getMyInventory as jest.Mock).mockClear();

  await act(async () => {
    await result.current.equip({ clothes: 'jacket', decor: null });
  });
  const [body, key] = (patchMyAppearance as jest.Mock).mock.calls[0];
  assert.deepEqual(body, { clothes: 'jacket', decor: null });
  assert.match(key, /^[0-9a-f-]{36}$/);
  assert.equal((getMyInventory as jest.Mock).mock.calls.length, 1);
});

test('공동 외양 PATCH — inventory 의 appearance.version 을 expectedVersion 으로 싣는다', async () => {
  (patchIslandAppearance as jest.Mock).mockResolvedValue({
    islandThemeId: 'pine',
    buildingThemes: { hall: 'default' },
    version: 6,
  });
  const { result } = await renderHook((p: Parameters<typeof useShop>[0]) => useShop(p), {
    initialProps: params(),
  });
  await waitFor(() => assert.equal(result.current.shared?.appearance.version, 5));

  await act(async () => {
    await result.current.applyTheme({ islandThemeId: 'pine' });
  });
  const [island, body, key] = (patchIslandAppearance as jest.Mock).mock.calls[0];
  assert.equal(island, ISLAND);
  assert.deepEqual(body, { islandThemeId: 'pine', expectedVersion: 5 });
  assert.match(key, /^[0-9a-f-]{36}$/);
  // 성공 뒤 공동 인벤토리를 다시 읽는다.
  assert.equal((getIslandInventory as jest.Mock).mock.calls.length, 1);
});

test('sound route — category=sound 목록과 공동 인벤토리를 읽는다', async () => {
  (getShopProducts as jest.Mock).mockResolvedValue({
    items: [
      {
        id: 'rain',
        title: '오두막의 빗소리',
        kind: 'audio',
        price: 30,
        currency: 'village_points',
        ownerType: 'island',
        owned: false,
        available: true,
        reason: null,
        productVersion: 5,
      },
    ],
    nextCursor: null,
  });
  const { result } = await renderHook((p: Parameters<typeof useShop>[0]) => useShop(p), {
    initialProps: params({ route: 'sound' }),
  });

  await waitFor(() => assert.equal(result.current.loading, false));
  assert.equal((getShopProducts as jest.Mock).mock.calls[0][0], ISLAND);
  assert.equal((getShopProducts as jest.Mock).mock.calls[0][1], 'sound');
  assert.equal(result.current.items[0].id, 'rain');
  assert.equal(result.current.shared?.audio[0], 'waves');
});
