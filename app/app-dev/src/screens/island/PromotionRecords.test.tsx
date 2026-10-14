// 회관 홍보 기록판(GROMO-2289 · AD-11) — 날짜·호 · 상태 칩 · 칸 썸네일(꾸미기가 올 때만) · 넣음·도착·가입 숫자 · 상태 안내 ·
// 불러오는 중 · 빈 기록 · 실패와 다시 시도 · 주민이 아니게 됨. 서버 API(magazine.ts)는 목이다.
import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import * as api from '@/services/api/magazine';
import type { PromotionRecord } from '@/services/api/magazine';
import { currentIsland, initialState } from '@/services/model';
import { PromotionRecords } from './PromotionRecords';

jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  getPromotionRecords: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
const getRecords = api.getPromotionRecords as jest.Mock;

const record = (over: Partial<PromotionRecord> = {}): PromotionRecord => ({
  promotionId: 'p1',
  issueDate: '2026-10-15',
  issueNo: 20,
  body: '같이 아침 공부해요',
  status: 'PUBLISHED',
  pinned: 12,
  arrived: 4,
  joined: 1,
  layout: null,
  ...over,
});
const env = () => ({ state: initialState(true), back: jest.fn(), go: jest.fn() });

beforeEach(() => jest.clearAllMocks());

test('줄마다 날짜·호 · 상태 칩 · 글 · 숫자 — 한 줄이 스크린리더 요소 하나', async () => {
  getRecords.mockResolvedValueOnce([record()]);
  const e = env();
  const screen = await render(<PromotionRecords e={e} />);
  await screen.findByText('10월 15일 · 20호');
  expect(getRecords).toHaveBeenCalledWith(currentIsland(e.state).id);
  expect(screen.getByText('실림')).toBeTruthy();
  expect(screen.getByText('넣음 12 · 도착 4 · 가입 1')).toBeTruthy();
  expect(screen.getByTestId('promotion-record-p1').props.accessibilityLabel).toBe(
    '10월 15일 · 20호, 실림, ‘같이 아침 공부해요’, 망원경에 넣음 12명, 도착 4명, 가입 1명',
  );
  // 꾸미기가 어긋나 읽지 못했으면(layout null) 칸 썸네일 없이 글만
  expect(screen.queryByTestId('promotion-record-cell-p1')).toBeNull();
});

test('발행 전·안 실림은 셀 사람이 없어 숫자 없이 안내만 · 숨김·내려감도 안내', async () => {
  getRecords.mockResolvedValueOnce([
    record({ promotionId: 'a', issueNo: null, issueDate: '2026-10-16', status: 'SCHEDULED' }),
    record({ promotionId: 'b', status: 'SKIPPED', issueNo: null, pinned: 0 }),
    record({ promotionId: 'c', status: 'HIDDEN', pinned: 3, arrived: 0, joined: 0 }),
    record({ promotionId: 'd', status: 'REMOVED' }),
  ]);
  const screen = await render(<PromotionRecords e={env()} />);
  await screen.findByText('10월 16일 호');
  expect(screen.getByText('그날 아침 7시 잡지에 실려요.')).toBeTruthy();
  expect(screen.getByText('안 실림')).toBeTruthy();
  expect(screen.getByText('신고가 쌓여 숨겨졌어요. 운영팀이 확인하고 있어요.')).toBeTruthy();
  expect(screen.getByText('운영 정책에 맞지 않아 내려졌어요.')).toBeTruthy();
  // 숫자는 숨김(3)·내려감(12)에만
  expect(screen.getAllByText(/^넣음 /).map((n) => n.props.children)).toEqual([
    '넣음 3 · 도착 0 · 가입 0',
    '넣음 12 · 도착 4 · 가입 1',
  ]);
  expect(screen.getByTestId('promotion-record-b').props.accessibilityLabel).toBe(
    '10월 15일 호, 안 실림, ‘같이 아침 공부해요’, 섬이 비공개·닫힘이었거나 발행이 안 돼 이 호에는 실리지 않았어요.',
  );
});

test('꾸미기가 오면 우리 섬 칸 썸네일을 그린다', async () => {
  getRecords.mockResolvedValueOnce([
    record({ layout: { v: 1, frameId: 'mag.frame-ticket', stickers: [], tape: null } }),
  ]);
  const screen = await render(<PromotionRecords e={env()} />);
  const thumb = await screen.findByTestId('promotion-record-cell-p1');
  // 지금 섬 숫자는 실린 날 숫자와 달라 썸네일에서는 「주민·평균」 줄을 뺀다
  expect(within(thumb).queryByText(/주민 .* · /, { includeHiddenElements: true })).toBeNull();
});

test('불러오는 중 → 빈 기록', async () => {
  let resolve: (items: PromotionRecord[]) => void = () => {};
  getRecords.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const screen = await render(<PromotionRecords e={env()} />);
  expect(screen.getByText('기록을 불러오고 있어요')).toBeTruthy();
  resolve([]);
  expect(await screen.findByTestId('promotion-records-empty')).toHaveTextContent(
    '아직 잡지에 실은 홍보가 없어요.',
  );
});

test('실패하면 다시 시도로 다시 읽는다 · 주민이 아니게 됐으면 다시 시도 없이 안내', async () => {
  getRecords.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '오프라인', 0));
  const screen = await render(<PromotionRecords e={env()} />);
  expect(await screen.findByTestId('promotion-records-problem')).toHaveTextContent(
    '기록판을 불러오지 못했어요.',
  );
  getRecords.mockResolvedValueOnce([record()]);
  await fireEvent.press(screen.getByTestId('promotion-records-retry'));
  await screen.findByText('10월 15일 · 20호');
  expect(getRecords).toHaveBeenCalledTimes(2);

  getRecords.mockRejectedValueOnce(new ApiError('FORBIDDEN', '주민만', 403));
  const gone = await render(<PromotionRecords e={env()} />);
  await waitFor(() =>
    expect(gone.getByTestId('promotion-records-problem')).toHaveTextContent(
      '이 섬 주민만 볼 수 있어요.',
    ),
  );
  expect(gone.queryByTestId('promotion-records-retry')).toBeNull();
});

test('뒤로 가기', async () => {
  getRecords.mockResolvedValueOnce([]);
  const e = env();
  const screen = await render(<PromotionRecords e={e} />);
  await fireEvent.press(screen.getByLabelText('뒤로'));
  expect(e.back).toHaveBeenCalled();
});
