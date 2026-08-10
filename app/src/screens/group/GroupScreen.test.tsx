// GroupScreen 전이 테스트 — 명세 docs/app/group-plan.md §6-1·§6-6 + 3차 A-9(항상 목록 먼저).
//
// A-9 이후 GroupScreen은 소속 수와 무관하게 **항상 GroupListScreen을 먼저 렌더**하고,
// 목록 카드 탭·초대 참여·찾기 시트의 '참여 중' 행 탭은 전부
// navigation.navigate('GroupRoom', { groupId })로 push 한다.
// (이전의 '1건이면 그룹방 내장 렌더', showList·onBack·tempListOpen·BackHandler는 전부 제거됐다.)
//
// 여기서 잠그는 것은 두 가지다:
//  1) **성공한 mutation과 그 뒤 재조회의 분리** — 생성·참여가 성공했는데 후속 getMyGroups()만
//     실패했을 때 예전 코드는 error=true만 세우고 에러 UI는 groups===null일 때만 그렸다 → 기존 []가
//     남아 다시 '그룹 만들기' 빈 화면이 떴고, 사용자는 방금 만든 그룹을 또 만들었다(백엔드는 다중
//     가입을 막지 않는다). 목록-우선 구조에서도 이 분리는 그대로 지켜져야 한다.
//  2) **어느 분기가 렌더되고 탭이 어디로 가는지** — 목록/빈 상태/에러+재시도/게스트 배선과,
//     각 진입(목록 카드·초대·찾기 시트)에서 GroupRoom으로의 push.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import GroupScreen from './GroupScreen';
import { getMyGroups } from '@/services/groupApi';
import { clearPendingInvite, peekPendingInvite } from '@/navigation/navigationRef';
import { clearPendingGroupEntry, queueDirectGroupEntry } from '@/navigation/groupEntrySource';
import { logGroupViewed } from '@/services/analyticsEvents';
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
  useIsFocused: () => true,
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

// 목록 본체(카드·CTA 규격)는 GroupListScreen.test.tsx가 맡는다 —
// 여기서는 GroupScreen이 넘기는 5개 prop이 각각 어떤 전이로 이어지는지만 잠근다.
// A-9 이후 목록이 항상 기본 화면이라 onBack은 더 이상 내려가지 않는다(내장 그룹방·임시 목록 제거).
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

// 찾기 시트는 소속 판정을 스스로 하지 않는다(2차 리뷰 C#8) — 부모가 내린 groups를 그대로 쓰고,
// '참여 중' 행 탭은 onOpenGroup으로만 나간다(그룹방 push는 GroupScreen이 쥔다, C#7).
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
const mockLogGroupViewed = logGroupViewed as jest.MockedFunction<typeof logGroupViewed>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const GROUP_ID_2 = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';
const GROUP_ID_3 = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d77';
function roomParams(groupId: string, entrySource: 'group_find' | 'invite' | 'unknown') {
  return {
    groupId,
    challengeId: undefined,
    entrySource,
    interactionId: undefined,
    interactionAcceptedAt: undefined,
  };
}

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
  clearPendingGroupEntry();
  mockIsGuest = false;
  mockPendingInvite = null;
  mockJoinedIdOverride = null;
  // 버퍼는 이제 {groupId, slug, entry} 를 들고 온다(초대 링크 스펙 §7-3). 이 화면의 관심사는
  // 여전히 groupId 하나라, 테스트는 groupId만 지정하고 나머지는 여기서 감싼다.
  mockPeek.mockImplementation(() =>
    mockPendingInvite ? { groupId: mockPendingInvite, slug: null, entry: 'link' } : null,
  );
});

// spyOn으로 만든 스파이만 되돌린다 — jest.mock 모듈 목에는 영향이 없다.
afterEach(() => {
  jest.restoreAllMocks();
  clearPendingGroupEntry();
});

describe('group_viewed view episode', () => {
  test('성공한 전체 목록 뒤에만 group_entry와 count bucket을 한 번 발행한다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([]);

    await renderScreen();

    expect(mockLogGroupViewed).toHaveBeenCalledTimes(1);
    expect(mockLogGroupViewed).toHaveBeenCalledWith({
      group_entry: 'tab',
      group_count_bucket: '0',
    });
  });

  test('목록 실패에는 발행하지 않고 같은 episode의 재시도 성공에서 한 번 발행한다', async () => {
    mockGetMyGroups.mockRejectedValueOnce(new Error('network'));
    await renderScreen();
    expect(mockLogGroupViewed).not.toHaveBeenCalled();

    mockGetMyGroups.mockResolvedValueOnce(
      Array.from({ length: 11 }, (_, index) => ({
        ...summary(),
        groupId: `0197e0c3-4d1b-7a2e-9f60-${String(index).padStart(12, '0')}`,
      })),
    );
    await press('다시 시도');

    expect(mockLogGroupViewed).toHaveBeenCalledTimes(1);
    expect(mockLogGroupViewed).toHaveBeenCalledWith({
      group_entry: 'tab',
      group_count_bucket: '11_plus',
    });
  });

  test('실제 새 focus를 만든 direct source를 한 번 소비하고 다음 focus는 return이다', async () => {
    queueDirectGroupEntry('invite');
    mockGetMyGroups.mockResolvedValueOnce([summary()]).mockResolvedValueOnce([summary()]);

    await renderScreen();
    expect(mockLogGroupViewed).toHaveBeenNthCalledWith(1, {
      group_entry: 'invite',
      group_count_bucket: '1',
    });

    await refocus();
    expect(mockLogGroupViewed).toHaveBeenNthCalledWith(2, {
      group_entry: 'return',
      group_count_bucket: '1',
    });
  });

  test('같은 episode의 새로고침은 view 이벤트를 추가하지 않는다', async () => {
    mockGetMyGroups.mockResolvedValue([summary()]);
    await renderScreen();

    await press('목록-새로고침');

    expect(mockLogGroupViewed).toHaveBeenCalledTimes(1);
  });
});

describe('mutation 성공 뒤 재조회만 실패한 경우', () => {
  // 3경로(생성·검색 참여·초대 참여) 모두 같은 요구를 갖는다: **빈 상태로 위장하지 않는다**.
  // 위장하면 사용자가 방금 만든/참여한 그룹을 없는 것으로 보고 같은 동작을 또 한다.
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

    // 다시 시도로 회복하면 목록(항상 기본 화면)이 뜬다.
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await press('다시 시도');
    expect(await screen.findByText('목록 1건')).toBeOnTheScreen();
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
});

describe('일반 재조회 실패', () => {
  test('기존 화면을 유지하고 인라인 배너로 알린다(무음 금지)', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();
    expect(screen.getByText('목록 1건')).toBeOnTheScreen();

    mockGetMyGroups.mockRejectedValueOnce(new Error('network'));
    await refocus();

    // 화면을 갈아엎지 않는다 — 보고 있던 목록을 그대로 두고 배너만 얹는다.
    expect(screen.getByText('목록 1건')).toBeOnTheScreen();
    expect(screen.getByText('목록을 새로고침하지 못했어요')).toBeOnTheScreen();

    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await press('다시 시도');
    await waitFor(() => expect(screen.queryByText('목록을 새로고침하지 못했어요')).toBeNull());
  });
});

// 목록 분기(A-9). 목록 본체가 아니라 **어느 분기가 렌더되고 탭이 어디로 가는지**만 잠근다.
describe('목록 분기(0/1/N)', () => {
  test('0건 — 빈 상태(목록이 아니다)', async () => {
    mockGetMyGroups.mockResolvedValueOnce([]);
    await renderScreen();

    expect(screen.getByText('함께 집중할 그룹을 만들어보세요')).toBeOnTheScreen();
    expect(screen.queryByText('목록 0건')).toBeNull();
  });

  test('1건 — 목록이 기본 화면이고 탭하면 GroupRoom으로 push 한다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();

    // 소속이 1건이어도 내장 그룹방이 아니라 목록이 먼저 뜬다(A-9).
    expect(screen.getByText('목록 1건')).toBeOnTheScreen();

    // 목록 카드를 탭하면 소속 수와 무관하게 그룹방 라우트로 push 한다.
    await press('목록-아침 6시 집중방');
    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', roomParams(GROUP_ID, 'unknown'));
  });

  test('2건 이상 — 목록이 기본 화면이고 탭하면 GroupRoom으로 push 한다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();

    expect(screen.getByText('목록 2건')).toBeOnTheScreen();

    await press('목록-저녁 스터디');
    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', roomParams(GROUP_ID_2, 'unknown'));
  });

  // GROMO-1088 — 스택에 이미 GroupRoom이 있으면 파라미터가 얕게 병합된다. challengeId 키를
  // 빼면 직전 딥링크(챌린지 종료 푸시)의 지목이 이 방으로 새어 든다. 타입이 키를 필수로 두어
  // 컴파일 시점에도 강제하지만, 왜 undefined를 명시하는지를 여기서 문서로 남긴다.
  // (toHaveBeenCalledWith는 undefined 프로퍼티를 무시하므로 키 존재를 직접 본다.)
  test('그룹방 push는 challengeId 키를 항상 명시한다(파라미터 병합 오염 방지)', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();

    await press('목록-아침 6시 집중방');
    const params = mockNavigate.mock.calls.find(([route]) => route === 'GroupRoom')?.[1];
    expect(params).toHaveProperty('challengeId');
    expect((params as { challengeId?: string }).challengeId).toBeUndefined();
  });

  test('당겨서 새로고침으로 1건이 되어도 목록을 그대로 유지한다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();
    expect(mockGetMyGroups).toHaveBeenCalledTimes(1);
    expect(screen.getByText('목록 2건')).toBeOnTheScreen();

    // 다른 기기에서 한 그룹을 나간 뒤 새로고침한 상황.
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await press('목록-새로고침');

    expect(mockGetMyGroups).toHaveBeenCalledTimes(2);
    // 1건이 되어도 내장 그룹방으로 접히지 않고 목록을 유지한다(A-9).
    expect(screen.getByText('목록 1건')).toBeOnTheScreen();
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
// 시트는 소속을 스스로 조회하지도, 분기를 판정하지도 않는다 — 부모가 내린 groups를 쓰고,
// 탭은 onOpenGroup으로만 나가며 GroupScreen이 그룹방 push로 일원화한다.
describe('찾기 시트의 참여 중 행(onOpenGroup)', () => {
  test('소속 판정 기준을 부모가 내려준다(시트는 따로 조회하지 않는다)', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();

    await press('목록-찾기');
    expect(screen.getByText('찾기-소속 2건')).toBeOnTheScreen();
  });

  test('1건 — 시트를 닫고 GroupRoom으로 push 한다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();
    expect(screen.getByText('목록 1건')).toBeOnTheScreen();

    await press('목록-찾기');
    expect(screen.getByText('찾기-소속 1건')).toBeOnTheScreen();

    await press('찾기-이동-아침 6시 집중방');

    // 소속이 1건이어도 이동은 그룹방 push다(목록 카드 탭과 같은 분기).
    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', roomParams(GROUP_ID, 'group_find'));
    expect(screen.queryByText('찾기-참여완료')).toBeNull(); // 시트도 닫힌다
  });

  test('2건 이상 — 시트를 닫고 GroupRoom으로 push 한다', async () => {
    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await renderScreen();

    await press('목록-찾기');
    await press('찾기-이동-저녁 스터디');

    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', roomParams(GROUP_ID_2, 'group_find'));
    expect(screen.queryByText('찾기-참여완료')).toBeNull();
  });
});

// 초대 링크는 '그룹 탭 열기'가 아니라 **특정 그룹방**을 가리킨다. A-9 이후 재조회 뒤 기본 화면이
// 항상 목록이라, 목적지를 들고 있지 않으면 소속 수와 무관하게 링크가 목록에서 끝난다.
describe('초대 링크 목적지(onInviteJoined)', () => {
  test('재조회 결과가 2건 이상이면 초대가 가리킨 그룹방으로 push 한다', async () => {
    mockPendingInvite = GROUP_ID_2;
    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await renderScreen();

    mockGetMyGroups.mockResolvedValueOnce([summary(), otherSummary()]);
    await press('초대-참여완료');

    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', roomParams(GROUP_ID_2, 'invite'));
    expect(mockClear).toHaveBeenCalled(); // 참여가 끝났으므로 초대 버퍼는 비운다
  });

  test('1건이어도 초대가 가리킨 그룹방으로 push 한다', async () => {
    mockPendingInvite = GROUP_ID;
    mockGetMyGroups.mockResolvedValueOnce([]);
    await renderScreen();

    mockGetMyGroups.mockResolvedValueOnce([summary()]);
    await press('초대-참여완료');

    // 내장 그룹방이 없어졌으므로 1건이어도 초대 목적지로 push 한다.
    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', roomParams(GROUP_ID, 'invite'));
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

    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', roomParams(GROUP_ID_2, 'invite'));
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
