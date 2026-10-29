import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DeveloperNoticesScreen } from './DeveloperNoticesScreen';
import { getDeveloperNotice, listDeveloperNotices } from '@/services/api/developerNotices';
import { ApiError } from '@/services/api/client';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: 1,
    compact: false,
    tablet: false,
    modalWidth: 340,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));
jest.mock('@/services/api/developerNotices', () => ({
  getDeveloperNotice: jest.fn(),
  listDeveloperNotices: jest.fn(),
}));
jest.mock('@/services/api/session', () => {
  let generation = 1;
  const listeners = new Set<() => void>();
  return {
    sessionGeneration: () => generation,
    subscribeSession: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => {
      generation = 1;
    },
    changeAccount: () => {
      generation += 1;
      listeners.forEach((listener) => listener());
    },
    getSession: () => null,
  };
});
const mockSession = jest.requireMock('@/services/api/session');
const item = {
  publicationId: 'notice-1',
  title: '업데이트 안내',
  body: '<b>평문 본문</b>\n둘째 줄',
  startsAt: '2026-10-01T00:00:00Z',
  endsAt: null,
  publishedAt: '2026-10-01T00:00:00Z',
};
const events = (route = 'developerNotices') => ({
  route,
  detail: item.publicationId,
  islands: {},
  back: jest.fn(),
  home: jest.fn(),
  go: jest.fn(),
});

beforeEach(() => {
  jest.resetAllMocks();
  mockSession.reset();
});

test('목록 로딩·빈 상태와 실패 뒤 재시도를 구분한다', async () => {
  (listDeveloperNotices as jest.Mock)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [] });
  const screen = await render(<DeveloperNoticesScreen e={events()} />);
  await waitFor(() =>
    expect(screen.getByText('공지를 불러오지 못했어요. 다시 시도해 주세요.')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText('다시 시도'));
  await waitFor(() => expect(screen.getByText('게시된 공지가 없어요.')).toBeTruthy());
});

test('목록에서 상세를 열고 평문 본문을 표시한다', async () => {
  (listDeveloperNotices as jest.Mock).mockResolvedValue({ items: [item] });
  const e = events();
  const screen = await render(<DeveloperNoticesScreen e={e} />);
  await waitFor(() => expect(screen.getByText(item.title)).toBeTruthy());
  await fireEvent.press(screen.getByText(item.title));
  expect(e.go).toHaveBeenCalledWith('developerNotice', item.publicationId);
  (getDeveloperNotice as jest.Mock).mockResolvedValue(item);
  await screen.rerender(<DeveloperNoticesScreen e={events('developerNotice')} />);
  await waitFor(() => expect(screen.getByText(item.body)).toBeTruthy());
  expect(getDeveloperNotice).toHaveBeenCalledWith(item.publicationId);
});

test('상세 404는 게시 종료 안내로 표시한다', async () => {
  (getDeveloperNotice as jest.Mock).mockRejectedValue(new ApiError('NOT_FOUND', 'gone', 404));
  const screen = await render(<DeveloperNoticesScreen e={events('developerNotice')} />);
  await waitFor(() =>
    expect(screen.getByText('게시가 종료되었거나 찾을 수 없는 공지예요.')).toBeTruthy(),
  );
});

test('계정 전환 후 이전 계정의 늦은 목록 응답을 폐기한다', async () => {
  let finish!: (value: unknown) => void;
  (listDeveloperNotices as jest.Mock)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValueOnce({ items: [] });
  const screen = await render(<DeveloperNoticesScreen e={events()} />);
  expect(screen.getByText('공지를 불러오는 중…')).toBeTruthy();
  await act(async () => {
    mockSession.changeAccount();
  });
  await waitFor(() => expect(screen.getByText('게시된 공지가 없어요.')).toBeTruthy());
  await act(async () => {
    finish({ items: [item] });
  });
  expect(screen.queryByText(item.title)).toBeNull();
});
