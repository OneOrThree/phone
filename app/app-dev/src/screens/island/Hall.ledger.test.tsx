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
  assert.ok(screen.getByText('이번 달 적립 +9,999 · 이번 달 사용 −150'));
  // 잔액 장: 물고기 + 잔액 + 단위
  expect(screen.getByTestId('ledger-balance')).toHaveTextContent('1,240');
  assert.ok(screen.getByText('마리'));
  expect(screen.queryByText(/ISLAND LEDGER/)).toBeNull();
  expect(screen.queryByText('우리 섬 물고기')).toBeNull();
  // 41 은 개인 fish 다 — 공동 잔액 자리에 개인 지갑이 새어 나오면 안 된다
  assert.equal(within(screen.getByTestId('ledger-book')).queryByText(/41/), null);
  assert.equal(townHallMock.mock.calls.length, 1);
  assert.equal(ledgerMock.mock.calls.length, 0);
});

// 402×874 시안 화면(안전영역 위 52): 책은 시안 높이 635.3 을 꽉 채우고 폭은 그림 비율로 줄어 가운데 온다
const SC = 635.3 / 1546;
const style = (node: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(node.props.style as any) ?? {}) as Record<string, any>;
// 그린 트리의 모든 하위 요소(글자 조각 제외)
const descendants = (node: any): any[] =>
  (node.children ?? []).flatMap((c: any) => (typeof c === 'string' ? [] : [c, ...descendants(c)]));

test('세 장짜리 책은 장부 그림 한 장이다 — 「공동 가계부」 팻말·옛 책 View·책갈피 SVG 가 없다(GROMO-2487)', async () => {
  townHallMock.mockResolvedValue(screenBody({}));
  const screen = await render(<Hall e={e()} />);
  await waitFor(() => assert.ok(screen.getByTestId('ledger-tab-잔액')));

  assert.equal(screen.queryByTestId('ledger-heading'), null);
  assert.equal(screen.queryByTestId('ledger-tabs'), null);
  assert.equal(screen.queryByText('공동 가계부'), null);
  // 코드로 그린 종이 겹(#f1e4c9)·초록 표지(#678268)·안쪽 종이(#fff3d8) View 가 남아 있지 않다
  const book = screen.getByTestId('ledger-book');
  const inside = descendants(book);
  const oldBook = inside.filter((n) =>
    ['#f1e4c9', '#678268', '#fff3d8'].includes(style(n).backgroundColor),
  );
  assert.equal(oldBook.length, 0);
  // 제비꼬리 책갈피 SVG 도 없다 — 포스트잇은 그림이다
  assert.equal(inside.filter((n) => /svg/i.test(String(n.type))).length, 0);

  // 그림은 비율 그대로: 폭 = 804 × 배율, 높이 = 635.3, 좌우 가운데
  const b = style(book);
  assert.ok(Math.abs(b.height - 635.3) < 1e-9);
  assert.ok(Math.abs(b.width - 804 * SC) < 1e-9);
  assert.ok(Math.abs(b.left - (402 - 804 * SC) / 2) < 1e-9);
  const art = screen.getByTestId('ledger-book-art');
  assert.equal(art.props.resizeMode, 'contain');
});

test('포스트잇 세 장은 모두 책 그림 앞 층이고, 펼친 장은 종이 윗변에·나머지는 제 색 단면에 걸친다(GROMO-2487)', async () => {
  townHallMock.mockResolvedValue(screenBody({}));
  const screen = await render(<Hall e={e()} />);
  await waitFor(() => assert.ok(screen.getByTestId('ledger-tab-잔액')));

  const artZ = style(screen.getByTestId('ledger-book-art')).zIndex;
  const tab = (label: string) => style(screen.getByTestId(`ledger-tab-${label}`));
  const labels = ['잔액', '적립', '지출'];
  for (const label of labels)
    assert.ok(tab(label).zIndex > artZ, `${label} 포스트잇이 책 뒤에 있다`);
  // 펼친 장이 맨 앞
  assert.ok(tab('잔액').zIndex > tab('적립').zIndex);
  assert.ok(tab('잔액').zIndex > tab('지출').zIndex);

  // 80 상자, 종이 왼쪽(60×배율) +4 부터 간격 2
  labels.forEach((label, n) => {
    const t = tab(label);
    assert.equal(t.width, 80);
    assert.equal(t.height, 80);
    assert.ok(Math.abs(t.left - (60 * SC + 4 + n * 82)) < 1e-9);
  });
  // 그림 아랫변(상자 위 0.94): 펼친 장은 단면 띠 바닥 147 +4, 나머지는 분홍 142·노랑 118·파랑 96 +6
  const artBottom = (label: string) => tab(label).top + 80 * 0.94;
  assert.ok(Math.abs(artBottom('잔액') - (147 * SC + 4)) < 1e-9);
  assert.ok(Math.abs(artBottom('적립') - (118 * SC + 6)) < 1e-9);
  assert.ok(Math.abs(artBottom('지출') - (96 * SC + 6)) < 1e-9);

  // 누르는 자리 84×84 = 상자 80 + 사방 2
  assert.equal(screen.getByTestId('ledger-tab-잔액').props.hitSlop, 2);

  // 적립 장을 펼치면 적립 포스트잇이 종이 윗변으로 내려오고 맨 앞이 된다. 분홍(잔액)은 제 단면으로 돌아간다
  ledgerMock.mockResolvedValue(page({}));
  await fireEvent.press(screen.getByTestId('ledger-tab-적립'));
  await waitFor(() => assert.ok(screen.getByTestId('ledger-total')));
  assert.ok(Math.abs(artBottom('적립') - (147 * SC + 4)) < 1e-9);
  assert.ok(Math.abs(artBottom('잔액') - (142 * SC + 6)) < 1e-9);
  assert.ok(tab('적립').zIndex > tab('잔액').zIndex);
  // 종이 틴트는 펼친 장 포스트잇 색(노랑)
  assert.equal(style(screen.getByTestId('ledger-tint')).backgroundColor, '#F1D77F');
});

test('포스트잇을 누르면 그 장이 펼쳐진다 — 잔액 → 적립 → 지출, 적립·지출 장은 그 방향 내역과 합계만(GROMO-2487)', async () => {
  townHallMock.mockResolvedValue(
    screenBody(
      {
        earnedTotal: 125,
        spentTotal: 60,
        items: [
          entry('e1', { amount: 34 }),
          entry('s1', { direction: 'spend', reason: 'construction_debit', amount: 60 }),
        ],
      },
      1240,
    ),
  );
  ledgerMock.mockImplementation((_island: string, { direction }: { direction?: string }) =>
    Promise.resolve(
      direction === 'earn'
        ? page({
            earnedTotal: 125,
            spentTotal: 60,
            items: [
              entry('e1', { amount: 34 }),
              entry('e2', { reason: 'quest_settlement', amount: 91 }),
            ],
          })
        : page({
            earnedTotal: 125,
            spentTotal: 60,
            items: [entry('s1', { direction: 'spend', reason: 'construction_debit', amount: 60 })],
          }),
    ),
  );
  const screen = await render(<Hall e={e()} />);
  const selected = (label: string) =>
    screen.getByTestId(`ledger-tab-${label}`).props.accessibilityState?.selected;

  // 잔액 장: 잔액 큰 숫자 + 합계 한 줄 + 최근 내역
  await waitFor(() => assert.ok(screen.getByTestId('ledger-balance')));
  for (const label of ['잔액', '적립', '지출']) {
    const tab = screen.getByTestId(`ledger-tab-${label}`);
    assert.equal(tab.props.accessibilityRole, 'tab');
    assert.equal(tab.props.accessibilityLabel, label);
  }
  assert.equal(selected('잔액'), true);
  assert.equal(selected('적립'), false);
  assert.equal(screen.queryByTestId('ledger-total'), null);

  // 적립 장: 「이번 달 적립」 + 적립 합계 + 적립 내역만
  await fireEvent.press(screen.getByTestId('ledger-tab-적립'));
  await waitFor(() => assert.ok(screen.getByText('퀘스트 보상')));
  assert.equal(ledgerMock.mock.calls.at(-1)[1].direction, 'earn');
  assert.equal(selected('적립'), true);
  assert.equal(selected('잔액'), false);
  assert.ok(screen.getByText('이번 달 적립'));
  expect(screen.getByTestId('ledger-total')).toHaveTextContent('+125');
  assert.equal(style(screen.getByTestId('ledger-total')).color, '#286856');
  assert.equal(screen.queryByTestId('ledger-balance'), null);
  assert.equal(screen.queryByText('건설 사용'), null);
  assert.ok(screen.getByTestId('ledger-amount-e2'));

  // 지출 장: 「이번 달 사용」 + 지출 합계 + 지출 내역만
  await fireEvent.press(screen.getByTestId('ledger-tab-지출'));
  await waitFor(() => assert.ok(screen.getByText('건설 사용')));
  assert.equal(ledgerMock.mock.calls.at(-1)[1].direction, 'spend');
  assert.equal(selected('지출'), true);
  assert.equal(selected('적립'), false);
  assert.ok(screen.getByText('이번 달 사용'));
  expect(screen.getByTestId('ledger-total')).toHaveTextContent('−60');
  assert.equal(style(screen.getByTestId('ledger-total')).color, '#994C3E');
  assert.equal(screen.queryByText('퀘스트 보상'), null);
  assert.equal(screen.queryByTestId('ledger-amount-e1'), null);
});

test('잔액·합계·거래 금액은 줄높이가 글자보다 커서 고운돋움 숫자 윗부분이 잘리지 않는다(GROMO-2487)', async () => {
  townHallMock.mockResolvedValue(
    screenBody({ earnedTotal: 34, items: [entry('e1', { amount: 1234567 })] }),
  );
  ledgerMock.mockResolvedValue(page({ earnedTotal: 34, items: [entry('e1', { amount: 34 })] }));
  const screen = await render(<Hall e={e()} />);
  await waitFor(() => assert.ok(screen.getByTestId('ledger-amount-e1')));

  const roomy = (testID: string) => {
    const node = screen.getByTestId(testID);
    const s = style(node);
    assert.ok(s.lineHeight > s.fontSize, `${testID}: 줄높이 ${s.lineHeight} ≤ 글자 ${s.fontSize}`);
    // 금액 글자를 품은 줄·종이가 overflow: hidden 으로 자르지 않는다(종이 스크롤 영역까지)
    for (let p = node.parent; p && p.props.testID !== 'ledger-page'; p = p.parent) {
      assert.notEqual(style(p).overflow, 'hidden', `${testID} 의 부모가 글자를 자른다`);
    }
  };
  roomy('ledger-balance');
  roomy('ledger-amount-e1');
  expect(screen.getByTestId('ledger-amount-e1')).toHaveTextContent('+1,234,567');

  await fireEvent.press(screen.getByTestId('ledger-tab-적립'));
  await waitFor(() => assert.ok(screen.getByTestId('ledger-total')));
  roomy('ledger-total');
  roomy('ledger-amount-e1');
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

  // 잔액 장(무필터): reason 라벨과 접힌 줄의 entryCount 보조 표시
  await waitFor(() => assert.ok(screen.getByText('집중 적립 · 480회')));
  assert.ok(screen.getByText('퀘스트 보상'));
  assert.ok(screen.getByText('+480'));

  // 지출 장: 양수 DTO 그대로 오고 화면에서만 −를 단다
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
