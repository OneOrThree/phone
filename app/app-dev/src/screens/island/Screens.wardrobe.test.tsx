/** 옷장(GROMO-2311) — 슬롯별 장착·해제, 퇴역 항목, 옛 서버 인벤토리. useShop 은 목이다. */
import assert from 'node:assert/strict';
import React, { useMemo, useReducer, useRef, useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RedesignScreens } from '@/screens/island/Screens';
import { initialState, reducer } from '@/services/model';

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
jest.mock('@/screens/island/useShop', () => ({ useShop: () => mockShopApi }));
const mockCatalog: Record<string, any> = {};
jest.mock('@/services/customizationCatalog', () => ({
  useCustomizationCatalog: () => mockCatalog,
}));

const entry = (productId: string, slot: string, over: Record<string, unknown> = {}) => ({
  productId,
  slot,
  title: `${productId}-제목`,
  imageUrl: `https://x/${productId}.png`,
  width: 128,
  height: 128,
  anchorX: 0.5,
  anchorY: 0.5,
  retiredAt: null,
  ...over,
});
const api = (my: Record<string, unknown>) => ({
  my: { clothes: [], decor: [], hulls: [], ...my },
  titles: {},
  kinds: {},
  equip: jest.fn(async () => ({})),
  retry: jest.fn(),
  loading: false,
  error: null,
  writing: false,
});

beforeEach(() => {
  for (const k of Object.keys(mockCatalog)) delete mockCatalog[k];
  Object.assign(mockCatalog, {
    cap: entry('cap', 'head'),
    bow: entry('bow', 'neck'),
    boots: entry('boots', 'shoes'),
    oldhat: entry('oldhat', 'head', { retiredAt: '2026-01-01T00:00:00Z' }),
  });
});

test('머리·목·신발 항목을 탭하면 해당 슬롯으로 equip 한다', async () => {
  mockShopApi = api({ head: ['cap'], neck: ['bow'], shoes: ['boots'] });
  const screen = await render(<Harness />);
  for (const [id, slot] of [
    ['cap-제목', 'head'],
    ['bow-제목', 'neck'],
    ['boots-제목', 'shoes'],
  ]) {
    await fireEvent.press(screen.getByLabelText(id));
    expect(mockShopApi.equip).toHaveBeenLastCalledWith({ [slot]: id.replace('-제목', '') });
  }
  expect(mockShopApi.equip).toHaveBeenCalledTimes(3);
});

test('「기본」은 그 슬롯만 null 로 해제한다(머리·decor 포함)', async () => {
  mockShopApi = api({ head: ['cap'], decor: ['flag'] });
  const screen = await render(<Harness equipped={{ head: 'cap', decor: 'flag' }} />);
  // 섹션 순서: 옷, 장식, 머리
  const defaults = screen.getAllByLabelText('기본');
  await fireEvent.press(defaults[1]);
  expect(mockShopApi.equip).toHaveBeenLastCalledWith({ decor: null });
  await fireEvent.press(defaults[2]);
  expect(mockShopApi.equip).toHaveBeenLastCalledWith({ head: null });
});

test('퇴역 항목은 서랍에 없고, 입고 있으면 남는다', async () => {
  mockShopApi = api({ head: ['cap', 'oldhat'] });
  const a = await render(<Harness />);
  expect(a.queryByLabelText('oldhat-제목')).toBeNull();
  expect(a.getByLabelText('cap-제목')).toBeTruthy();
  const b = await render(<Harness equipped={{ head: 'oldhat' }} />);
  expect(b.getByLabelText('oldhat-제목')).toBeTruthy();
});

test('옛 서버 인벤토리(head/neck/shoes 키 없음)면 새 슬롯 섹션을 숨긴다', async () => {
  mockShopApi = api({});
  const screen = await render(<Harness />);
  expect(screen.queryByText('머리')).toBeNull();
  expect(screen.queryByText('목')).toBeNull();
  expect(screen.queryByText('신발')).toBeNull();
  expect(screen.getByText('옷')).toBeTruthy();
});

// Screens.test.tsx 의 Harness 를 이 파일 전용으로 축약했다 — 'product'/'shop' 경로만 다룬다.
function Harness({
  equipped = {},
  route = 'wardrobe',
  detail = '',
  notify = jest.fn(),
}: {
  equipped?: Record<string, string>;
  route?: string;
  detail?: string;
  notify?: jest.Mock;
}) {
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
    Object.assign(s.equipped, equipped);
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
