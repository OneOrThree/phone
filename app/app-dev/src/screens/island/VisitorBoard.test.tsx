import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { VisitorBoard } from '@/screens/island/VisitorBoard';
import { ApiError } from '@/services/api/client';
import { applyLocalePref } from '@/i18n';
import { getBoard, getNotice, listNotices, createNoticeComment } from '@/services/api/notices';
import { getGuestbook, writeGuestbook } from '@/services/api/islands';

jest.mock('@/services/api/notices', () => ({
  listNotices: jest.fn(),
  getNotice: jest.fn(),
  getBoard: jest.fn(),
  createNoticeComment: jest.fn(),
}));
jest.mock('@/services/api/islands', () => ({
  ...jest.requireActual('@/services/api/islands'),
  getGuestbook: jest.fn(),
  writeGuestbook: jest.fn(),
}));
jest.mock('@/screens/island/IslandSheet', () => ({
  IslandSheet: ({ children }: any) => {
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));
const list = listNotices as jest.Mock;
const detail = getNotice as jest.Mock;
const guestbook = getGuestbook as jest.Mock;
const write = writeGuestbook as jest.Mock;
beforeEach(() => {
  jest.resetAllMocks();
  // 방명록은 게시판이 없는 섬으로 두어(숨김) 아래 공지 테스트가 방명록 UI 에 흔들리지 않게 한다
  guestbook.mockResolvedValue({ boardBuilt: false, items: [] });
});
afterEach(() => applyLocalePref('system'));

test('방문 섬의 공지·댓글을 읽고 주민 화면 조회와 쓰기 API를 호출하지 않는다', async () => {
  list.mockResolvedValue({
    items: [{ id: 'n1', title: '방문 섬의 공지', commentCount: 1 }],
    nextCursor: null,
  });
  detail.mockResolvedValue({
    id: 'n1',
    title: '방문 섬의 공지',
    body: '공개 내용',
    version: 1,
    comments: [
      {
        id: 'c1',
        userId: 'u1',
        name: '주민',
        text: '공개 댓글',
        createdAt: '2026-10-08T00:00:00Z',
      },
    ],
    nextCommentsCursor: null,
  });
  const screen = await render(<VisitorBoard islandId="visitor" onClose={jest.fn()} />);
  await screen.findByText('방문 섬의 공지');
  expect(list).toHaveBeenCalledWith('visitor');
  await fireEvent.press(screen.getByText('방문 섬의 공지'));
  await screen.findByText('공개 댓글');
  expect(detail).toHaveBeenCalledWith('visitor', 'n1', undefined);
  assert.equal((getBoard as jest.Mock).mock.calls.length, 0);
  assert.equal((createNoticeComment as jest.Mock).mock.calls.length, 0);
  assert.equal(screen.queryByRole('textbox'), null);
});

test('방문자에게도 미완공 게시판은 잠금 안내를 표시한다', async () => {
  list.mockRejectedValue(new ApiError('FACILITY_LOCKED', 'internal', 403));
  const screen = await render(<VisitorBoard islandId="visitor" onClose={jest.fn()} />);
  await screen.findByText('게시판을 완공한 뒤 이용할 수 있어요.');
  assert.equal(screen.queryByText('아직 공지가 없어요.'), null);
});

test('시스템 뒤로가기도 상세에서 목록, 목록에서 방문 화면 순서로 돌아간다', async () => {
  list.mockResolvedValue({
    items: [{ id: 'n1', title: '공지', commentCount: 0 }],
    nextCursor: null,
  });
  detail.mockResolvedValue({
    id: 'n1',
    title: '공지',
    body: '본문',
    comments: [],
    nextCommentsCursor: null,
  });
  const onClose = jest.fn();
  const backOverride = { current: null as (() => boolean) | null };
  const screen = await render(
    <VisitorBoard islandId="visitor" onClose={onClose} backOverride={backOverride} />,
  );
  await fireEvent.press(await screen.findByText('공지'));
  await screen.findByText('본문');
  await act(async () => {
    backOverride.current?.();
  });
  expect(screen.queryByText('본문')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    backOverride.current?.();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  await screen.unmount();
  expect(backOverride.current).toBeNull();
});

test('게시판이 사라질 때 다른 화면이 건 뒤로 가기 처리는 걷어 내지 않는다', async () => {
  list.mockResolvedValue({ items: [], nextCursor: null });
  const backOverride = { current: null as (() => boolean) | null };
  const screen = await render(
    <VisitorBoard islandId="visitor" onClose={jest.fn()} backOverride={backOverride} />,
  );
  expect(typeof backOverride.current).toBe('function');
  const other = () => true;
  backOverride.current = other; // 다른 화면이 자기 처리를 걸었다
  await screen.unmount();
  expect(backOverride.current).toBe(other);
});

test('다른 방문 섬으로 바뀌면 이전 섬의 늦은 공지 응답을 버린다', async () => {
  let finish!: (value: unknown) => void;
  list
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({
      items: [{ id: 'b1', title: 'B 섬 공지', commentCount: 0 }],
      nextCursor: null,
    });
  const screen = await render(<VisitorBoard islandId="a" onClose={jest.fn()} />);
  await screen.rerender(<VisitorBoard islandId="b" onClose={jest.fn()} />);
  await screen.findByText('B 섬 공지');
  await act(async () =>
    finish({ items: [{ id: 'a1', title: 'A 섬 공지', commentCount: 0 }], nextCursor: null }),
  );
  assert.equal(screen.queryByText('A 섬 공지'), null);
});

const firstPage = {
  items: [{ id: 'n1', title: '첫 공지', commentCount: 1 }],
  nextCursor: 'notice-next',
};
const firstDetail = {
  id: 'n1',
  title: '첫 공지',
  body: '상세 본문',
  version: 1,
  comments: [
    { id: 'c1', userId: 'u1', name: '주민', text: '첫 댓글', createdAt: '2026-10-09T00:00:00Z' },
  ],
  nextCommentsCursor: 'comment-next',
};

test('공지 상세 실패는 목록으로 돌아가지 않고 같은 상세를 재시도한다', async () => {
  list.mockResolvedValue(firstPage);
  detail
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'lost', 0))
    .mockResolvedValue(firstDetail);
  const screen = await render(<VisitorBoard islandId="visitor" onClose={jest.fn()} />);
  await fireEvent.press(await screen.findByText('첫 공지'));
  await fireEvent.press(await screen.findByText('다시 불러오기'));
  await screen.findByText('상세 본문');
  assert.equal(list.mock.calls.length, 1);
  expect(detail.mock.calls).toEqual([
    ['visitor', 'n1', undefined],
    ['visitor', 'n1', undefined],
  ]);
});

test('댓글 다음 페이지 실패는 기존 댓글을 유지하고 같은 커서로 재시도한다', async () => {
  list.mockResolvedValue(firstPage);
  detail
    .mockResolvedValueOnce(firstDetail)
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'lost', 0))
    .mockResolvedValueOnce({
      ...firstDetail,
      comments: [{ ...firstDetail.comments[0], id: 'c2', text: '다음 댓글' }],
      nextCommentsCursor: null,
    });
  const screen = await render(<VisitorBoard islandId="visitor" onClose={jest.fn()} />);
  await fireEvent.press(await screen.findByText('첫 공지'));
  await fireEvent.press(await screen.findByText('댓글 더 보기'));
  const retry = await screen.findByText('다시 불러오기');
  assert.ok(screen.getByText('첫 댓글'));
  await fireEvent.press(retry);
  await screen.findByText('다음 댓글');
  assert.ok(screen.getByText('첫 댓글'));
  assert.equal(list.mock.calls.length, 1);
  expect(detail.mock.calls.slice(1)).toEqual([
    ['visitor', 'n1', 'comment-next'],
    ['visitor', 'n1', 'comment-next'],
  ]);
});

test('공지 다음 페이지 실패는 기존 목록을 유지하고 같은 커서로 재시도한다', async () => {
  list
    .mockResolvedValueOnce(firstPage)
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'lost', 0))
    .mockResolvedValueOnce({
      items: [{ id: 'n2', title: '다음 공지', commentCount: 0 }],
      nextCursor: null,
    });
  const screen = await render(<VisitorBoard islandId="visitor" onClose={jest.fn()} />);
  await fireEvent.press(await screen.findByText('공지 더 보기'));
  const retry = await screen.findByText('다시 불러오기');
  assert.ok(screen.getByText('첫 공지'));
  await fireEvent.press(retry);
  await screen.findByText('다음 공지');
  assert.ok(screen.getByText('첫 공지'));
  expect(list.mock.calls.slice(1)).toEqual([
    ['visitor', 'notice-next'],
    ['visitor', 'notice-next'],
  ]);
});

test('영어 방문 게시판에서 읽기 안내·댓글 수·페이지 버튼·떠난 주민을 번역한다', async () => {
  applyLocalePref('en');
  list.mockResolvedValue({
    ...firstPage,
    items: [...firstPage.items, { id: 'n2', title: '두 번째 공지', commentCount: 2 }],
  });
  detail.mockResolvedValue({
    ...firstDetail,
    comments: [{ ...firstDetail.comments[0], name: null }],
  });
  const screen = await render(<VisitorBoard islandId="visitor" onClose={jest.fn()} />);
  await screen.findByText('1 comment');
  screen.getByText('2 comments');
  screen.getByText('Visitors can read notices and comments. Only residents can post.');
  screen.getByText('More Notices');
  await fireEvent.press(screen.getByText('첫 공지'));
  await screen.findByText('Former resident');
  screen.getByText('More Comments');
});

test('영어 방문 게시판에서 조회 오류를 재시도하면 빈 상태를 번역한다', async () => {
  applyLocalePref('en');
  list
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '연결 실패', 0))
    .mockResolvedValue({ items: [], nextCursor: null });
  const screen = await render(<VisitorBoard islandId="visitor" onClose={jest.fn()} />);
  await screen.findByText("Can't connect to the network. Please check your connection.");
  await fireEvent.press(screen.getByText('Reload'));
  await screen.findByText('No notices yet.');
  expect(screen.queryByText('아직 공지가 없어요.')).toBeNull();
});

const gbEntry = {
  id: 'g1',
  authorId: 'u2',
  authorName: '수아',
  content: '놀러 왔어요',
  createdAt: '2026-10-12T01:00:00Z',
  mine: false,
};

test('공지 목록 아래에 방명록이 있고 방문자도 쓸 수 있지만 지우기·신고는 없다(GROMO-2263)', async () => {
  list.mockResolvedValue({
    items: [{ id: 'n1', title: '공지', commentCount: 0 }],
    nextCursor: null,
  });
  guestbook.mockResolvedValue({ boardBuilt: true, items: [gbEntry] });
  const screen = await render(<VisitorBoard islandId="visitor" onClose={jest.fn()} />);
  await screen.findByText('놀러 왔어요');
  expect(guestbook).toHaveBeenCalledWith('visitor');
  expect(screen.getByText('방명록')).toBeTruthy();
  expect(screen.queryByText('지우기')).toBeNull();
  expect(screen.queryByText('신고')).toBeNull();

  write.mockResolvedValue({ ...gbEntry, id: 'g2', content: '안녕하세요', mine: true });
  await fireEvent.changeText(screen.getByTestId('field-한마디 남기기'), '안녕하세요');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await screen.findByText('안녕하세요');
  expect(write).toHaveBeenCalledWith('visitor', '안녕하세요');
  // 공지 쓰기·댓글 API 는 여전히 0회
  assert.equal((createNoticeComment as jest.Mock).mock.calls.length, 0);
});

test('게시판이 없는 섬의 방문 게시판에는 방명록이 안 보인다', async () => {
  list.mockResolvedValue({
    items: [{ id: 'n1', title: '공지', commentCount: 0 }],
    nextCursor: null,
  });
  const screen = await render(<VisitorBoard islandId="visitor" onClose={jest.fn()} />);
  await screen.findByText('공지');
  await waitFor(() => expect(guestbook).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('불러오고 있어요.')).toBeNull());
  expect(screen.queryByText('방명록')).toBeNull();
  assert.equal(screen.queryByRole('textbox'), null);
});

test('공지 상세를 열면 방명록은 접히고 목록으로 돌아오면 다시 보인다', async () => {
  list.mockResolvedValue({
    items: [{ id: 'n1', title: '공지', commentCount: 0 }],
    nextCursor: null,
  });
  detail.mockResolvedValue({
    id: 'n1',
    title: '공지',
    body: '본문',
    comments: [],
    nextCommentsCursor: null,
  });
  guestbook.mockResolvedValue({ boardBuilt: true, items: [gbEntry] });
  const backOverride = { current: null as (() => boolean) | null };
  const screen = await render(
    <VisitorBoard islandId="visitor" onClose={jest.fn()} backOverride={backOverride} />,
  );
  await screen.findByText('놀러 왔어요');
  await fireEvent.press(screen.getByText('공지'));
  await screen.findByText('본문');
  expect(screen.queryByText('방명록')).toBeNull();
  await act(async () => {
    backOverride.current?.();
  });
  await screen.findByText('놀러 왔어요');
});

test('방명록의 쓰기 거절 안내는 앱 셸 알림(e.notify)으로 나간다', async () => {
  list.mockResolvedValue({ items: [], nextCursor: null });
  guestbook.mockResolvedValue({ boardBuilt: true, items: [] });
  const e = { notify: jest.fn() };
  const screen = await render(<VisitorBoard islandId="visitor" onClose={jest.fn()} e={e} />);
  await screen.findByTestId('guestbook-submit');
  // 전환 시트가 없는 셸에서 게스트 거절 — 토스트로 알리는 오류(다시 눌러도 같은 거절인 409·403 은 칸 아래 안내로 남는다)
  write.mockRejectedValue(new ApiError('SOCIAL_LOGIN_REQUIRED', 'x', 403));
  await fireEvent.changeText(screen.getByTestId('field-한마디 남기기'), '또 왔어요');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await waitFor(() => expect(e.notify).toHaveBeenCalledWith('소셜 로그인하면 이용할 수 있어요.'));
});
