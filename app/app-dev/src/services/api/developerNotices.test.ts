import { request } from './client';
import { getDeveloperNotice, listDeveloperNotices } from './developerNotices';

jest.mock('./client', () => ({ request: jest.fn() }));

test('공지 목록은 게스트를 차단하는 별도 조건 없이 공개 인증 API로 읽는다', async () => {
  (request as jest.Mock).mockResolvedValueOnce({ items: [] });
  expect(await listDeveloperNotices()).toEqual({ items: [] });
  expect(request).toHaveBeenLastCalledWith('/me/developer-notices');
});

test('상세 식별자를 경로 인자로 인코딩하고 서버 오류는 호출자에게 전달한다', async () => {
  const error = new Error('not found');
  (request as jest.Mock).mockRejectedValueOnce(error);
  await expect(getDeveloperNotice('id/with?query')).rejects.toBe(error);
  expect(request).toHaveBeenLastCalledWith('/me/developer-notices/id%2Fwith%3Fquery');
});
