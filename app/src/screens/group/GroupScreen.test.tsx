// GroupScreen 전이 테스트 — 명세 docs/app/group-plan.md §6-1·§6-6.
//
// 여기서 잠그는 것은 **성공한 mutation과 그 뒤 재조회의 분리**다.
// 생성·참여가 성공했는데 후속 getMyGroups()만 실패했을 때 예전 코드는 error=true만 세우고
// 에러 UI는 groups===null일 때만 그렸다 → 기존 []가 남아 다시 '그룹 만들기' 빈 화면이 떴고,
// 사용자는 방금 만든 그룹을 또 만들었다(백엔드는 다중 가입을 막지 않는다). 탈퇴는 그 반대로
// 재조회가 실패하면 이미 나간 그룹방이 그대로 남았다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import GroupScreen from './GroupScreen';
import { getMyGroups } from '@/services/groupApi';
import { clearPendingInvite, peekPendingInvite } from '@/navigation/navigationRef';
import type { GroupSummaryResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => {
  const { View: RNView } = require('react-native');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
    SafeAreaView: RNView,
  };
});

// 포커스 재조회를 테스트에서 다시 트리거하려고 콜백을 모아 둔다(그룹 생성 화면에서 돌아오는 상황).
const mockFocusRunners = new Set<() => void | (() => void)>();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      mockFocusRunners.add(cb);
      const cleanup = cb();
      return () => {
        mockFocusRunners.delete(cb);
        if (typeof cleanup === 'function') cleanup();
      };
    }, [cb]);
  },
}));

let mockIsGuest = false;
jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ isGuest: mockIsGuest }),
}));

jest.mock('@/services/analyticsEvents', () => ({ logGroupViewed: jest.fn() }));

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getMyGroups: jest.fn(),
}));

let mockPendingInvite: string | null = null;
jest.mock('@/navigation/navigationRef', () => ({
  setGroupInviteListener: jest.fn(),
  peekPendingInvite: jest.fn(),
  clearPendingInvite: jest.fn(),
}));

// 자식 화면·시트는 콜백만 잠근다 — 각자의 분기는 자기 테스트 파일이 맡는다.
jest.mock('./GroupRoomScreen', () => {
  const { Text: RNText, TouchableOpacity: RNTouchable } = require('react-native');
  return function MockRoom({ onLeft }: { onLeft: () => void }) {
    return (
      <RNTouchable onPress={onLeft}>
        <RNText>그룹방</RNText>
      </RNTouchable>
    );
  };
});

jest.mock('./components/GroupFindSheet', () => {
  const { Text: RNText, TouchableOpacity: RNTouchable } = require('react-native');
  return function MockFind({ onJoined }: { onJoined: () => void }) {
    return (
      <RNTouchable onPress={onJoined}>
        <RNText>찾기-참여완료</RNText>
      </RNTouchable>
    );
  };
});

jest.mock('./components/GroupInviteSheet', () => {
  const { Text: RNText, TouchableOpacity: RNTouchable, View: RNView } = require('react-native');
  return function MockInvite({ onJoined, onLogin }: { onJoined: () => void; onLogin: () => void }) {
    return (
      <RNView>
        <RNTouchable onPress={onJoined}>
          <RNText>초대-참여완료</RNText>
        </RNTouchable>
        <RNTouchable onPress={onLogin}>
          <RNText>초대-로그인</RNText>
        </RNTouchable>
      </RNView>
    );
  };
});

const mockGetMyGroups = getMyGroups as jest.MockedFunction<typeof getMyGroups>;
const mockPeek = peekPendingInvite as jest.MockedFunction<typeof peekPendingInvite>;
const mockClear = clearPendingInvite as jest.MockedFunction<typeof clearPendingInvite>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

function summary(): GroupSummaryResponse {
  return {
    groupId: GROUP_ID,
    name: '아침 6시 집중방',
    code: null,
    currentMembers: 2,
    maxMembers: 5,
    role: 'MEMBER',
    status: 'WAITING',
  };
}

async function renderScreen() {
  const result = await render(<GroupScreen />);
  await act(async () => {});
  return result;
}

// 다른 화면에 다녀와 다시 포커스된 상황(생성 화면 → 뒤로).
async function refocus() {
  await act(async () => {
    mockFocusRunners.forEach((cb) => cb());
  });
}

// 비동기 콜백을 부르는 탭 — fireEvent만으론 이어지는 setState가 act 밖으로 샌다.
async function press(label: string) {
  const el = await screen.findByText(label);
  await act(async () => {
    fireEvent.press(el);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsGuest = false;
  mockPendingInvite = null;
  mockPeek.mockImplementation(() => mockPendingInvite);
});

describe('mutation 성공 뒤 재조회만 실패한 경우', () => {
  // 4경로(생성·검색 참여·초대 참여·탈퇴) 중 앞의 3경로는 같은 요구를 갖는다:
  // **빈 상태로 위장하지 않는다**. 위장하면 사용자가 같은 그룹을 또 만들거나 또 참여한다.
  test('생성 — 빈 화면이 아니라 에러+재시도를 세운다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([]);
    await renderScreen();
    expect(screen.getByText('함께 집중할 그룹을 만들어보세요')).toBeOnTheScreen();

    await press('그룹 만들기');
    expect(mockNavigate).toHaveBeenCalledWith('GroupCreate');

    // 생성하고 돌아왔는데 목록 조회가 실패한다.
    mockGetMyGroups.mockRejectedValueOnce(new Error('network'));
    await refocus();

    expect(screen.getByText('그룹을 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.queryByText('함께 집중할 그룹을 만들어보세요')).toBeNull();

    // 다시 시도로 회복하면 그룹방으로 전환된다.
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await press('다시 시도');
    expect(await screen.findByText('그룹방')).toBeOnTheScreen();
  });

  test('검색 참여 — 빈 화면이 아니라 에러+재시도를 세운다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([]);
    await renderScreen();

    await press('그룹 찾기');
    mockGetMyGroups.mockRejectedValueOnce(new Error('network'));
    await press('찾기-참여완료');

    expect(screen.getByText('그룹을 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.queryByText('함께 집중할 그룹을 만들어보세요')).toBeNull();
  });

  test('초대 참여 — 빈 화면이 아니라 에러+재시도를 세운다', async () => {
    mockPendingInvite = GROUP_ID;
    mockGetMyGroups.mockResolvedValueOnce([]);
    await renderScreen();

    mockGetMyGroups.mockRejectedValueOnce(new Error('network'));
    await press('초대-참여완료');

    expect(screen.getByText('그룹을 불러오지 못했어요')).toBeOnTheScreen();
    expect(mockClear).toHaveBeenCalled(); // 참여가 끝났으므로 초대 버퍼는 비운다
  });

  test('탈퇴 — 재조회를 기다리지 않고 즉시 빈 상태로 되돌린다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();
    expect(screen.getByText('그룹방')).toBeOnTheScreen();

    mockGetMyGroups.mockRejectedValueOnce(new Error('network'));
    await press('그룹방'); // = onLeft

    // 나간 그룹방이 남아 있으면 안 된다 — 재조회 실패와 무관하게 빈 상태다.
    expect(screen.queryByText('그룹방')).toBeNull();
    expect(screen.getByText('함께 집중할 그룹을 만들어보세요')).toBeOnTheScreen();
  });
});

describe('일반 재조회 실패', () => {
  test('기존 화면을 유지하고 인라인 배너로 알린다(무음 금지)', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();

    mockGetMyGroups.mockRejectedValueOnce(new Error('network'));
    await refocus();

    expect(screen.getByText('그룹방')).toBeOnTheScreen(); // 화면을 갈아엎지 않는다
    expect(screen.getByText('목록을 새로고침하지 못했어요')).toBeOnTheScreen();

    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await press('다시 시도');
    await waitFor(() => expect(screen.queryByText('목록을 새로고침하지 못했어요')).toBeNull());
  });
});

describe('게스트 초대 로그인(§6-6)', () => {
  test('시트만 내리고 초대 버퍼는 남긴 채 계정 화면으로 보낸다', async () => {
    mockIsGuest = true;
    mockPendingInvite = GROUP_ID;
    await renderScreen();

    await press('초대-로그인');

    expect(mockNavigate).toHaveBeenCalledWith('SettingsAccount');
    // 시트는 내려간다 — RN 네이티브 Modal이라 남으면 로그인 화면을 덮는다.
    expect(screen.queryByText('초대-로그인')).toBeNull();
    // 버퍼는 살아 있어야 로그인 후 리마운트에서 같은 그룹 프리뷰로 복귀한다.
    expect(mockClear).not.toHaveBeenCalled();
  });

  // App.tsx의 applyStoredSession은 로그인 전후 userId가 같은 경우(계정 연결)를 따로 분기한다 —
  // 그때는 <UserProvider key={userId}>가 그대로라 리마운트가 없고, 마운트 1회 peek에만 기대면
  // 버퍼에 초대가 남아 있는데도 시트가 다시 뜨지 않는다.
  test('리마운트 없이 게스트→로그인으로 바뀌어도 같은 초대로 복귀한다', async () => {
    mockIsGuest = true;
    mockPendingInvite = GROUP_ID;
    const { rerender } = await renderScreen();

    await press('초대-로그인');
    expect(screen.queryByText('초대-참여완료')).toBeNull();

    mockIsGuest = false;
    mockGetMyGroups.mockResolvedValue([]);
    await act(async () => {
      rerender(<GroupScreen />);
    });

    expect(await screen.findByText('초대-참여완료')).toBeOnTheScreen();
  });
});
