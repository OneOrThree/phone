import { createPreviewEnvironment } from '@/navigation/previewEnvironment';
import type { Route } from '@/services/model';
/**
 * 상점 구매 확정 시 서버에 닿지 못하면(연결 거부·타임아웃) 사용자에게 알려야 한다.
 * useShop 훅은 이미 useShop.test.tsx 가 검증한다 — 여기서는 화면의 구매 확인 핸들러만 고립해서 본다.
 */
import { RedesignScreens } from '@/screens/island/Screens';
import { ApiError } from '@/services/api/client';
import type { CatalogEntry } from '@/services/customizationCatalog';
import { initialState, reducer } from '@/services/model';
import { act, fireEvent, render } from '@testing-library/react-native';
import assert from 'node:assert/strict';
import { useMemo, useReducer, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: 1,
    compact: false,
    tablet: false,
    modalWidth: 340,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 52, bottom: 32, left: 0, right: 0 }),
}));

let mockShopApi: any;
jest.mock('@/screens/island/useShop', () => ({
  useShop: () => mockShopApi,
}));

// 상점 카드의 꾸미기 그림(GROMO-2873) — 서버 꾸미기 카탈로그 표만 바꿔 끼운다
let mockCatalog: Record<string, CatalogEntry> = {};
jest.mock('@/services/customizationCatalog', () => ({
  ...jest.requireActual('@/services/customizationCatalog'),
  useCustomizationCatalog: () => mockCatalog,
}));

const baseShopApi = () => ({
  loading: false,
  error: null,
  items: [],
  // 응답을 받은 탭 — 실제 useShop 은 첫 요청 전 null 이다
  itemsCategory: 'personal',
  nextCursor: null,
  detail: {
    id: 'scarf',
    title: '목도리',
    kind: 'clothes_item',
    price: 20,
    owned: false,
    available: true,
    productVersion: 3,
  },
  detailLoading: false,
  detailError: null,
  wallets: { villagePoints: 100, villagePointsVersion: 7 },
  my: { clothes: [], decor: [] },
  shared: { appearance: { islandThemeId: null, buildingThemes: {} }, audio: [] },
  titles: {},
  kinds: {},
  orders: [],
  ordersNextCursor: null,
  ordersLoading: false,
  ordersError: null,
  writing: false,
  retry: jest.fn(),
  buy: jest.fn(),
  equip: jest.fn(),
  applyTheme: jest.fn(),
});

// Screens.test.tsx 의 Harness 를 이 파일 전용으로 축약했다 — 'product'/'shop' 경로만 다룬다.
function Harness({ route, detail, notify }: { route: Route; detail?: string; notify: jest.Mock }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const s = initialState(false);
    s.serverIslands = {
      memberships: [
        {
          id: 'qa-island',
          name: 'QA 건설섬',
          intro: '',
          visibility: 'public',
          approvalRequired: false,
          memberCount: 1,
          maxMembers: 15,
          membershipStatus: 'active',
          joinRequestId: null,
          growthStage: null,
          themeId: null,
        },
      ],
      currentIslandId: 'qa-island',
      lossReason: null,
      candidates: [],
      nextCursor: null,
      visit: null,
      joinRequests: [],
      requestStatus: [],
    };
    return s;
  });
  const islands = useMemo(() => ({}), []);
  const confirm = useRef(jest.fn((_title: string, _body: string, ok: () => void) => ok())).current;
  const [tab, setTab] = useState('');
  return (
    <RedesignScreens
      e={createPreviewEnvironment({
        state,
        route,
        dispatch,
        go: jest.fn(),
        replace: jest.fn(),
        reset: jest.fn(),
        home: jest.fn(),
        back: jest.fn(),
        notify,
        confirm,
        signOut: jest.fn(async () => true),
        build: jest.fn(),
        text: '',
        setText: jest.fn(),
        body: '',
        setBody: jest.fn(),
        tab,
        setTab,
        detail: detail ?? '',
        now: Date.now(),
        terms: false,
        setTerms: jest.fn(),
        approval: false,
        setApproval: jest.fn(),
        visited: '',
        setVisited: jest.fn(),
        guideStep: 0,
        setGuideStep: jest.fn(),
        player: {
          addListener: () => ({ remove() {} }),
          replace() {},
          play() {
            return true;
          },
          pause() {},
        },
        previewAudio: false,
        setPreviewAudio: jest.fn(),
        walkTo: jest.fn(),
        newQuest: jest.fn(),
        walkRequest: null,
        islands,
        islandBootError: false,
        homeError: false,
        retryHome: jest.fn(),
        friendsScreen: undefined,
      })}
    />
  );
}

beforeEach(() => {
  mockShopApi = baseShopApi();
  mockCatalog = {};
});

// 서버 상점 목록의 꾸미기 한 칸(kind 는 서버 값 neck → 카드에선 「내 꾸미기」)
const bellItem = {
  id: 'cust.neck.bell',
  title: '버터 방울 목걸이',
  kind: 'neck',
  price: 30,
  currency: 'village_points',
  ownerType: 'user',
  owned: false,
  available: true,
  reason: null,
  productVersion: 1,
};
const bellEntry: CatalogEntry = {
  productId: 'cust.neck.bell',
  kind: 'neck',
  slot: 'neck',
  title: '버터 방울 목걸이',
  imageUrl: 'https://api.test/static/customization/neck/bell.c1750340.png',
  width: 512,
  height: 512,
  anchorX: 0.5,
  anchorY: 0.5,
  sortOrder: 10,
  retiredAt: null,
};

test('상점 꾸미기 카드는 꾸미기 카탈로그에 있는 상품이면 그 상품 그림을 그린다(GROMO-2873)', async () => {
  mockShopApi = { ...baseShopApi(), items: [bellItem] };
  mockCatalog = { 'cust.neck.bell': bellEntry };
  const screen = await render(<Harness route="shop" notify={jest.fn()} />);
  const art = screen.getByTestId('shop-art-cust.neck.bell');
  assert.deepEqual(art.props.source, { uri: bellEntry.imageUrl });
});

test('꾸미기 카탈로그에 없는 상품(불러오는 중·실패)은 상품 그림 없이 기본 그림으로 칸을 그린다(GROMO-2873)', async () => {
  mockShopApi = { ...baseShopApi(), items: [bellItem] };
  const screen = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.equal(screen.queryByTestId('shop-art-cust.neck.bell'), null);
  assert.ok(screen.getByText('30마리'));
});

test('칸이 좁으면 꾸미기 그림은 칸 폭의 92% 를 넘지 않는다 — compact 한 줄 4칸에서 가로로 잘리지 않게(GROMO-2873)', async () => {
  mockShopApi = { ...baseShopApi(), items: [bellItem] };
  mockCatalog = { 'cust.neck.bell': bellEntry };
  const screen = await render(<Harness route="shop" notify={jest.fn()} />);
  const size = () => StyleSheet.flatten(screen.getByTestId('shop-art-cust.neck.bell').props.style);
  // 폭을 재기 전에는 칸 높이 112 의 0.86 배
  assert.equal(size().width, 96);
  await fireEvent(screen.getByTestId('shop-art-box-cust.neck.bell'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 60, height: 112 } },
  });
  assert.equal(size().width, 55);
  assert.equal(size().height, 55);
});

test('섬·건물 테마 카드는 꾸미기 카탈로그와 상관없이 종류별 그림만 그린다(GROMO-2873)', async () => {
  const theme = (id: string, kind: string, targetBuilding?: string) => ({
    ...bellItem,
    id,
    title: id,
    kind,
    price: 300,
    ownerType: 'island',
    ...(targetBuilding ? { targetBuilding } : {}),
  });
  mockShopApi = {
    ...baseShopApi(),
    itemsCategory: 'island',
    items: [
      theme('soda-theme', 'island_theme'),
      theme('strawberry-roof', 'building_theme', 'hall'),
    ],
  };
  // 같은 id 가 카탈로그 표에 있어도 테마 카드는 상품 그림을 쓰지 않는다
  mockCatalog = {
    'soda-theme': { ...bellEntry, productId: 'soda-theme' },
    'strawberry-roof': { ...bellEntry, productId: 'strawberry-roof' },
  };
  const screen = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.equal(screen.queryByTestId('shop-art-soda-theme'), null);
  assert.equal(screen.queryByTestId('shop-art-strawberry-roof'), null);
  assert.equal(screen.getAllByText('300마리').length, 2);
});

test('집중 보상 머리·목(catFit)은 대표 영역만 잘라 칸 높이 안에 그린다(GROMO-2873)', async () => {
  mockShopApi = { ...baseShopApi(), items: [bellItem] };
  mockCatalog = {
    'cust.neck.bell': {
      ...bellEntry,
      catFit: {
        width: 1254,
        height: 1254,
        crop: [406, 406, 839, 913],
        colors: ['black'],
        motions: { walk: 6, focus: 4, reel: 4 },
        stills: [],
        rigUrls: { black: 'https://api.test/static/customization/rigs/neck.22a4cc24.json' },
        neck: {
          style: 'pendant',
          front: [406, 406, 839, 913],
          commonBand: {
            url: 'https://api.test/static/customization/neck/common-band.1acc2be4.png',
            box: [82, 392, 1693, 493],
          },
        },
      },
    },
  };
  const screen = await render(<Harness route="shop" notify={jest.fn()} />);
  const crop = StyleSheet.flatten(screen.getByTestId('shop-art-cust.neck.bell').props.style);
  assert.ok(crop.height <= 96 && crop.width <= 96, `잘린 그림 ${crop.width}×${crop.height}`);
  assert.ok(crop.height > 90, '세로가 긴 목걸이는 높이 기준값에 맞춘다');
});
// 그림 없는 신발(GROMO-2878) — 서버 꾸미기 카탈로그에는 신발 그림 자료가 없다
const bareShoes = {
  ...bellItem,
  id: 'cust.shoes.test-only',
  title: '시험용 덧신',
  kind: 'shoes',
  price: 25,
};

test('꾸미기 카탈로그를 받은 뒤에는 표에 없는 개인 꾸미기 카드를 목록에서 뺀다(GROMO-2878)', async () => {
  mockShopApi = { ...baseShopApi(), items: [bellItem, bareShoes] };
  mockCatalog = { 'cust.neck.bell': bellEntry };
  const screen = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.ok(screen.getByTestId('shop-art-cust.neck.bell'));
  assert.equal(screen.queryByText('25마리'), null);
  assert.equal(screen.queryByTestId('shop-empty'), null);
});

test('카탈로그를 아직 못 받았거나 실패해 표가 비었으면 거르지 않고 기본 그림으로 보인다(GROMO-2878)', async () => {
  mockShopApi = { ...baseShopApi(), items: [bellItem, bareShoes] };
  const screen = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.ok(screen.getByText('30마리'));
  assert.ok(screen.getByText('25마리'));
  assert.equal(screen.queryByTestId('shop-art-cust.shoes.test-only'), null);
});

test('개인 꾸미기가 모두 걸러지면 빈 상태 한 줄을 보인다(GROMO-2878)', async () => {
  mockShopApi = { ...baseShopApi(), items: [bareShoes] };
  mockCatalog = { 'cust.neck.bell': bellEntry };
  const screen = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.ok(screen.getByTestId('shop-empty'));
});

test('섬·건물 테마 카드는 카탈로그에 없어도 거르지 않는다(GROMO-2878)', async () => {
  const theme = (id: string, kind: string) => ({
    ...bellItem,
    id,
    title: id,
    kind,
    price: 300,
    ownerType: 'island',
  });
  mockShopApi = {
    ...baseShopApi(),
    itemsCategory: 'island',
    items: [theme('soda-theme', 'island_theme'), theme('strawberry-roof', 'building_theme')],
  };
  mockCatalog = { 'cust.neck.bell': bellEntry };
  const screen = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.equal(screen.getAllByText('300마리').length, 2);
});

test('상점·구매 내역 탭은 번역한 이름을 보인다 — 키 문자열이 화면에 나오지 않는다(GROMO-2878)', async () => {
  const shop = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.ok(shop.getByText('내 꾸미기'));
  assert.ok(shop.getByText('우리 섬 꾸미기'));
  assert.equal(shop.queryByText('shop.tab.personal'), null);
  await shop.unmount();

  const orders = await render(<Harness route="orders" notify={jest.fn()} />);
  assert.ok(orders.getByText('내 구매'));
  assert.ok(orders.getByText('섬 공동 구매'));
  assert.equal(orders.queryByText('shop.ordersTab.personal'), null);
});

test('서버 불통(CLIENT_NETWORK_ERROR) 구매 실패는 사용자에게 실패 문구를 보여준다', async () => {
  mockShopApi.buy = jest.fn(() =>
    Promise.reject(
      new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요. 연결을 확인해 주세요.', 0),
    ),
  );
  const notify = jest.fn();
  const screen = await render(<Harness route="product" detail="scarf" notify={notify} />);

  await act(async () => {
    await fireEvent.press(screen.getByText('20마리로 구매'));
  });

  assert.equal(mockShopApi.buy.mock.calls.length, 1);
  assert.ok(
    screen.getByText('네트워크에 연결할 수 없어요. 연결을 확인해 주세요.'),
    '실패 문구가 상품 시트 안에 보여야 한다',
  );
  assert.equal(notify.mock.calls.length, 0, '같은 화면에서는 전역 알림과 중복해 알리지 않는다');
});

test('타임아웃(CLIENT_TIMEOUT) 구매 실패도 사용자에게 실패 문구를 보여준다', async () => {
  mockShopApi.buy = jest.fn(() =>
    Promise.reject(
      new ApiError('CLIENT_TIMEOUT', '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.', 0),
    ),
  );
  const notify = jest.fn();
  const screen = await render(<Harness route="product" detail="scarf" notify={notify} />);

  await act(async () => {
    await fireEvent.press(screen.getByText('20마리로 구매'));
  });

  assert.ok(screen.getByText('서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.'));
});

test('구매 실패 문구는 전역 토스트에 가려질 수 있어 상품 시트 안(sheetToast)에 보여야 한다', async () => {
  // 전역 알림(App.tsx 의 토스트)은 이 화면 하네스에는 렌더링되지 않는다 — 실사용에서는 그
  // 전역 토스트가 키보드·모달 뒤에 가려질 수 있어, 시트 안에서도 같은 문구가
  // 보여야 실패를 알 수 있다. notify 만 불리고 화면에 아무 문구도 뜨지 않으면 이 테스트가 잡는다.
  mockShopApi.buy = jest.fn(() =>
    Promise.reject(
      new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요. 연결을 확인해 주세요.', 0),
    ),
  );
  const notify = jest.fn();
  const screen = await render(<Harness route="product" detail="scarf" notify={notify} />);

  await act(async () => {
    await fireEvent.press(screen.getByText('20마리로 구매'));
  });

  assert.ok(
    screen.getByText('네트워크에 연결할 수 없어요. 연결을 확인해 주세요.'),
    '구매 실패 문구가 상품 시트 안(sheetToast)에도 렌더링돼야 한다',
  );
});

test('구매 응답 전에 다른 화면으로 옮기면 시트 토스트 대신 전역 알림으로 알린다', async () => {
  let reject: (e: unknown) => void = () => {};
  mockShopApi.buy = jest.fn(() => new Promise((_, rej) => (reject = rej)));
  const notify = jest.fn();
  const screen = await render(<Harness route="product" detail="scarf" notify={notify} />);

  await act(async () => {
    await fireEvent.press(screen.getByText('20마리로 구매'));
  });
  await screen.rerender(<Harness route="shop" notify={notify} />);
  await act(async () => {
    reject(new ApiError('CLIENT_TIMEOUT', '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.', 0));
  });

  assert.equal(screen.queryByText('서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.'), null);
  assert.ok(
    notify.mock.calls.some((call) => call[0] === '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.'),
  );
});

test('상점에 파는 꾸미기가 0개면 빈 상태 한 줄을 보이고, 불러오는 중·실패에는 보이지 않는다(GROMO-2412)', async () => {
  const empty = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.ok(empty.getByTestId('shop-empty'));
  assert.ok(empty.getByText('아직 파는 꾸미기가 없어요'));
  await empty.unmount();

  mockShopApi = { ...baseShopApi(), loading: true };
  const loading = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.equal(loading.queryByTestId('shop-empty'), null);
  await loading.unmount();

  mockShopApi = { ...baseShopApi(), error: new ApiError('CLIENT_NETWORK_ERROR', '네트워크', 0) };
  const failed = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.equal(failed.queryByTestId('shop-empty'), null);
});

test('상점 첫 프레임(요청 전 items 빈 배열·loading false)과 다른 탭 응답에는 빈 상태를 띄우지 않는다(GROMO-2412)', async () => {
  // useShop 초기 상태 그대로 — 로딩 effect 가 loading 을 켜기 전
  mockShopApi = { ...baseShopApi(), itemsCategory: null };
  const first = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.equal(first.queryByTestId('shop-empty'), null);
  await first.unmount();

  // 탭을 바꾼 직후 — 아직 이전 탭(우리 섬 꾸미기) 응답이 남아 있다
  mockShopApi = { ...baseShopApi(), itemsCategory: 'island' };
  const switched = await render(<Harness route="shop" notify={jest.fn()} />);
  assert.equal(switched.queryByTestId('shop-empty'), null);
});

test('상품 상세는 내용 높이에 맞춘 시트(fit)를 쓴다 — 설명과 구매 버튼 사이를 비우지 않는다(GROMO-2412)', async () => {
  const screen = await render(<Harness route="product" detail="scarf" notify={jest.fn()} />);
  const box = () => StyleSheet.flatten(screen.getByTestId('island-sheet-box').props.style);
  await fireEvent(screen.getByTestId('island-sheet-scroll'), 'contentSizeChange', 402, 320);
  await fireEvent(screen.getByTestId('island-sheet-footer'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 130 } },
  });
  assert.equal(box().top, 874 - (72 + 2 + 320 + 130));
});
