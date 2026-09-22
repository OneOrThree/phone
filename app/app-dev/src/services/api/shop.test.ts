import assert from 'node:assert/strict';
import { API_URL } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
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

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];

const ISLAND = '11111111-2222-4333-8444-555555555555';
const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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

const headers = (n = 0) => calls[n].init.headers as Record<string, string>;
const sentBody = (n = 0) => JSON.parse(calls[n].init.body as string);

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('GET /screens/shop — 기본 category 없이 호출하고 응답 조각을 그대로 돌려준다', async () => {
  const screen = {
    island: { id: ISLAND, name: '딸기소다', role: 'member' },
    sharedInventory: {
      audio: ['waves'],
      islandThemes: ['pine'],
      buildingThemes: [{ buildingId: 'hall', themeId: 'hall_theme' }],
      inventoryVersion: 1,
      appearance: { islandThemeId: 'pine', buildingThemes: { hall: 'default' }, version: 5 },
    },
    wallets: { fish: 0, villagePoints: 1500, fishVersion: null, villagePointsVersion: 7 },
    products: { items: [], nextCursor: null },
  };
  stub(200, { data: screen });

  const result = await getShopScreen();

  assert.equal(calls[0].url, `${API_URL}/screens/shop`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(headers().Authorization, 'Bearer AT');
  assert.deepEqual(result, screen);
});

test('GET /screens/shop?category=island — 탭 전환은 category 만 붙인다', async () => {
  stub(200, { data: { products: { items: [], nextCursor: null } } });
  await getShopScreen('island');
  assert.equal(calls[0].url, `${API_URL}/screens/shop?category=island`);
});

test('GET 상품 목록 — category 필수, 서버 커서를 그대로 되돌려 보낸다', async () => {
  stub(200, { data: { items: [], nextCursor: null } });
  await getShopProducts(ISLAND, 'sound', 'cursor.1');
  assert.equal(
    calls[0].url,
    `${API_URL}/islands/${ISLAND}/shop/products?category=sound&cursor=cursor.1`,
  );
});

test('GET 상품 상세·지갑 — productId 는 경로 인코딩한다', async () => {
  stub(200, { data: { id: 'a b' } });
  await getShopProduct(ISLAND, 'a b');
  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/shop/products/a%20b`);

  stub(200, { data: { villagePoints: 1500, villagePointsVersion: 7 } });
  await getShopWallets(ISLAND);
  assert.equal(calls[1].url, `${API_URL}/islands/${ISLAND}/shop/wallets`);
});

test('POST 주문 — 멱등 키 헤더 + {productId, expectedWalletVersion, expectedProductVersion} 만 보낸다', async () => {
  stub(200, { data: { id: 'o1', productId: 'rain', spent: 30, walletVersion: 8 } });

  await purchaseProduct(
    ISLAND,
    { productId: 'rain', expectedWalletVersion: 7, expectedProductVersion: 5 },
    KEY,
  );

  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/shop/orders`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(headers()['Idempotency-Key'], KEY);
  // 가격·통화·owner·수량을 싣지 않는다 — 서버 정본 필드만 보낸다.
  assert.deepEqual(sentBody(), {
    productId: 'rain',
    expectedWalletVersion: 7,
    expectedProductVersion: 5,
  });
});

test('GET 주문 내역 — scope 필수, cursor 는 통과한다', async () => {
  stub(200, { data: { items: [], nextCursor: null } });
  await getShopOrders(ISLAND, 'shared', 'c1');
  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/shop/orders?scope=shared&cursor=c1`);
});

test('GET 개인·공동 인벤토리 — 무접두 경로 그대로', async () => {
  stub(200, { data: { clothes: [], decor: [], hulls: ['raft'], inventoryVersion: 3 } });
  await getMyInventory();
  assert.equal(calls[0].url, `${API_URL}/me/inventory`);

  stub(200, { data: { audio: [], islandThemes: [], buildingThemes: [], inventoryVersion: 1 } });
  await getIslandInventory(ISLAND);
  assert.equal(calls[1].url, `${API_URL}/islands/${ISLAND}/inventory`);
});

test('PATCH /me/appearance — 명시 null(해제)을 본문에 보존하고 멱등 키를 싣는다', async () => {
  stub(200, {
    data: { clothes: 'jacket', decor: null, hull: 'raft', position: 'front', version: 2 },
  });

  await patchMyAppearance({ clothes: 'jacket', decor: null }, KEY);

  assert.equal(calls[0].url, `${API_URL}/me/appearance`);
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(headers()['Idempotency-Key'], KEY);
  // decor:null 은 해제 — key 가 본문에 남아야 한다(지우면 다른 명령이다).
  assert.deepEqual(sentBody(), { clothes: 'jacket', decor: null });
});

test('PATCH /islands/{id}/appearance — expectedVersion·default 해제·멱등 키를 보낸다', async () => {
  stub(200, { data: { islandThemeId: 'pine', buildingThemes: { hall: 'default' }, version: 6 } });

  await patchIslandAppearance(
    ISLAND,
    { islandThemeId: 'pine', buildingThemes: { hall: 'default' }, expectedVersion: 5 },
    KEY,
  );

  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/appearance`);
  assert.equal(headers()['Idempotency-Key'], KEY);
  assert.deepEqual(sentBody(), {
    islandThemeId: 'pine',
    buildingThemes: { hall: 'default' },
    expectedVersion: 5,
  });
});
