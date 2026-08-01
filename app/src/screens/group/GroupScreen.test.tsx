// GroupScreen 전이 테스트 — 명세 docs/app/group-plan.md §6-1·§6-6.
//
// 여기서 잠그는 것은 **성공한 mutation과 그 뒤 재조회의 분리**다.
// 생성·참여가 성공했는데 후속 getMyGroups()만 실패했을 때 예전 코드는 error=true만 세우고
// 에러 UI는 groups===null일 때만 그렸다 → 기존 []가 남아 다시 '그룹 만들기' 빈 화면이 떴고,
// 사용자는 방금 만든 그룹을 또 만들었다(백엔드는 다중 가입을 막지 않는다). 탈퇴는 그 반대로
// 재조회가 실패하면 이미 나간 그룹방이 그대로 남았다.
import { BackHandler, type HardwareBackPressEvent } from 'react-native';
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
    onBack,
  }: {
    groups: { groupId: string; name: string }[];
    onSelect: (groupId: string) => void;
    onCreate: () => void;
    onFind: () => void;
    onRefresh: () => Promise<void>;
    onBack?: () => void;
  }) {
    return (
      <RNView>
        <RNText>{`목록 ${groups.length}건`}</RNText>
        {/* 백버튼은 '잠깐 열어 본 목록'에만 전달된다 — 유무 자체가 계약이다(U#10) */}
        {onBack ? (
          <RNTouchable onPress={onBack}>
            <RNText>목록-뒤로</RNText>
          </RNTouchable>
        ) : null}
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

// 찾기 시트는 소속 판정을 스스로 하지 않는다(2차 리뷰 C#8) — 부모가 내린 groups를 그대로 쓰고,
// '참여 중' 행 탭은 onOpenGroup으로만 나간다(1건/N건 분기는 GroupScreen이 쥔다, C#7).
jest.mock('./components/GroupFindSheet', () => {
  const { Text: RNText, TouchableOpacity: RNTouchable, View: RNView } = require('react-native');
  return function MockFind({
    groups,
    onJoined,
    onOpenGroup,
  }: {
    groups: { groupId: string; name: string }[];
    onJoined: () => void;
    onOpenGroup: (groupId: string) => void;
  }) {
    return (
      <RNView>
        <RNText>{`찾기-소속 ${groups.length}건`}</RNText>
        <RNTouchable onPress={onJoined}>
          <RNText>찾기-참여완료</RNText>
        </RNTouchable>
        {groups.map((g) => (
          <RNTouchable key={g.groupId} onPress={() => onOpenGroup(g.groupId)}>
            <RNText>{`찾기-이동-${g.name}`}</RNText>
          </RNTouchable>
        ))}
      </RNView>
    );
  };
});

// 참여 완료가 알리는 그룹 id — 기본은 지금 시트가 보고 있는 groupId다. 참여 요청이 떠 있는 동안
// 두 번째 초대 링크가 도착하면 시트의 groupId만 갈리고 **먼저 뜬 요청의 성공**이 뒤늦게 통지되는데,
// 그 경우를 재현하려고 여기서 다른 id를 주입한다(실제 시트는 요청 시작 시 캡처한 target을 넘긴다).
let mockJoinedIdOverride: string | null = null;
jest.mock('./components/GroupInviteSheet', () => {
  const { Text: RNText, TouchableOpacity: RNTouchable, View: RNView } = require('react-native');
  return function MockInvite({
    groupId,
    onJoined,
    onLogin,
  }: {
    groupId: string;
    onJoined: (joinedGroupId: string) => void;
    onLogin: () => void;
  }) {
    return (
      <RNView>
        <RNTouchable onPress={() => onJoined(mockJoinedIdOverride ?? groupId)}>
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

// 시스템 뒤로가기 구독을 가로채 핸들러를 직접 호출한다 — BackHandler 구현이 플랫폼마다
// 다르고(iOS는 no-op 스텁) jest-expo는 두 플랫폼 프로젝트로 다 돌려서, 실제 구현에 기대면 안 된다.
function spyBackHandler() {
  const remove = jest.fn();
  const add = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockReturnValue({ remove } as ReturnType<typeof BackHandler.addEventListener>);
  return {
    add,
    remove,
    // 등록된 핸들러를 눌러 본다 — 반환값이 곧 '이벤트를 소비했는가'다.
    press: () => add.mock.calls[0][1]({ type: 'hardwareBackPress' } as HardwareBackPressEvent),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsGuest = false;
  mockPendingInvite = null;
  mockJoinedIdOverride = null;
  mockPeek.mockImplementation(() => mockPendingInvite);
});

// spyOn으로 만든 스파이만 되돌린다 — jest.mock 모듈 목에는 영향이 없다.
afterEach(() => {
  jest.restoreAllMocks();
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

// 2차 리뷰 C#7·C#8 — '참여 중' 행 탭의 분기를 시트에서 회수했다.
// 예전엔 시트가 자체 스냅샷으로 1건/N건을 판정하고 1건이면 onJoined(재조회)만 불렀는데,
// showList는 아무도 안 내려 **자기 그룹을 눌렀는데 스피너 뒤에 다시 목록**이 뜨는 사각이 있었다.
describe('찾기 시트의 참여 중 행(onOpenGroup)', () => {
  test('소속 판정 기준을 부모가 내려준다(시트는 따로 조회하지 않는다)', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();

    await press('목록-찾기');
    expect(screen.getByText('찾기-소속 2건')).toBeOnTheScreen();
  });

  test('1건 + 목록을 연 상태 — 목록을 접고 내장 그룹방으로 되돌아온다(push 없음)', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();

    // 1건 사용자가 그룹방 ⋯ → '내 그룹 목록' → 하단 '그룹 찾기'로 들어간 상태.
    await press('내 그룹 목록');
    await press('목록-찾기');
    expect(screen.getByText('찾기-소속 1건')).toBeOnTheScreen();

    await press('찾기-이동-아침 6시 집중방');

    expect(screen.getByText('그룹방')).toBeOnTheScreen(); // 목록으로 되돌아오지 않는다
    expect(screen.queryByText('목록 1건')).toBeNull();
    expect(screen.queryByText('찾기-참여완료')).toBeNull(); // 시트도 닫힌다
    expect(mockNavigate).not.toHaveBeenCalledWith('GroupRoom', { groupId: GROUP_ID });
  });

  test('2건 이상 — 시트를 닫고 GroupRoom으로 push 한다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();

    await press('목록-찾기');
    await press('찾기-이동-저녁 스터디');

    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', { groupId: GROUP_ID_2 });
    expect(screen.queryByText('찾기-참여완료')).toBeNull();
  });
});

// U#10 — 1건에서 '잠깐 열어 본' 목록은 되돌아갈 길이 카드 탭뿐이라 탭에 눌러앉았다.
describe('목록 백버튼(showList)', () => {
  test('1건에서 연 목록에만 onBack이 내려가고, 누르면 그룹방으로 돌아온다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();

    await press('내 그룹 목록');
    expect(screen.getByText('목록 1건')).toBeOnTheScreen();

    await press('목록-뒤로');
    expect(screen.getByText('그룹방')).toBeOnTheScreen();
    expect(screen.queryByText('목록 1건')).toBeNull();
  });

  test('2건 이상의 기본 목록에는 백버튼을 주지 않는다(갈 곳이 없다)', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();

    expect(screen.getByText('목록 2건')).toBeOnTheScreen();
    expect(screen.queryByText('목록-뒤로')).toBeNull();
  });
});

// 임시 목록은 스택 라우트가 아니라 로컬 상태(showList)라, 헤더 백버튼만으론 Android
// 시스템 뒤로가기를 못 받는다 — 그대로 두면 탭 네비게이터 기본 동작으로 탭을 벗어난다.
describe('임시 목록의 시스템 뒤로가기', () => {
  test('1건에서 연 목록에서만 이벤트를 소비해 그룹방으로 되돌린다', async () => {
    const back = spyBackHandler();

    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();
    // 내장 그룹방에선 가로챌 이유가 없다(탭의 첫 화면이다).
    expect(back.add).not.toHaveBeenCalled();

    await press('내 그룹 목록');
    expect(back.add).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));

    let consumed: boolean | null | undefined;
    await act(async () => {
      consumed = back.press();
    });

    // true를 돌려주지 않으면 탭 네비게이터 기본 동작으로 흘러 다른 탭/앱 종료가 된다.
    expect(consumed).toBe(true);
    expect(screen.getByText('그룹방')).toBeOnTheScreen();
    expect(screen.queryByText('목록 1건')).toBeNull();
    // 목록을 접었으면 구독도 정리한다.
    expect(back.remove).toHaveBeenCalled();
  });

  test('2건 이상의 기본 목록에서는 가로채지 않는다(되돌아갈 곳이 없다)', async () => {
    const back = spyBackHandler();

    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();

    expect(screen.getByText('목록 2건')).toBeOnTheScreen();
    expect(back.add).not.toHaveBeenCalled();
  });
});

// 초대 링크는 '그룹 탭 열기'가 아니라 **특정 그룹방**을 가리킨다. 이미 두 그룹 이상인
// 사용자는 재조회 뒤 기본 화면이 목록이라, 목적지를 들고 있지 않으면 링크가 목록에서 끝난다.
describe('초대 링크 목적지(onInviteJoined)', () => {
  test('재조회 결과가 2건 이상이면 초대가 가리킨 그룹방으로 push 한다', async () => {
    mockPendingInvite = GROUP_ID_2;
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();

    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await press('초대-참여완료');

    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', { groupId: GROUP_ID_2 });
    expect(mockClear).toHaveBeenCalled(); // 참여가 끝났으므로 초대 버퍼는 비운다
  });

  test('1건이면 내장 그룹방이 곧 그 그룹이라 push 하지 않는다', async () => {
    mockPendingInvite = GROUP_ID;
    mockGetMyGroups.mockResolvedValueOnce([]);
    await renderScreen();

    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await press('초대-참여완료');

    expect(mockNavigate).not.toHaveBeenCalledWith('GroupRoom', { groupId: GROUP_ID });
    expect(screen.getByText('그룹방')).toBeOnTheScreen();
  });

  test('재조회 목록에 없는 그룹이면 아무 데도 보내지 않는다(참여 미반영)', async () => {
    mockPendingInvite = GROUP_ID_3;
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();

    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await press('초대-참여완료');

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('목록 2건')).toBeOnTheScreen();
  });

  // 초대 A로 참여 요청을 띄운 뒤 초대 B 링크가 도착하면 시트의 groupId는 B로 갈리는데, A의 성공은
  // 그 뒤에 통지된다(시트는 성공을 세대와 무관하게 넘긴다 — 실제로 가입됐기 때문). 목적지를 현재
  // inviteGroupId(B)로 잡으면 아직 내 목록에 없는 B로 가려다 아무 방도 열지 못한다.
  test('참여 요청 중 새 초대가 도착해도 실제로 가입된 그룹방으로 보낸다', async () => {
    mockPendingInvite = GROUP_ID_3; // 나중에 도착한 초대 B — 아직 가입 전이라 목록에 없다
    mockJoinedIdOverride = GROUP_ID_2; // 먼저 띄운 참여 요청이 겨냥한 초대 A
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();

    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await press('초대-참여완료');

    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', { groupId: GROUP_ID_2 });
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
