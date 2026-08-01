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
// 그룹방 목업은 '내 그룹 목록'(onShowGroups)을 **받았을 때만** 렌더한다 — 내장 렌더에서만
// 전달되는 prop이라, 이 항목의 유무가 곧 진입 경로 계약이다(2차 §0-3).
jest.mock('./GroupRoomScreen', () => {
  const { Text: RNText, TouchableOpacity: RNTouchable, View: RNView } = require('react-native');
  return function MockRoom({
    onLeft,
    onShowGroups,
  }: {
    onLeft: () => void;
    onShowGroups?: () => void;
  }) {
    return (
      <RNView>
        <RNTouchable onPress={onLeft}>
          <RNText>그룹방</RNText>
        </RNTouchable>
        {onShowGroups ? (
          <RNTouchable onPress={onShowGroups}>
            <RNText>내 그룹 목록</RNText>
          </RNTouchable>
        ) : null}
      </RNView>
    );
  };
});

// 목록 본체(카드·CTA 규격)는 GroupListScreen.test.tsx가 맡는다 —
// 여기서는 GroupScreen이 넘기는 5개 prop이 각각 어떤 전이로 이어지는지만 잠근다.
jest.mock('./GroupListScreen', () => {
  const { Text: RNText, TouchableOpacity: RNTouchable, View: RNView } = require('react-native');
  return function MockList({
    groups,
    onSelect,
    onCreate,
    onFind,
    onRefresh,
  }: {
    groups: { groupId: string; name: string }[];
    onSelect: (groupId: string) => void;
    onCreate: () => void;
    onFind: () => void;
    onRefresh: () => Promise<void>;
  }) {
    return (
      <RNView>
        <RNText>{`목록 ${groups.length}건`}</RNText>
        {groups.map((g) => (
          <RNTouchable key={g.groupId} onPress={() => onSelect(g.groupId)}>
            <RNText>{`목록-${g.name}`}</RNText>
          </RNTouchable>
        ))}
        <RNTouchable onPress={onCreate}>
          <RNText>목록-만들기</RNText>
        </RNTouchable>
        <RNTouchable onPress={onFind}>
          <RNText>목록-찾기</RNText>
        </RNTouchable>
        <RNTouchable onPress={() => onRefresh()}>
          <RNText>목록-새로고침</RNText>
        </RNTouchable>
      </RNView>
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
const GROUP_ID_2 = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';
const GROUP_ID_3 = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d77';

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

function otherSummary(): GroupSummaryResponse {
  return { ...summary(), groupId: GROUP_ID_2, name: '저녁 스터디' };
}

function thirdSummary(): GroupSummaryResponse {
  return { ...summary(), groupId: GROUP_ID_3, name: '주말 모각공' };
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

// 2차 배관 — 목록 분기(2차 §0-1·§0-2). 목록 본체가 아니라 **어느 분기가 렌더되고 탭이 어디로 가는지**만 잠근다.
describe('목록 분기(0/1/N)', () => {
  test('0건 — 빈 상태(목록도 그룹방도 아니다)', async () => {
    mockGetMyGroups.mockResolvedValueOnce([]);
    await renderScreen();

    expect(screen.getByText('함께 집중할 그룹을 만들어보세요')).toBeOnTheScreen();
    expect(screen.queryByText('목록 0건')).toBeNull();
    expect(screen.queryByText('그룹방')).toBeNull();
  });

  test('1건 — 기존대로 내장 그룹방. 목록을 열면 push 없이 그룹방으로 되돌아온다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();
    expect(screen.getByText('그룹방')).toBeOnTheScreen();

    // ⋯ 메뉴 '내 그룹 목록' — 1건이어도 목록을 볼 수 있는 유일한 경로다.
    await press('내 그룹 목록');
    expect(screen.getByText('목록 1건')).toBeOnTheScreen();

    // 1건일 때 목록에서 탭하면 스택에 같은 방을 얹지 않는다 — 내장 렌더로 복귀할 뿐이다.
    await press('목록-아침 6시 집중방');
    expect(mockNavigate).not.toHaveBeenCalledWith('GroupRoom', { groupId: GROUP_ID });
    expect(screen.getByText('그룹방')).toBeOnTheScreen();
  });

  test('2건 이상 — 목록이 기본 화면이고 탭하면 GroupRoom으로 push 한다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();

    expect(screen.getByText('목록 2건')).toBeOnTheScreen();
    expect(screen.queryByText('그룹방')).toBeNull(); // 내장 렌더는 1건 전용이다

    await press('목록-저녁 스터디');
    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', { groupId: GROUP_ID_2 });
  });

  test('당겨서 새로고침으로 1건이 되면 목록을 접고 내장 그룹방으로 돌아간다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();
    expect(mockGetMyGroups).toHaveBeenCalledTimes(1);

    // 다른 기기에서 한 그룹을 나간 뒤 새로고침한 상황.
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await press('목록-새로고침');

    expect(mockGetMyGroups).toHaveBeenCalledTimes(2);
    expect(screen.getByText('그룹방')).toBeOnTheScreen();
    expect(screen.queryByText('목록 1건')).toBeNull();
  });
});

// 목록의 하단 CTA 2개 — 빈 상태와 같은 동작으로 이어져야 한다(2차 §3-1).
// 목록은 스스로 navigate·시트 오픈을 하지 않으므로, 배선을 쥔 쪽이 GroupScreen임을 여기서 잠근다.
describe('목록의 만들기·찾기 진입점', () => {
  test('그룹 만들기 — GroupCreate로 보내고 돌아온 뒤 재조회 결과가 반영된다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();

    await press('목록-만들기');
    expect(mockNavigate).toHaveBeenCalledWith('GroupCreate');

    // 만들고 돌아오면 포커스 재조회가 새 그룹을 목록에 얹는다.
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary(), thirdSummary()]);
    await refocus();
    expect(screen.getByText('목록 3건')).toBeOnTheScreen();
  });

  test('그룹 찾기 — 시트를 열고 참여가 끝나면 재조회로 목록에 반영한다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();
    expect(screen.queryByText('찾기-참여완료')).toBeNull();

    await press('목록-찾기');
    expect(screen.getByText('찾기-참여완료')).toBeOnTheScreen();

    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary(), thirdSummary()]);
    await press('찾기-참여완료');

    expect(screen.getByText('목록 3건')).toBeOnTheScreen();
    expect(screen.queryByText('찾기-참여완료')).toBeNull(); // 시트는 닫힌다
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
