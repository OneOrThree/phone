// GroupRoomScreen 조회 견고화 + 챌린지 섹션 테스트 — 명세 docs/app/group-plan.md §6-4,
// docs/app/group-plan-2.md §3-2.
//
// 여기서 잠그는 것:
//  1) 상세·공지·챌린지의 실패를 **각각** 다룬다. 예전엔 상세 재조회 실패가 groups 데이터가 있으면
//     화면에 아무 흔적도 남기지 않았고(오래된 멤버·인원을 그대로 봄), 공지 실패는 []로 뭉개져
//     '아직 공지가 없어요'가 떴다 — 작성 권한자는 이미 있는 공지를 또 등록했다.
//     챌린지도 같은 규격을 따른다(실패를 '없음'으로 위장하지 않는다).
//  2) 포그라운드 복귀. 그룹 탭이 포커스된 채 백그라운드에 있다 자정을 넘겨 돌아오면
//     useFocusEffect가 다시 돌지 않아 '오늘 집중분'이 전날 값으로 남았다.
//  3) ⋯ 메뉴의 '그룹 전환·추가'는 **onShowGroups를 받았을 때만** 렌더한다 —
//     라우트로 push된 그룹방은 이미 목록에서 들어온 화면이라 되돌아가는 항목이 중복이다(2차 §0-3).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import GroupRoomScreen from './GroupRoomScreen';
import {
  createBet,
  deleteChallenge,
  getAnnouncements,
  getChallenges,
  getGroupDetail,
  joinBet,
} from '@/services/groupApi';
import { todayStr } from '@/utils/localDate';
import type {
  GroupAnnouncementResponse,
  GroupChallengeResponse,
  GroupDetailResponse,
} from '@/types/dto/group';

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

jest.mock('@/services/analyticsEvents', () => ({
  logGroupInviteShared: jest.fn(),
  logGroupBetCreated: jest.fn(),
  logGroupBetJoined: jest.fn(),
}));

// 내기 시트가 잔액을 읽는다(CoinContext) — 테스트 트리엔 Provider가 없어 훅을 대체한다.
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({ coins: 100, refresh: jest.fn(async () => {}) }),
}));

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupDetail: jest.fn(),
  getAnnouncements: jest.fn(),
  getChallenges: jest.fn(),
  deleteChallenge: jest.fn(),
  withdrawGroup: jest.fn(),
  createBet: jest.fn(),
  joinBet: jest.fn(),
}));

// 날짜 경계를 테스트가 직접 옮긴다.
jest.mock('@/utils/localDate', () => ({ todayStr: jest.fn(() => '2026-08-01') }));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockGetAnnouncements = getAnnouncements as jest.MockedFunction<typeof getAnnouncements>;
const mockGetChallenges = getChallenges as jest.MockedFunction<typeof getChallenges>;
const mockDeleteChallenge = deleteChallenge as jest.MockedFunction<typeof deleteChallenge>;
const mockCreateBet = createBet as jest.MockedFunction<typeof createBet>;
const mockJoinBet = joinBet as jest.MockedFunction<typeof joinBet>;
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

function challenge(over: Partial<GroupChallengeResponse> = {}): GroupChallengeResponse {
  return {
    id: 'c1',
    missionType: 'DURATION',
    missionCategory: 'FOCUS',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    status: 'ACTIVE',
    createdAt: '2026-08-01T06:00:00',
    canParticipate: true,
    memberProgress: [{ userId: 'me', nickname: '나', progressMinutes: 30, achieved: false }],
    ...over,
  };
}

// onShowGroups를 넘기면 '내장 렌더'(탭 안) — 안 넘기면 라우트 진입이다(2차 §0-3).
async function renderRoom(props: { onShowGroups?: () => void } = {}) {
  const result = await render(<GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} {...props} />);
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

// 당겨서 새로고침 컨트롤 — RTL v14엔 UNSAFE_getByType이 없어 스크롤뷰의 prop으로 집는다.
function refreshControl(): { props: { refreshing: boolean; onRefresh: () => void } } {
  return screen.getByTestId('group.room.scroll').props.refreshControl;
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
  // 챌린지는 대부분의 케이스에서 관심사가 아니다 — 빈 목록을 기본값으로 깔아 둔다.
  mockGetChallenges.mockResolvedValue([]);
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

describe('당겨서 새로고침', () => {
  // 새로고침 중에 포커스 복귀·포그라운드 복귀의 reload()가 끼어들면 이 호출은 stale로 끝나는데,
  // 예전엔 fresh일 때만 refreshing을 내려서 RefreshControl이 영원히 돌았다(최신 reload()는
  // loading만 해제한다). 사용자에겐 '새로고침이 끝나지 않는 화면'으로 보인다.
  test('진행 중 다른 조회가 끼어들어도 스피너는 내려간다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();

    // 새로고침 응답을 붙잡아 둔다.
    let release: (v: GroupDetailResponse) => void = () => {};
    mockGetGroupDetail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await act(async () => {
      refreshControl().props.onRefresh();
    });
    expect(refreshControl().props.refreshing).toBe(true);

    // 포그라운드 복귀가 끼어들어 요청 시퀀스를 올린다 → 원래 새로고침은 '최신 아님'이 된다.
    // 예전엔 여기서 스피너를 내릴 주체가 사라져 영구히 돌았다.
    await foreground();
    await act(async () => {
      release(detail());
    });

    await waitFor(() => expect(refreshControl().props.refreshing).toBe(false));
  });
});

describe('초대 시트 ↔ 그룹방 시트 배타(§6-6)', () => {
  test('초대 링크가 도착하면 메뉴를 내린다 — asModal 두 개가 겹쳐 딤이 2겹이 되지 않게', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    const { rerender } = await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('그룹 메뉴'));
    });
    expect(screen.getByText('그룹 나가기')).toBeOnTheScreen();

    // 딥링크로 초대가 도착 — 부모(GroupScreen)가 초대 시트를 띄우며 inviteOpen을 세운다.
    await act(async () => {
      rerender(<GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} inviteOpen />);
    });
    expect(screen.queryByText('그룹 나가기')).toBeNull();

    // 초대 시트가 닫혀도 메뉴가 되살아나지 않는다(가리기만 한 게 아니라 state까지 내려간다).
    await act(async () => {
      rerender(<GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} />);
    });
    expect(screen.queryByText('그룹 나가기')).toBeNull();
  });

  test('초대 링크가 도착하면 챌린지 만들기 시트도 내린다 — 메뉴와 같은 배타 규칙', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([]);
    const { rerender } = await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.add'));
    });
    // '챌린지 만들기'는 헤더 ＋ 의 접근성 라벨과도 겹친다 — 시트 안에만 있는 CTA로 판정한다.
    expect(screen.getByTestId('group.challenge.submit')).toBeOnTheScreen();

    // 딥링크로 초대가 도착 — 작성 시트와 초대 시트가 동시에 뜨면 딤이 2겹이 된다.
    await act(async () => {
      rerender(<GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} inviteOpen />);
    });
    expect(screen.queryByTestId('group.challenge.submit')).toBeNull();

    // 초대 시트가 닫혀도 되살아나지 않는다(가리기만 한 게 아니라 state까지 내려간다).
    await act(async () => {
      rerender(<GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} />);
    });
    expect(screen.queryByTestId('group.challenge.submit')).toBeNull();
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

describe('챌린지 섹션', () => {
  test('상세·공지와 같은 date로 함께 조회하고 카드를 그린다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();

    // ⚠️ date를 넘겨야만 memberProgress가 실려 온다(2차 배관 결정 1) — 진행 리스트의 전제다.
    expect(mockGetChallenges).toHaveBeenCalledWith(GROUP_ID, '2026-08-01');
    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();
    expect(screen.getByText('30/60분')).toBeOnTheScreen();
  });

  test('챌린지만 실패하면 "챌린지 없음"으로 위장하지 않는다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockRejectedValueOnce(new Error('network'));
    await renderRoom();

    // 방의 뼈대(상세)와 공지 섹션은 그대로 뜬다.
    expect(screen.getByText('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.getByText('챌린지를 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.queryByText('아직 챌린지가 없어요')).toBeNull();
    // 만들기 진입점도 세우지 않는다 — 서버에 이미 있는 챌린지면 중복 생성으로 튕긴다.
    // 빈 상태의 '챌린지 만들기'뿐 아니라 **헤더의 ＋도 함께** 막아야 한다. 하나만 막으면
    // existingCategories가 빈 배열인 채 시트가 열려 이미 있는 종류를 고를 수 있게 된다.
    expect(screen.queryByText('챌린지 만들기')).toBeNull();
    expect(screen.queryByTestId('group.challenge.add')).toBeNull();
  });

  test('갱신만 실패하면 기존 카드를 유지한 채 알린다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValueOnce([challenge()]);
    await renderRoom();
    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();

    mockGetChallenges.mockRejectedValueOnce(new Error('network'));
    await focus();

    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();
    expect(screen.getByText('챌린지를 새로고침하지 못했어요')).toBeOnTheScreen();
  });

  test('빈 목록에서 갱신이 실패하면 빈 상태가 아니라 실패를 보여준다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    // 첫 조회는 []로 성공 — challenges가 null이 아니게 된다.
    mockGetChallenges.mockResolvedValueOnce([]);
    await renderRoom();
    expect(screen.getByText('아직 챌린지가 없어요')).toBeOnTheScreen();

    mockGetChallenges.mockRejectedValueOnce(new Error('network'));
    await focus();

    // 예전엔 '아직 챌린지가 없어요' + 만들기 버튼이 그대로 떠서 실패한 흔적이 화면에 없었다.
    expect(screen.getByText('챌린지를 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.queryByText('아직 챌린지가 없어요')).toBeNull();
    expect(screen.queryByText('챌린지 만들기')).toBeNull();
    expect(screen.queryByTestId('group.challenge.add')).toBeNull();
  });

  test('0건이면 방장에게만 만들기 진입점을 준다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();
    expect(screen.getByText('아직 챌린지가 없어요')).toBeOnTheScreen();
    expect(screen.getByText('챌린지 만들기')).toBeOnTheScreen();

    // 일반 멤버로 바꿔 다시 그린다 — 만들기는 방장 전용이라 시트를 열 자리 자체가 없어야 한다.
    mockGetGroupDetail.mockResolvedValue(
      detail({
        members: [
          { userId: 'me', nickname: '나', role: 'MEMBER', focusTimeMinutes: 30 },
          { userId: 'u2', nickname: '수빈', role: 'OWNER', focusTimeMinutes: 60 },
        ],
      }),
    );
    await focus();
    expect(screen.getByText('아직 챌린지가 없어요')).toBeOnTheScreen();
    expect(screen.queryByText('챌린지 만들기')).toBeNull();
    expect(screen.queryByTestId('group.challenge.add')).toBeNull();
  });

  test('방장이 카드를 롱프레스해 삭제하면 목록을 재조회한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    mockDeleteChallenge.mockResolvedValue(undefined);
    await renderRoom();

    await act(async () => {
      fireEvent(screen.getByTestId('group.challenge.card.c1'), 'longPress');
    });
    await act(async () => {
      alertSpy.mock.calls[0][2]?.find((b) => b.text === '삭제')?.onPress?.();
    });

    expect(mockDeleteChallenge).toHaveBeenCalledWith(GROUP_ID, 'c1');
    // 삭제 후 재조회 — 최초 1회 + 삭제 후 1회.
    await waitFor(() => expect(mockGetChallenges).toHaveBeenCalledTimes(2));
  });
});

// 내기(3차) — 화면이 하는 일은 시트 상태 보유와 성공 후 재조회뿐이다(§2).
// 내기 데이터는 challenges 응답에 이미 실려 있어 **추가 조회가 없어야** 한다.
describe('내기 배선', () => {
  test('카드에서 내기를 열어 개설하면 시트가 닫히고 챌린지를 재조회한다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    mockCreateBet.mockResolvedValue({ betId: 'b1' });
    await renderRoom();

    await press('내기 걸기');
    // 시트가 떴다 — 개설 모드 CTA.
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.submit'));
    });

    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, 'c1', {
      stake: 10,
      date: '2026-08-01',
    });
    // 성공 후 재조회 — 최초 1회 + 개설 후 1회.
    await waitFor(() => expect(mockGetChallenges).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('내기 열기')).toBeNull();
  });

  test('참가 진입은 그 카드의 betId로 이어진다(추가 조회 없음)', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([
      challenge({
        bet: {
          betId: 'b7',
          stake: 30,
          pot: 30,
          status: 'OPEN',
          myJoined: false,
          myAchievedNow: false,
          participants: [{ userId: 'u2', nickname: '수빈' }],
        },
      }),
    ]);
    mockJoinBet.mockResolvedValue(undefined);
    await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.join.c1'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.submit'));
    });

    expect(mockJoinBet).toHaveBeenCalledWith(GROUP_ID, 'b7');
    await waitFor(() => expect(mockGetChallenges).toHaveBeenCalledTimes(2));
  });
});

describe('⋯ 메뉴 — 그룹 전환·추가', () => {
  test('내장 렌더(onShowGroups 전달)에서만 항목이 보이고, 탭하면 콜백이 불린다', async () => {
    const onShowGroups = jest.fn();
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom({ onShowGroups });

    await act(async () => {
      fireEvent.press(screen.getByLabelText('그룹 메뉴'));
    });
    await press('그룹 전환·추가');
    expect(onShowGroups).toHaveBeenCalled();
  });

  test('라우트 진입(onShowGroups 미전달)에선 항목을 숨긴다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('그룹 메뉴'));
    });
    // 메뉴 자체는 열려 있다 — '그룹 나가기'는 두 경로 모두에 있다.
    expect(screen.getByText('그룹 나가기')).toBeOnTheScreen();
    expect(screen.queryByText('그룹 전환·추가')).toBeNull();
  });
});
