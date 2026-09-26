import { compareBoardNoticeSnapshots } from './useBoardHomeIndicator';

test('게시판 기준점 이후 새 공지와 댓글 증가를 구분한다', () => {
  const seen = { noticeA: 2, noticeB: 0 };
  expect(compareBoardNoticeSnapshots({ noticeA: 2, noticeB: 0 }, seen)).toBeNull();
  expect(compareBoardNoticeSnapshots({ noticeA: 2, noticeB: 0, noticeC: 0 }, seen)).toBe('unread');
  expect(compareBoardNoticeSnapshots({ noticeA: 3, noticeB: 0 }, seen)).toBe('new-comment');
});
