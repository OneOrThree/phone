import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { VisitorBoard } from '@/screens/island/VisitorBoard';
import { ApiError } from '@/services/api/client';
import { getBoard, getNotice, listNotices, createNoticeComment } from '@/services/api/notices';

jest.mock('@/services/api/notices', () => ({
  listNotices: jest.fn(),
  getNotice: jest.fn(),
  getBoard: jest.fn(),
  createNoticeComment: jest.fn(),
}));
jest.mock('@/screens/island/IslandSheet', () => ({
  IslandSheet: ({ children }: any) => {
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));
const list = listNotices as jest.Mock;
const detail = getNotice as jest.Mock;
beforeEach(() => jest.resetAllMocks());

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
