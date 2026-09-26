import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { getBoard, listNotices } from '@/services/api/notices';
import {
  boardNoticeSnapshot,
  compareBoardNoticeSnapshots,
  useBoardHomeIndicator,
} from './useBoardHomeIndicator';

jest.mock('@/services/api/notices', () => ({
  getBoard: jest.fn(),
  listNotices: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (getBoard as jest.Mock).mockReset();
  (listNotices as jest.Mock).mockReset();
});

test('게시판 기준점 이후 새 공지와 댓글 증가를 구분한다', () => {
  const seen = { noticeA: 2, noticeB: 0 };
  expect(compareBoardNoticeSnapshots({ noticeA: 2, noticeB: 0 }, seen)).toBeNull();
  expect(compareBoardNoticeSnapshots({ noticeA: 2, noticeB: 0, noticeC: 0 }, seen)).toBe('unread');
  expect(compareBoardNoticeSnapshots({ noticeA: 3, noticeB: 0 }, seen)).toBe('new-comment');
});

test('게시판 기준점은 커서가 있는 모든 공지 페이지의 댓글 수를 포함한다', async () => {
  (listNotices as jest.Mock).mockResolvedValueOnce({
    items: [{ id: 'noticeB', title: '오래된 공지', commentCount: 2 }],
    nextCursor: null,
  });
  const board = {
    island: {
      id: 'island-1',
      name: '섬',
      intro: '',
      visibility: 'public',
      approvalRequired: false,
      memberCount: 1,
      maxMembers: 15,
      membershipStatus: 'active',
      growthStage: null,
      themeId: null,
      role: 'host',
      version: 1,
    },
    notices: {
      items: [{ id: 'noticeA', title: '최근 공지', commentCount: 0 }],
      nextCursor: 'cursor-1',
    },
  } as Awaited<ReturnType<typeof import('@/services/api/notices').getBoard>>;

  await expect(boardNoticeSnapshot(board)).resolves.toEqual({ noticeA: 0, noticeB: 2 });
  expect(listNotices).toHaveBeenCalledWith('island-1', 'cursor-1');
});

test('홈이 foreground로 돌아오면 게시판 상태를 다시 조회한다', async () => {
  const board = {
    island: {
      id: 'island-1',
      name: '섬',
      intro: '',
      visibility: 'public',
      approvalRequired: false,
      memberCount: 1,
      maxMembers: 15,
      membershipStatus: 'active',
      growthStage: null,
      themeId: null,
      role: 'host',
      version: 1,
    },
    notices: { items: [], nextCursor: null },
    quests: { items: [] },
    wallets: { fish: 0, villagePoints: 0, fishVersion: null, villagePointsVersion: 0 },
  } as Awaited<ReturnType<typeof getBoard>>;
  (getBoard as jest.Mock).mockResolvedValue(board);
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({}));
  const listeners: ((state: string) => void)[] = [];
  const addListener = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    listener: (state: string) => void,
  ) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  }) as never);
  const hook = await renderHook(() =>
    useBoardHomeIndicator({
      active: true,
      ownerId: 'user-1',
      islandId: 'island-1',
      markRead: false,
    }),
  );

  await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(1));
  await act(async () => listeners[0]('active'));
  await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(2));

  await hook.unmount();
  addListener.mockRestore();
});

test('공지 화면에서 foreground 복귀만으로 읽음 기준점을 올리지 않는다', async () => {
  const board = {
    island: {
      id: 'island-1',
      name: '섬',
      intro: '',
      visibility: 'public',
      approvalRequired: false,
      memberCount: 1,
      maxMembers: 15,
      membershipStatus: 'active',
      growthStage: null,
      themeId: null,
      role: 'host',
      version: 1,
    },
    notices: { items: [], nextCursor: null },
    quests: { items: [] },
    wallets: { fish: 0, villagePoints: 0, fishVersion: null, villagePointsVersion: 0 },
  } as Awaited<ReturnType<typeof getBoard>>;
  (getBoard as jest.Mock).mockResolvedValue(board);
  const addListener = jest.spyOn(AppState, 'addEventListener');
  await renderHook(() =>
    useBoardHomeIndicator({
      active: true,
      ownerId: 'user-1',
      islandId: 'island-1',
      markRead: true,
    }),
  );

  await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(1));
  expect(addListener).not.toHaveBeenCalled();
  addListener.mockRestore();
});

test('foreground 재조회 실패 시 같은 섬의 기존 미확인 배지를 유지한다', async () => {
  const board = {
    island: {
      id: 'island-1',
      name: '섬',
      intro: '',
      visibility: 'public',
      approvalRequired: false,
      memberCount: 1,
      maxMembers: 15,
      membershipStatus: 'active',
      growthStage: null,
      themeId: null,
      role: 'host',
      version: 1,
    },
    notices: {
      items: [{ id: 'notice-new', title: '새 소식', commentCount: 0 }],
      nextCursor: null,
    },
    quests: { items: [] },
    wallets: { fish: 0, villagePoints: 0, fishVersion: null, villagePointsVersion: 0 },
  } as Awaited<ReturnType<typeof getBoard>>;
  (getBoard as jest.Mock).mockResolvedValueOnce(board);
  (getBoard as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({}));
  const listeners: ((state: string) => void)[] = [];
  const addListener = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    listener: (state: string) => void,
  ) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  }) as never);
  const hook = await renderHook(() =>
    useBoardHomeIndicator({
      active: true,
      ownerId: 'user-1',
      islandId: 'island-1',
      markRead: false,
    }),
  );

  await waitFor(() => expect(hook.result.current).toBe('unread'));
  await act(async () => listeners[0]('active'));
  await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(2));
  expect(hook.result.current).toBe('unread');

  await hook.unmount();
  addListener.mockRestore();
});

test('비활성 경로를 다녀온 뒤 재조회가 실패해도 같은 섬의 배지를 유지한다', async () => {
  const board = {
    island: {
      id: 'island-1',
      name: '섬',
      intro: '',
      visibility: 'public',
      approvalRequired: false,
      memberCount: 1,
      maxMembers: 15,
      membershipStatus: 'active',
      growthStage: null,
      themeId: null,
      role: 'host',
      version: 1,
    },
    notices: {
      items: [{ id: 'notice-new', title: '새 소식', commentCount: 0 }],
      nextCursor: null,
    },
    quests: { items: [] },
    wallets: { fish: 0, villagePoints: 0, fishVersion: null, villagePointsVersion: 0 },
  } as Awaited<ReturnType<typeof getBoard>>;
  (getBoard as jest.Mock).mockResolvedValueOnce(board).mockRejectedValueOnce(new Error('offline'));
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({}));
  const addListener = jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() } as never);
  const props = { active: true };
  const hook = await renderHook(
    (p: typeof props) =>
      useBoardHomeIndicator({
        active: p.active,
        ownerId: 'user-1',
        islandId: 'island-1',
        markRead: false,
      }),
    { initialProps: props },
  );

  await waitFor(() => expect(hook.result.current).toBe('unread'));
  await hook.rerender({ active: false });
  expect(hook.result.current).toBeNull();
  await hook.rerender({ active: true });
  await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(2));
  expect(hook.result.current).toBe('unread');

  await hook.unmount();
  addListener.mockRestore();
});

test('댓글 작성 성공 후 읽음 세대가 바뀌면 최신 댓글 수를 기준점에 저장한다', async () => {
  const makeBoard = (commentCount: number) =>
    ({
      island: {
        id: 'island-1',
        name: '섬',
        intro: '',
        visibility: 'public',
        approvalRequired: false,
        memberCount: 1,
        maxMembers: 15,
        membershipStatus: 'active',
        growthStage: null,
        themeId: null,
        role: 'host',
        version: 1,
      },
      notices: {
        items: [{ id: 'notice-1', title: '공지', commentCount }],
        nextCursor: null,
      },
      quests: { items: [] },
      wallets: { fish: 0, villagePoints: 0, fishVersion: null, villagePointsVersion: 0 },
    }) as Awaited<ReturnType<typeof getBoard>>;
  (getBoard as jest.Mock).mockResolvedValueOnce(makeBoard(0)).mockResolvedValueOnce(makeBoard(1));
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ notice1: 0 }));
  const props = { readVersion: 0 };
  const hook = await renderHook(
    (p: typeof props) =>
      useBoardHomeIndicator({
        active: true,
        ownerId: 'user-1',
        islandId: 'island-1',
        markRead: true,
        readVersion: p.readVersion,
      }),
    { initialProps: props },
  );

  await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(1));
  await hook.rerender({ readVersion: 1 });
  await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      'gromo.board-indicator.v1:user-1:island-1',
      JSON.stringify({ 'notice-1': 1 }),
    ),
  );

  await hook.unmount();
});
