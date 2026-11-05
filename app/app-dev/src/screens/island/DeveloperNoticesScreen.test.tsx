import { createPreviewEnvironment } from '@/navigation/previewEnvironment';
import { ApiError } from '@/services/api/client';
import { getDeveloperNotice, listDeveloperNotices } from '@/services/api/developerNotices';
import type { Route } from '@/services/model';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DeveloperNoticesScreen } from './DeveloperNoticesScreen';

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
const events = (route: Route = 'developerNotices') => ({
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
  const screen = await render(<DeveloperNoticesScreen e={createPreviewEnvironment(events())} />);
  await waitFor(() =>
    expect(screen.getByText('공지를 불러오지 못했어요. 다시 시도해 주세요.')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText('다시 시도'));
  await waitFor(() => expect(screen.getByText('게시된 공지가 없어요.')).toBeTruthy());
});

test('목록에서 상세를 열고 평문 본문을 표시한다', async () => {
  (listDeveloperNotices as jest.Mock).mockResolvedValue({ items: [item] });
  const e = events();
  const screen = await render(<DeveloperNoticesScreen e={createPreviewEnvironment(e)} />);
  await waitFor(() => expect(screen.getByText(item.title)).toBeTruthy());
  await fireEvent.press(screen.getByText(item.title));
  expect(e.go).toHaveBeenCalledWith('developerNotice', item.publicationId);
  (getDeveloperNotice as jest.Mock).mockResolvedValue(item);
  await screen.rerender(
    <DeveloperNoticesScreen e={createPreviewEnvironment(events('developerNotice'))} />,
  );
  await waitFor(() => expect(screen.getByText(item.body)).toBeTruthy());
  expect(getDeveloperNotice).toHaveBeenCalledWith(item.publicationId);
});

test('상세 404는 게시 종료 안내로 표시한다', async () => {
  (getDeveloperNotice as jest.Mock).mockRejectedValue(new ApiError('NOT_FOUND', 'gone', 404));
  const screen = await render(
    <DeveloperNoticesScreen e={createPreviewEnvironment(events('developerNotice'))} />,
  );
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
  const screen = await render(<DeveloperNoticesScreen e={createPreviewEnvironment(events())} />);
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

const second = { ...item, publicationId: 'notice-2', title: '둘째 쪽 공지' };

test('nextCursor 가 있으면 더 보기로 다음 쪽을 이어 붙이고, 마지막 쪽에서 버튼이 사라진다', async () => {
  (listDeveloperNotices as jest.Mock)
    .mockResolvedValueOnce({ items: [item], nextCursor: 'c1' })
    .mockResolvedValueOnce({ items: [second], nextCursor: null });
  const screen = await render(<DeveloperNoticesScreen e={createPreviewEnvironment(events())} />);
  await waitFor(() => expect(screen.getByText('더 보기')).toBeTruthy());
  await fireEvent.press(screen.getByText('더 보기'));
  await waitFor(() => expect(screen.getByText(second.title)).toBeTruthy());
  expect(listDeveloperNotices).toHaveBeenLastCalledWith('c1');
  expect(screen.getByText(item.title)).toBeTruthy();
  expect(screen.queryByText('더 보기')).toBeNull();
});

test('nextCursor 가 없는 응답(옛 서버)에는 더 보기가 없다', async () => {
  (listDeveloperNotices as jest.Mock).mockResolvedValue({ items: [item] });
  const screen = await render(<DeveloperNoticesScreen e={createPreviewEnvironment(events())} />);
  await waitFor(() => expect(screen.getByText(item.title)).toBeTruthy());
  expect(screen.queryByText('더 보기')).toBeNull();
});

test('CURSOR_EXPIRED 면 목록을 처음부터 다시 읽는다', async () => {
  (listDeveloperNotices as jest.Mock)
    .mockResolvedValueOnce({ items: [item], nextCursor: 'old' })
    .mockRejectedValueOnce(new ApiError('CURSOR_EXPIRED', 'expired', 409))
    .mockResolvedValueOnce({ items: [second], nextCursor: null });
  const screen = await render(<DeveloperNoticesScreen e={createPreviewEnvironment(events())} />);
  await waitFor(() => expect(screen.getByText('더 보기')).toBeTruthy());
  await fireEvent.press(screen.getByText('더 보기'));
  await waitFor(() => expect(screen.getByText(second.title)).toBeTruthy());
  expect(listDeveloperNotices).toHaveBeenCalledTimes(3);
  expect(listDeveloperNotices).toHaveBeenLastCalledWith();
  expect(screen.queryByText(item.title)).toBeNull();
});

test('그 밖의 더 보기 실패는 불러온 목록을 두고 같은 커서로 다시 누르게 한다', async () => {
  (listDeveloperNotices as jest.Mock)
    .mockResolvedValueOnce({ items: [item], nextCursor: 'c1' })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [second], nextCursor: null });
  const screen = await render(<DeveloperNoticesScreen e={createPreviewEnvironment(events())} />);
  await waitFor(() => expect(screen.getByText('더 보기')).toBeTruthy());
  await fireEvent.press(screen.getByText('더 보기'));
  await waitFor(() => expect(listDeveloperNotices).toHaveBeenCalledTimes(2));
  expect(screen.getByText(item.title)).toBeTruthy();
  await fireEvent.press(screen.getByText('더 보기'));
  await waitFor(() => expect(screen.getByText(second.title)).toBeTruthy());
  expect(listDeveloperNotices).toHaveBeenNthCalledWith(2, 'c1');
  expect(listDeveloperNotices).toHaveBeenNthCalledWith(3, 'c1');
});

test('더 보기를 연달아 두 번 눌러도 같은 커서 요청은 한 번만 나간다', async () => {
  let finish!: (value: unknown) => void;
  (listDeveloperNotices as jest.Mock)
    .mockResolvedValueOnce({ items: [item], nextCursor: 'c1' })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
  const screen = await render(<DeveloperNoticesScreen e={createPreviewEnvironment(events())} />);
  await waitFor(() => expect(screen.getByText('더 보기')).toBeTruthy());
  // 재렌더 전에 같은 렌더의 핸들러를 두 번 — loadingMore 상태가 아직 낡아 있는 순간을 흉내 낸다.
  // fireEvent.press 를 겹쳐 부르면 act 가 겹쳐 경고가 나므로 RN 이 테스트용으로 여는 Pressable 설정에서 onPress 를 꺼낸다
  const { onPress } = screen
    .getByRole('button', { name: '더 보기' })
    .props.onStartShouldSetResponder.testOnly_pressabilityConfig();
  await act(async () => {
    onPress();
    onPress();
  });
  expect(listDeveloperNotices).toHaveBeenCalledTimes(2);
  expect(listDeveloperNotices).toHaveBeenLastCalledWith('c1');
  await act(async () => {
    finish({ items: [second], nextCursor: null });
  });
  await waitFor(() => expect(screen.getByText(second.title)).toBeTruthy());
});

test('더 보기가 늦는 사이 목록이 다시 시작되면 낡은 쪽은 붙지 않고 새 커서로 이어진다', async () => {
  let finishStale!: (value: unknown) => void;
  (listDeveloperNotices as jest.Mock)
    .mockResolvedValueOnce({ items: [item], nextCursor: 'c1' })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishStale = resolve;
      }),
    )
    .mockResolvedValueOnce({ items: [item], nextCursor: 'c2' })
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  const screen = await render(<DeveloperNoticesScreen e={createPreviewEnvironment(events())} />);
  await waitFor(() => expect(screen.getByText('더 보기')).toBeTruthy());
  await fireEvent.press(screen.getByText('더 보기'));
  expect(listDeveloperNotices).toHaveBeenLastCalledWith('c1');
  // 계정 전환으로 효과가 다시 돌아 새 첫 쪽(nextCursor c2)을 읽는다
  await act(async () => {
    mockSession.changeAccount();
  });
  await waitFor(() => expect(screen.getByText('더 보기')).toBeTruthy());
  // 낡은 «더 보기» 응답이 뒤늦게 도착
  await act(async () => {
    finishStale({ items: [second], nextCursor: 'stale' });
  });
  expect(screen.queryByText(second.title)).toBeNull();
  expect(screen.getByText(item.title)).toBeTruthy();
  await fireEvent.press(screen.getByText('더 보기'));
  expect(listDeveloperNotices).toHaveBeenLastCalledWith('c2');
});

test('더 보기 요청 중에는 버튼이 비활성이고 다시 눌러도 요청이 늘지 않는다', async () => {
  (listDeveloperNotices as jest.Mock)
    .mockResolvedValueOnce({ items: [item], nextCursor: 'c1' })
    .mockReturnValueOnce(new Promise(() => {}));
  const screen = await render(<DeveloperNoticesScreen e={createPreviewEnvironment(events())} />);
  await waitFor(() => expect(screen.getByText('더 보기')).toBeTruthy());
  await fireEvent.press(screen.getByText('더 보기'));
  expect(screen.getByRole('button', { name: '더 보기' }).props.accessibilityState.disabled).toBe(
    true,
  );
  await fireEvent.press(screen.getByText('더 보기'));
  expect(listDeveloperNotices).toHaveBeenCalledTimes(2);
});
