import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { initialState } from '@/services/model';
import { Hall } from '@/screens/island/Hall';
import { useConstruction } from '@/screens/island/useConstruction';
import { useIslandManagement } from '@/screens/interiors/useIslandManagement';
import { getSession } from '@/services/api/session';
import type { ConstructionOptions } from '@/services/api/home';

// GROMO — 마을회관 「목각 건물 고르기」 실서버 건설 패널 회귀 테스트.
//
// 근본 원인(RN 0.86 ReactNativeAttributePayload.diffProperties): 같은 View 인스턴스에서
// style.transform 값이 [{...}](배열) → undefined 로 바뀌면, "명시적 undefined 는 이전 값을
// 지우는 null"로 취급해 processTransform(null) 을 호출한다 — processTransform.js 의
// _validateTransforms 는 null 가드가 없어 `null.forEach` 로 RedBox("Cannot read property
// 'forEach' of null")를 낸다. Hall.tsx 1334번줄 근처 「목각 건물 고르기」 그리드 컨테이너가
// `transform: plan ? [{ scale: 0.985 }] : undefined` 였다 — 건설 패널을 열 때(undefined→배열)는
// 안전하지만 패널을 닫을 때(배열→undefined)는 정확히 이 크래시 조건이다.
// (jest 의 react-test-renderer 는 네이티브 diff 를 실제로 돌리지 않아 렌더만으로는 크래시가
// 재현되지 않는다 — 그래서 실제 계약대로 "이 컨테이너의 transform 은 열림/닫힘 어느 쪽에서도
// 배열이어야 한다"를 직접 검증한다.)
jest.mock('@/screens/island/useConstruction', () => ({ useConstruction: jest.fn() }));
jest.mock('@/screens/interiors/useIslandManagement', () => ({ useIslandManagement: jest.fn() }));
jest.mock('@/services/api/session', () => ({
  sessionGeneration: () => 0,
  getSession: jest.fn(),
}));
jest.mock('@/screens/island/useLedgerScreen', () => ({
  shiftMonth: (month: string) => month,
  useLedgerScreen: () => ({
    month: '2026-09',
    offset: 0,
    canNext: false,
    prevMonth: jest.fn(),
    nextMonth: jest.fn(),
    tab: 'balance',
    setTab: jest.fn(),
    status: 'ready',
    error: null,
    items: [],
    villagePoints: null,
    earnedTotal: 0,
    spentTotal: 0,
    nextCursor: null,
    loadingMore: false,
    moreError: null,
    loadMore: jest.fn(),
    retry: jest.fn(),
    refresh: jest.fn(),
  }),
}));
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
    landscape: false,
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 52, bottom: 32, left: 0, right: 0 }),
}));

const constructionMock = useConstruction as jest.Mock;
const managementMock = useIslandManagement as jest.Mock;
const getSessionMock = getSession as jest.Mock;

const management = (over: object = {}) => ({
  detail: null,
  role: 'member',
  members: null,
  requests: null,
  loading: false,
  error: null,
  accessLost: false,
  reload: jest.fn(),
  saveSettings: jest.fn(),
  answerRequest: jest.fn(),
  kickMember: jest.fn(),
  transferHost: jest.fn(),
  ...over,
});

// 재현 서버 응답 — 목표(게시판)는 선택돼 있고 잔액은 원가의 절반이다(0/0 이 아니라 실제 크래시 신고와
// 같은 값으로 맞춘다).
const options = (over: Partial<ConstructionOptions> = {}): ConstructionOptions =>
  ({
    islandVersion: 2,
    costPolicyVersion: 1,
    selectedBuildingId: 'board',
    villagePoints: 120,
    walletVersion: 1,
    items: [
      {
        id: 'board',
        name: '게시판',
        cost: 240,
        currency: 'village_points',
        selectable: true,
        buildable: false,
        blockedReason: 'INSUFFICIENT_FUNDS',
      },
      {
        id: 'library',
        name: '도서관',
        cost: 200,
        currency: 'village_points',
        selectable: false,
        buildable: false,
        blockedReason: 'FACILITY_LOCKED',
      },
    ],
    ...over,
  }) as ConstructionOptions;

const construction = (over: object = {}) => ({
  status: 'ready',
  options: options(),
  members: [
    { id: 'host', name: '방장' },
    { id: 'member-1', name: '나' },
  ],
  started: null,
  progress: 0,
  phase: 'pre',
  error: null,
  reload: jest.fn(),
  retry: jest.fn(),
  select: jest.fn(),
  build: jest.fn(),
  ...over,
});

const e = (route = 'construction', state = initialState(true)) => ({
  state,
  route,
  now: Date.now(),
  go: jest.fn(),
  back: jest.fn(),
  home: jest.fn(),
  dispatch: jest.fn(),
  notify: jest.fn(),
  reset: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  managementMock.mockReturnValue(management());
  constructionMock.mockReturnValue(construction());
  getSessionMock.mockReturnValue({ userId: 'member-1' });
});
afterEach(cleanup);

test('잔액이 목표 원가의 일부만 찬 상태로 게시판 건설 패널을 열어도 렌더가 죽지 않는다', async () => {
  const screen = await render(<Hall e={e()} />);

  // 「목각 건물 고르기」 그리드에서 게시판 카드를 눌러 BUILDING PLAN 패널을 연다.
  await fireEvent.press(screen.getByTestId('hall-bld-board'));

  await waitFor(() => assert.ok(screen.getByText('BUILDING PLAN · 01')));
  assert.ok(screen.getByText('120 / 240마리'));
});

test('건설 패널을 열고 닫아도 「목각 건물 고르기」 그리드의 transform 이 undefined 가 되지 않는다', async () => {
  const screen = await render(<Hall e={e()} />);

  // 닫힌 상태(최초 렌더) — 그리드는 축소 애니메이션이 없다.
  const closedStyle = StyleSheet.flatten(screen.getByTestId('hall-bld-grid').props.style);
  assert.ok(
    Array.isArray(closedStyle.transform),
    `닫힌 상태의 transform 은 배열이어야 한다 (받은 값: ${JSON.stringify(closedStyle.transform)})`,
  );

  // 연다 — 그리드가 살짝 축소된다.
  await fireEvent.press(screen.getByTestId('hall-bld-board'));
  await waitFor(() => assert.ok(screen.getByText('BUILDING PLAN · 01')));
  const openStyle = StyleSheet.flatten(screen.getByTestId('hall-bld-grid').props.style);
  assert.ok(
    Array.isArray(openStyle.transform),
    `열린 상태의 transform 은 배열이어야 한다 (받은 값: ${JSON.stringify(openStyle.transform)})`,
  );

  // 다시 닫는다(뒤로가기는 패널이 열려 있으면 라우트 이동 대신 setPlan(null)을 부른다) — 같은 View
  // 인스턴스가 배열→undefined 로 transform 을 잃으면 RN 이 native 에 null 을 보내
  // processTransform 의 _validateTransforms 에서 `null.forEach` 로 죽는다(RedBox: "Cannot read
  // property 'forEach' of null"). 고정 전에는 여기서 transform 이 `undefined` 였다.
  await fireEvent.press(screen.getByTestId('hall-back'));
  await waitFor(() => assert.equal(screen.queryByText('BUILDING PLAN · 01'), null));
  const reClosedStyle = StyleSheet.flatten(screen.getByTestId('hall-bld-grid').props.style);
  assert.ok(
    Array.isArray(reClosedStyle.transform),
    `다시 닫힌 상태의 transform 도 배열이어야 한다 (받은 값: ${JSON.stringify(reClosedStyle.transform)})`,
  );
});
