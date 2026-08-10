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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, AppState, Share, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupRoomScreen from './GroupRoomScreen';
import { buildInviteShareMessage } from './inviteShare';
import {
  createBet,
  deleteChallenge,
  getAnnouncements,
  getChallenges,
  getGroupDetail,
  getMyChallengeResults,
  joinBet,
} from '@/services/groupApi';
import { todayStrKst } from '@/utils/localDate';
import type {
  GroupAnnouncementResponse,
  GroupChallengeResponse,
  GroupDetailResponse,
  MyChallengeResultEntry,
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
  logGroupRoomViewed: jest.fn(),
  logGroupChallengeResultShown: jest.fn(),
  logGroupChallengeResultClosed: jest.fn(),
}));
const { logGroupInviteShared, logGroupChallengeResultShown } = jest.requireMock(
  '@/services/analyticsEvents',
);

// 초대 링크는 서버 발급분만 쓴다(초대 링크 스펙 §4-2 ①).
jest.mock('@/services/inviteLinkApi', () => ({ issueInviteLink: jest.fn() }));
const mockIssueInviteLink = jest.requireMock('@/services/inviteLinkApi')
  .issueInviteLink as jest.Mock;
const SLUG = 'ab23cd45';

// 내기 시트가 잔액을 읽고(CoinContext) 화면이 정산 감지 시 잔액을 다시 받는다 —
// 테스트 트리엔 Provider가 없어 훅을 대체하고, refresh는 호출을 세기 위해 한 개를 공유한다.
// 반환값은 '잔액이 실제로 반영됐는가'(GROMO-1024) — 기본은 성공이고, 실패 케이스가 직접 바꾼다.
const mockRefreshCoins = jest.fn(async () => true);
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({
    // 최고 프리셋(3,000 — N30 상한)까지 잠기지 않는 잔액 — 이 스위트는 배선만 보고
    // 부족 분기는 BetSheet.test가 잠근다.
    coins: 5000,
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
  getMyChallengeResults: jest.fn(),
  deleteChallenge: jest.fn(),
  withdrawGroup: jest.fn(),
  createBet: jest.fn(),
  joinBet: jest.fn(),
}));

// 날짜 경계를 테스트가 직접 옮긴다. kstDateStr은 결과 후보의 createdAt 판정이 실제로 돌게
// 실물을 쓴다(challengeResult.ts). 조회 기준일·내기 생성 경로는 전부 KST 버전이다(GROMO-1219 —
// 서버 날짜 판정이 KST 고정). **로컬 버전은 일부러 다른 날짜로 고정한다** — 코드가 로컬 축을
// 부르면 date 단언이 하루 어긋나 곧장 드러난다(축 분리 검증).
jest.mock('@/utils/localDate', () => ({
  todayStr: jest.fn(() => '2026-07-31'),
  yesterdayStr: jest.fn(() => '2026-07-30'),
  todayStrKst: jest.fn(() => '2026-08-01'),
  yesterdayStrKst: jest.fn(() => '2026-07-31'),
  tomorrowStrKst: jest.fn(() => '2026-08-02'),
  localDateStr: jest.requireActual('@/utils/localDate').localDateStr,
  kstDateStr: jest.requireActual('@/utils/localDate').kstDateStr,
}));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockGetAnnouncements = getAnnouncements as jest.MockedFunction<typeof getAnnouncements>;
const mockGetChallenges = getChallenges as jest.MockedFunction<typeof getChallenges>;
const mockGetMyChallengeResults = getMyChallengeResults as jest.MockedFunction<
  typeof getMyChallengeResults
>;
const mockDeleteChallenge = deleteChallenge as jest.MockedFunction<typeof deleteChallenge>;
const mockCreateBet = createBet as jest.MockedFunction<typeof createBet>;
const mockJoinBet = joinBet as jest.MockedFunction<typeof joinBet>;
const mockTodayStrKst = todayStrKst as jest.MockedFunction<typeof todayStrKst>;
const mockYesterdayStrKst = jest.requireMock('@/utils/localDate').yesterdayStrKst as jest.Mock;

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
      { userId: 'me', nickname: '나', role: 'OWNER', focusTimeMinutes: 30, totalFocusMinutes: 30 },
      {
        userId: 'u2',
        nickname: '수빈',
        role: 'MEMBER',
        focusTimeMinutes: 60,
        totalFocusMinutes: 60,
      },
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

beforeEach(async () => {
  jest.clearAllMocks();
  // 결과 모달 1회 가드가 파일 안 테스트끼리 새지 않게 비운다(공식 mock은 인메모리 영속).
  await AsyncStorage.clear();
  mockFocusEntries.length = 0;
  mockTodayStrKst.mockReturnValue('2026-08-01');
  mockYesterdayStrKst.mockReturnValue('2026-07-31');
  // 챌린지·결과 큐는 대부분의 케이스에서 관심사가 아니다 — 빈 목록을 기본값으로 깔아 둔다.
  mockGetChallenges.mockResolvedValue([]);
  mockGetMyChallengeResults.mockResolvedValue([]);
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
    mockTodayStrKst.mockReturnValue('2026-08-02');
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
    // existingCombos가 빈 배열인 채 시트가 열려 이미 있는 조합을 고를 수 있게 된다.
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
          {
            userId: 'me',
            nickname: '나',
            role: 'MEMBER',
            focusTimeMinutes: 30,
            totalFocusMinutes: 30,
          },
          {
            userId: 'u2',
            nickname: '수빈',
            role: 'OWNER',
            focusTimeMinutes: 60,
            totalFocusMinutes: 60,
          },
        ],
      }),
    );
    await focus();
    expect(screen.getByText('아직 챌린지가 없어요')).toBeOnTheScreen();
    expect(screen.queryByText('챌린지 만들기')).toBeNull();
    expect(screen.queryByTestId('group.challenge.add')).toBeNull();
  });

  // GROMO-1222 — 시트로 넘기는 파생이 (카테고리, 방식) **조합**을 보존하는지 잠근다. 카테고리만
  // 넘기면 창형만 있는 카테고리에서 매트릭스가 반전된다(되는 매일 목표가 잠기고, 409가 확정된
  // 시간대가 초기 선택으로 온다). 종료(INACTIVE) 챌린지는 다시 만들 수 있으므로 점유로 세지 않는다.
  test('창형 챌린지만 있으면 만들기 시트의 매일 목표는 열려 있다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([
      challenge({
        id: 'c1',
        missionType: 'TIME_WINDOW',
        windowStart: '2026-08-01T09:00:00+09:00',
        windowEnd: '2026-08-01T12:00:00+09:00',
      }),
      // 종료된 매일 목표 챌린지 — ACTIVE가 아니므로 조합 점유가 아니다.
      challenge({ id: 'c2', status: 'INACTIVE' }),
    ]);
    await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.add'));
    });

    // 매일 목표는 열려 초기 선택으로 온다 — 카테고리만 넘기던 파생에선 여기가 잠긴다.
    expect(screen.getByTestId('group.challenge.type.DURATION')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: false, selected: true }),
    );
    // 실제로 점유된 조합(FOCUS×시간대)은 잠긴다 — 조합이 그대로 건너간 증거다.
    expect(screen.getByTestId('group.challenge.type.TIME_WINDOW')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true, selected: false }),
    );
  });

  test('방장이 카드의 X 버튼으로 삭제하면 목록을 재조회한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    mockDeleteChallenge.mockResolvedValue(undefined);
    await renderRoom();

    // 롱프레스 삭제는 X 버튼으로 대체됐다(GROMO-1101 — ChallengeCard.test가 상세를 잠근다).
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.c1'));
    });
    await act(async () => {
      alertSpy.mock.calls[0][2]?.find((b) => b.text === '삭제')?.onPress?.();
    });

    expect(mockDeleteChallenge).toHaveBeenCalledWith(GROUP_ID, 'c1');
    // 삭제 후 재조회 — 챌린지 조회는 오늘 1콜(결과 큐는 /me/challenge-results로 분리 — 1279).
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
      fireEvent.press(screen.getByTestId('group.challenge.delete.c1'));
    });
    await act(async () => {
      alertSpy.mock.calls[0][2]?.find((b) => b.text === '삭제')?.onPress?.();
    });

    expect(alertSpy).toHaveBeenLastCalledWith(
      '챌린지를 삭제할 수 없어요',
      '진행 중인 내기가 있어 삭제할 수 없어요.',
    );
    // 실패했으므로 목록을 다시 받지 않는다(카드는 그대로 살아 있다) — 최초 조회의 오늘 1콜뿐.
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

    // 기본 참가비 = 가장 낮은 프리셋(상한 3,000의 10% = 300 — N30·GROMO-1424).
    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, 'c1', {
      stake: 300,
      date: '2026-08-01',
    });
    // 성공 후 재조회 — 조회 1회당 오늘 1콜(결과 큐 분리 — 1279): 최초 1콜 + 개설 후 1콜.
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
    // 조회 1회당 오늘 1콜(결과 큐 분리 — 1279): 최초 1콜 + 참가 후 재조회 1콜.
    await waitFor(() => expect(mockGetChallenges).toHaveBeenCalledTimes(2));
  });

  // 시트가 challenge **객체 스냅샷**을 쥐면 배경 재조회(포커스·포그라운드 복귀)와 어긋난다 —
  // 팟 60·2명을 보며 30코인을 거는데 실제로는 팟 120·4명이다. 조용히 틀린 정보로 돈을 쓴다(F2).
  test('시트가 열린 채 재조회되면 최신 적립금·참가자가 시트에 반영된다', async () => {
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

  // 서버는 오늘 내기가 없으면 **내일** OPEN 내기를 폴백으로 내려줄 수 있다(계약 §3 응답 보수) —
  // 그때 '오늘 내기가 열려 있어요'는 거짓이다(GROMO-1219, 결정 D10). KST 오늘과 bet.date를
  // 비교해 문구를 가른다(#512가 확정한 결: '이미 {오늘/내일} 내기가 열려 있어요').
  test('개설 시트를 연 사이 열린 내기가 내일 폴백이면 "내일" 문구로 닫는다', async () => {
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
          betId: 'b10',
          date: '2026-08-02', // KST 오늘(2026-08-01)보다 뒤 — 내일 폴백 내기
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
      '이미 내일 내기가 열려 있어요',
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

  // 서명을 먼저 확정하면 refresh가 일시 실패해도(throw 없이 coinsLoaded만 내려간다) 이후
  // 조회가 전부 같은 서명으로 판단해 **영구히** 재시도하지 않는다 — 카드엔 지급 결과가 뜨는데
  // 잔액은 정산 전 값으로 남는다(GROMO-1024). 확정은 동기화 성공 뒤여야 한다.
  test('정산 감지 후 잔액 동기화가 실패하면 다음 조회가 다시 시도한다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();
    mockRefreshCoins.mockClear();

    // 배치가 돌았다 — 내 결과가 실린 정산 내기가 도착하는데, 하필 잔액 조회가 실패한다.
    mockGetChallenges.mockResolvedValue([
      challenge({
        lastSettledBet: {
          betDate: '2026-07-31',
          stake: 30,
          pot: 60,
          status: 'SETTLED',
          results: [{ userId: 'me', nickname: '나', achieved: true, payout: 60 }],
        },
      }),
    ]);
    mockRefreshCoins.mockResolvedValueOnce(false);
    await foreground();
    expect(mockRefreshCoins).toHaveBeenCalledTimes(1);

    // 같은 정산 응답이 다시 온다 — 서명이 확정되지 않았으므로 같은 변화로 다시 감지해 재시도한다.
    await foreground();
    expect(mockRefreshCoins).toHaveBeenCalledTimes(2);

    // 이번엔 성공했다(기본 목 true) — 서명이 확정돼 더는 재시도하지 않는다.
    await foreground();
    expect(mockRefreshCoins).toHaveBeenCalledTimes(2);
  });

  // 갱신 실패 중의 카드는 낡은 스냅샷이다 — 그 팟·참가자를 보고 보내는 참가를 서버는 정상
  // 수락하므로, 오류 분기로는 잘못된 사전 표시를 바로잡을 수 없다. 진입 자체를 막는다(GROMO-1026).
  test('챌린지 갱신 실패 중에는 낡은 카드로 내기 시트를 열 수 없다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();

    // 포그라운드 복귀의 챌린지 갱신만 실패 — 기존 카드는 남고 배너가 뜬다.
    mockGetChallenges.mockRejectedValueOnce(new Error('network'));
    await foreground();
    expect(screen.getByText('챌린지를 새로고침하지 못했어요')).toBeOnTheScreen();

    // 카드는 보이지만 내기 진입은 잠겨 있어야 한다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.create.c1'));
    });
    expect(screen.queryByText('내기 열기')).toBeNull();

    // 다음 성공 조회가 잠금을 푼다.
    await foreground();
    await press('내기 걸기');
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();
  });
});

// 이미 스택에 있는 'GroupRoom' 라우트로 다시 navigate 하면(params 병합) 같은 인스턴스가 다른
// groupId로 재사용된다 — 이전 그룹의 화면이 남은 채 mutation만 새 groupId로 나가면 영구 실패가 된다.
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
    // (챌린지는 오늘+어제 2콜이라 Last 대신 인자 매칭으로 본다 — A3)
    expect(mockGetGroupDetail).toHaveBeenLastCalledWith(OTHER_GROUP_ID, '2026-08-01');
    expect(mockGetChallenges).toHaveBeenCalledWith(OTHER_GROUP_ID, '2026-08-01');
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

  // 1024의 서명 확정은 refreshCoins()를 **기다린 뒤**라 새 비동기 창이 생겼다 — 대기 중 그룹이
  // 바뀌면 전환 리셋(서명 null)이 먼저 일어나고, 늦은 확정이 이전 그룹의 서명을 되살리면 새
  // 그룹의 다음 조회가 '남의 정산'과 비교해 잔액을 다시 받는다. 확정 전 seq 재검사가 막는다.
  test('잔액 동기화 대기 중 그룹이 바뀌면 늦은 서명 확정이 새 그룹을 오염시키지 않는다', async () => {
    const settled = (payout: number | null) =>
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
    // 첫 조회 — 지급 미확정 정산이 실려 온다(서명의 비교 기준이 된다).
    mockGetChallenges.mockResolvedValue([settled(null)]);
    const { rerender } = await renderRoom();
    mockRefreshCoins.mockClear();

    // 지급이 채워졌다 — 정산 감지로 잔액 동기화가 시작되는데, 응답을 붙잡아 둔다.
    let finishRefresh: (ok: boolean) => void = () => {};
    mockRefreshCoins.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    mockGetChallenges.mockResolvedValue([settled(60)]);
    await foreground();
    expect(mockRefreshCoins).toHaveBeenCalledTimes(1);

    // 동기화가 떠 있는 채 그룹 B로 전환 — B의 첫 조회는 자기 정산을 싣고 정상 완료된다
    // (첫 서명은 비교 대상이 없어 잔액을 받지 않는 것이 규칙이다).
    mockGetGroupDetail.mockResolvedValue(detail({ id: OTHER_GROUP_ID }));
    mockGetChallenges.mockResolvedValue([
      challenge({
        id: 'c9',
        lastSettledBet: {
          betDate: '2026-07-31',
          stake: 50,
          pot: 100,
          status: 'SETTLED' as const,
          results: [{ userId: 'me', nickname: '나', achieved: false, payout: 0 }],
        },
      }),
    ]);
    await act(async () => {
      rerender(<GroupRoomScreen groupId={OTHER_GROUP_ID} onLeft={onLeft} />);
    });

    // 이제야 A의 동기화가 성공으로 끝난다 — 낡은 확정은 버려져야 한다.
    await act(async () => {
      finishRefresh(true);
    });

    // B의 같은 응답을 다시 받아도 잔액을 받지 않아야 한다 — 늦은 확정이 A의 서명을 심어 뒀다면
    // B의 서명과 달라 '정산 변화'로 오인해 여기서 한 번 더 불렸을 것이다.
    await foreground();
    expect(mockRefreshCoins).toHaveBeenCalledTimes(1);
  });

  // 삭제 실패 Alert는 groupId를 보지 않았다 — 응답 전에 그룹이 바뀌면 B 화면 위에 A의 삭제
  // 실패 안내가 뜬다(GROMO-1027). onDone·onCreated와 같은 가드로 무시해야 한다.
  test('전환 전 그룹의 챌린지 삭제가 늦게 실패해도 새 화면에 Alert를 띄우지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    let rejectDelete: (e: unknown) => void = () => {};
    mockDeleteChallenge.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectDelete = reject;
      }),
    );
    const { rerender } = await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.c1'));
    });
    await act(async () => {
      alertSpy.mock.calls[0][2]?.find((b) => b.text === '삭제')?.onPress?.();
    });

    // 응답 전에 그룹 B로 전환 — B의 조회는 pending으로 둔다(재조회가 걷어 주기를 기대하지 않는다).
    mockGetGroupDetail.mockReturnValue(new Promise(() => {}));
    mockGetChallenges.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      rerender(<GroupRoomScreen groupId={OTHER_GROUP_ID} onLeft={onLeft} />);
    });
    alertSpy.mockClear();
    mockGetChallenges.mockClear();

    // 이제야 A의 삭제 실패가 도착한다 — B 화면 위엔 아무것도 띄우지 않고, 재조회도 시작하지 않는다.
    await act(async () => {
      rejectDelete(axiosErrorWith(409, 'CHALLENGE_HAS_OPEN_BET'));
    });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockGetChallenges).not.toHaveBeenCalled();
  });
});

describe('⋯ 버튼 → 그룹 설정', () => {
  // 나가기·프로필·관리는 그룹 설정 화면(GroupSettings)으로 이관됐다(A안) — 그룹방 ⋯ 는 그 화면을
  // 바로 연다. 실제 나가기/host-withdraw 분기는 GroupSettingsScreen.test.tsx 에서 검증한다.
  test('⋯ 를 누르면 그룹 설정 화면으로 이동한다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('그룹 설정'));
    });

    expect(mockNavigate).toHaveBeenCalledWith('GroupSettings', { groupId: GROUP_ID });
  });
});

// 챌린지 내역 링크(GROMO-1277 · N6-1) — **이력의 소유자는 그룹이다.** 그래서 진입점이 챌린지
// 목록의 상태에 매달리면 안 된다: 챌린지가 하나도 없거나 조회가 실패한 순간에도 "돈이 오간
// 기록은 사라지지 않는다"는 약속을 확인할 수 있어야 한다.
describe('챌린지 내역 링크', () => {
  test('그룹 축 내역 화면으로 필터 없이 이동한다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValue([challenge()]);
    await renderRoom();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.history'));
    });

    expect(mockNavigate).toHaveBeenCalledWith('GroupChallengeHistory', { groupId: GROUP_ID });
  });

  test('챌린지가 없거나 조회가 실패해도 링크는 선다 — 내역은 챌린지와 함께 죽지 않는다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetChallenges.mockResolvedValueOnce([]);
    await renderRoom();
    expect(screen.getByTestId('group.challenge.history')).toBeOnTheScreen();

    mockGetChallenges.mockRejectedValueOnce(new Error('network'));
    await renderRoom();
    expect(screen.getByText('챌린지를 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.getByTestId('group.challenge.history')).toBeOnTheScreen();
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

    await press('초대');

    expect(mockIssueInviteLink).toHaveBeenCalledWith(GROUP_ID);
    expect(Share.share).toHaveBeenCalledWith({
      message: buildInviteShareMessage('아침 6시 집중방', INVITE_URL),
    });
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

    await press('초대');

    expect(Share.share).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('초대 링크를 만들지 못했어요', expect.any(String));
    expect(logGroupInviteShared).not.toHaveBeenCalled();
  });

  // 같은 '초대하기'인데 진입점마다 말이 다르면 안 된다 — 이 타일과 생성 직후 다이얼로그는
  // buildInviteShareMessage 하나만 쓴다(GroupCreateScreen.test.tsx의 같은 이름 테스트가 짝).
  // 그룹명은 따옴표·꺾쇠 없이 그대로 들어간다 — 카톡 OG 카드 제목이 이미 「그룹명」을 쓴다.
  test('공유 문구는 그룹 생성 다이얼로그와 같은 공용 문구다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    await renderRoom();

    await press('초대');

    expect(Share.share).toHaveBeenCalledWith({
      message: `아침 6시 집중방 그룹에 초대했어요! 같이 집중해요 ⭐️\n${INVITE_URL}`,
    });
  });
});

// ── 챌린지 결과 모달(GROMO-1279) — 소스 = GET /me/challenge-results (참가자 스코프 · N53) ────
// 여기서 잠그는 것:
//  1) 큐 소스가 카드 조회(어제 date 재조회)가 아니라 /me/challenge-results 1콜이다.
//  2) 1회 가드 — 같은 회차(세션)는 다음 조회에서 다시 뜨지 않는다. 마커는 계정 스코프(IA §8).
//  3) 그룹 전환 중 억제 — 이전에 떠 있던 결과가 새 그룹 화면 위에 남지 않는다.
//  4) 무산·환불도 결과다(IA §4.3) — 단 삭제 챌린지의 회차는 띄우지 않는다(N48 이중 통지 금지).
//  5) sessionDate 내림차순 순차 큐 — 최근 것부터 하나씩.
describe('챌린지 결과 모달(GROMO-1279)', () => {
  function resultEntry(over: Partial<MyChallengeResultEntry> = {}): MyChallengeResultEntry {
    return {
      sessionId: 's1',
      groupId: GROUP_ID,
      groupName: '아침 6시 집중방',
      challengeId: 'c1',
      challengeDeleted: false,
      challengeEnded: false,
      sessionDate: '2026-07-31',
      stake: 30,
      pot: 60,
      status: 'SETTLED',
      voidReason: null,
      goalMinutes: 60,
      myAchieved: true,
      myPayout: 60,
      results: [
        { userId: 'me', nickname: '나', achieved: true, payout: 60, progressMinutes: 70 },
        { userId: 'u2', nickname: '수빈', achieved: false, payout: 0, progressMinutes: 20 },
      ],
      ...over,
    };
  }

  test('정산 결과가 있으면 모달을 띄우고, 같은 회차는 다시 띄우지 않는다(1회 가드)', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderRoom();

    // 내 결과(달성) 헤드라인 + 그룹·날짜 + 명단 + 내 손익(정산 통지 — GROMO-1279).
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(screen.getByText('목표를 달성했어요!')).toBeOnTheScreen();
    expect(screen.getByText('7월 31일 결과')).toBeOnTheScreen();
    expect(screen.getByText('달성 1')).toBeOnTheScreen();
    expect(screen.getByText('미달성 1')).toBeOnTheScreen();
    expect(screen.getByText('내 정산 +30코인')).toBeOnTheScreen();
    expect(logGroupChallengeResultShown).toHaveBeenCalledWith({
      status: 'SETTLED',
      achieved: true,
      achiever_count: 1,
      member_count: 2,
    });
    // 1회 가드 마커 — 계정 스코프 세션 키, 값은 sessionDate(60일 프룬 기준 — IA §8).
    await waitFor(async () => {
      expect(await AsyncStorage.getItem('gromo:sessionResult:me:s1')).toBe('2026-07-31');
    });
    // 잔액 동기화(PR #566 리뷰 ⑤) — 결과 큐는 그룹 무관 소스라 현재 방 서명이 못 잡는 정산
    // (다른 그룹·ENDED)도 실려 온다. 모달 노출 = 정산 통지이므로 그 순간 잔액을 다시 받는다.
    expect(mockRefreshCoins).toHaveBeenCalled();

    // 닫으면 사라진다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challengeResult.close'));
    });
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();

    // 다음 조회(재포커스)가 같은 결과를 받아도 다시 띄우지 않는다 — 1회 가드.
    await blur();
    await focus();
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    expect(logGroupChallengeResultShown).toHaveBeenCalledTimes(1);
  });

  test('sessionDate 내림차순 순차 큐 — 최근 것부터, 닫으면 다음이 뜬다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetMyChallengeResults.mockResolvedValue([
      resultEntry({ sessionId: 's-old', sessionDate: '2026-07-30', myAchieved: false }),
      resultEntry({ sessionId: 's-new', sessionDate: '2026-07-31', myAchieved: true }),
    ]);
    await renderRoom();

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(screen.getByText('7월 31일 결과')).toBeOnTheScreen(); // 최근 것부터

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challengeResult.close'));
    });
    expect(screen.getByText('7월 30일 결과')).toBeOnTheScreen(); // 다음 장

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challengeResult.close'));
    });
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
  });

  test('그룹이 바뀌면 떠 있던 결과 모달을 즉시 접는다(전환 중 억제)', async () => {
    const OTHER_GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    const { rerender } = await renderRoom();
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();

    // 새 그룹의 응답은 아직 없다 — 전환 그 자체만으로 모달이 접혀야 한다.
    mockGetGroupDetail.mockReturnValue(new Promise(() => {}));
    mockGetChallenges.mockReturnValue(new Promise(() => {}));
    mockGetMyChallengeResults.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      rerender(<GroupRoomScreen groupId={OTHER_GROUP_ID} onLeft={onLeft} />);
    });

    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
  });

  test('무산(인원 부족)도 결과다 — 환불 문구로 알린다(IA §4.3)', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetMyChallengeResults.mockResolvedValue([
      resultEntry({
        status: 'VOIDED',
        voidReason: 'SHORT_PARTICIPANTS',
        myAchieved: null,
        myPayout: null,
      }),
    ]);
    await renderRoom();

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(
      screen.getByText('참가자가 부족해 무산됐어요 · 참가비는 돌려드렸어요'),
    ).toBeOnTheScreen();
  });

  // 삭제 환불은 BET_VOID_REFUND 푸시가 알린다 — 모달까지 띄우면 같은 사건 이중 통지(N48).
  test('삭제된 챌린지의 회차는 띄우지 않는다(N48 — 푸시와 이중 통지 금지)', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetMyChallengeResults.mockResolvedValue([
      resultEntry({ status: 'VOIDED', voidReason: 'CHALLENGE_DELETED' }),
      resultEntry({ sessionId: 's-del', challengeDeleted: true }),
    ]);
    await renderRoom();

    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
  });

  // 탈퇴자도 자기 정산 결과는 본다(N53·C8 — PR #566 리뷰 ②). 카드 조회는 멤버십 검증으로
  // 막히지만(MEMBER_ONLY) 결과 큐는 참가자 스코프라 응답에 온다 — onLeft로 화면을 내리기 전에
  // 모달부터 소비시키고, 마지막 결과를 닫을 때 이탈을 잇는다.
  describe('탈퇴자(MEMBER_ONLY)의 결과 소비 후 이탈', () => {
    test('결과가 있으면 onLeft를 미루고 모달부터 보여준다 — 닫으면 그때 onLeft', async () => {
      mockGetGroupDetail.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetAnnouncements.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetChallenges.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry(),
        resultEntry({ sessionId: 's2', sessionDate: '2026-07-30' }),
      ]);
      await renderRoom();

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(onLeft).not.toHaveBeenCalled();

      // 첫 장을 닫아도 아직 — 큐가 남아 있다.
      await act(async () => {
        fireEvent.press(screen.getByTestId('group.challengeResult.close'));
      });
      expect(screen.getByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(onLeft).not.toHaveBeenCalled();

      // 마지막 장을 닫는 순간 부모에게 넘긴다.
      await act(async () => {
        fireEvent.press(screen.getByTestId('group.challengeResult.close'));
      });
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
      expect(onLeft).toHaveBeenCalledTimes(1);
    });

    // '모르겠다'와 '없다'를 같은 값으로 말하면 안 된다(codex 후속 리뷰 P2). 가드(AsyncStorage)
    // 읽기가 일시 실패했을 뿐인데 "결과 0건"으로 읽고 방을 내리면, 다른 소속 그룹이 없는
    // 탈퇴자에겐 주석이 기대하는 '다음 조회'가 아예 없어 그 정산 결과가 영영 사라진다.
    test('가드 읽기가 실패하면 즉시 이탈하지 않는다 — 회복된 다음 조회가 결과를 보여준다', async () => {
      mockGetGroupDetail.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetAnnouncements.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetChallenges.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      // 결과 응답은 성공했는데 1회 가드 조회만 실패한다.
      // ⚠️ jest.spyOn + mockRestore 는 쓰지 않는다 — 공식 AsyncStorage mock의 메서드는 이미
      //    jest.fn 이라, 복원하면 구현이 사라져 이후 모든 multiGet이 undefined를 돌려준다
      //    (이 파일 뒤쪽 테스트들이 통째로 무너진다). 1회 오버라이드만 얹는다.
      (AsyncStorage.multiGet as jest.Mock).mockRejectedValueOnce(new Error('storage'));

      await renderRoom();

      expect(onLeft).not.toHaveBeenCalled();
      expect(screen.queryByTestId('group.challengeResult')).toBeNull(); // 노출도 하지 않는다

      // 가드가 회복된 다음 조회 — 그제서야 결과를 띄우고, 닫을 때 이탈한다.
      await blur();
      await focus();

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(onLeft).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.press(screen.getByTestId('group.challengeResult.close'));
      });
      expect(onLeft).toHaveBeenCalledTimes(1);
    });

    // 결과 조회 자체가 실패한 경우도 같은 '모르겠다'다 — 다만 **래치하지 않아야** 한다.
    // 유예를 붙들면 다음 조회가 '결과 없음'을 확인해도 영영 에러 화면에 갇힌다.
    test('결과 조회 실패도 이탈을 미루되, 회복 후 결과가 없으면 그때 나간다', async () => {
      mockGetGroupDetail.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetAnnouncements.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetChallenges.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetMyChallengeResults.mockRejectedValue(new Error('network'));

      await renderRoom();
      expect(onLeft).not.toHaveBeenCalled();

      // 회복된 조회가 '정말 없다'를 확정하면 종전대로 즉시 이탈한다.
      mockGetMyChallengeResults.mockResolvedValue([]);
      await blur();
      await focus();

      expect(onLeft).toHaveBeenCalledTimes(1);
    });

    test('보여줄 결과가 없으면 종전대로 즉시 onLeft', async () => {
      mockGetGroupDetail.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetAnnouncements.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetChallenges.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
      mockGetMyChallengeResults.mockResolvedValue([]);
      await renderRoom();

      expect(onLeft).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    });
  });

  // 성공 응답은 빈 배열도 정본이다(codex 후속 리뷰 P2). 예전엔 후보 0건이면 큐 반영 자체를
  // 건너뛰어, 시트에 가려 대기하던 결과가 서버에서 제외된 뒤에도 살아남았다 — 시트를 닫는
  // 순간 **서버가 이미 지운 과거 결과**가 뜨고, 삭제 환불 푸시와 겹치면 N48이 금지하는
  // 같은 사건 이중 통지가 된다.
  describe('성공한 빈 응답의 큐 반영', () => {
    test('시트에 가려 대기하던 결과가 서버에서 빠지면 큐에서도 사라진다(N48)', async () => {
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);

      // 초대 시트가 떠 있어 결과가 큐에서 대기만 하는 상태.
      const { rerender } = await render(
        <GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} inviteOpen />,
      );
      await act(async () => {});
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();

      // 그 사이 다른 기기에서 챌린지가 삭제돼 서버가 이 회차를 응답에서 제외했다(FR-44-4).
      mockGetMyChallengeResults.mockResolvedValue([]);
      await blur();
      await focus();

      // 시트를 닫아도 사라진 결과가 되살아나선 안 된다 — 환불 푸시가 이미 알린 사건이다.
      await act(async () => {
        rerender(<GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} />);
      });
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    });

    test('실제로 떠 있는 모달은 빈 응답에도 걷어내지 않는다', async () => {
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      await renderRoom();
      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();

      // 재조회가 빈 정본을 들고 와도 사용자가 읽던 모달을 응답 하나로 지우지 않는다.
      mockGetMyChallengeResults.mockResolvedValue([]);
      await blur();
      await focus();
      expect(screen.getByTestId('group.challengeResult')).toBeOnTheScreen();

      // 닫으면 정본대로 비어 있다 — 뒤에 남아 있던 장이 따라 뜨지 않는다.
      await act(async () => {
        fireEvent.press(screen.getByTestId('group.challengeResult.close'));
      });
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    });

    test('조회 실패는 대기 큐를 건드리지 않는다 — 네트워크 실패로 결과를 잃지 않는다', async () => {
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);

      const { rerender } = await render(
        <GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} inviteOpen />,
      );
      await act(async () => {});

      mockGetMyChallengeResults.mockRejectedValue(new Error('network'));
      await blur();
      await focus();

      // 시트를 닫으면 대기하던 결과가 그대로 뜬다.
      await act(async () => {
        rerender(<GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} />);
      });
      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    });
  });

  test('결과 조회가 실패해도 방 화면은 무영향이다', async () => {
    mockGetGroupDetail.mockResolvedValue(detail());
    mockGetAnnouncements.mockResolvedValue([]);
    mockGetMyChallengeResults.mockRejectedValue(new Error('network'));
    await renderRoom();

    expect(screen.getByText('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
  });

  // ── 챌린지 종료 푸시 딥링크(GROMO-1088) ──
  // 푸시를 탭해서 들어온 경우 focusChallengeId가 실린다. 사용자가 알림을 직접 누른 명시적
  // 요청이라 1회 가드를 넘어서 열되, 화면 안에서 **한 번만** 소비돼야 한다.
  describe('종료 푸시가 지목한 챌린지(focusChallengeId)', () => {
    async function renderWithFocus(challengeId: string) {
      const result = await render(
        <GroupRoomScreen groupId={GROUP_ID} focusChallengeId={challengeId} onLeft={onLeft} />,
      );
      await act(async () => {});
      return result;
    }

    // SESSION_END 푸시는 정산 **전**에 온다 — 방금 끝난 회차는 아직 큐에 없고, 있는 것은 지난
    // (이미 본) 회차뿐이다. 이때 seen 우회로 지난 회차를 재노출하며 지목을 소비하면, 새 결과가
    // 정산돼 도착했을 때 지목이 죽어 있다(PR #566 리뷰 ③).
    test('매치가 전부 본 결과뿐이면 재노출하지 않고 지목을 유지한다 — 새 결과 도착 시 그때 연다', async () => {
      await AsyncStorage.setItem('gromo:sessionResult:me:s1', '2026-07-31');
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]); // s1 — 이미 본 지난 회차

      await renderWithFocus('c1');

      // 재노출 없음 — 지난 회차가 다시 뜨면 사용자는 그것이 방금 결과인 줄 안다.
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();

      // 정산이 끝나 새 회차가 도착한 재조회 — 유지된 지목이 그때 소비된다.
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry(),
        resultEntry({ sessionId: 's2', sessionDate: '2026-08-01' }),
      ]);
      await blur();
      await focus();

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(screen.getByText('8월 1일 결과')).toBeOnTheScreen();
    });

    test('닫은 뒤 재조회에서 다시 뜨지 않는다(1회 소비 + 노출 가드)', async () => {
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);

      await renderWithFocus('c1');
      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      await act(async () => {
        fireEvent.press(screen.getByTestId('group.challengeResult.close'));
      });

      await blur();
      await focus();
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();

      await foreground();
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    });

    test('아직 정산 전이면 소비하지 않고 다음 조회가 이어받는다', async () => {
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      // 정산 전에는 /me/challenge-results에 그 회차가 실리지 않는다 — 지목을 소비하면 안 된다.
      mockGetMyChallengeResults.mockResolvedValue([]);

      await renderWithFocus('c1');
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();

      // 정산이 끝난 뒤의 재조회 — 지목이 살아 있어 그때 뜬다.
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      await blur();
      await focus();

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    });

    test('지목한 챌린지의 결과를 큐 앞자리에 세운다(다른 결과보다 먼저)', async () => {
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      // 최신순 정렬로는 s-other(7/31)가 먼저다 — 지목이 그 앞을 차지해야 한다.
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry({ sessionId: 's-other', challengeId: 'c-other', sessionDate: '2026-07-31' }),
        resultEntry({ sessionId: 's-target', challengeId: 'c-target', sessionDate: '2026-07-30' }),
      ]);

      await renderWithFocus('c-target');

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(screen.getByText('7월 30일 결과')).toBeOnTheScreen(); // 지목(7/30)이 최신(7/31)보다 먼저
    });

    // 시트에 가려 아직 뜨지 못한 결과가 큐 맨 앞을 붙들면, 그 사이 탭한 지목이 뒤로 밀려
    // 시트를 닫았을 때 사용자가 누른 결과가 아니라 무관한 결과가 먼저 열린다(코덱스 리뷰).
    test('시트에 가려 대기 중인 결과보다 새 지목을 앞세운다', async () => {
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      // 초대 시트가 떠 있어 결과 모달이 눌려 있는 상태로 시작한다.
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry({ sessionId: 's-other', challengeId: 'c-other', sessionDate: '2026-07-31' }),
      ]);
      const { rerender } = await render(
        <GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} inviteOpen />,
      );
      await act(async () => {});
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();

      // 시트가 떠 있는 사이 다른 챌린지 알림을 탭했다 — 파라미터만 갈린다.
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry({ sessionId: 's-other', challengeId: 'c-other', sessionDate: '2026-07-31' }),
        resultEntry({ sessionId: 's-target', challengeId: 'c-target', sessionDate: '2026-07-30' }),
      ]);
      await act(async () => {
        rerender(
          <GroupRoomScreen
            groupId={GROUP_ID}
            focusChallengeId="c-target"
            onLeft={onLeft}
            inviteOpen
          />,
        );
      });

      // 시트를 닫으면 사용자가 탭한 결과가 먼저 열려야 한다.
      await act(async () => {
        rerender(
          <GroupRoomScreen groupId={GROUP_ID} focusChallengeId="c-target" onLeft={onLeft} />,
        );
      });

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(screen.getByText('7월 30일 결과')).toBeOnTheScreen();
      expect(logGroupChallengeResultShown).toHaveBeenCalledTimes(1);
    });

    // 방이 이미 떠 있는 채로 같은 그룹의 다른 챌린지 푸시를 탭하면 라우트 파라미터만 갈리고
    // 포커스는 유지된다 — useFocusEffect가 다시 돌지 않아 새 지목이 처리될 계기가 없다.
    test('같은 방에서 지목만 바뀌면 스스로 재조회해 모달을 연다', async () => {
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      // 첫 진입에는 결과가 없다 — 모달이 뜰 이유가 없는 상태에서 시작한다.
      mockGetMyChallengeResults.mockResolvedValue([]);
      const { rerender } = await renderWithFocus('c1');
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();

      // 두 번째 푸시가 도착해 파라미터만 갈린다. 포커스·포그라운드 이벤트는 일부러 굴리지 않는다.
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry({ sessionId: 's2', challengeId: 'c2' }),
      ]);
      await act(async () => {
        rerender(<GroupRoomScreen groupId={GROUP_ID} focusChallengeId="c2" onLeft={onLeft} />);
      });

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    });

    // ⚠️ 이 테스트는 rerender 기반 두 테스트('시트에 가려'·'같은 방에서') **뒤에** 둔다 —
    // 심은 seen 마커의 비동기 잔향이 앞에 있으면 그 둘의 재조회를 깨뜨린다(멀티리무브로도 완전
    // 격리가 안 됐다). 순서 의존은 다음 사람을 위해 여기 명시해 둔다.
    // 요일 반복(N3)에서는 같은 challengeId의 지난 회차가 큐(30일)에 여럿 남는다 — 푸시는
    // challengeId만 싣기 때문에 전부 우회시키면 이미 본 지난 회차까지 재노출된다(PR #566 리뷰).
    test('같은 챌린지의 지난 회차가 여럿이어도 가드 우회는 최신 1건뿐이다', async () => {
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry({ sessionId: 's-new', challengeId: 'c-target', sessionDate: '2026-07-31' }),
        resultEntry({ sessionId: 's-old', challengeId: 'c-target', sessionDate: '2026-07-28' }),
        resultEntry({ sessionId: 's-older', challengeId: 'c-target', sessionDate: '2026-07-25' }),
      ]);
      // 지난 두 회차는 이미 봤다 — 가드 마커가 있다.
      await AsyncStorage.setItem(`gromo:sessionResult:me:s-old`, '2026-07-28');
      await AsyncStorage.setItem(`gromo:sessionResult:me:s-older`, '2026-07-25');

      await renderWithFocus('c-target');

      // 최신(7/31) 1건만 우회로 뜨고, 이미 본 지난 회차(7/28·7/25)는 큐에 없다.
      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(screen.getByText('7월 31일 결과')).toBeOnTheScreen();
      fireEvent.press(screen.getByText('확인'));
      await act(async () => {});
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
      // 이 테스트가 심은 마커만 걷는다 — 스토리지 목은 스위트 전체에서 살아남아 뒤 테스트를
      // 오염시킨다. clear()는 목 내부 상태를 통째로 리셋해 다른 누수를 만들 수 있어 쓰지 않는다.
      await AsyncStorage.multiRemove([
        'gromo:sessionResult:me:s-old',
        'gromo:sessionResult:me:s-older',
        'gromo:sessionResult:me:s-new',
      ]);
    });

    test('지목이 없으면(목록 탭 진입) 기존 1회 가드가 그대로 막는다', async () => {
      await AsyncStorage.setItem('gromo:sessionResult:me:s1', '2026-07-31');
      mockGetGroupDetail.mockResolvedValue(detail());
      mockGetAnnouncements.mockResolvedValue([]);
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);

      await renderRoom();

      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    });
  });
});
