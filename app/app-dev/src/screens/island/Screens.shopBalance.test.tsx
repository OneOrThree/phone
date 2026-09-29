/**
 * 「강아지 상점」 물고기 잔액 라벨은 현재 서버 섬 이름을 써야 한다(로컬 목업 섬 이름 고정 금지).
 * useShop 훅은 이미 useShop.test.tsx 가 검증한다 — 여기서는 화면의 구매 확인 핸들러만 고립해서 본다.
 */
import assert from 'node:assert/strict';
import React, { useMemo, useReducer, useRef, useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
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
test('상점 잔액 라벨은 로컬 목업 섬(소다 섬) 대신 현재 서버 섬 이름을 쓴다', async () => {
  const notify = jest.fn();
  const screen = await render(<Harness route="shop" notify={notify} />);

  assert.ok(screen.getByText('QA 건설섬 물고기'));
  assert.equal(screen.queryByText('소다 섬 물고기'), null);
});
