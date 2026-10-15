/**
 * 섬 상점·꾸미기 공개 API (GROMO-2017, island-shop / island-appearance LLD — business-api
 * `ShopController`·`ScreenController`·`AppearanceController`). 무접두 경로이고 성공 봉투·오류
 * 형태는 공통 client 가 벗긴다 — 이 모듈은 정확한 path/body/키만 보증한다.
 *
 * - 가격·통화·소유 주체·판매 가능 여부는 응답 필드가 정본이다 — 클라이언트가 계산하거나
 *   보정하지 않는다. `price` 가 null 이면 「무료」가 아니라 미승인(구매 불가)이다.
 * - 지갑은 섬 공동 지갑뿐이다 — 개인 상품(ownerType=user)도 village_points 를 쓰며
 *   `expectedWalletVersion` 은 항상 `villagePointsVersion` 이다. 개인 지갑은 없다.
 * - 구매 본문은 정확히 `{productId, expectedWalletVersion, expectedProductVersion}` 세 키다 —
 *   가격·owner·수량을내면 안 된다.
 * - 목록 커서(`nextCursor`)는 서버가 발급한 서명 커서다 — 그대로 되돌려 보내고 재조합하지
 *   않는다. `GET /screens/shop` 의 첫 페이지 커서도 도메인 GET 이 그대로 이어받는다.
 * - 쓰기(구매·개인/공동 외양 PATCH)는 호출자가 만든 UUID36 `Idempotency-Key` 를 받는다.
 *   같은 의도의 재시도는 같은 key·같은 본문으로 보낸다(서버가 원 결과를 재생한다).
 * - 개인 PATCH 는 제출한 필드만 간다 — 생략은 유지, 명시 null 은 해제. expectedVersion 은
 *   없다. 공동 PATCH 는 정수 expectedVersion 이 필수이고, 해제는 문자열 "default" 다
 *   (null 은 422 — 개인 PATCH 와 규약이 다르다).
 */
import { request } from './client';

/** 섬 공동 지갑 — 개인 지갑 축이 없어 fishVersion 은 null 로 온다(서버가 지어내지 않는다). */
export type ShopWallets = {
  fish: number;
  villagePoints: number;
  fishVersion: number | null;
  villagePointsVersion: number;
};

/** 상품 목록 항목 — price·reason 은 null 허용(미승인 가격·사유 없음). */
export type ShopItem = {
  id: string;
  title: string;
  kind: string;
  price: number | null;
  currency: string;
  ownerType: string;
  owned: boolean;
  available: boolean;
  reason: string | null;
  productVersion: number;
};

export type ShopProductPage = { items: ShopItem[]; nextCursor: string | null };

/** 상품 상세 — requiredBuilding 은 구매 조건, targetBuilding 은 테마 대상 건물이다(다른 개념). */
export type ShopProduct = {
  id: string;
  kind: string;
  title: string;
  price: number | null;
  currency: string;
  ownerType: string;
  productVersion: number;
  previewUrl: string | null;
  owned: boolean;
  available: boolean;
  blockedReason: string | null;
  requiredBuilding: string | null;
  requiredProduct: { id: string; title: string } | null;
  targetBuilding: string | null;
};

/** 구매 결과 — spent 는 서버가 판정한 실제 차감액, walletVersion 은 차감 뒤 지갑 버전. */
export type ShopOrder = {
  id: string;
  productId: string;
  spent: number;
  currency: string;
  ownerType: string;
  owned: boolean;
  walletVersion: number;
};

/** 주문 내역 항목 — price 는 당시 확정가 스냅숏이다(현재 카탈로그 가격과 조인하지 않는다). */
export type ShopOrderItem = {
  id: string;
  productId: string;
  price: number;
  currency: string;
  createdAt: string;
};

export type ShopOrderPage = { items: ShopOrderItem[]; nextCursor: string | null };

/** 공동 외양 전체 맵 — 적용 안 한 건물·섬은 "default" 로 온다. */
export type IslandAppearance = {
  islandThemeId: string;
  buildingThemes: Record<string, string>;
  version: number;
};

export type SharedInventory = {
  audio: string[];
  islandThemes: string[];
  buildingThemes: { buildingId: string; themeId: string }[];
  inventoryVersion: number;
  appearance: IslandAppearance;
};

/** 개인 외양 — clothes·decor 은 미착용이 null 이다. */
export type PersonalAppearance = {
  clothes: string | null;
  decor: string | null;
  hull: string;
  position: string;
  version: number;
};

export type PersonalInventory = {
  clothes: string[];
  decor: string[];
  hulls: string[];
  inventoryVersion: number;
  equipped: PersonalAppearance;
};

/** /screens/shop 의 island 조각 — 화면은 id·name·role 만 읽는다. */
export type ShopIsland = { id: string; name: string; role: string };

export type ShopScreen = {
  island: ShopIsland;
  sharedInventory: SharedInventory;
  wallets: ShopWallets;
  products: ShopProductPage;
};

const enc = encodeURIComponent;

/** 상점 화면 조합 — category 는 personal|island 만 받는다(sound 는 화면 계약에서 422). */
export function getShopScreen(category: 'personal' | 'island' = 'personal'): Promise<ShopScreen> {
  const query = category === 'personal' ? '' : `?category=${category}`;
  return request<ShopScreen>(`/screens/shop${query}`);
}

export function getShopProducts(
  islandId: string,
  category: 'personal' | 'island' | 'sound',
  cursor?: string,
): Promise<ShopProductPage> {
  const query = new URLSearchParams({ category });
  if (cursor !== undefined) query.set('cursor', cursor);
  return request<ShopProductPage>(`/islands/${enc(islandId)}/shop/products?${query.toString()}`);
}

export function getShopProduct(islandId: string, productId: string): Promise<ShopProduct> {
  return request<ShopProduct>(`/islands/${enc(islandId)}/shop/products/${enc(productId)}`);
}

export function getShopWallets(islandId: string): Promise<ShopWallets> {
  return request<ShopWallets>(`/islands/${enc(islandId)}/shop/wallets`);
}

/**
 * 구매 — 본문은 {productId, expectedWalletVersion, expectedProductVersion} 세 키뿐이고
 * 가격·owner·수량은 서버가 정본으로 판정한다. 같은 의도의 재시도는 같은 key 로 보낸다.
 */
export function purchaseProduct(
  islandId: string,
  body: {
    productId: string;
    expectedWalletVersion: number;
    expectedProductVersion: number;
  },
  key: string,
): Promise<ShopOrder> {
  return request<ShopOrder>(`/islands/${enc(islandId)}/shop/orders`, {
    method: 'POST',
    body,
    idempotencyKey: key,
  });
}

export function getShopOrders(
  islandId: string,
  scope: 'personal' | 'shared',
  cursor?: string,
): Promise<ShopOrderPage> {
  const query = new URLSearchParams({ scope });
  if (cursor !== undefined) query.set('cursor', cursor);
  return request<ShopOrderPage>(`/islands/${enc(islandId)}/shop/orders?${query.toString()}`);
}

export function getMyInventory(): Promise<PersonalInventory> {
  return request<PersonalInventory>('/me/inventory');
}

export function getIslandInventory(islandId: string): Promise<SharedInventory> {
  return request<SharedInventory>(`/islands/${enc(islandId)}/inventory`);
}

/**
 * 개인 외양 — 제출한 필드만 보낸다. 명시 null 은 「해제」라 값을 지우지 않고 그대로 직렬화해야
 * 한다(undefined 키는 JSON 에서 사라져 다른 명령이 된다). expectedVersion 은 없다.
 */
export type MyAppearancePatch = {
  clothes?: string | null;
  decor?: string | null;
  hull?: string | null;
  position?: string | null;
};

export function patchMyAppearance(
  body: MyAppearancePatch,
  key: string,
): Promise<PersonalAppearance> {
  return request<PersonalAppearance>('/me/appearance', {
    method: 'PATCH',
    body,
    idempotencyKey: key,
  });
}

/**
 * 공동 외양 — islandThemeId·buildingThemes 중 하나 이상 + 정수 expectedVersion 필수.
 * 해제는 문자열 "default" 로 보낸다(null 은 422 다 — 개인 PATCH 와 다름).
 */
export type IslandAppearancePatch = {
  islandThemeId?: string;
  buildingThemes?: Record<string, string>;
  expectedVersion: number;
};

export function patchIslandAppearance(
  islandId: string,
  body: IslandAppearancePatch,
  key: string,
): Promise<IslandAppearance> {
  return request<IslandAppearance>(`/islands/${enc(islandId)}/appearance`, {
    method: 'PATCH',
    body,
    idempotencyKey: key,
  });
}
