// GroupBetHistoryScreen 테스트 — GROMO-1221 (앱 최초의 FlatList 무한 스크롤).
//
// 여기서 잠그는 것:
//  1) 3상(로딩/전면 에러+재시도/빈 상태) — NoticeScreen 정본 구조 그대로.
//  2) 페이지네이션 계약: onEndReached가 직전 응답의 nextCursor를 그대로 싣는다, 같은 틱
//     연발은 1회만 나간다(moreLock), 종료는 hasNext·nextCursor **둘 다** 본다 — 한쪽만 보면
//     계약이 어긋난 응답(hasNext=true·cursor null)에서 같은 페이지를 무한 재호출한다.
//  3) 다음 페이지 404(BET_NOT_FOUND, 무효 커서)는 받은 이력을 유지하고 인라인으로만 알린다 —
//     화면을 에러로 뒤집으면 잘 읽던 기록이 통째로 사라진다. 이후 재호출도 접는다(재시도 무의미).
//
// 네트워크만 목으로 갈아끼우고 groupErrorCode는 실제 구현을 쓴다(NoticeScreen.test 관행).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupBetHistoryScreen from './GroupBetHistoryScreen';
import { getBetHistory } from '@/services/groupApi';
import type { GroupBetHistoryItem, GroupBetHistorySliceResponse } from '@/types/dto/group';

jest.setTimeout(20000);

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const mockNav = { goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockNav.goBack }),
  useRoute: () => ({
    params: {
      groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55',
      challengeId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66',
    },
  }),
}));

// groupApi가 삭제 계측 경유로 파이어베이스 네이티브 모듈을 당긴다 — jest엔 없다(NoticeScreen.test 관행).
jest.mock('@/services/analyticsEvents', () => ({ logGroupChallengeDeleted: jest.fn() }));

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getBetHistory: jest.fn(),
}));

const mockGetBetHistory = getBetHistory as jest.MockedFunction<typeof getBetHistory>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const CHALLENGE_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';

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

function historyItem(over: Partial<GroupBetHistoryItem> = {}): GroupBetHistoryItem {
  return {
    betId: 'b1',
    betDate: '2026-07-31',
    stake: 30,
    pot: 90,
    status: 'SETTLED',
    settledAt: '2026-08-01T00:05:00Z',
    goalMinutes: 60,
    results: [
      { userId: 'u1', nickname: '재영', achieved: true, payout: 45, progressMinutes: 72 },
      { userId: 'u2', nickname: '수빈', achieved: true, payout: 45, progressMinutes: 65 },
      { userId: 'u3', nickname: '민지', achieved: false, payout: 0, progressMinutes: 12 },
    ],
    ...over,
  };
}

function slice(over: Partial<GroupBetHistorySliceResponse> = {}): GroupBetHistorySliceResponse {
  return { content: [historyItem()], size: 20, hasNext: false, nextCursor: null, ...over };
}

async function renderScreen() {
  const result = await render(<GroupBetHistoryScreen />);
  await act(async () => {});
  return result;
}

// FlatList의 끝 도달을 흉내 낸다 — 실제 스크롤 지오메트리는 jsdom에 없어 이벤트를 직접 쏜다.
async function reachEnd() {
  await act(async () => {
    fireEvent(screen.getByTestId('group.betHistory.list'), 'onEndReached');
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetBetHistory.mockResolvedValue(slice());
});

describe('3상(로딩/에러/빈)', () => {
  test('첫 조회가 끝나기 전에는 스피너만 — 목록도 에러도 세우지 않는다', async () => {
    mockGetBetHistory.mockReturnValueOnce(new Promise(() => {})); // 영원히 pending
    await render(<GroupBetHistoryScreen />);

    expect(screen.getByTestId('group.betHistory.screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.betHistory.list')).toBeNull();
    expect(screen.queryByText('다시 시도')).toBeNull();
  });

  test('첫 페이지 404(NOT_FOUND)는 전면 에러 + 다시 시도 — 재시도가 성공하면 목록으로', async () => {
    mockGetBetHistory.mockRejectedValueOnce(axiosErrorWith(404, 'NOT_FOUND'));
    await renderScreen();

    expect(screen.getByText('사라진 챌린지예요.')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.betHistory.list')).toBeNull();

    // 다시 시도 → 기본 목(성공)으로 떨어져 목록이 선다.
    await act(async () => {
      fireEvent.press(screen.getByText('다시 시도'));
    });
    expect(screen.getByTestId('group.betHistory.list')).toBeOnTheScreen();
    expect(screen.getByText('7월 31일')).toBeOnTheScreen();
  });

  test('MEMBER_ONLY는 그룹원 전용 문구로 갈린다(code 분기 — status가 아니다)', async () => {
    mockGetBetHistory.mockRejectedValueOnce(axiosErrorWith(403, 'MEMBER_ONLY'));
    await renderScreen();
    expect(screen.getByText('그룹원만 볼 수 있어요.')).toBeOnTheScreen();
  });

  test('빈 목록은 빈 상태 안내 — 에러가 아니다', async () => {
    mockGetBetHistory.mockResolvedValueOnce(slice({ content: [] }));
    await renderScreen();

    expect(screen.getByText('아직 정산된 내기가 없어요')).toBeOnTheScreen();
    expect(screen.queryByText('다시 시도')).toBeNull();
  });
});

describe('첫 페이지 렌더', () => {
  test('날짜·달성 집계·참가비/적립금·인별 행(판정/근거/손익)을 전부 적는다', async () => {
    await renderScreen();

    expect(screen.getByText('7월 31일')).toBeOnTheScreen();
    // achieved 3상 집계 — true만 센다.
    expect(screen.getByText('3명 중 2명 달성')).toBeOnTheScreen();
    expect(screen.getByText('참가비 30 · 적립금 90')).toBeOnTheScreen();
    // 손익 환산(payout - stake)·판정·근거 분 — 시트와 같은 조각을 쓴다.
    expect(screen.getAllByText('+15')).toHaveLength(2);
    expect(screen.getByText('-30')).toBeOnTheScreen();
    expect(screen.getByText('72/60분')).toBeOnTheScreen();
    // 행 전체가 한 덩어리 음성 라벨(시트 rowA11y 그대로).
    expect(screen.getByLabelText('재영 60분 중 72분 달성, 15코인')).toBeOnTheScreen();
  });

  test('REFUNDED/FORFEITED는 결말 문구를 카드에 적는다(시트 배너와 같은 문장)', async () => {
    mockGetBetHistory.mockResolvedValueOnce(
      slice({
        content: [
          historyItem({ betId: 'b1', status: 'REFUNDED' }),
          historyItem({ betId: 'b2', betDate: '2026-07-30', status: 'FORFEITED' }),
        ],
      }),
    );
    await renderScreen();

    expect(screen.getByText('달성한 사람이 없어 전원 환불됐어요')).toBeOnTheScreen();
    expect(screen.getByText('아무도 달성하지 못해 참가비가 소멸됐어요')).toBeOnTheScreen();
  });
});

describe('onEndReached 페이지네이션', () => {
  test('끝에 닿으면 직전 응답의 nextCursor로 다음 페이지를 부르고 이어붙인다', async () => {
    mockGetBetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 'b1' }))
      .mockResolvedValueOnce(
        slice({ content: [historyItem({ betId: 'b2', betDate: '2026-07-30' })] }),
      );
    await renderScreen();

    expect(mockGetBetHistory).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, { size: 20 });

    await reachEnd();

    expect(mockGetBetHistory).toHaveBeenLastCalledWith(GROUP_ID, CHALLENGE_ID, {
      cursor: 'b1',
      size: 20,
    });
    // 첫 페이지는 그대로 남고 다음 페이지가 이어붙는다.
    expect(screen.getByText('7월 31일')).toBeOnTheScreen();
    expect(screen.getByText('7월 30일')).toBeOnTheScreen();
  });

  test('요청이 나가 있는 동안의 연발 onEndReached는 무시된다(중복 호출 방지)', async () => {
    let resolveMore: (v: GroupBetHistorySliceResponse) => void = () => {};
    mockGetBetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 'b1' }))
      .mockReturnValueOnce(
        new Promise<GroupBetHistorySliceResponse>((r) => {
          resolveMore = r;
        }),
      );
    await renderScreen();

    // 같은 틱에 두 번 — FlatList는 스크롤 중 onEndReached를 연발할 수 있다.
    await act(async () => {
      fireEvent(screen.getByTestId('group.betHistory.list'), 'onEndReached');
      fireEvent(screen.getByTestId('group.betHistory.list'), 'onEndReached');
    });
    await act(async () => {
      resolveMore(slice({ content: [historyItem({ betId: 'b2', betDate: '2026-07-30' })] }));
    });

    // 첫 페이지 1회 + 다음 페이지 1회 — 연발이 두 번째 요청을 만들지 않았다.
    expect(mockGetBetHistory).toHaveBeenCalledTimes(2);
  });

  test('hasNext=false면 끝에 닿아도 더 부르지 않는다', async () => {
    // 계약 위반 대비 — cursor가 남아 있어도 hasNext가 false면 끝이다.
    mockGetBetHistory.mockResolvedValueOnce(slice({ hasNext: false, nextCursor: 'b1' }));
    await renderScreen();

    await reachEnd();
    expect(mockGetBetHistory).toHaveBeenCalledTimes(1);
  });

  test('nextCursor=null이면 hasNext=true여도 부르지 않는다 — 무한 재호출 방지', async () => {
    // 서버가 계약(hasNext=false ↔ cursor null)을 어긴 보수적 응답 — 같은 첫 페이지를 영원히
    // 다시 부르는 게 최악이라 양쪽 다 봐야 한다.
    mockGetBetHistory.mockResolvedValueOnce(slice({ hasNext: true, nextCursor: null }));
    await renderScreen();

    await reachEnd();
    expect(mockGetBetHistory).toHaveBeenCalledTimes(1);
  });
});

describe('다음 페이지 404(BET_NOT_FOUND) 인라인', () => {
  test('받은 이력은 유지하고 인라인으로만 알린다 — 전면 에러로 뒤집지 않는다', async () => {
    mockGetBetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 'b1' }))
      .mockRejectedValueOnce(axiosErrorWith(404, 'BET_NOT_FOUND'));
    await renderScreen();

    await reachEnd();

    // 이미 받은 페이지는 그대로.
    expect(screen.getByText('7월 31일')).toBeOnTheScreen();
    // 인라인 배너만 — 전면 에러(다시 시도)가 아니다.
    expect(screen.getByTestId('group.betHistory.more.notice')).toHaveTextContent(
      '지난 기록을 더 불러올 수 없어요',
    );
    expect(screen.queryByText('다시 시도')).toBeNull();
  });

  test('무효 커서는 재시도 무의미 — 이후 끝에 닿아도 다시 부르지 않는다', async () => {
    mockGetBetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 'b1' }))
      .mockRejectedValueOnce(axiosErrorWith(404, 'BET_NOT_FOUND'));
    await renderScreen();

    await reachEnd();
    await reachEnd();

    expect(mockGetBetHistory).toHaveBeenCalledTimes(2); // 첫 페이지 + 실패한 다음 페이지 1회뿐
  });

  test('일시 실패(코드 없는 500 등)는 커서를 보존해 다음 끝 도달에 재시도한다', async () => {
    mockGetBetHistory
      .mockResolvedValueOnce(slice({ hasNext: true, nextCursor: 'b1' }))
      .mockRejectedValueOnce(axiosErrorWith(500))
      .mockResolvedValueOnce(
        slice({ content: [historyItem({ betId: 'b2', betDate: '2026-07-30' })] }),
      );
    await renderScreen();

    await reachEnd();
    expect(screen.getByTestId('group.betHistory.more.notice')).toBeOnTheScreen();

    await reachEnd();
    // 같은 커서로 재시도해 성공 — 배너가 걷히고 페이지가 이어붙는다.
    expect(mockGetBetHistory).toHaveBeenLastCalledWith(GROUP_ID, CHALLENGE_ID, {
      cursor: 'b1',
      size: 20,
    });
    expect(screen.getByText('7월 30일')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.betHistory.more.notice')).toBeNull();
  });
});
