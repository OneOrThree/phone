import assert from 'node:assert/strict';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { initialState, dayKey } from '@/services/model';
import type { LedgerPage, TownHallScreen } from '@/services/api/townHall';
import { getLedger, getTownHall } from '@/services/api/townHall';
import { Hall } from '@/screens/island/Hall';

jest.mock('@/services/api/townHall', () => ({
  getTownHall: jest.fn(),
  getLedger: jest.fn(),
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

const townHallMock = getTownHall as jest.Mock;
const ledgerMock = getLedger as jest.Mock;

const SERVER_ISLAND = '3f6b9c2a-7d4e-4a1b-8c5d-2e9f0a1b3c4d';

const entry = (id: string, over: Partial<LedgerPage['items'][number]> = {}) => ({
  id,
  direction: 'earn' as const,
  reason: 'contribution',
  amount: 10,
  createdAt: '2026-09-20T00:12:00Z',
  groupedUntil: '2026-09-20T09:51:00Z',
  entryCount: 1,
  ...over,
});

const page = (over: Partial<LedgerPage> = {}): LedgerPage => ({
  month: dayKey(Date.now()).slice(0, 7),
  earnedTotal: 0,
  spentTotal: 0,
  items: [],
  nextCursor: null,
  ...over,
});

// fish(개인 41)와 villagePoints(공동 잔액 정본)를 다른 값으로 둔다 — 개인 지갑 오표시를 잡는다
const screenBody = (ledger: Partial<LedgerPage>, village = 1240): TownHallScreen =>
  ({
    island: { id: SERVER_ISLAND },
    wallets: { fish: 41, villagePoints: village },
    ledger: page(ledger),
  }) as unknown as TownHallScreen;

const e = (state = initialState(true)) => ({
  state,
  route: 'ledger',
  now: Date.now(),
  go: jest.fn(),
  back: jest.fn(),
  home: jest.fn(),
  dispatch: jest.fn(),
  notify: jest.fn(),
  reset: jest.fn(),
  share: jest.fn(),
});

let consoleSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  // act() 경고 한 번이 수백 MB 의 component stack 문자열 홍수로 번진다 — 첫 경고에서 즉시 실패한다
  consoleSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('not configured to support act')) {
      throw new Error('act() 경고 — RNTL 비동기 전환을 await 하지 않았다');
    }
  });
});
afterEach(() => consoleSpy.mockRestore());

test('서버 월 합계·지갑을 그대로 표시한다 — 보이는 rows 합과 달라도 totals 가 정본이다', async () => {
  townHallMock.mockResolvedValue(
    screenBody(
      {
        earnedTotal: 9999,
        spentTotal: 150,
        items: [entry('e1', { amount: 10 })],
      },
      1240,
    ),
  );
  const screen = await render(<Hall e={e()} />);

  await waitFor(() => assert.ok(screen.getByText('+9,999')));
  assert.ok(screen.getByText('−150'));
  assert.ok(screen.getByText(/1,240마리/));
  expect(screen.queryByText(/ISLAND LEDGER/)).toBeNull();
  expect(screen.queryByText('우리 섬 물고기')).toBeNull();
  // 41 은 개인 fish 다 — 공동 잔액 자리에 개인 지갑이 새어 나오면 안 된다
  assert.equal(screen.queryByText(/41마리/), null);
  assert.equal(townHallMock.mock.calls.length, 1);
  assert.equal(ledgerMock.mock.calls.length, 0);
});

test('「공동 가계부」 제목표와 책갈피는 한 줄에 놓여 책갈피가 제목을 덮지 않는다(GROMO-2409)', async () => {
  townHallMock.mockResolvedValue(screenBody({}));
  const screen = await render(<Hall e={e()} />);
  await waitFor(() => assert.ok(screen.getByTestId('ledger-tab-잔액')));

  // 제목표와 책갈피가 같은 줄(flex row) 안에 있다 — 따로 절대 배치하면 좁은 화면에서 겹친다
  const heading = screen.getByTestId('ledger-heading');
  assert.equal(StyleSheet.flatten(heading.props.style).flexDirection, 'row');
  assert.ok(within(heading).getByText('공동 가계부'));
  for (const label of ['잔액', '적립', '지출']) {
    assert.ok(within(heading).getByTestId(`ledger-tab-${label}`));
    // 고정 폭이 아니라 시안 폭까지만 커지고 남는 폭만큼 줄어든다
    const tab = StyleSheet.flatten(screen.getByTestId(`ledger-tab-${label}`).props.style);
    assert.equal(tab.width, undefined);
    assert.equal(tab.flex, 1);
    assert.equal(tab.maxWidth, 72.3);
    // 좁은 화면·큰 글자에서도 최소 터치 폭 44 아래로는 줄지 않는다
    assert.equal(tab.minWidth, 44);
  }
});

test('가계부 책갈피가 44 를 지킬 폭이 없으면 제목표 아래 줄로 내려가고, 늘어난 높이만큼 책을 내린다(GROMO-2409)', async () => {
  townHallMock.mockResolvedValue(screenBody({}));
  const screen = await render(<Hall e={e()} />);
  await waitFor(() => assert.ok(screen.getByTestId('ledger-tab-잔액')));

  // 줄바꿈: 책갈피 묶음은 셋 × 44 + 사이 간격보다 좁아지지 않고, 자리가 없으면 다음 줄로 간다
  const heading = screen.getByTestId('ledger-heading');
  const headingStyle = StyleSheet.flatten(heading.props.style);
  assert.equal(headingStyle.flexWrap, 'wrap');
  // 줄은 아래(책갈피 아랫변)에 붙여 위로 쌓인다 — 두 줄이어도 책갈피는 책 위 같은 자리
  assert.equal(headingStyle.bottom, 0);
  const tabs = StyleSheet.flatten(screen.getByTestId('ledger-tabs').props.style);
  assert.equal(tabs.minWidth, 3 * 44 + 2 * 3.9);

  // 한 줄(높이 43.9 − 22 + 51.6)이면 책은 제자리, 두 줄로 접혀 제목표 높이만큼 늘면 그만큼 책을 내린다
  const bookTop = () => StyleSheet.flatten(screen.getByTestId('ledger-book').props.style).top;
  const single = 43.9 - 22 + 51.6;
  await fireEvent(heading, 'layout', { nativeEvent: { layout: { height: single } } });
  const base = bookTop();
  await fireEvent(heading, 'layout', { nativeEvent: { layout: { height: single + 44.3 } } });
  assert.ok(Math.abs(bookTop() - (base + 44.3)) < 1e-9);
});

test('spend 는 양수 amount 를 −로, earn 은 +로 그리고 reason 라벨·묶음 표시를 단다', async () => {
  ledgerMock.mockResolvedValue(
    page({
      items: [
        entry('s1', {
          direction: 'spend',
          reason: 'construction_debit',
          amount: 100,
          createdAt: '2026-09-10T03:00:00Z',
        }),
        entry('s2', {
          direction: 'spend',
          reason: 'shop_purchase',
          amount: 80,
          createdAt: '2026-09-14T03:00:00Z',
        }),
        // 잡지 홍보비(GROMO-2289) — 「기타」가 아니라 「잡지 홍보」
        entry('s3', {
          direction: 'spend',
          reason: 'promotion_fee',
          amount: 60,
          createdAt: '2026-09-15T03:00:00Z',
        }),
      ],
    }),
  );
  townHallMock.mockResolvedValue(
    screenBody({
      items: [
        entry('e1', { amount: 480, entryCount: 480 }),
        entry('e2', { reason: 'quest_settlement', amount: 15 }),
      ],
    }),
  );
  const screen = await render(<Hall e={e()} />);

  // 잔액 책갈피(무필터): reason 라벨과 접힌 줄의 entryCount 보조 표시
  await waitFor(() => assert.ok(screen.getByText('집중 적립')));
  assert.ok(screen.getByText('퀘스트 보상'));
  assert.ok(screen.getByText(/480회 적립/));
  assert.ok(screen.getByText('+480'));

  // 지출 책갈피: 양수 DTO 그대로 오고 화면에서만 −를 단다
  await fireEvent.press(screen.getByTestId('ledger-tab-지출'));
  await waitFor(() => assert.ok(screen.getByText('건설 사용')));
  assert.ok(screen.getByText('공동 구매'));
  assert.ok(screen.getByText('잡지 홍보'));
  assert.ok(screen.getByText('−100'));
  assert.ok(screen.getByText('−80'));
  // 거래 주체는 계약에 없다 — 주민 이름을 줄에 합성하지 않는다
  assert.equal(screen.queryByText(/민지|두부|수빈/), null);
  assert.equal(townHallMock.mock.calls.length, 1);
  assert.equal(ledgerMock.mock.calls.length, 1);
});

test('로딩·빈 달·실패 재시도·더 보기는 서로 다른 상태다', async () => {
  // 실패 → error + retry, retry 로 같은 scope 를 다시 읽는다
  townHallMock.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '네트워크', 0));
  const screen = await render(<Hall e={e()} />);
  await waitFor(() => assert.ok(screen.getByTestId('ledger-error')));
  assert.equal(screen.queryByTestId('ledger-empty'), null);

  townHallMock.mockResolvedValue(screenBody({ items: [] }));
  await fireEvent.press(screen.getByTestId('ledger-retry'));
  await waitFor(() => assert.ok(screen.getByTestId('ledger-empty')));
  assert.ok(screen.getByText('아직 쌓인 내역이 없어요'));
  assert.equal(townHallMock.mock.calls.length, 2);

  // 적립 탭: 서버가 다음 쪽 커서를 주면 더 보기가 나오고 같은 scope 로 잇는다
  ledgerMock.mockResolvedValue(page({ items: [entry('e1')], nextCursor: 'cur1', earnedTotal: 10 }));
  await fireEvent.press(screen.getByTestId('ledger-tab-적립'));
  await waitFor(() => assert.ok(screen.getByTestId('ledger-more')));

  ledgerMock.mockResolvedValue(page({ items: [entry('e2')], nextCursor: null }));
  await fireEvent.press(screen.getByTestId('ledger-more'));
  await waitFor(() => assert.equal(screen.queryByTestId('ledger-more'), null));
  assert.equal(ledgerMock.mock.calls[1][1].cursor, 'cur1');
  assert.equal(ledgerMock.mock.calls.length, 2);
});

test('리뷰·데모 모크 모드는 로컬 원장을 그리고 API 를 한 번도 부르지 않는다', async () => {
  // App.tsx 의 REVIEW/DEMO 와 같은 판정: web + ?review(또는 ?demo)
  const os = jest.replaceProperty(Platform, 'OS', 'web');
  (globalThis as any).window = { location: { search: '?review' } };
  try {
    const state = initialState(true);
    state.islands[0].ledger = [
      { id: 'l2', text: '도서관 공사 시작 −40마리', at: Date.now() },
      { id: 'l1', text: '수빈 · 집중 +12마리', at: Date.now() },
    ];
    const screen = await render(<Hall e={e(state)} />);

    // 로컬 원장의 제목이 그대로 보인다 — 서버 reason 라벨이 아니다
    assert.ok(screen.getByText('수빈 · 집중'));
    assert.ok(screen.getByText('도서관 공사 시작'));
    assert.equal(townHallMock.mock.calls.length, 0);
    assert.equal(ledgerMock.mock.calls.length, 0);
  } finally {
    os.restore();
    delete (globalThis as any).window;
  }
});

test('방문자는 조회도 장부 UI도 없다 — 빈 장부로 위장하지 않는다', async () => {
  const state = initialState(true);
  state.visitingIslandId = 'strawberry';
  const screen = await render(<Hall e={e(state)} />);

  assert.ok(screen.getByTestId('ledger-member-only'));
  assert.equal(townHallMock.mock.calls.length, 0);
  assert.equal(ledgerMock.mock.calls.length, 0);
  assert.equal(screen.queryByTestId('ledger-empty'), null);
  assert.equal(screen.queryByTestId('ledger-loading'), null);
});
