/**
 * 섬 상점·꾸미기 화면 훅 (GROMO-2017) — /screens/shop·상품·주문·인벤토리·외양 PATCH 를 싣는다.
 * UI 는 이 파일 밖이다.
 *
 * - `active=false` 또는 islandId 미확정이면 API 를 하나도 부르지 않는다.
 * - 어떤 데이터를 읽을지는 `route`(상점·상세·내역·옷장·축음기)가 정하고, 탭(category/scope)·
 *   섬·계정이 바뀌면 epoch fence 로 옛 데이터를 지우고 처음부터 다시 읽는다. 언마운트·
 *   계정 전환 뒤 도착한 늦은 응답은 버린다(client 의 CLIENT_STALE_SESSION 과 같은 fence).
 * - 서버가 내린 가격·owned·available·reason 이 정본이다 — 앱은 목록을 필터링하지만
 *   판매 가능·권한을 스스로 판정하지 않는다.
 * - 서버 응답 조각(지갑·공동 인벤토리·개인 인벤토리)은 도착 때마다 `SHOP_SYNC` 로 로컬
 *   state 에도 옮긴다 — 홈 뗏목 고양이·섬 테마처럼 이 화면 밖에서 읽는 표시 상태를
 *   서버 정본과 맞추기 위해서다.
 * - 쓰기(구매·개인/공동 외양)는 의도 슬롯마다 `Idempotency-Key` 하나를 쓴다. 같은 본문의
 *   재시도(응답 유실·중복 탭)는 같은 key·같은 본문으로 가고, 본문이 바뀌면 새 의도로 본다.
 *   성공은 「쓰기 + 정본 재조회」가 끝난 뒤에만 resolve 한다 — 실패한 쓰기는 호출부에
 *   throw 되므로 성공 토스트·적용 표시가 붙지 않는다.
 * - VERSION_CONFLICT·403 은 정본이 바뀌었다는 뜻이라 조용히 다시 읽어 새 버전을 맞춘다 —
 *   다음 탭이 새 본문(=새 멱등 키)으로 간다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, CLIENT_STALE_SESSION, uuid } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
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
  type IslandAppearance,
  type IslandAppearancePatch,
  type MyAppearancePatch,
  type PersonalAppearance,
  type PersonalInventory,
  type SharedInventory,
  type ShopItem,
  type ShopOrder,
  type ShopOrderItem,
  type ShopProduct,
  type ShopWallets,
} from '@/services/api/shop';

/** 화면이 비활성·섬 미확정이라 쓰기를 시작할 수 없다 — 호출부 분기용 클라이언트 코드. */
export const CLIENT_INACTIVE = 'CLIENT_INACTIVE';

export type ShopCategory = 'personal' | 'island' | 'sound';
export type OrderScope = 'personal' | 'shared';

export type ShopState = {
  islandId: string | null;
  wallets: ShopWallets | null;
  shared: SharedInventory | null;
  my: PersonalInventory | null;
  /** 현재 탭의 목록 — 서버가 돌려준 순서·필드 그대로다. */
  items: ShopItem[];
  itemsCategory: ShopCategory | null;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  detail: ShopProduct | null;
  detailLoading: boolean;
  detailError: ApiError | null;
  orders: ShopOrderItem[];
  ordersScope: OrderScope | null;
  ordersNextCursor: string | null;
  ordersLoading: boolean;
  ordersError: ApiError | null;
  /** 쓰기(구매·적용·착용)가 진행 중인가 — 중복 탭 방지 버튼 비활성용. */
  writing: boolean;
  /** 목록·상세·인벤토리에서 모은 productId → 표시 이름/서버 kind. 서버에 없으면 id 를 쓴다. */
  titles: Record<string, string>;
  kinds: Record<string, string>;
};

const EMPTY: ShopState = {
  islandId: null,
  wallets: null,
  shared: null,
  my: null,
  items: [],
  itemsCategory: null,
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  orders: [],
  ordersScope: null,
  ordersNextCursor: null,
  ordersLoading: false,
  ordersError: null,
  writing: false,
  titles: {},
  kinds: {},
};

type IntentSlot = { key: string; payload: string; flight: Promise<unknown> | null };

export function useShop({
  active,
  islandId,
  route,
  category,
  orderScope,
  productId,
  dispatch,
}: {
  active: boolean;
  /** 서버 섬 UUID — snap.currentIslandId. 없으면 어떤 호출도 하지 않는다. */
  islandId: string | null;
  route: string;
  /** 상점 탭 → personal|island. sound 라우트(축음기)는 고정 sound 다. */
  category: 'personal' | 'island';
  orderScope: OrderScope;
  productId: string | null;
  dispatch: (action: { type: string; [key: string]: unknown }) => void;
}) {
  const [state, setState] = useState<ShopState>(EMPTY);
  const stateRef = useRef(state);
  const set = useCallback((patch: Partial<ShopState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  const mounted = useRef(false);
  const epoch = useRef(0);
  const intents = useRef(new Map<string, IntentSlot>());
  const detailSeq = useRef(0);
  // 이미 제목을 받은 상품 — 내역·옷장이 아는 id 는 다시 상세를 부르지 않는다.
  const titled = useRef(new Set<string>());
  // 캐시된 섬 데이터의 출처 — 계정·범위 교체 뒤 도착한 옛 응답이 새 화면에 입혀지지 않게 한다.
  const proven = useRef({ epoch: -1, generation: -1 });

  const cached = useCallback(
    () =>
      proven.current.epoch === epoch.current && proven.current.generation === sessionGeneration(),
    [],
  );
  const stale = () =>
    new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);
  const alive = useCallback(
    (e: number, generation: number) =>
      mounted.current && e === epoch.current && generation === sessionGeneration(),
    [],
  );

  /** 서버 조각을 로컬 표시 상태에도 옮긴다 — 홈·테마처럼 이 화면 밖에서 읽는 값용. */
  const sync = useCallback(
    (patch: {
      wallets?: ShopWallets;
      sharedInventory?: SharedInventory;
      myInventory?: PersonalInventory;
    }) => {
      if (islandId) dispatch({ type: 'SHOP_SYNC', islandId, ...patch });
    },
    [dispatch, islandId],
  );

  /** 응답 조각을 state 에 싣고 로컬 동기화까지 한 곳에서 한다. */
  const applyScreen = useCallback(
    (
      e: number,
      generation: number,
      screen: {
        sharedInventory: SharedInventory;
        wallets: ShopWallets;
        products: { items: ShopItem[]; nextCursor: string | null };
      },
      cat: ShopCategory,
    ) => {
      if (!alive(e, generation)) return;
      proven.current = { epoch: e, generation };
      const titles = { ...stateRef.current.titles },
        kinds = { ...stateRef.current.kinds };
      for (const item of screen.products.items) {
        titles[item.id] = item.title;
        kinds[item.id] = item.kind;
        titled.current.add(item.id);
      }
      set({
        wallets: screen.wallets,
        shared: screen.sharedInventory,
        items: screen.products.items,
        itemsCategory: cat,
        nextCursor: screen.products.nextCursor,
        titles,
        kinds,
        loading: false,
        error: null,
      });
      sync({ wallets: screen.wallets, sharedInventory: screen.sharedInventory });
    },
    [alive, set, sync],
  );

  const applyShared = useCallback(
    (e: number, generation: number, shared: SharedInventory) => {
      if (!alive(e, generation)) return;
      proven.current = { epoch: e, generation };
      set({ shared });
      sync({ sharedInventory: shared });
    },
    [alive, set, sync],
  );

  const applyMy = useCallback(
    (e: number, generation: number, my: PersonalInventory) => {
      if (!alive(e, generation)) return;
      proven.current = { epoch: e, generation };
      set({ my });
      sync({ myInventory: my });
    },
    [alive, set, sync],
  );

  /** 모르는 productId 의 제목·kind 를 상세 GET 으로 채운다 — 내역·옷장의 표시 이름용. */
  const ensureTitles = useCallback(
    async (e: number, generation: number, ids: string[]) => {
      const island = stateRef.current.islandId;
      if (!island) return;
      const missing = ids.filter((id) => !titled.current.has(id));
      for (const id of missing) titled.current.add(id); // 실패해도 같은 epoch 에서 반복 호출하지 않는다
      await Promise.all(
        missing.map(async (id) => {
          try {
            const product = await getShopProduct(island, id);
            if (!alive(e, generation)) return;
            set({
              titles: { ...stateRef.current.titles, [id]: product.title },
              kinds: { ...stateRef.current.kinds, [id]: product.kind },
            });
          } catch {
            // 제목을 못 얻어도 목록 자체는 id 로 보여 준다 — 표시 보조 데이터라 삼킨다.
          }
        }),
      );
    },
    [alive, set],
  );

  /** 상점 탭 로드 — /screens/shop 한 번에 공동 인벤토리·지갑·첫 상품 페이지가 온다. */
  const loadList = useCallback(
    async (e: number, generation: number, cat: ShopCategory) => {
      if (cat === 'sound') {
        if (!islandId) return;
        set({ loading: true, error: null, items: [], itemsCategory: cat });
        try {
          const [page, shared] = await Promise.all([
            getShopProducts(islandId, 'sound'),
            getIslandInventory(islandId),
          ]);
          if (!alive(e, generation)) return;
          proven.current = { epoch: e, generation };
          const titles = { ...stateRef.current.titles },
            kinds = { ...stateRef.current.kinds };
          for (const item of page.items) {
            titles[item.id] = item.title;
            kinds[item.id] = item.kind;
            titled.current.add(item.id);
          }
          set({
            shared,
            items: page.items,
            itemsCategory: cat,
            nextCursor: page.nextCursor,
            titles,
            kinds,
            loading: false,
            error: null,
          });
          sync({ sharedInventory: shared });
        } catch (error) {
          if (!alive(e, generation)) return;
          set({ loading: false, error: error as ApiError });
        }
        return;
      }
      set({ loading: true, error: null, items: [], itemsCategory: cat });
      try {
        const screen = await getShopScreen(cat);
        if (!alive(e, generation)) return;
        // 화면이 준 섬과 다른 섬 id 로 기대하고 있었다면 이 데이터는 새 정본이다 — islandId 도 갱신.
        set({ islandId: screen.island.id });
        applyScreen(e, generation, screen, cat);
      } catch (error) {
        if (!alive(e, generation)) return;
        set({ loading: false, error: error as ApiError });
      }
    },
    [alive, applyScreen, islandId, set, sync],
  );

  const loadMore = useCallback(async () => {
    const { islandId: id, itemsCategory, nextCursor, loading, loadingMore } = stateRef.current;
    if (
      !mounted.current ||
      !active ||
      !id ||
      !itemsCategory ||
      nextCursor === null ||
      loading ||
      loadingMore ||
      !cached()
    )
      return;
    const e = epoch.current;
    const generation = sessionGeneration();
    set({ loadingMore: true });
    try {
      const page = await getShopProducts(id, itemsCategory, nextCursor);
      if (!alive(e, generation)) return;
      const seen = new Set(stateRef.current.items.map((i) => i.id));
      const titles = { ...stateRef.current.titles },
        kinds = { ...stateRef.current.kinds };
      for (const item of page.items) {
        titles[item.id] = item.title;
        kinds[item.id] = item.kind;
        titled.current.add(item.id);
      }
      set({
        items: [...stateRef.current.items, ...page.items.filter((i) => !seen.has(i.id))],
        nextCursor: page.nextCursor,
        titles,
        kinds,
        loadingMore: false,
      });
    } catch (error) {
      if (!alive(e, generation)) return;
      set({ loadingMore: false, error: error as ApiError });
    }
  }, [active, alive, cached, set]);

  const select = useCallback(
    async (id: string | null) => {
      const seq = ++detailSeq.current;
      if (id === null) {
        set({ detail: null, detailLoading: false, detailError: null });
        return;
      }
      const { islandId: island, wallets } = stateRef.current;
      if (!mounted.current || !active || !island || !cached()) return;
      const e = epoch.current;
      const generation = sessionGeneration();
      // 다른 상품을 여는 순간 옛 상세는 죽는다 — 옛 상품이 잠깐 보이지 않게 자리를 비운다.
      set({ detail: null, detailLoading: true, detailError: null });
      try {
        const [detail, walletsNext] = await Promise.all([
          getShopProduct(island, id),
          // 지갑이 아직 없으면(축음기에서 바로 들어온 길) 함께 읽는다 — expectedWalletVersion 의 정본.
          wallets ? Promise.resolve(null) : getShopWallets(island),
        ]);
        if (!alive(e, generation) || seq !== detailSeq.current) return;
        const titles = { ...stateRef.current.titles, [id]: detail.title },
          kinds = { ...stateRef.current.kinds, [id]: detail.kind };
        titled.current.add(id);
        set({
          detail,
          detailLoading: false,
          titles,
          kinds,
          ...(walletsNext ? { wallets: walletsNext } : {}),
        });
        if (walletsNext) sync({ wallets: walletsNext });
      } catch (error) {
        if (!alive(e, generation) || seq !== detailSeq.current) return;
        set({ detailLoading: false, detailError: error as ApiError });
      }
    },
    [active, alive, cached, set, sync],
  );

  const loadOrders = useCallback(
    async (e: number, generation: number, scope: OrderScope) => {
      const { islandId: island } = stateRef.current;
      if (!island) return;
      set({ ordersLoading: true, ordersError: null, orders: [], ordersScope: scope });
      try {
        const page = await getShopOrders(island, scope);
        if (!alive(e, generation)) return;
        set({
          orders: page.items,
          ordersNextCursor: page.nextCursor,
          ordersLoading: false,
        });
        await ensureTitles(
          e,
          generation,
          page.items.map((o) => o.productId),
        );
      } catch (error) {
        if (!alive(e, generation)) return;
        set({ ordersLoading: false, ordersError: error as ApiError });
      }
    },
    [alive, ensureTitles, set],
  );

  const loadMoreOrders = useCallback(async () => {
    const {
      islandId: island,
      ordersScope: scope,
      ordersNextCursor,
      ordersLoading,
      loadingMore,
    } = stateRef.current;
    if (
      !mounted.current ||
      !active ||
      !island ||
      !scope ||
      ordersNextCursor === null ||
      ordersLoading ||
      loadingMore ||
      !cached()
    )
      return;
    const e = epoch.current;
    const generation = sessionGeneration();
    set({ loadingMore: true });
    try {
      const page = await getShopOrders(island, scope, ordersNextCursor);
      if (!alive(e, generation)) return;
      const seen = new Set(stateRef.current.orders.map((o) => o.id));
      set({
        orders: [...stateRef.current.orders, ...page.items.filter((o) => !seen.has(o.id))],
        ordersNextCursor: page.nextCursor,
        loadingMore: false,
      });
      await ensureTitles(
        e,
        generation,
        page.items.map((o) => o.productId),
      );
    } catch (error) {
      if (!alive(e, generation)) return;
      set({ loadingMore: false, ordersError: error as ApiError });
    }
  }, [active, alive, cached, ensureTitles, set]);

  const loadMy = useCallback(
    async (e: number, generation: number) => {
      try {
        const my = await getMyInventory();
        applyMy(e, generation, my);
        await ensureTitles(e, generation, [...my.clothes, ...my.decor]);
      } catch {
        // 옷장 목록은 비어 보이되 개별 실패는 SHOP_SYNC 미적용으로만 둔다 — 화면 오류는 상단 error 가 담당.
      }
    },
    [applyMy, ensureTitles],
  );

  /**
   * 쓰기 한 건을 의도 슬롯 위에서 돈다 — 진행 중 같은 본문의 중복 탭은 promise 를 공유하고,
   * 실패하면 key 를 남겨 재시도가 같은 key 로 가고, 성공(쓰기+재조회)이면 슬롯을 놓는다.
   */
  const runWrite = useCallback(
    <T>(
      slotId: string,
      payload: string,
      write: (key: string) => Promise<T>,
      after: () => Promise<void>,
    ): Promise<T> => {
      const prev = intents.current.get(slotId);
      if (prev?.flight) {
        if (prev.payload === payload) return prev.flight as Promise<T>;
        return Promise.reject(
          new ApiError('CLIENT_WRITE_IN_PROGRESS', '이전 처리가 끝나는 중이에요.', 0),
        );
      }
      const slot: IntentSlot =
        prev && prev.payload === payload ? prev : { key: uuid(), payload, flight: null };
      set({ writing: true });
      const flight = (async () => {
        const result = await write(slot.key);
        await after();
        if (intents.current.get(slotId) === slot) intents.current.delete(slotId);
        return result;
      })();
      slot.flight = flight;
      intents.current.set(slotId, slot);
      flight
        .catch(() => {
          if (intents.current.get(slotId) === slot) slot.flight = null;
        })
        .finally(() => {
          if (mounted.current) set({ writing: false });
        });
      return flight;
    },
    [set],
  );

  const writable = useCallback((): string => {
    const { islandId: island } = stateRef.current;
    if (!mounted.current || !active || !island)
      throw new ApiError(CLIENT_INACTIVE, '지금은 상점을 쓸 수 없어요.', 0);
    if (!cached()) throw stale();
    return island;
  }, [active, cached]);

  /** 쓰기 뒤 정본 재조회 — stale 이면 성공이 아니라 실패로 던진다(호출부가 토스트를 띄우지 않게). */
  const refreshAll = useCallback(
    async (e: number, generation: number) => {
      if (!alive(e, generation)) throw stale();
      const { itemsCategory, ordersScope: scope, islandId: island } = stateRef.current;
      const jobs: Promise<void>[] = [];
      if (island) {
        if (itemsCategory === 'sound') {
          jobs.push(
            Promise.all([getShopProducts(island, 'sound'), getIslandInventory(island)]).then(
              ([page, shared]) => {
                applyShared(e, generation, shared);
                if (!alive(e, generation)) throw stale();
                const titles = { ...stateRef.current.titles };
                for (const item of page.items) titles[item.id] = item.title;
                set({ items: page.items, nextCursor: page.nextCursor, titles });
              },
            ),
          );
        } else if (itemsCategory) {
          jobs.push(
            getShopScreen(itemsCategory).then((screen) =>
              applyScreen(e, generation, screen, itemsCategory),
            ),
          );
        }
        // 지갑 버전은 구매 검사 축이라 카테고리와 무관하게 항상 새로 읽는다.
        jobs.push(
          getShopWallets(island).then((wallets) => {
            if (!alive(e, generation)) throw stale();
            set({ wallets });
            sync({ wallets });
          }),
        );
        if (scope)
          jobs.push(
            getShopOrders(island, scope).then((page) => {
              if (!alive(e, generation)) throw stale();
              set({ orders: page.items, ordersNextCursor: page.nextCursor });
            }),
          );
      }
      jobs.push(getMyInventory().then((my) => applyMy(e, generation, my)));
      await Promise.all(jobs);
      if (!alive(e, generation)) throw stale();
    },
    [alive, applyMy, applyScreen, applyShared, set, sync],
  );

  /**
   * 구매 — 서버 목록/상세의 productVersion 과 지갑의 villagePointsVersion 을 그대로 싣는다.
   * 성공하면 지갑·인벤토리·목록·내역을 다시 읽은 뒤에야 resolve 한다(잔액은 로컬 가산 금지).
   */
  const buy = useCallback(
    async (product: { id: string; productVersion: number }): Promise<ShopOrder> => {
      const island = writable();
      const { wallets } = stateRef.current;
      if (!wallets)
        throw new ApiError(
          CLIENT_INACTIVE,
          '지갑 정보를 아직 못 읽었어요. 잠시 후 다시 시도해 주세요.',
          0,
        );
      const e = epoch.current;
      const generation = sessionGeneration();
      const body = {
        productId: product.id,
        expectedWalletVersion: wallets.villagePointsVersion,
        expectedProductVersion: product.productVersion,
      };
      try {
        return await runWrite(
          `buy:${product.id}`,
          JSON.stringify(body),
          (key) => purchaseProduct(island, body, key),
          () => refreshAll(e, generation),
        );
      } catch (error) {
        // 정본 충돌·권한 실패는 최신 상태를 다시 읽어 다음 의도가 새 버전을 쓰게 한다.
        if (
          error instanceof ApiError &&
          (error.status === 403 || error.status === 409) &&
          alive(e, generation)
        )
          await refreshAll(e, generation).catch(() => {});
        throw error;
      }
    },
    [alive, refreshAll, runWrite, writable],
  );

  /** 개인 외양 — 제출한 필드만 보낸다(생략 유지·명시 null 해제). expectedVersion 없음. */
  const equip = useCallback(
    async (patch: MyAppearancePatch): Promise<PersonalAppearance> => {
      writable();
      const e = epoch.current;
      const generation = sessionGeneration();
      try {
        return await runWrite(
          'equip',
          JSON.stringify(patch),
          (key) => patchMyAppearance(patch, key),
          async () => {
            if (!alive(e, generation)) throw stale();
            const my = await getMyInventory();
            applyMy(e, generation, my);
          },
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && alive(e, generation))
          await loadMy(e, generation).catch(() => {});
        throw error;
      }
    },
    [alive, applyMy, loadMy, runWrite, writable],
  );

  /** 공동 외양 — appearance.version 을 expectedVersion 으로 싣고, 해제는 "default" 다. */
  const applyTheme = useCallback(
    async (patch: Omit<IslandAppearancePatch, 'expectedVersion'>): Promise<IslandAppearance> => {
      const island = writable();
      const { shared } = stateRef.current;
      if (!shared)
        throw new ApiError(
          CLIENT_INACTIVE,
          '섬 외양 정보를 아직 못 읽었어요. 잠시 후 다시 시도해 주세요.',
          0,
        );
      const e = epoch.current;
      const generation = sessionGeneration();
      const body: IslandAppearancePatch = {
        ...patch,
        expectedVersion: shared.appearance.version,
      };
      try {
        return await runWrite(
          'theme',
          JSON.stringify(body),
          (key) => patchIslandAppearance(island, body, key),
          async () => {
            if (!alive(e, generation)) throw stale();
            const next = await getIslandInventory(island);
            applyShared(e, generation, next);
          },
        );
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 403 || error.status === 409) &&
          alive(e, generation)
        )
          await getIslandInventory(island)
            .then((next) => applyShared(e, generation, next))
            .catch(() => {});
        throw error;
      }
    },
    [alive, applyShared, runWrite, writable],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 섬·계정이 바뀌면 모든 캐시·미해결 의도를 버리고 처음부터 다시 읽는다.
  const generation = sessionGeneration();
  useEffect(() => {
    epoch.current += 1;
    intents.current.clear();
    titled.current.clear();
    if (!active || !islandId) {
      set(EMPTY);
      return;
    }
    // islandId 는 snap.currentIslandId 에서 온 이번 세대의 정본이다 — 내역에서 상세로
    // 바로 들어가는 길처럼 어떤 목록 로드보다 먼저 읽기·쓰기가 올 수 있게 proven 을 민다.
    proven.current = { epoch: epoch.current, generation: sessionGeneration() };
    set({ ...EMPTY, islandId });
  }, [active, islandId, generation, set]);

  // 라우트·탭이 정하는 데이터를 읽는다 — 읽기는 조용히, 쓰기는 위 액션으로만.
  useEffect(() => {
    if (!active || !islandId) return;
    const e = epoch.current;
    const g = sessionGeneration();
    if (route === 'shop') loadList(e, g, category);
    else if (route === 'sound') loadList(e, g, 'sound');
    else if (route === 'product' && productId) select(productId);
    else if (route === 'orders') loadOrders(e, g, orderScope);
    else if (route === 'wardrobe') loadMy(e, g);
  }, [
    active,
    islandId,
    route,
    category,
    orderScope,
    productId,
    generation,
    loadList,
    loadMy,
    loadOrders,
    select,
  ]);

  return {
    ...state,
    loadMore,
    loadMoreOrders,
    select,
    buy,
    equip,
    applyTheme,
    retry: () => {
      const e = epoch.current;
      const g = sessionGeneration();
      if (route === 'shop' || route === 'sound')
        loadList(e, g, route === 'sound' ? 'sound' : category);
      else if (route === 'orders') loadOrders(e, g, orderScope);
      else if (route === 'wardrobe') loadMy(e, g);
      else if (route === 'product' && productId) select(productId);
    },
  };
}
