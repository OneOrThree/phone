/** 옷장(GROMO-2311) — 슬롯별 장착·해제, 퇴역 항목, 옛 서버 인벤토리. useShop 은 목이다. */
import assert from 'node:assert/strict';
import React, { useMemo, useReducer, useRef, useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet } from 'react-native';
import { RedesignScreens, raftArtSize } from '@/screens/island/Screens';
import { resetUnseenOutfitsForTest } from '@/services/unseenOutfits';
import { initialState, reducer, type State } from '@/services/model';

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

// 안 본 새 꾸미기는 로그인 사용자별이다 — 이 파일은 u1 로 로그인한 것으로 본다
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  getSession: () => ({ userId: 'u1', accessToken: 'a', refreshToken: 'r' }),
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
  // 섹션 순서: 장식, 머리
  const defaults = screen.getAllByText('기본');
  await fireEvent.press(defaults[0]);
  expect(mockShopApi.equip).toHaveBeenLastCalledWith({ decor: null });
  await fireEvent.press(defaults[1]);
  expect(mockShopApi.equip).toHaveBeenLastCalledWith({ head: null });
  expect(screen.getByLabelText('머리 기본')).toBeTruthy(); // 슬롯별 접근성 라벨
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
  expect(screen.queryByText('옷')).toBeNull();
});

test('결과창에서 처음 받은 꾸미기는 옷장 칸에 NEW! — 한 번 누르면 사라지고 기존 보유품엔 없다 (GROMO-2382)', async () => {
  resetUnseenOutfitsForTest();
  await AsyncStorage.setItem(
    'gromo.unseenOutfits.u1',
    JSON.stringify({ ids: ['cap'], records: ['r1'] }),
  );
  mockShopApi = api({ head: ['cap'], neck: ['bow'] });
  const screen = await render(<Harness />);
  await act(async () => {});
  expect(screen.getAllByText('NEW!')).toHaveLength(1);
  expect(screen.getByLabelText('cap-제목 NEW!')).toBeTruthy();
  expect(screen.getByLabelText('bow-제목')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('cap-제목 NEW!'));
  await act(async () => {});
  expect(mockShopApi.equip).toHaveBeenLastCalledWith({ head: 'cap' });
  expect(screen.queryByText('NEW!')).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem('gromo.unseenOutfits.u1'))!)).toEqual({
    ids: [],
    records: ['r1'],
  });
});

test('검정 뗏목 미리보기의 꾸미기 상자는 실제 그림 상자에 맞춘다 — 393·430pt 폭 (GROMO-2382)', async () => {
  // 미리보기 안쪽 = 화면 폭 - 시트 좌우 여백 40 - 테두리 4, 높이 260 - 4
  const at393 = raftArtSize(393 - 44, 256);
  const at430 = raftArtSize(430 - 44, 256);
  // 두 폭 모두 높이(86%)가 먼저 차 그림 폭이 92% 보다 좁다 — 430pt 에서는 92% 의 86% 뿐이다
  expect(at393.height).toBeCloseTo(256 * 0.86, 6);
  expect(at393.width).toBeCloseTo((256 * 0.86 * 440) / 317, 6);
  expect(at430).toEqual(at393);
  expect(at393.width / ((393 - 44) * 0.92)).toBeCloseTo(0.952, 3);
  expect(at430.width / ((430 - 44) * 0.92)).toBeCloseTo(0.86, 2);
  // 좁은 상자는 폭(92%)이 먼저 찬다
  expect(raftArtSize(300, 256)).toEqual({ width: 276, height: (276 * 317) / 440 });
  // 화면은 미리보기 안쪽을 재서 그림·꾸미기를 그 상자 하나에 겹친다
  mockShopApi = api({ head: ['cap'] });
  const screen = await render(<Harness color="black" />);
  await fireEvent(screen.getByTestId('raft-cat-frame'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 430 - 44, height: 256 } },
  });
  expect(StyleSheet.flatten(screen.getByTestId('raft-cat-art').props.style)).toEqual(at430);
});

// Screens.test.tsx 의 Harness 를 이 파일 전용으로 축약했다 — 'product'/'shop' 경로만 다룬다.
function Harness({
  equipped = {},
  color,
  route = 'wardrobe',
  detail = '',
  notify = jest.fn(),
}: {
  equipped?: Record<string, string>;
  color?: State['color'];
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
    if (color) s.color = color;
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
