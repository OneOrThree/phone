// 고양이 잡지 펼치기(GROMO-2289 · A1~A4) — 첫 장 편집부(메달·NEW·편집냥) · 다음 장부터 3칸씩 · 끝 쪽 근처에서 다음 커서 ·
// 섬에서 펼치면 망원경 동그라미 없음(우리 섬 배지만) · 펼치면 읽음 받음 · 빈 호 · 섬장 끝 쪽 쓰기 입구 · 7호 밖 · 크게 보기.
// 서버 API(magazine.ts)는 목이다.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import * as api from '@/services/api/magazine';
import type { MagazineCell, MagazineIssuePage } from '@/services/api/magazine';
import { initialState } from '@/services/model';
import { FlatList, StyleSheet } from 'react-native';
import { MagazineReader, magazinePages, readerGeometry } from './MagazineReader';
import { resetMagazineToday } from './useMagazineToday';

jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  getMagazineIssue: jest.fn(),
  putMagazineReceipt: jest.fn(),
  reportPromotion: jest.fn(),
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

const issue = {
  issueId: 'iss-19',
  issueNo: 19,
  issueDate: '2026-10-14',
  publishedAt: '2026-10-13T22:00:00Z',
  current: true,
};
const island = (name: string, relation: MagazineCell['relation'] = 'NONE') => ({
  islandId: `is-${name}`,
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

test('가로처럼 낮은 화면에서도 지면(칸 3개)이 쪽 넘김 줄보다 위에서 끝난다', () => {
  for (const [width, height] of [
    [874, 402],
    [667, 375],
    [402, 874],
    [320, 568],
  ]) {
    const g = readerGeometry({ width, height, insets: { top: 0, bottom: 0, left: 0, right: 0 } });
    expect(g.contentBottom).toBeLessThanOrEqual(g.navTop);
    // 칸 3개 + 사이 간격이 지면 안에 들어간다
    expect(g.cellW * 3 * (199 / 338) + 16).toBeLessThanOrEqual(g.innerH + 0.01);
  }
});

test('섬장에게만 끝 쪽 「우리 섬 홍보 쓰기」 — 누르면 쓰기 화면', async () => {
  const { screen, e } = await open(page(), env(), true);
  expect(screen.getByText('1 / 4')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('magazine-write'));
  expect(e.go).toHaveBeenCalledWith('promotionEditor');

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

// 지금 열린 맨 위 Modal 이 iOS 에서 «다 닫혔다» 고 알릴 함수 — 테스트 렌더러는 닫힌 Modal 을 바로 지우므로 열려 있을 때 잡아 둔다
const topModalDismiss = (screen: Awaited<ReturnType<typeof render>>): (() => void) =>
  screen.container.queryAll((node) => node.type === 'Modal').at(-1)!.props.onDismiss;

describe('신고(SAFE-04)', () => {
  test('칸을 길게 누르면 신고 시트 — 사유를 골라 보내면 닫히고 알림, 칸은 다음에 읽을 때까지 그대로', async () => {
    report.mockResolvedValueOnce({ created: true });
    const notify = jest.fn();
    const { screen } = await open(page(), env({ notify }));
    await fireEvent(screen.getByLabelText(/^섬2섬,/), 'longPress');
    expect(screen.getByText('홍보 칸 신고하기')).toBeTruthy();
    expect(screen.getByText(/섬2섬 홍보 칸을 신고하는 이유/)).toBeTruthy();
    // 유저 신고 창과 같은 사유 8종
    expect(screen.getByLabelText('개인정보·사칭')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('스팸·사기'));
    await fireEvent.press(screen.getByTestId('magazine-report-submit'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('신고했어요. 운영팀이 살펴볼게요.'));
    expect(report).toHaveBeenCalledWith('is-섬2', 'p2', 'SPAM_FRAUD');
    expect(screen.queryByTestId('magazine-report')).toBeNull();
    expect(screen.getByTestId('magazine-cell-p2')).toBeTruthy();
  });

  test('이미 신고한 칸(서버 200)은 「이미 신고」 안내', async () => {
    report.mockResolvedValueOnce({ created: false });
    const notify = jest.fn();
    const { screen } = await open(page(), env({ notify }));
    await fireEvent(screen.getByLabelText(/^섬2섬,/), 'longPress');
    await fireEvent.press(screen.getByTestId('magazine-report-submit'));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('이미 신고한 칸이에요. 운영팀이 살펴보고 있어요.'),
    );
    expect(report).toHaveBeenCalledWith('is-섬2', 'p2', 'HARASSMENT');
  });

  test('스크린리더는 칸의 「신고하기」 동작으로 연다 · 취소하면 닫힌다', async () => {
    const { screen } = await open();
    await fireEvent(screen.getByLabelText(/^섬4섬,/), 'accessibilityAction', {
      nativeEvent: { actionName: 'report' },
    });
    expect(screen.getByTestId('magazine-report')).toBeTruthy();
    await fireEvent.press(screen.getByText('취소'));
    expect(screen.queryByTestId('magazine-report')).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  test('크게 보기에서 길게 누르면 크게 보기를 닫고, 다 닫힌 뒤(iOS onDismiss) 신고 시트', async () => {
    const { screen } = await open();
    await fireEvent.press(screen.getByTestId('magazine-cell-p2'));
    const zoomDismissed = topModalDismiss(screen);
    const zoomed = screen.getAllByLabelText(/^섬2섬,/);
    await fireEvent(zoomed[zoomed.length - 1], 'longPress');
    expect(screen.queryByTestId('magazine-zoom')).toBeNull();
    // 닫히는 중에는 아직 열지 않는다 — iOS 는 Modal 이 닫히는 중에 다른 Modal 을 띄우면 실패한다
    expect(screen.queryByTestId('magazine-report')).toBeNull();
    await act(async () => zoomDismissed());
    expect(screen.getByTestId('magazine-report')).toBeTruthy();
    expect(screen.getByText(/섬2섬 홍보 칸을 신고하는 이유/)).toBeTruthy();
  });

  test('게스트(403) — 회원 전환 시트를 열 수 있으면 열고 닫는다, 없으면 시트 안에 안내', async () => {
    const gate = new ApiError('SOCIAL_LOGIN_REQUIRED', '소셜', 403);
    report.mockRejectedValueOnce(gate);
    const offer = jest.fn(() => true);
    const { screen } = await open(page(), env({ conversion: { offer } }));
    await fireEvent(screen.getByLabelText(/^섬2섬,/), 'longPress');
    const sheetDismissed = topModalDismiss(screen);
    await fireEvent.press(screen.getByTestId('magazine-report-submit'));
    // 시트를 먼저 닫고, 다 닫힌 뒤(iOS onDismiss) 회원 전환 시트를 연다
    await waitFor(() => expect(screen.queryByTestId('magazine-report')).toBeNull());
    expect(offer).not.toHaveBeenCalled();
    await act(async () => sheetDismissed());
    expect(offer).toHaveBeenCalledWith(gate);

    report.mockRejectedValueOnce(gate);
    const mock = await open();
    await fireEvent(mock.screen.getByLabelText(/^섬2섬,/), 'longPress');
    await fireEvent.press(mock.screen.getByTestId('magazine-report-submit'));
    await waitFor(() =>
      expect(mock.screen.getByTestId('magazine-report-error')).toHaveTextContent(
        '소셜 로그인하면 신고할 수 있어요.',
      ),
    );
  });

  test('그 밖의 실패는 시트에 남아 다시 보낼 수 있다', async () => {
    report.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '오프라인', 0));
    const { screen } = await open();
    await fireEvent(screen.getByLabelText(/^섬2섬,/), 'longPress');
    await fireEvent.press(screen.getByTestId('magazine-report-submit'));
    await waitFor(() => expect(screen.getByTestId('magazine-report-error')).toBeTruthy());
    expect(screen.getByTestId('magazine-report')).toBeTruthy();
  });
});

test('magazinePages — 커서가 남아 있으면 빈 장·끝 장을 아직 붙이지 않는다', () => {
  const loaded = { issue, editorial: null, cells: [], nextCursor: 'c' };
  expect(magazinePages(loaded, true)).toEqual([]);
  expect(magazinePages({ ...loaded, nextCursor: null }, true).map((p) => p.kind)).toEqual([
    'empty',
    'end',
  ]);
});
