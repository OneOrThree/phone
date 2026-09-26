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
