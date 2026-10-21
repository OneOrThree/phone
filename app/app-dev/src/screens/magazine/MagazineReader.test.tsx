// 고양이 잡지 펼치기(GROMO-2289 · A1~A4) — 첫 장 편집부(메달·NEW·편집냥) · 다음 장부터 3칸씩 · 끝 쪽 근처에서 다음 커서 ·
// 섬에서 펼치면 망원경 동그라미 없음(우리 섬 배지만) · 펼치면 읽음 받음 · 빈 호 · 섬장 끝 쪽 안내(쓰기는 마을회관) · 7호 밖 · 크게 보기.
// 서버 API(magazine.ts)는 목이다.
import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { applyLocalePref } from '@/i18n';
import { ApiError } from '@/services/api/client';
import * as api from '@/services/api/magazine';
import { pinToTelescope } from '@/services/api/telescope';
import type { MagazineCell, MagazineIssuePage } from '@/services/api/magazine';
import { initialState } from '@/services/model';
import { FlatList, StyleSheet } from 'react-native';
import { MagazineReader, issueBleed, magazinePages, readerGeometry } from './MagazineReader';
import { resetMagazineToday } from './useMagazineToday';

jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  getMagazineIssue: jest.fn(),
  putMagazineReceipt: jest.fn(),
  reportPromotion: jest.fn(),
  getMagazineIssues: jest.fn(),
}));
jest.mock('@/services/api/telescope', () => ({
  ...jest.requireActual('@/services/api/telescope'),
  pinToTelescope: jest.fn(),
}));
// 화면 크기·글자 배율만 바꿔 끼운다(회전·큰 글자)
let mockScreen: { width?: number; height?: number; fontScale?: number } = {};
jest.mock('@/utils/layout', () => {
  const actual = jest.requireActual('@/utils/layout');
  return { useAppLayout: () => ({ ...actual.useAppLayout(), fontScale: 1, ...mockScreen }) };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
const getIssue = api.getMagazineIssue as jest.Mock;
const putReceipt = api.putMagazineReceipt as jest.Mock;
const report = api.reportPromotion as jest.Mock;
const pin = pinToTelescope as jest.Mock;

const issue = {
  issueId: 'iss-19',
  issueNo: 19,
  issueDate: '2026-10-14',
  publishedAt: '2026-10-13T22:00:00Z',
  current: true,
};
const island = (name: string, relation: MagazineCell['relation'] = 'NONE') => ({
  islandId: `is-${name}`,
  privateIsland: false,
  name,
  buildingCount: 3,
  memberCount: 4,
  maxMembers: 15,
  averageFocusMinutesPerDay: 125,
  relation,
});
const cell = (n: number, relation: MagazineCell['relation'] = 'NONE'): MagazineCell => ({
  ...island(`섬${n}`, relation),
  promotionId: `p${n}`,
  body: `홍보 ${n}`,
  layout: { v: 1, frameId: 'mag.frame-scallop', stickers: [], tape: null },
});
const page = (over: Partial<MagazineIssuePage> = {}): MagazineIssuePage => ({
  issue,
  editorial: {
    ranking: [
      { ...island('별고래섬'), rank: 1 },
      { ...island('소다', 'MEMBER'), rank: 2 },
      { ...island('조약돌섬'), rank: 3 },
    ],
    newIslands: [island('달빛')],
    note: { type: 'TIP', body: null, tipNo: 0 },
  },
  cells: [cell(1, 'MEMBER'), cell(2), cell(3, 'KICKED'), cell(4)],
  nextCursor: null,
  ...over,
});
const env = (over: object = {}) => ({
  state: initialState(true),
  detail: 'iss-19',
  back: jest.fn(),
  go: jest.fn(),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetMagazineToday();
  putReceipt.mockResolvedValue({
    place: 'ISLAND',
    receivedAt: 'a',
    deferredAt: null,
    openedAt: 'b',
  });
});

async function open(
  first: MagazineIssuePage = page(),
  e = env(),
  host = false,
  ...more: MagazineIssuePage[]
) {
  getIssue.mockResolvedValueOnce(first);
  more.forEach((next) => getIssue.mockResolvedValueOnce(next));
  const screen = await render(<MagazineReader e={e} host={host} />);
  await waitFor(() => expect(screen.getByTestId('magazine-pages')).toBeTruthy());
  return { screen, e };
}

test('첫 장은 편집부 — 표지 띠(날짜·호) · 1~3위 메달 · 어제 새 섬 · 편집냥의 조언(팁)', async () => {
  const { screen } = await open();
  expect(getIssue).toHaveBeenCalledWith('iss-19');
  expect(screen.getByText('10월 14일 · 19호')).toBeTruthy();
  expect(screen.getByText('이번 주 랭킹')).toBeTruthy();
  expect(screen.getByLabelText('1위 별고래섬, 평균 2시간 5분')).toBeTruthy();
  expect(screen.getByTestId('magazine-rank-3')).toBeTruthy();
  expect(screen.getByText('달빛섬')).toBeTruthy();
  expect(screen.getByText('편집냥의 조언')).toBeTruthy();
  expect(screen.getByText('25분 집중하고 5분 쉬면 오래 가요. 오늘도 한 칸씩!')).toBeTruthy();
  expect(screen.getByText('1 / 3')).toBeTruthy();
});

test('운영 문구가 있는 날은 편집부 소식 · 랭킹·새 섬이 비면 빈 문구', async () => {
  const { screen } = await open(
    page({
      editorial: {
        ranking: [],
        newIslands: [],
        note: { type: 'EDITOR', body: '이번 주말 바다 축제!', tipNo: null },
      },
      cells: [],
    }),
  );
  expect(screen.getByText('편집부 소식')).toBeTruthy();
  expect(screen.getByText('이번 주말 바다 축제!')).toBeTruthy();
  expect(screen.getByText('이번 주 순위는 아직 없어요')).toBeTruthy();
  expect(screen.getByText('어제는 새 섬이 없었어요')).toBeTruthy();
  // 칸이 하나도 없으면 편집부 다음 장에 「오늘은 실린 홍보가 없어요」
  expect(screen.getByTestId('magazine-empty')).toBeTruthy();
  expect(screen.getByText('오늘은 실린 홍보가 없어요')).toBeTruthy();
});

test('다음 장부터 3칸씩 — 섬에서 펼친 잡지는 망원경 동그라미 없이 우리 섬 칸에만 배지', async () => {
  const { screen } = await open();
  const cells = screen.getAllByTestId('magazine-cells');
  expect(cells).toHaveLength(2);
  // 첫 칸 위에 꾸미기가 걸치는 둘레만큼 비운다(지면 위 끝에서 잘리지 않게)
  expect(StyleSheet.flatten(cells[0].props.style).paddingTop).toBeGreaterThan(0);
  const hidden = { includeHiddenElements: true };
  expect(screen.getByTestId('magazine-cell-p1-ours', hidden)).toBeTruthy();
  expect(screen.queryByTestId('magazine-cell-p2-ours', hidden)).toBeNull();
  // 강퇴된 섬(KICKED)·남의 섬 어디에도 동그라미가 없다
  expect(screen.queryAllByTestId(/-scope$/, hidden)).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('magazine-next'));
  expect(screen.getByText('2 / 3')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('magazine-prev'));
  expect(screen.getByText('1 / 3')).toBeTruthy();
});

test('펼치면 그 호에 읽음 받음(ISLAND)을 보낸다', async () => {
  await open();
  await waitFor(() =>
    expect(putReceipt).toHaveBeenCalledWith('iss-19', { place: 'ISLAND', opened: true }),
  );
});

test('끝 쪽 근처에 오면 다음 커서를 읽어 칸을 붙인다', async () => {
  const { screen } = await open(
    page({ cells: [cell(1), cell(2), cell(3)], nextCursor: 'c1' }),
    env(),
    false,
    page({ editorial: null, cells: [cell(4)], nextCursor: null }),
  );
  // 편집부 · 3칸 두 쪽뿐이라 이미 끝 쪽 앞이다 — 바로 다음 페이지를 읽는다
  await waitFor(() => expect(getIssue).toHaveBeenCalledWith('iss-19', 'c1'));
  await waitFor(() => expect(screen.getAllByTestId('magazine-cells')).toHaveLength(2));
  expect(screen.getByTestId('magazine-cell-p4')).toBeTruthy();
  expect(getIssue).toHaveBeenCalledTimes(2);
});

test('이어 읽기가 실패하면 같은 쪽에서는 다시 부르지 않고, 쪽을 넘기면 다시 시도한다', async () => {
  getIssue
    .mockResolvedValueOnce(page({ cells: [cell(1), cell(2), cell(3)], nextCursor: 'c1' }))
    .mockRejectedValueOnce(new ApiError('NETWORK', '오프라인', 0));
  const screen = await render(<MagazineReader e={env()} />);
  await waitFor(() => expect(getIssue).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(getIssue).toHaveBeenCalledTimes(2);
  getIssue.mockResolvedValueOnce(page({ editorial: null, cells: [cell(4)], nextCursor: null }));
  await fireEvent.press(screen.getByTestId('magazine-next'));
  await waitFor(() => expect(screen.getByTestId('magazine-cell-p4')).toBeTruthy());
  expect(getIssue).toHaveBeenCalledTimes(3);
});

test('끝 쪽에서 이어 읽기가 실패하면 쪽 번호 자리에 「더 불러오지 못했어요 · 다시」 — 누르면 다시 읽는다', async () => {
  getIssue
    .mockResolvedValueOnce(page({ cells: [cell(1), cell(2), cell(3)], nextCursor: 'c1' }))
    .mockRejectedValueOnce(new ApiError('NETWORK', '오프라인', 0))
    .mockResolvedValueOnce(page({ editorial: null, cells: [cell(4)], nextCursor: null }));
  const screen = await render(<MagazineReader e={env()} />);
  await waitFor(() => expect(screen.getByTestId('magazine-more-retry')).toBeTruthy());
  expect(screen.getByText('더 불러오지 못했어요 · 다시')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('magazine-more-retry'));
  await waitFor(() => expect(screen.getByTestId('magazine-cell-p4')).toBeTruthy());
  expect(screen.queryByTestId('magazine-more-retry')).toBeNull();
});

test('이어 읽는 중에는 쪽 번호를 「N쪽 넘게 중」으로 읽는다', async () => {
  getIssue
    .mockResolvedValueOnce(page({ cells: [cell(1), cell(2), cell(3)], nextCursor: 'c1' }))
    .mockReturnValueOnce(new Promise(() => {})); // 다음 칸은 아직 오는 중
  const screen = await render(<MagazineReader e={env()} />);
  await waitFor(() => expect(screen.getByText('1 / 2+')).toBeTruthy());
  await waitFor(() => expect(getIssue).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('magazine-page').props.accessibilityLabel).toBe('2쪽 넘게 중 1쪽');
});

test('큰 글자에서는 편집부 섬 줄의 숫자(평균·주민)를 이름 아래로 내린다', async () => {
  const lineOf = (screen: any) =>
    StyleSheet.flatten(screen.getByTestId('magazine-rank-1').props.children[2].props.style)
      .flexDirection;
  const normal = await open();
  expect(lineOf(normal.screen)).toBe('row');
  await normal.screen.unmount();
  mockScreen = { fontScale: 1.6 };
  try {
    const large = await open();
    expect(lineOf(large.screen)).toBe('column');
  } finally {
    mockScreen = {};
  }
});

test('회전으로 쪽 폭이 바뀌면 보던 쪽 위치로 다시 맞춘다', async () => {
  const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset');
  try {
    mockScreen = { width: 402, height: 874 };
    const { screen } = await open();
    await fireEvent.press(screen.getByTestId('magazine-next'));
    scroll.mockClear();
    mockScreen = { width: 874, height: 402 };
    await screen.rerender(<MagazineReader e={env()} />);
    const { innerW } = readerGeometry({
      width: 874,
      height: 402,
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    expect(scroll).toHaveBeenCalledWith({ offset: innerW, animated: false });
  } finally {
    mockScreen = {};
    scroll.mockRestore();
  }
});

test('가로처럼 낮은 화면에서도 지면(칸 3개 + 꾸미기가 걸치는 둘레)이 쪽 넘김 줄보다 위에서 끝난다', () => {
  for (const [width, height] of [
    [874, 402],
    [667, 375],
    [402, 874],
    [320, 568],
  ]) {
    const g = readerGeometry({ width, height, insets: { top: 0, bottom: 0, left: 0, right: 0 } });
    const cellH = g.cellW * (199 / 338);
    expect(g.contentBottom).toBeLessThanOrEqual(g.navTop);
    // 칸 둘레 8% 는 지면(가로로 넘기는 목록 — 그 밖은 잘린다) 안: 첫 칸 위 여백 · 칸 3개 · 사이 간격 · 마지막 칸 아래 둘레 · 좌우
    expect(g.cellPad).toBeCloseTo(0.08 * cellH, 5);
    expect(g.cellPad + cellH * 3 + 16 + 0.08 * cellH).toBeLessThanOrEqual(g.innerH + 0.01);
    expect(g.cellW * 1.16).toBeLessThanOrEqual(g.innerW + 0.01);
  }
});

test('섬장에게만 끝 쪽 「우리 섬도 실어 볼까요?」 — 쓰기 버튼 없이 마을회관에서 쓴다는 안내만(10/14)', async () => {
  const { screen, e } = await open(page(), env(), true);
  expect(screen.getByText('1 / 4')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('magazine-next'));
  await fireEvent.press(screen.getByTestId('magazine-next'));
  await fireEvent.press(screen.getByTestId('magazine-next'));
  expect(screen.getByText('4 / 4')).toBeTruthy();
  expect(screen.getByTestId('magazine-end')).toBeTruthy();
  expect(screen.getByText('우리 섬도 실어 볼까요?')).toBeTruthy();
  expect(
    screen.getByText(
      '홍보는 마을회관에서 쓸 수 있어요. 아침 7시부터 자정까지 신청하면 다음 날 아침 호에 실려요',
    ),
  ).toBeTruthy();
  expect(screen.queryByTestId('magazine-write')).toBeNull();
  expect(e.go).not.toHaveBeenCalled();

  const member = await open();
  expect(member.screen.queryByTestId('magazine-end')).toBeNull();
});

test('7호보다 오래된 호는 「이 호는 이제 볼 수 없어요」 · 닫기', async () => {
  getIssue.mockRejectedValueOnce(new ApiError('MAGAZINE_ISSUE_NOT_FOUND', '없음', 404));
  const e = env({ detail: 'old' });
  const screen = await render(<MagazineReader e={e} />);
  await waitFor(() => expect(screen.getByText('이 호는 이제 볼 수 없어요')).toBeTruthy());
  await fireEvent.press(screen.getByText('확인'));
  expect(e.back).toHaveBeenCalled();
  expect(putReceipt).not.toHaveBeenCalled();
});

test('다른 오류는 다시 시도로 다시 읽는다', async () => {
  getIssue.mockRejectedValueOnce(new ApiError('NETWORK', '오프라인', 0));
  const screen = await render(<MagazineReader e={env()} />);
  await waitFor(() => expect(screen.getByText('잡지를 펼치지 못했어요')).toBeTruthy());
  getIssue.mockResolvedValueOnce(page());
  await fireEvent.press(screen.getByTestId('magazine-retry'));
  await waitFor(() => expect(screen.getByTestId('magazine-pages')).toBeTruthy());
});

test('칸을 누르면 화면 폭으로 크게 보고, 누르면 닫힌다 · 닫기 버튼은 뒤로', async () => {
  const { screen, e } = await open();
  await fireEvent.press(screen.getByTestId('magazine-cell-p2'));
  expect(screen.getByTestId('magazine-zoom')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('magazine-zoom'));
  expect(screen.queryByTestId('magazine-zoom')).toBeNull();
  await fireEvent.press(screen.getByTestId('magazine-close'));
  expect(e.back).toHaveBeenCalled();
});

test('잡지 일반·확대 보기에는 길게 누르기나 접근성 신고 진입이 없고 확대는 유지한다', async () => {
  const { screen } = await open();
  const target = screen.getByLabelText(/^섬2섬,/);
  expect(target.props.onLongPress).toBeUndefined();
  expect(target.props.accessibilityActions).toBeUndefined();
  await fireEvent(target, 'longPress');
  expect(screen.queryByTestId('magazine-report')).toBeNull();
  await fireEvent.press(target);
  const zoomed = within(screen.getByTestId('magazine-zoom')).getByLabelText(/^섬2섬,/);
  expect(zoomed.props.onLongPress).toBeUndefined();
  expect(zoomed.props.accessibilityActions).toBeUndefined();
  expect(screen.getByTestId('magazine-zoom')).toBeTruthy();
  expect(report).not.toHaveBeenCalled();
});

test('magazinePages — 커서가 남아 있으면 빈 장·끝 장을 아직 붙이지 않는다', () => {
  const loaded = { issue, editorial: null, cells: [], nextCursor: 'c' };
  expect(magazinePages(loaded, true)).toEqual([]);
  expect(magazinePages({ ...loaded, nextCursor: null }, true).map((p) => p.kind)).toEqual([
    'empty',
    'end',
  ]);
});

describe('en 로케일', () => {
  const mockLocales = jest.requireMock('expo-localization').getLocales as jest.Mock;
  afterEach(() => {
    mockLocales.mockReturnValue([{ languageCode: 'ko', languageTag: 'ko-KR' }]);
    applyLocalePref('system');
  });

  // 섬 이름·홍보 글은 사용자 데이터라 번역하지 않는다 — 전수 한글 검사가 이름을 걸러내지 않게 영문 픽스처로 본다
  test('en — 표지·편집부·칸에 한글이 없고 날짜는 영문 형식이다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const layout = { v: 1 as const, frameId: 'mag.frame-scallop', stickers: [], tape: null };
    const { screen } = await open(
      page({
        editorial: {
          ranking: [
            { ...island('Whale'), rank: 1 },
            { ...island('Soda', 'MEMBER'), rank: 2 },
            { ...island('Pebble'), rank: 3 },
          ],
          newIslands: [island('Moon')],
          note: { type: 'TIP', body: null, tipNo: 0 },
        },
        cells: [
          { ...island('Soda', 'MEMBER'), promotionId: 'p1', body: 'Come focus with us', layout },
          { ...island('Wave'), promotionId: 'p2', body: 'Study together at night', layout },
        ],
      }),
    );
    expect(screen.getByText('October 14 · No. 19')).toBeTruthy();
    const noHangul = () => {
      expect(screen.queryByText(/[가-힣]/)).toBeNull();
      expect(screen.queryByLabelText(/[가-힣]/)).toBeNull();
    };
    noHangul();
    await fireEvent.press(screen.getByLabelText(/^Wave Island,/));
    expect(screen.getByTestId('magazine-zoom')).toBeTruthy();
    noHangul();
  });
});

test('지면은 이 호 칸들이 실제로 걸치는 만큼 비운다 — 위 테두리 테이프가 첫 칸 위에서 잘리지 않게', () => {
  const L = { width: 402, height: 874, insets: { top: 0, bottom: 0, left: 0, right: 0 } };
  const taped = {
    layout: {
      v: 1 as const,
      frameId: 'mag.frame-scallop',
      stickers: [],
      tape: { assetId: 'mag.tape-pink', x: 0.5, y: 0, rotation: 4 },
    },
  };
  const plain = readerGeometry(L, issueBleed([]));
  const wide = readerGeometry(L, issueBleed([taped]));
  expect(issueBleed([]).y).toBe(0.08);
  expect(wide.cellPad / ((wide.cellW * 199) / 338)).toBeGreaterThan(0.1);
  expect(wide.cellW).toBeLessThan(plain.cellW);
  // 아주 크게 걸친 꾸미기도 칸이 너무 작아지지 않게 상한이 있다
  const huge = {
    layout: {
      ...taped.layout,
      tape: null,
      stickers: [{ assetId: 'mag.heart', x: 0.5, y: -0.08, scale: 0.6, rotation: 45 }],
    },
  };
  expect(issueBleed([huge]).y).toBeLessThanOrEqual(0.3);
});

test('비공개 편집부 랭킹·새 섬에 초대 안내를 표시하고 랭킹 접근성 이름에도 넣는다', async () => {
  const first = page();
  first.editorial!.ranking[0].privateIsland = true;
  first.editorial!.newIslands[0].privateIsland = true;
  const { screen } = await open(first);
  expect(screen.getAllByText(/초대로만 갈 수 있는 섬/)).toHaveLength(2);
  expect(
    screen.getByLabelText('1위 별고래섬, 평균 2시간 5분, 초대로만 갈 수 있는 섬'),
  ).toBeTruthy();
});

describe('바다에서 펼친 잡지(GROMO-2314 · A2)', () => {
  const hidden = { includeHiddenElements: true };
  const seaEnv = () => ({ ...env(), notify: jest.fn(), replace: jest.fn() });
  async function openSea(first: MagazineIssuePage, e = seaEnv()) {
    getIssue.mockResolvedValueOnce(first);
    const screen = await render(<MagazineReader e={e} place="SEA" />);
    await waitFor(() => expect(screen.getByTestId('magazine-pages')).toBeTruthy());
    return { screen, e };
  }
  const cellsOnly = (cells: MagazineCell[]) => page({ editorial: null, cells });
  afterEach(() => expect(api.getMagazineIssues).not.toHaveBeenCalled());

  test('읽음 받음은 SEA 로 적고, 칸 자리는 우리 섬 = 배지 · 남의 섬 = 망원경 동그라미 · 옛 서버의 강퇴(KICKED) 칸 = 없음', async () => {
    const { screen } = await openSea(cellsOnly([cell(1, 'MEMBER'), cell(2), cell(3, 'KICKED')]));
    await waitFor(() =>
      expect(putReceipt).toHaveBeenCalledWith('iss-19', { place: 'SEA', opened: true }),
    );
    expect(screen.getByTestId('magazine-cell-p1-ours', hidden)).toBeTruthy();
    expect(screen.queryByTestId('magazine-cell-p1-scope', hidden)).toBeNull();
    expect(screen.getByTestId('magazine-cell-p2-scope', hidden)).toBeTruthy();
    expect(screen.queryByTestId('magazine-cell-p3-scope', hidden)).toBeNull();
    expect(screen.queryByTestId('magazine-cell-p3-ours', hidden)).toBeNull();
  });

  test('비공개 섬 칸에는 동그라미가 없다', async () => {
    const { screen } = await openSea(cellsOnly([{ ...cell(1), privateIsland: true }]));
    expect(screen.queryAllByTestId(/-scope$/, hidden)).toHaveLength(0);
  });

  test('동그라미 → 망원경에 넣고(source magazine · 홍보 id) 잡지 자리를 망원경으로 바꾼다', async () => {
    pin.mockResolvedValue({ item: {}, evicted: null });
    const { screen, e } = await openSea(cellsOnly([cell(2)]));
    await fireEvent.press(screen.getByTestId('magazine-cell-p2-scope'));
    expect(pin).toHaveBeenCalledWith('is-섬2', 'magazine', 'p2');
    expect(e.replace).toHaveBeenCalledWith('telescope');
    expect(e.go).not.toHaveBeenCalled();
    expect(e.notify).not.toHaveBeenCalled();
  });

  test('가득 차 빠진 섬이 있으면 토스트 하나로 알린다(섬 이름은 「…섬」)', async () => {
    pin.mockResolvedValue({ item: {}, evicted: { islandId: 'old', name: '옛' } });
    const { screen, e } = await openSea(cellsOnly([cell(2)]));
    await fireEvent.press(screen.getByTestId('magazine-cell-p2-scope'));
    expect(e.notify).toHaveBeenCalledTimes(1);
    expect(e.notify).toHaveBeenCalledWith('옛섬이 망원경에서 빠져요');
    expect(e.replace).toHaveBeenCalledWith('telescope');
  });

  test('요청 중 다시 눌러도 한 번만 넣는다', async () => {
    let done!: (v: unknown) => void;
    pin.mockReturnValue(new Promise((resolve) => (done = resolve)));
    const { screen, e } = await openSea(cellsOnly([cell(2)]));
    await fireEvent.press(screen.getByTestId('magazine-cell-p2-scope'));
    await fireEvent.press(screen.getByTestId('magazine-cell-p2-scope'));
    expect(pin).toHaveBeenCalledTimes(1);
    await act(async () => done({ item: {}, evicted: null }));
    expect(e.replace).toHaveBeenCalledTimes(1);
  });

  test('넣는 중에 잡지를 닫으면 망원경으로 옮기지 않지만, 빠진 섬 토스트는 그대로 알린다', async () => {
    let done!: (v: unknown) => void;
    pin.mockReturnValue(new Promise((resolve) => (done = resolve)));
    const { screen, e } = await openSea(cellsOnly([cell(2)]));
    await fireEvent.press(screen.getByTestId('magazine-cell-p2-scope'));
    await screen.unmount();
    await act(async () => done({ item: {}, evicted: { islandId: 'old', name: '옛' } }));
    expect(e.notify).toHaveBeenCalledWith('옛섬이 망원경에서 빠져요');
    expect(e.replace).not.toHaveBeenCalled();
  });

  test.each([
    ['FORBIDDEN', 403, '이 섬에는 넣을 수 없어요'],
    ['STATE_CONFLICT', 409, '이미 내가 속한 섬이에요'],
  ])('넣기 거절(%s)은 기존 문구로 알리고 잡지에 머문다', async (code, status, message) => {
    pin.mockRejectedValue(new ApiError(code, '', status));
    const { screen, e } = await openSea(cellsOnly([cell(2)]));
    await fireEvent.press(screen.getByTestId('magazine-cell-p2-scope'));
    expect(e.notify).toHaveBeenCalledWith(message);
    expect(e.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('magazine-reader')).toBeTruthy();
  });
});
