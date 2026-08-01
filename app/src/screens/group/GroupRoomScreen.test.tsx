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
import { Alert, AppState, Share, type AppStateStatus } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
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
const { logGroupInviteShared } = jest.requireMock('@/services/analyticsEvents');

// 초대 링크는 서버 발급분만 쓴다(초대 링크 스펙 §4-2 ①).
jest.mock('@/services/inviteLinkApi', () => ({ issueInviteLink: jest.fn() }));
const mockIssueInviteLink = jest.requireMock('@/services/inviteLinkApi')
  .issueInviteLink as jest.Mock;
const SLUG = 'ab23cd45';

// 내기 시트가 잔액을 읽고(CoinContext) 화면이 정산 감지 시 잔액을 다시 받는다 —
// 테스트 트리엔 Provider가 없어 훅을 대체하고, refresh는 호출을 세기 위해 한 개를 공유한다.
const mockRefreshCoins = jest.fn(async () => {});
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({
    coins: 100,
    coinsLoaded: true,
    coinsVersion: 1,
    latestCoinsVersion: () => 1,
    refresh: mockRefreshCoins,
  }),
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
const INVITE_URL = `https://link.oneorthree.world/l/${SLUG}?g=${GROUP_ID}`;
const onLeft = jest.fn();

let appStateHandler: ((state: AppStateStatus) => void) | null = null;

// 서버 에러 바디({ code })를 실은 axios 에러 — 화면은 status가 아니라 code로 분기한다(§3-2).
function axiosErrorWith(status: number, code: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { code, message: '...' },
  });
}

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
    // 내기를 아는 서버는 내기가 없을 때 null을 명시로 내려준다 — 필드 자체가 없는 응답은
    // '구버전 서버'라 카드가 내기 영역을 아예 그리지 않는다(ChallengeCard.betKnown).
    bet: null,
    lastSettledBet: null,
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
  mockIssueInviteLink.mockResolvedValue({ slug: SLUG, url: INVITE_URL });
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
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

  // 진행 중인 내기가 있으면 서버가 삭제를 막는다(CHALLENGE_HAS_OPEN_BET) — 이미 걷어 둔 판돈이
  // 갈 곳을 잃기 때문이다. 공통 문구로 떨어뜨리면 정산 전까진 영원히 같은 실패만 반복한다.
  test('진행 중인 내기가 있으면 삭제 불가 사유를 그대로 알린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    mockDeleteChallenge.mockRejectedValueOnce(axiosErrorWith(409, 'CHALLENGE_HAS_OPEN_BET'));
    await renderRoom();

    await act(async () => {
      fireEvent(screen.getByTestId('group.challenge.card.c1'), 'longPress');
    });
    await act(async () => {
      alertSpy.mock.calls[0][2]?.find((b) => b.text === '삭제')?.onPress?.();
    });

    expect(alertSpy).toHaveBeenLastCalledWith(
      '챌린지를 삭제할 수 없어요',
      '진행 중인 내기가 있어 삭제할 수 없어요.',
    );
    // 실패했으므로 목록을 다시 받지 않는다(카드는 그대로 살아 있다).
    expect(mockGetChallenges).toHaveBeenCalledTimes(1);
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

  // 시트가 challenge **객체 스냅샷**을 쥐면 배경 재조회(포커스·포그라운드 복귀)와 어긋난다 —
  // 팟 60·2명을 보며 30코인을 거는데 실제로는 팟 120·4명이다. 조용히 틀린 정보로 돈을 쓴다(F2).
  test('시트가 열린 채 재조회되면 최신 팟·참가자가 시트에 반영된다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    const openBet = {
      betId: 'b7',
      stake: 30,
      status: 'OPEN' as const,
      myJoined: false,
      myAchievedNow: false,
    };
    mockGetChallenges.mockResolvedValue([
      challenge({
        bet: { ...openBet, pot: 60, participants: [{ userId: 'u2', nickname: '수빈' }] },
      }),
    ]);
    await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.join.c1'));
    });
    expect(screen.getByText('참가자 1명')).toBeOnTheScreen();

    // 알림을 보고 돌아왔다 — 그 사이 두 명이 더 참가했다.
    mockGetChallenges.mockResolvedValue([
      challenge({
        bet: {
          ...openBet,
          pot: 120,
          participants: [
            { userId: 'u2', nickname: '수빈' },
            { userId: 'u3', nickname: '민지' },
            { userId: 'u4', nickname: '지훈' },
          ],
        },
      }),
    ]);
    await foreground();

    expect(await screen.findByText('참가자 3명')).toBeOnTheScreen();
    expect(screen.getByText('민지')).toBeOnTheScreen();
  });

  // 자정을 넘겨 복귀하면 서버는 **다른 날짜의 새 내기**를 준다 — 열었을 때의 betId로 참가하면
  // BET_CLOSED로 튕긴다. 판돈이 소리 없이 바뀌는 것도 막아야 해서 닫고 다시 열게 한다.
  test('참가하려던 내기가 다른 내기로 갈리면 닫고 재진입을 유도한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    const openBet = {
      stake: 30,
      pot: 30,
      status: 'OPEN' as const,
      myJoined: false,
      myAchievedNow: false,
      participants: [{ userId: 'u2', nickname: '수빈' }],
    };
    mockGetChallenges.mockResolvedValue([challenge({ bet: { ...openBet, betId: 'b7' } })]);
    await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.join.c1'));
    });
    expect(screen.getByText('참가하기')).toBeOnTheScreen();

    mockGetChallenges.mockResolvedValue([
      challenge({ bet: { ...openBet, betId: 'b8', stake: 100 } }),
    ]);
    await foreground();

    await waitFor(() => expect(screen.queryByText('참가하기')).toBeNull());
    expect(alertSpy).toHaveBeenLastCalledWith('내기가 바뀌었어요', '최신 내기로 다시 열어주세요.');
    expect(mockJoinBet).not.toHaveBeenCalled();
  });

  // betId만 비교하면 **같은 내기의 상태 전이**를 놓친다 — 시트는 계속 돈을 쓰는 CTA를 세운 채
  // BET_CLOSED·BET_ALREADY_JOINED를 받게 된다. 모드의 진입 조건이 최신 객체에서도 성립하는지 본다.
  test('참가하려던 내기가 마감되면 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    const openBet = {
      betId: 'b7',
      stake: 30,
      pot: 30,
      myJoined: false,
      myAchievedNow: false,
      participants: [{ userId: 'u2', nickname: '수빈' }],
    };
    mockGetChallenges.mockResolvedValue([
      challenge({ bet: { ...openBet, status: 'OPEN' as const } }),
    ]);
    await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.join.c1'));
    });
    expect(screen.getByText('참가하기')).toBeOnTheScreen();

    // 자정 정산이 돌았다 — 같은 betId지만 이제 참가할 수 없다.
    mockGetChallenges.mockResolvedValue([
      challenge({ bet: { ...openBet, status: 'SETTLED' as const } }),
    ]);
    await foreground();

    await waitFor(() => expect(screen.queryByText('참가하기')).toBeNull());
    expect(alertSpy).toHaveBeenLastCalledWith('마감된 내기예요', '이미 마감돼 참가할 수 없어요.');
    expect(mockJoinBet).not.toHaveBeenCalled();
  });

  test('다른 기기에서 이미 참가했으면 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    const openBet = {
      betId: 'b7',
      stake: 30,
      pot: 30,
      status: 'OPEN' as const,
      myAchievedNow: false,
      participants: [{ userId: 'u2', nickname: '수빈' }],
    };
    mockGetChallenges.mockResolvedValue([challenge({ bet: { ...openBet, myJoined: false } })]);
    await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.join.c1'));
    });
    expect(screen.getByText('참가하기')).toBeOnTheScreen();

    mockGetChallenges.mockResolvedValue([challenge({ bet: { ...openBet, myJoined: true } })]);
    await foreground();

    await waitFor(() => expect(screen.queryByText('참가하기')).toBeNull());
    expect(alertSpy).toHaveBeenLastCalledWith(
      '이미 참가한 내기예요',
      '최신 상태로 새로고침했어요.',
    );
    expect(mockJoinBet).not.toHaveBeenCalled();
  });

  // 개설 시트의 진입 조건은 '아직 내기가 없다' — 그새 누가 열었으면 개설은 BET_ALREADY_EXISTS로
  // 반드시 실패한다. 실패를 겪게 하는 대신 닫고 참가로 다시 들어오게 한다.
  test('개설 시트를 연 사이 내기가 열리면 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();

    await press('내기 걸기');
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();

    mockGetChallenges.mockResolvedValue([
      challenge({
        bet: {
          betId: 'b9',
          stake: 50,
          pot: 50,
          status: 'OPEN',
          myJoined: false,
          myAchievedNow: false,
          participants: [{ userId: 'u2', nickname: '수빈' }],
        },
      }),
    ]);
    await foreground();

    await waitFor(() => expect(screen.queryByText('내기 열기')).toBeNull());
    expect(alertSpy).toHaveBeenLastCalledWith(
      '이미 오늘 내기가 열려 있어요',
      '최신 상태예요. 참가하려면 다시 열어주세요.',
    );
    expect(mockCreateBet).not.toHaveBeenCalled();
  });

  // 개설 진입점의 나머지 한 축 — 끝난 챌린지엔 새로 돈을 걸 수 없다(카드의 betOpenable).
  // 서버 개설 경로는 챌린지 상태를 보지 않아 그대로 성립한다 — 막지 않으면 앱이 종료로 취급하는
  // 챌린지에 판돈만 빠져나간 내기가 남는다. 참가 쪽 상태 검사와 대칭이다.
  test('개설 시트를 연 사이 챌린지가 끝나면 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();

    await press('내기 걸기');
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();

    mockGetChallenges.mockResolvedValue([challenge({ status: 'INACTIVE' })]);
    await foreground();

    await waitFor(() => expect(screen.queryByText('내기 열기')).toBeNull());
    expect(alertSpy).toHaveBeenLastCalledWith(
      '끝난 챌린지예요',
      '종료된 챌린지에는 내기를 열 수 없어요.',
    );
    expect(mockCreateBet).not.toHaveBeenCalled();
  });

  // 참가 진입점도 카드에서 챌린지 상태(betOpenable)를 함께 요구한다 — 내기만 OPEN인 채 챌린지가
  // 끝나면 카드의 참가 행은 사라지는데 열린 시트만 판돈 차감 요청을 보낼 수 있다.
  test('참가 시트를 연 사이 챌린지가 끝나면 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    const openBet = {
      betId: 'b7',
      stake: 30,
      pot: 30,
      status: 'OPEN' as const,
      myJoined: false,
      myAchievedNow: false,
      participants: [{ userId: 'u2', nickname: '수빈' }],
    };
    mockGetChallenges.mockResolvedValue([challenge({ bet: openBet })]);
    await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.join.c1'));
    });
    expect(screen.getByText('참가하기')).toBeOnTheScreen();

    // 내기는 그대로 OPEN인데 챌린지만 끝났다 — 카드 기준으로는 이미 참가할 수 없는 자리다.
    mockGetChallenges.mockResolvedValue([challenge({ status: 'INACTIVE', bet: openBet })]);
    await foreground();

    await waitFor(() => expect(screen.queryByText('참가하기')).toBeNull());
    expect(alertSpy).toHaveBeenLastCalledWith(
      '끝난 챌린지예요',
      '종료된 챌린지의 내기에는 참가할 수 없어요.',
    );
    expect(mockJoinBet).not.toHaveBeenCalled();
  });

  // 순차 배포 — 내기를 아는 서버로 시트를 연 뒤 구버전 서버(bet 필드 생략)에 붙으면, undefined를
  // null로 뭉갠 채 두면 없는 엔드포인트로 개설 요청만 나간다. 카드는 이미 진입점을 숨긴 상태다.
  test('개설 시트를 연 사이 서버가 내기를 모르는 응답을 주면 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();

    await press('내기 걸기');
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();

    mockGetChallenges.mockResolvedValue([challenge({ bet: undefined })]);
    await foreground();

    await waitFor(() => expect(screen.queryByText('내기 열기')).toBeNull());
    expect(alertSpy).toHaveBeenLastCalledWith(
      '내기를 열 수 없어요',
      '지금은 내기를 이용할 수 없어요. 잠시 후 다시 시도해주세요.',
    );
    expect(mockCreateBet).not.toHaveBeenCalled();
  });

  // 달성 전이는 시트를 닫지 않는다 — 고른 판돈을 보고 있는 화면을 걷을 이유가 없어 CTA만 잠근다.
  // 내기가 없는 챌린지엔 bet.myAchievedNow가 없어, 화면이 진행률에서 파생해 시트로 내려준다.
  test('개설 시트를 연 사이 내가 목표를 달성하면 CTA만 잠근다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();

    await press('내기 걸기');
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();

    // 집중 세션이 끝나 오늘 목표를 채웠다 — 서버는 이제 개설도 거절한다(BET_ALREADY_ACHIEVED).
    mockGetChallenges.mockResolvedValue([
      challenge({
        memberProgress: [{ userId: 'me', nickname: '나', progressMinutes: 60, achieved: true }],
      }),
    ]);
    await foreground();

    // 카드와 시트가 **같은 문장**으로 같은 사실을 말한다(그래서 2개다).
    await waitFor(() =>
      expect(screen.getAllByText('이미 오늘 목표를 달성해서 내기를 열 수 없어요')).toHaveLength(2),
    );
    // 시트는 닫지 않는다 — 고른 판돈을 보고 있는 화면을 걷지 않고 CTA만 잠근다.
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.submit'));
    });
    expect(mockCreateBet).not.toHaveBeenCalled();
  });

  test('시트가 가리키던 챌린지가 사라지면 시트를 닫는다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();

    await press('내기 걸기');
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();

    // 방장이 챌린지를 지웠다 — 없는 챌린지의 낡은 화면으로 돈을 걸게 둘 수 없다.
    mockGetChallenges.mockResolvedValue([]);
    await foreground();

    await waitFor(() => expect(screen.queryByText('내기 열기')).toBeNull());
  });

  // 성공 후 재조회 전 카드는 아직 '내기 걸기'다 — 다시 누르면 409가 나고,
  // "다른 그룹원이 먼저 열었어요"라는 **거짓** 안내를 본다. 재진입 자체를 막는다(F6).
  test('개설 성공 후 재조회가 끝날 때까지 내기 진입점을 잠근다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    mockCreateBet.mockResolvedValue({ betId: 'b1' });

    // 재조회를 테스트가 붙잡아 '느린 회선'의 창을 만든다.
    let finishReload: (v: GroupChallengeResponse[]) => void = () => {};
    await renderRoom();
    mockGetChallenges.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReload = resolve;
        }),
    );

    await press('내기 걸기');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.submit'));
    });

    // 시트는 닫혔고 카드는 아직 내기 이전 모습이다 — 그래도 눌리지 않아야 한다.
    expect(screen.queryByText('내기 열기')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.create.c1'));
    });
    expect(screen.queryByText('내기 열기')).toBeNull();
    expect(mockCreateBet).toHaveBeenCalledTimes(1);

    // 재조회가 끝나면 다시 열린다.
    await act(async () => {
      finishReload([challenge({ bet: null })]);
    });
    await press('내기 걸기');
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();
  });

  // load()는 allSettled라 챌린지만 실패해도 정상 resolve한다 — 그걸로 잠금을 풀면 판돈은 이미
  // 빠졌는데 '내기 이전' 카드의 진입점이 다시 열려 같은 요청을 반복하고 서버 오류를 보게 된다.
  test('개설 후 챌린지 재조회가 실패하면 잠금을 유지하고, 다음 성공에서 푼다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    mockCreateBet.mockResolvedValue({ betId: 'b1' });
    await renderRoom();

    // 개설 직후의 재조회만 실패시킨다.
    mockGetChallenges.mockRejectedValueOnce(new Error('network'));

    await press('내기 걸기');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.submit'));
    });

    await waitFor(() =>
      expect(screen.getByText('챌린지를 새로고침하지 못했어요')).toBeOnTheScreen(),
    );
    // 카드는 아직 '내기 이전' 모습이다 — 진입점은 잠긴 채여야 한다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.create.c1'));
    });
    expect(screen.queryByText('내기 열기')).toBeNull();
    expect(mockCreateBet).toHaveBeenCalledTimes(1);

    // 다음 성공한 재조회가 잠금을 푼다(당겨서 새로고침·포커스·포그라운드 복귀).
    mockGetChallenges.mockResolvedValue([challenge({ bet: null })]);
    await foreground();

    await press('내기 걸기');
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();
  });

  // 정산은 서버 배치(04:00)가 한다 — 앱을 켜 둔 채 정산이 돌면 카드엔 당첨·환불 결과가 뜨는데
  // 전역 잔액만 정산 전 값으로 남아, 지급받은 코인을 상점에서 쓸 수 없다(코덱스 리뷰).
  test('내 내기가 정산돼 돌아오면 코인 잔액도 다시 받는다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();

    // 첫 조회는 비교 대상이 없어 재조회하지 않는다(마운트 시 CoinContext가 이미 받는다).
    mockRefreshCoins.mockClear();
    await foreground();
    expect(mockRefreshCoins).not.toHaveBeenCalled();

    // 배치가 돌았다 — 내 결과가 실린 정산 내기가 새로 도착한다.
    mockGetChallenges.mockResolvedValue([
      challenge({
        lastSettledBet: {
          betDate: '2026-07-31',
          stake: 30,
          pot: 60,
          status: 'SETTLED',
          results: [
            { userId: 'me', nickname: '나', achieved: true, payout: 60 },
            { userId: 'u2', nickname: '수빈', achieved: false, payout: 0 },
          ],
        },
      }),
    ]);
    await foreground();

    await waitFor(() => expect(mockRefreshCoins).toHaveBeenCalled());
  });

  test('내가 없는 내기의 정산으로는 잔액을 다시 받지 않는다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();
    mockRefreshCoins.mockClear();

    // 남들끼리 건 내기가 정산됐다 — 내 잔액은 움직이지 않았으므로 조회할 이유가 없다.
    mockGetChallenges.mockResolvedValue([
      challenge({
        lastSettledBet: {
          betDate: '2026-07-31',
          stake: 30,
          pot: 60,
          status: 'SETTLED',
          results: [
            { userId: 'u2', nickname: '수빈', achieved: true, payout: 60 },
            { userId: 'u3', nickname: '민지', achieved: false, payout: 0 },
          ],
        },
      }),
    ]);
    await foreground();

    expect(mockRefreshCoins).not.toHaveBeenCalled();
  });

  // 계약상 payout은 null일 수 있다(부분 정산 실패) — 복구 작업이 같은 내기의 payout만 채우면
  // 챌린지·날짜·상태는 그대로다. 서명이 그 셋뿐이면 두 응답이 같은 사건으로 뭉개져 **지급이
  // 확정된 순간**을 놓치고, 카드엔 지급액이 뜨는데 잔액은 정산 전 값에 머문다(코덱스 리뷰).
  test('같은 내기라도 내 지급액이 채워지면 잔액을 다시 받는다', async () => {
    const settling = (payout: number | null) =>
      challenge({
        lastSettledBet: {
          betDate: '2026-07-31',
          stake: 30,
          pot: 60,
          status: 'SETTLED' as const,
          results: [{ userId: 'me', nickname: '나', achieved: true, payout }],
        },
      });

    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();

    // 정산은 됐는데 지급이 아직 안 실린 응답이 먼저 도착한다.
    mockGetChallenges.mockResolvedValue([settling(null)]);
    await foreground();
    mockRefreshCoins.mockClear();

    // 복구 작업이 payout만 채웠다 — 이때가 잔액이 실제로 바뀐 순간이다.
    mockGetChallenges.mockResolvedValue([settling(60)]);
    await foreground();

    await waitFor(() => expect(mockRefreshCoins).toHaveBeenCalled());
  });
});

// 내장 렌더(GroupScreen의 1건 분기)는 그룹이 A 한 건에서 B 한 건으로 바뀌어도 같은 인스턴스를
// 재사용한다 — 이전 그룹의 화면이 남은 채 mutation만 새 groupId로 나가면 영구 실패가 된다.
describe('그룹 전환(같은 인스턴스에 다른 groupId)', () => {
  const OTHER_GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';

  test('groupId가 바뀌면 열린 내기 시트와 이전 그룹의 화면을 즉시 버린다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([
      challenge({
        bet: {
          betId: 'b7',
          stake: 30,
          pot: 30,
          status: 'OPEN' as const,
          myJoined: false,
          myAchievedNow: false,
          participants: [{ userId: 'u2', nickname: '수빈' }],
        },
      }),
    ]);
    const { rerender } = await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.join.c1'));
    });
    expect(screen.getByText('참가하기')).toBeOnTheScreen();

    // 새 그룹의 응답은 **아직 하나도 오지 않았다** — 재조회가 낡은 화면을 걷어 주기를 기대할 수
    // 없는 상태로 두고, 전환 그 자체만으로 시트와 이전 그룹 데이터가 사라지는지 본다.
    mockGetGroupDetail.mockReturnValueOnce(new Promise(() => {}));
    mockGetChallenges.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      rerender(<GroupRoomScreen groupId={OTHER_GROUP_ID} onLeft={onLeft} />);
    });

    expect(screen.queryByText('참가하기')).toBeNull();
    expect(screen.queryByTestId('group.bet.join.c1')).toBeNull();
    expect(screen.queryByText('아침 6시 집중방')).toBeNull();

    // 조회는 새 groupId로 나간다 — 시트가 남아 있었다면 이 id로 참가 요청이 갔을 자리다.
    expect(mockGetGroupDetail).toHaveBeenLastCalledWith(OTHER_GROUP_ID, '2026-08-01');
    expect(mockGetChallenges).toHaveBeenLastCalledWith(OTHER_GROUP_ID, '2026-08-01');
    expect(mockJoinBet).not.toHaveBeenCalled();
  });

  // 전환 시 초기화(위 테스트)가 있어도, 전환 **전** 렌더에서 캡처된 내기 완료 콜백은 응답이
  // 늦게 도착하면 그대로 실행된다 — 가드가 없으면 이전 그룹의 load()가 seq를 올려 새 그룹의
  // 진행 중 조회를 무효화하고 이전 그룹 데이터를 새 화면에 되씌운다(코덱스 리뷰).
  test('전환 전 그룹의 내기 참가가 늦게 성공해도 이전 그룹을 재조회하지 않는다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([
      challenge({
        bet: {
          betId: 'b7',
          stake: 30,
          pot: 30,
          status: 'OPEN' as const,
          myJoined: false,
          myAchievedNow: false,
          participants: [{ userId: 'u2', nickname: '수빈' }],
        },
      }),
    ]);
    let resolveJoin: () => void = () => {};
    mockJoinBet.mockReturnValue(
      new Promise((resolve) => {
        resolveJoin = () => resolve(undefined);
      }),
    );
    const { rerender } = await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.join.c1'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.submit'));
    });

    // 참가 응답이 오기 전에 그룹 B로 전환 — B의 조회는 pending으로 둬, 뒤이은 재조회가
    // 덮어써진 화면을 걷어 주기를 기대할 수 없는 상태로 만든다.
    mockGetGroupDetail.mockReturnValue(new Promise(() => {}));
    mockGetChallenges.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      rerender(<GroupRoomScreen groupId={OTHER_GROUP_ID} onLeft={onLeft} />);
    });
    mockGetGroupDetail.mockClear();
    mockGetChallenges.mockClear();

    // 이제야 A의 참가 응답이 도착한다 — 전환 전 렌더에서 캡처된 onDone이 실행되는 순간.
    await act(async () => {
      resolveJoin();
    });

    // 이전 그룹으로의 재조회가 시작되지 않아야 한다(시작되면 B의 진행 중 조회까지 무효화된다).
    expect(mockGetGroupDetail).not.toHaveBeenCalled();
    expect(mockGetChallenges).not.toHaveBeenCalled();
  });

  test('새 그룹의 첫 정산 서명으로는 잔액을 다시 받지 않는다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    // 이전 그룹에서는 내 정산 결과를 이미 본 상태다.
    mockGetChallenges.mockResolvedValue([
      challenge({
        lastSettledBet: {
          betDate: '2026-07-31',
          stake: 30,
          pot: 60,
          status: 'SETTLED' as const,
          results: [{ userId: 'me', nickname: '나', achieved: true, payout: 60 }],
        },
      }),
    ]);
    const { rerender } = await renderRoom();
    mockRefreshCoins.mockClear();

    // 새 그룹엔 정산 내역이 없다 — 서명이 '달라졌다'고 세면 남의 그룹 때문에 잔액을 다시 받는다.
    mockGetGroupDetail.mockResolvedValue(detail({ id: OTHER_GROUP_ID }));
    mockGetChallenges.mockResolvedValue([challenge()]);
    await act(async () => {
      rerender(<GroupRoomScreen groupId={OTHER_GROUP_ID} onLeft={onLeft} />);
    });

    expect(mockRefreshCoins).not.toHaveBeenCalled();
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

// ── 초대 링크 공유(초대 링크 스펙 §4-2 ①·§7-4) ─────────────────────────────────
// 링크는 서버가 발급한 url 만 나간다. 앱이 조립하던 구 링크(github.io)는 실제로 404였고,
// slug 가 빠지면 클릭→설치→가입이 어느 초대에서 왔는지 서버가 영영 이을 수 없다.
describe('초대 링크 공유', () => {
  test('서버 발급 url 로 공유하고 slug·group_id 를 함께 계측한다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();

    await press('초대 링크로 친구 부르기');

    expect(mockIssueInviteLink).toHaveBeenCalledWith(GROUP_ID);
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(INVITE_URL) }),
    );
    expect(logGroupInviteShared).toHaveBeenCalledWith({
      share_method: 'share_sheet',
      confirmed: expect.any(Boolean),
      slug: SLUG,
      group_id: GROUP_ID,
    });
  });

  test('발급 실패면 공유 시트를 띄우지 않고 안내한다(폴백 링크 없음)', async () => {
    mockIssueInviteLink.mockRejectedValueOnce(new Error('network'));
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();

    await press('초대 링크로 친구 부르기');

    expect(Share.share).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('초대 링크를 만들지 못했어요', expect.any(String));
    expect(logGroupInviteShared).not.toHaveBeenCalled();
  });
});
