// 고양이 잡지 펼치기(GROMO-2289 · A1~A4) — 첫 장 편집부(메달·NEW·편집냥) · 다음 장부터 3칸씩 · 끝 쪽 근처에서 다음 커서 ·
// 섬에서 펼치면 망원경 동그라미 없음(우리 섬 배지만) · 펼치면 읽음 받음 · 빈 호 · 섬장 끝 쪽 쓰기 입구 · 7호 밖 · 크게 보기.
// 서버 API(magazine.ts)는 목이다.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import * as api from '@/services/api/magazine';
import type { MagazineCell, MagazineIssuePage } from '@/services/api/magazine';
import { initialState } from '@/services/model';
import { MagazineReader, magazinePages } from './MagazineReader';
import { resetMagazineToday } from './useMagazineToday';

jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  getMagazineIssue: jest.fn(),
  putMagazineReceipt: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
const getIssue = api.getMagazineIssue as jest.Mock;
const putReceipt = api.putMagazineReceipt as jest.Mock;

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

test('magazinePages — 커서가 남아 있으면 빈 장·끝 장을 아직 붙이지 않는다', () => {
  const loaded = { issue, editorial: null, cells: [], nextCursor: 'c' };
  expect(magazinePages(loaded, true)).toEqual([]);
  expect(magazinePages({ ...loaded, nextCursor: null }, true).map((p) => p.kind)).toEqual([
    'empty',
    'end',
  ]);
});
