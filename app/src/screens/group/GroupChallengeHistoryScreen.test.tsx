// GroupChallengeHistoryScreen 테스트 — GROMO-1277 (구 GroupBetHistoryScreen의 그룹 축 재편).
//
// 여기서 잠그는 것:
//  1) 3상(로딩/전면 에러+재시도/빈 상태) — NoticeScreen 정본 구조 그대로.
//  2) **그룹 축 계약**: 챌린지 경로가 아니라 /groups/{gid}/challenge-history를 부르고,
//     챌린지별 보기는 같은 엔드포인트의 challengeId 필터다(IA §1). 삭제된 챌린지의 줄도
//     스냅샷으로 온전히 그려진다(N6-1 — 이 화면의 존재 이유).
//  3) 페이지네이션 계약(구 화면에서 물려받음): onEndReached가 직전 응답의 nextCursor를 그대로
//     싣는다, 같은 틱 연발은 1회만 나간다, 종료는 hasNext·nextCursor **둘 다** 본다,
//     다음 페이지 404는 받은 이력을 유지하고 인라인으로만 알린다, 일시 실패는 자동 재시도 없음.
//
// 네트워크만 목으로 갈아끼우고 groupErrorCode는 실제 구현을 쓴다(NoticeScreen.test 관행).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupChallengeHistoryScreen from './GroupChallengeHistoryScreen';
import { getGroupChallengeHistory } from '@/services/groupApi';
import type {
  GroupChallengeHistoryItem,
  GroupChallengeHistorySliceResponse,
} from '@/types/dto/group';

jest.setTimeout(20000);

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const CHALLENGE_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';

// route params 홀더 — 필터 진입 테스트가 갈아끼운다(beforeEach가 기본값으로 되돌린다).
const mockNav = { goBack: jest.fn() };
const mockRoute = {
  params: { groupId: GROUP_ID } as {
    groupId: string;
    challengeId?: string;
    challengeLabel?: string;
  },
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockNav.goBack }),
  useRoute: () => mockRoute,
}));

// groupApi가 삭제 계측 경유로 파이어베이스 네이티브 모듈을 당긴다 — jest엔 없다(관행).
jest.mock('@/services/analyticsEvents', () => ({ logGroupChallengeDeleted: jest.fn() }));

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupChallengeHistory: jest.fn(),
}));

const mockGetHistory = getGroupChallengeHistory as jest.MockedFunction<
  typeof getGroupChallengeHistory
>;

// 서버 GlobalExceptionHandler의 { code, message } 바디를 실은 axios 에러.
function axiosErrorWith(status: number, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: code ? { code, message: '...' } : undefined,
  });
}

function historyItem(over: Partial<GroupChallengeHistoryItem> = {}): GroupChallengeHistoryItem {
  return {
    sessionId: 's1',
    sessionDate: '2026-07-31',
    challengeId: CHALLENGE_ID,
    challengeDeleted: false,
    missionCategory: 'FOCUS',
    missionType: 'DURATION',
    goalMinutes: 60,
    windowStart: null,
    windowEnd: null,
    stake: 30,
    pot: 90,
    status: 'SETTLED',
    voidReason: null,
    myPayout: 45,
    myAchieved: true,
    myProgressMinutes: 72,
    achievedCount: 2,
    participantCount: 3,
    ...over,
  };
}

function slice(
  over: Partial<GroupChallengeHistorySliceResponse> = {},
): GroupChallengeHistorySliceResponse {
  return { content: [historyItem()], size: 20, hasNext: false, nextCursor: null, ...over };
}

async function renderScreen() {
  const result = await render(<GroupChallengeHistoryScreen />);
  await act(async () => {});
  return result;
}

// FlatList의 끝 도달을 흉내 낸다 — 실제 스크롤 지오메트리는 jsdom에 없어 이벤트를 직접 쏜다.
async function reachEnd() {
  await act(async () => {
    fireEvent(screen.getByTestId('group.challengeHistory.list'), 'onEndReached');
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHistory.mockResolvedValue(slice());
  mockRoute.params = { groupId: GROUP_ID };
});

describe('3상(로딩/에러/빈)', () => {
  test('첫 조회가 끝나기 전에는 스피너만 — 목록도 에러도 세우지 않는다', async () => {
    mockGetHistory.mockReturnValueOnce(new Promise(() => {})); // 영원히 pending
    await render(<GroupChallengeHistoryScreen />);

    expect(screen.getByTestId('group.challengeHistory.screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.challengeHistory.list')).toBeNull();
    expect(screen.queryByText('다시 시도')).toBeNull();
  });

  test('첫 페이지 404(NOT_FOUND)는 전면 에러 + 다시 시도 — 재시도가 성공하면 목록으로', async () => {
    mockGetHistory.mockRejectedValueOnce(axiosErrorWith(404, 'NOT_FOUND'));
    await renderScreen();

    // 그룹 축이라 사라진 대상은 챌린지가 아니라 그룹이다.
    expect(screen.getByText('사라진 그룹이에요.')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.challengeHistory.list')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('다시 시도'));
    });
    expect(screen.getByTestId('group.challengeHistory.list')).toBeOnTheScreen();
    expect(screen.getByText('7/31(금)')).toBeOnTheScreen();
  });

  test('MEMBER_ONLY는 그룹원 전용 문구로 갈린다(code 분기 — status가 아니다)', async () => {
    mockGetHistory.mockRejectedValueOnce(axiosErrorWith(403, 'MEMBER_ONLY'));
    await renderScreen();
    expect(screen.getByText('그룹원만 볼 수 있어요.')).toBeOnTheScreen();
  });

  test('빈 목록은 빈 상태 안내 — 에러가 아니다', async () => {
    mockGetHistory.mockResolvedValueOnce(slice({ content: [] }));
    await renderScreen();

    expect(screen.getByText('아직 지난 기록이 없어요')).toBeOnTheScreen();
    expect(screen.queryByText('다시 시도')).toBeNull();
  });
});

describe('그룹 축 계약 (N6-1)', () => {
  test('그룹 경로를 부른다 — 필터 없이 들어오면 challengeId를 싣지 않는다', async () => {
    await renderScreen();
    expect(mockGetHistory).toHaveBeenCalledWith(GROUP_ID, {
      size: 20,
      challengeId: undefined,
    });
    // 그룹 전체 보기에는 필터 고지가 없다.
    expect(screen.queryByTestId('group.challengeHistory.filter')).toBeNull();
  });

  test('챌린지별 보기는 같은 화면의 challengeId 필터다 — 헤더가 필터 사실을 밝힌다', async () => {
    mockRoute.params = {
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      challengeLabel: '하루 60분 집중',
    };
    await renderScreen();

    expect(mockGetHistory).toHaveBeenCalledWith(GROUP_ID, {
      size: 20,
      challengeId: CHALLENGE_ID,
    });
    expect(screen.getByTestId('group.challengeHistory.filter')).toHaveTextContent(
      '하루 60분 집중만 보는 중',
    );
  });

  test('삭제된 챌린지의 줄도 스냅샷으로 온전히 그려진다 + 삭제 배지', async () => {
    mockGetHistory.mockResolvedValueOnce(
      slice({
        content: [
          historyItem({
            challengeDeleted: true,
            missionType: 'TIME_WINDOW',
            goalMinutes: 90,
            windowStart: '09:00:00',
            windowEnd: '12:00:00',
          }),
        ],
      }),
    );
    await renderScreen();

    expect(screen.getByText('삭제됨')).toBeOnTheScreen();
    // 챌린지 행을 조인하지 않고도 미션이 읽힌다 — 이 화면의 존재 이유다.
    // 창 문장에 「매일」은 붙지 않는다(요일 반복 챌린지의 지난 기록이 섞여 있다 — challengeHistoryView).
    expect(screen.getByText('09:00~12:00 90분 집중')).toBeOnTheScreen();
  });
});

describe('첫 페이지 렌더', () => {
  test('날짜(요일)·미션·집계·참가비/적립금·내 손익·근거를 전부 적는다', async () => {
    await renderScreen();

    expect(screen.getByText('7/31(금)')).toBeOnTheScreen();
    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();
    expect(screen.getByText('3명 중 2명 달성')).toBeOnTheScreen();
    expect(screen.getByText('참가비 30 · 적립금 90')).toBeOnTheScreen();
    expect(screen.getByText('+15')).toBeOnTheScreen();
    expect(screen.getByText('72/60분')).toBeOnTheScreen();
    // 행 전체가 한 덩어리 음성 라벨 — 카드가 accessible이라 자식 Text는 따로 읽히지 않는다.
    // 그래서 눈에 보이는 참가비·적립금도 이 문장 안에 있어야 한다(codex 리뷰).
    expect(
      screen.getByLabelText(
        '7/31(금), 하루 60분 집중, 3명 중 2명 달성, 72/60분, 참가비 30코인, 적립금 90코인, 15코인 획득',
      ),
    ).toBeOnTheScreen();
  });

  test('무산·몰수는 달성 집계 대신 결말을 적는다 — 하지 않은 판정을 말하지 않는다', async () => {
    mockGetHistory.mockResolvedValueOnce(
      slice({
        content: [
          historyItem({
            sessionId: 's1',
            status: 'VOIDED',
            voidReason: 'INSUFFICIENT_PARTICIPANTS',
            myPayout: 30,
            myAchieved: null,
            achievedCount: 0,
          }),
          historyItem({
            sessionId: 's2',
            sessionDate: '2026-07-30',
            status: 'FORFEITED',
            myPayout: 0,
            myAchieved: false,
            achievedCount: 0,
          }),
        ],
      }),
    );
    await renderScreen();

    expect(screen.getByText('참가자가 부족해 무산')).toBeOnTheScreen();
    expect(screen.getByText('환불')).toBeOnTheScreen();
    expect(screen.getByText('아무도 달성하지 못해 참가비 소멸')).toBeOnTheScreen();
    expect(screen.getByText('-30')).toBeOnTheScreen();
  });

  test('내가 참가하지 않은 날도 목록에 있고, 손익 자리는 0이 아니라 미참여다', async () => {
    mockGetHistory.mockResolvedValueOnce(
      slice({
        content: [historyItem({ myPayout: null, myAchieved: null, myProgressMinutes: null })],
      }),
    );
    await renderScreen();

    expect(screen.getByText('미참여')).toBeOnTheScreen();
    expect(screen.queryByText('72/60분')).toBeNull();
  });
});

describe('onEndReached 페이지네이션', () => {
  test('끝에 닿으면 직전 응답의 nextCursor로 다음 페이지를 부르고 이어붙인다', async () => {
    mockGetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 's1' }))
      .mockResolvedValueOnce(
        slice({ content: [historyItem({ sessionId: 's2', sessionDate: '2026-07-30' })] }),
      );
    await renderScreen();

    await reachEnd();

    expect(mockGetHistory).toHaveBeenLastCalledWith(GROUP_ID, {
      cursor: 's1',
      size: 20,
      challengeId: undefined,
    });
    expect(screen.getByText('7/31(금)')).toBeOnTheScreen();
    expect(screen.getByText('7/30(목)')).toBeOnTheScreen();
  });

  test('필터 진입에서는 다음 페이지에도 challengeId가 그대로 실린다', async () => {
    mockRoute.params = { groupId: GROUP_ID, challengeId: CHALLENGE_ID };
    mockGetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 's1' }))
      .mockResolvedValueOnce(slice({ content: [historyItem({ sessionId: 's2' })] }));
    await renderScreen();

    await reachEnd();

    expect(mockGetHistory).toHaveBeenLastCalledWith(GROUP_ID, {
      cursor: 's1',
      size: 20,
      challengeId: CHALLENGE_ID,
    });
  });

  test('요청이 나가 있는 동안의 연발 onEndReached는 무시된다(중복 호출 방지)', async () => {
    let resolveMore: (v: GroupChallengeHistorySliceResponse) => void = () => {};
    mockGetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 's1' }))
      .mockReturnValueOnce(
        new Promise<GroupChallengeHistorySliceResponse>((r) => {
          resolveMore = r;
        }),
      );
    await renderScreen();

    // 같은 틱에 두 번 — FlatList는 스크롤 중 onEndReached를 연발할 수 있다.
    await act(async () => {
      fireEvent(screen.getByTestId('group.challengeHistory.list'), 'onEndReached');
      fireEvent(screen.getByTestId('group.challengeHistory.list'), 'onEndReached');
    });
    await act(async () => {
      resolveMore(slice({ content: [historyItem({ sessionId: 's2' })] }));
    });

    expect(mockGetHistory).toHaveBeenCalledTimes(2);
  });

  test('hasNext=false면 끝에 닿아도 더 부르지 않는다', async () => {
    mockGetHistory.mockResolvedValueOnce(slice({ hasNext: false, nextCursor: 's1' }));
    await renderScreen();

    await reachEnd();
    expect(mockGetHistory).toHaveBeenCalledTimes(1);
  });

  test('nextCursor=null이면 hasNext=true여도 부르지 않는다 — 무한 재호출 방지', async () => {
    mockGetHistory.mockResolvedValueOnce(slice({ hasNext: true, nextCursor: null }));
    await renderScreen();

    await reachEnd();
    expect(mockGetHistory).toHaveBeenCalledTimes(1);
  });
});

describe('다음 페이지 404(BET_NOT_FOUND) 인라인', () => {
  test('받은 이력은 유지하고 인라인으로만 알린다 — 전면 에러로 뒤집지 않는다', async () => {
    mockGetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 's1' }))
      .mockRejectedValueOnce(axiosErrorWith(404, 'BET_NOT_FOUND'));
    await renderScreen();

    await reachEnd();

    expect(screen.getByText('7/31(금)')).toBeOnTheScreen();
    expect(screen.getByTestId('group.challengeHistory.more.notice')).toHaveTextContent(
      '지난 기록을 더 불러올 수 없어요',
    );
    expect(screen.queryByText('다시 시도')).toBeNull();
  });

  test('무효 커서는 재시도 무의미 — 이후 끝에 닿아도 다시 부르지 않는다', async () => {
    mockGetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 's1' }))
      .mockRejectedValueOnce(axiosErrorWith(404, 'BET_NOT_FOUND'));
    await renderScreen();

    await reachEnd();
    await reachEnd();

    expect(mockGetHistory).toHaveBeenCalledTimes(2); // 첫 페이지 + 실패한 다음 페이지 1회뿐
  });
});

// 일시 실패(코드 없는 500 등)의 재개는 **수동뿐**이다(#527 codex 리뷰 P1) — footer 갱신이
// content 높이를 바꾸면 FlatList가 스크롤 없이 onEndReached를 재발화할 수 있어, 자동 재시도는
// 지속 실패에서 요청 무한 루프가 된다.
describe('다음 페이지 일시 실패 — 자동 재시도 금지', () => {
  test('실패 후 onEndReached 연발은 추가 요청을 만들지 않는다 — 다시 시도 버튼만 남는다', async () => {
    mockGetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 's1' }))
      .mockRejectedValueOnce(axiosErrorWith(500));
    await renderScreen();

    await reachEnd();
    expect(screen.getByText('7/31(금)')).toBeOnTheScreen();
    expect(screen.getByText('지난 기록을 더 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.getByTestId('group.challengeHistory.more.retry')).toBeOnTheScreen();

    await reachEnd();
    await reachEnd();
    expect(mockGetHistory).toHaveBeenCalledTimes(2);
  });

  test("'다시 시도' 탭이 같은 커서로 1회 재요청한다 — 성공하면 버튼이 걷히고 이어붙는다", async () => {
    mockGetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 's1' }))
      .mockRejectedValueOnce(axiosErrorWith(500))
      .mockResolvedValueOnce(
        slice({ content: [historyItem({ sessionId: 's2', sessionDate: '2026-07-30' })] }),
      );
    await renderScreen();
    await reachEnd();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challengeHistory.more.retry'));
    });

    expect(mockGetHistory).toHaveBeenCalledTimes(3);
    expect(mockGetHistory).toHaveBeenLastCalledWith(GROUP_ID, {
      cursor: 's1',
      size: 20,
      challengeId: undefined,
    });
    expect(screen.getByText('7/30(목)')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.challengeHistory.more.retry')).toBeNull();
  });
});

describe('새로고침 × 다음 페이지 레이스', () => {
  test('첫 페이지 재조회가 도는 동안 onEndReached는 무시된다 — 옛 커서 이어붙임 방지', async () => {
    let resolveRefresh: (v: GroupChallengeHistorySliceResponse) => void = () => {};
    mockGetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 's1' }))
      .mockImplementationOnce(
        () =>
          new Promise<GroupChallengeHistorySliceResponse>((r) => {
            resolveRefresh = r;
          }),
      );
    await renderScreen();

    const refreshControl = (
      screen.getByTestId('group.challengeHistory.list').props as {
        refreshControl: { props: { onRefresh: () => void } };
      }
    ).refreshControl;
    await act(async () => {
      refreshControl.props.onRefresh();
    });

    await reachEnd();
    expect(mockGetHistory).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRefresh(slice({ hasNext: false, nextCursor: null }));
    });
    await reachEnd();
    expect(mockGetHistory).toHaveBeenCalledTimes(2); // hasNext=false — 재개할 다음 페이지가 없다
  });
});

// FOCUS 창의 5분 관용치 안내 — 그룹 축이라 판단 소스가 route param에서 **줄마다의 스냅샷**으로
// 바뀌었다(진입 경로에 표시가 의존하지 않는다). 조건·문구 자체는 결과 시트와 같다.
describe('FOCUS 창 관용치 안내', () => {
  const focusWindow = {
    missionCategory: 'FOCUS',
    missionType: 'TIME_WINDOW',
    goalMinutes: 90,
    windowStart: '09:00',
    windowEnd: '12:00',
  } as const;

  test('창형 집중 줄에 실측 분이 있으면 목록 상단에 안내가 선다', async () => {
    mockGetHistory.mockResolvedValueOnce(slice({ content: [historyItem(focusWindow)] }));
    await renderScreen();

    expect(screen.getByTestId('group.challengeHistory.toleranceNotice')).toHaveTextContent(
      '목표에서 5분 모자라도 달성으로 인정돼요',
    );
  });

  test('하루형만 있으면 안내가 없다 — 관용치는 창형 집중 전용', async () => {
    await renderScreen(); // 기본 픽스처 = DURATION
    expect(screen.queryByTestId('group.challengeHistory.toleranceNotice')).toBeNull();
  });

  test('창형 집중이어도 실측 분이 없으면 안내가 없다 — 모순될 숫자가 없다', async () => {
    mockGetHistory.mockResolvedValueOnce(
      slice({ content: [historyItem({ ...focusWindow, myProgressMinutes: null })] }),
    );
    await renderScreen();
    expect(screen.queryByTestId('group.challengeHistory.toleranceNotice')).toBeNull();
  });
});
