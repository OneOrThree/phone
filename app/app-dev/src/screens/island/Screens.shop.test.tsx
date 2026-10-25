/**
 * 상점 구매 확정 시 서버에 닿지 못하면(연결 거부·타임아웃) 사용자에게 알려야 한다.
 * useShop 훅은 이미 useShop.test.tsx 가 검증한다 — 여기서는 화면의 구매 확인 핸들러만 고립해서 본다.
 */
import assert from 'node:assert/strict';
import React, { useMemo, useReducer, useRef, useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { RedesignScreens } from '@/screens/island/Screens';
import { initialState, reducer } from '@/services/model';
import { ApiError } from '@/services/api/client';

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
function Harness({ route, detail, notify }: { route: string; detail?: string; notify: jest.Mock }) {
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
      e={{
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
        signOut: jest.fn(async () => {}),
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
        player: { addListener: () => ({ remove() {} }), replace() {}, play() {}, pause() {} },
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
      }}
    />
  );
}

beforeEach(() => {
  mockShopApi = baseShopApi();
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
