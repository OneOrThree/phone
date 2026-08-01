// GroupRoomScreen 조회 견고화 테스트 — 명세 docs/app/group-plan.md §6-4.
//
// 여기서 잠그는 것 두 가지:
//  1) 상세와 공지의 실패를 **각각** 다룬다. 예전엔 상세 재조회 실패가 groups 데이터가 있으면
//     화면에 아무 흔적도 남기지 않았고(오래된 멤버·인원을 그대로 봄), 공지 실패는 []로 뭉개져
//     '아직 공지가 없어요'가 떴다 — 작성 권한자는 이미 있는 공지를 또 등록했다.
//  2) 포그라운드 복귀. 그룹 탭이 포커스된 채 백그라운드에 있다 자정을 넘겨 돌아오면
//     useFocusEffect가 다시 돌지 않아 '오늘 집중분'이 전날 값으로 남았다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import GroupRoomScreen from './GroupRoomScreen';
import { getAnnouncements, getGroupDetail } from '@/services/groupApi';
import { todayStr } from '@/utils/localDate';
import type { GroupAnnouncementResponse, GroupDetailResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// 포커스/블러를 테스트가 직접 굴린다(탭 화면이라 블러돼도 언마운트되지 않는다).
const mockFocusEntries: { cb: () => void | (() => void); cleanup?: () => void }[] = [];
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      const entry: { cb: typeof cb; cleanup?: () => void } = { cb };
      const cleanup = cb();
      if (typeof cleanup === 'function') entry.cleanup = cleanup;
      mockFocusEntries.push(entry);
      return () => {
        entry.cleanup?.();
        const i = mockFocusEntries.indexOf(entry);
        if (i >= 0) mockFocusEntries.splice(i, 1);
      };
    }, [cb]);
  },
}));

jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ userId: 'me' }),
}));

jest.mock('@/services/analyticsEvents', () => ({ logGroupInviteShared: jest.fn() }));

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupDetail: jest.fn(),
  getAnnouncements: jest.fn(),
  withdrawGroup: jest.fn(),
}));

// 날짜 경계를 테스트가 직접 옮긴다.
jest.mock('@/utils/localDate', () => ({ todayStr: jest.fn(() => '2026-08-01') }));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockGetAnnouncements = getAnnouncements as jest.MockedFunction<typeof getAnnouncements>;
const mockTodayStr = todayStr as jest.MockedFunction<typeof todayStr>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const onLeft = jest.fn();

let appStateHandler: ((state: AppStateStatus) => void) | null = null;

function detail(over: Partial<GroupDetailResponse> = {}): GroupDetailResponse {
  return {
    id: GROUP_ID,
    name: '아침 6시 집중방',
    description: null,
    missionCategory: 'FOCUS',
    missionType: 'DURATION',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    isPrivate: false,
    maxMembers: 5,
    status: 'WAITING',
    code: null,
    codeExpiresAt: null,
    noticeGrantedUserIds: [],
    members: [
      { userId: 'me', nickname: '나', role: 'OWNER', focusTimeMinutes: 30 },
      { userId: 'u2', nickname: '수빈', role: 'MEMBER', focusTimeMinutes: 60 },
    ],
    ...over,
  };
}

function notice(over: Partial<GroupAnnouncementResponse> = {}): GroupAnnouncementResponse {
  return {
    id: 'a1',
    title: '오늘 6시에 모여요',
    content: '본문',
    createdAt: '2026-08-01T06:00:00',
    ...over,
  };
}

async function renderRoom() {
  const result = await render(<GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} />);
  await act(async () => {});
  return result;
}

// 다시 포커스된 상황(공지 화면에서 뒤로) — 블러는 진행 중 요청을 무효화한다.
async function blur() {
  await act(async () => {
    mockFocusEntries.forEach((e) => {
      e.cleanup?.();
      e.cleanup = undefined;
    });
  });
}

async function focus() {
  await act(async () => {
    mockFocusEntries.forEach((e) => {
      const cleanup = e.cb();
      if (typeof cleanup === 'function') e.cleanup = cleanup;
    });
  });
}

async function foreground() {
  await act(async () => {
    appStateHandler?.('active');
  });
}

async function press(label: string) {
  const el = await screen.findByText(label);
  await act(async () => {
    fireEvent.press(el);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusEntries.length = 0;
  mockTodayStr.mockReturnValue('2026-08-01');
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

describe('상세·공지 오류 분리', () => {
  test('최초 상세 실패는 전면 에러 + 다시 시도', async () => {
    mockGetGroupDetail.mockRejectedValueOnce(new Error('network'));
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();

    expect(screen.getByText('그룹을 불러오지 못했어요')).toBeOnTheScreen();

    mockGetGroupDetail.mockResolvedValueOnce(detail());
    await press('다시 시도');
    expect(await screen.findByText('아침 6시 집중방')).toBeOnTheScreen();
  });

  test('데이터가 있는 상태의 상세 실패는 기존 값을 지우지 않고 배너로 알린다', async () => {
    mockGetGroupDetail.mockResolvedValueOnce(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();

    mockGetGroupDetail.mockRejectedValueOnce(new Error('network'));
    await focus();

    expect(screen.getByText('아침 6시 집중방')).toBeOnTheScreen(); // 오래된 값이라도 보존
    expect(screen.getByText('수빈')).toBeOnTheScreen();
    expect(screen.getByText('최신 정보를 불러오지 못했어요')).toBeOnTheScreen();

    mockGetGroupDetail.mockResolvedValueOnce(detail());
    await press('다시 시도');
    await waitFor(() => expect(screen.queryByText('최신 정보를 불러오지 못했어요')).toBeNull());
  });

  test('공지만 실패하면 "공지 없음"으로 위장하지 않는다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockRejectedValueOnce(new Error('network'));
    await renderRoom();

    // 방의 뼈대(상세)는 그대로 뜬다.
    expect(screen.getByText('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.getByText('공지를 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.queryByText('아직 공지가 없어요')).toBeNull();
    // 작성 진입점도 세우지 않는다 — 서버에 이미 있는 공지를 또 쓰게 만들 수 있다.
    expect(screen.queryByText('공지 쓰기')).toBeNull();
  });

  test('공지 갱신만 실패하면 기존 공지를 유지한 채 알린다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValueOnce([notice()]);
    await renderRoom();
    expect(screen.getByText('오늘 6시에 모여요')).toBeOnTheScreen();

    mockGetAnnouncements.mockRejectedValueOnce(new Error('network'));
    await focus();

    expect(screen.getByText('오늘 6시에 모여요')).toBeOnTheScreen();
    expect(screen.getByText('공지를 새로고침하지 못했어요')).toBeOnTheScreen();
  });
});

describe('포그라운드 복귀', () => {
  test('화면이 떠 있으면 active 전환마다 재조회한다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();
    expect(mockGetGroupDetail).toHaveBeenCalledTimes(1);

    await foreground();
    expect(mockGetGroupDetail).toHaveBeenCalledTimes(2);
  });

  test('포커스가 없어도 날짜가 바뀌었으면 새 날짜로 강제 재조회한다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();
    expect(mockGetGroupDetail).toHaveBeenLastCalledWith(GROUP_ID, '2026-08-01');

    await blur();
    // 같은 날이면 다음 포커스에서 조회하면 되므로 그대로 둔다.
    await foreground();
    expect(mockGetGroupDetail).toHaveBeenCalledTimes(1);

    // 자정을 넘겨 복귀 — '오늘 집중분'의 기준일이 바뀌었으니 반드시 다시 부른다.
    mockTodayStr.mockReturnValue('2026-08-02');
    await foreground();
    expect(mockGetGroupDetail).toHaveBeenLastCalledWith(GROUP_ID, '2026-08-02');
  });
});
