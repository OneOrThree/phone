// BetSheet 전송값·잔액·에러 분기 테스트 — 명세 docs/app/group-bet-plan.md §1,
// 계약 정본 docs/back/group-bet-plan.md §2.
//
// 여기서 잠그는 것(전부 '돈'이 걸린 자리라 조용히 어긋나면 사용자가 손해를 본다):
//  1) 전송값. 개설은 고른 판돈 + **오늘 날짜**, 참가는 카드가 쥔 betId다 — 날짜가 하루 어긋나면
//     서버는 어제 내기를 만들고 아무도 참가할 수 없는 방을 남긴다.
//  2) 잔액 부족은 **누르기 전에** 막는다. 눌러서 서버 400으로 알게 되면 이미 실패한 뒤다.
//  3) 에러 분기. 재시도 가능한 실패(잔액)와 재시도해도 같은 실패(이미 있음·이미 달성·마감)를
//     가른다 — 후자를 시트에 붙잡아 두면 같은 실패만 반복한다.
//  4) BET_ALREADY_JOINED는 **성공 취급**이다(원하던 상태에 이미 도달했다).
//  5) 잔액 3상(3차 리뷰 F1·F3). '못 받은 잔액'으로 부족을 단정하면 코인을 가진 사용자가 영영
//     내기를 못 걸고, 서버가 부족을 확정했는데 CTA가 열려 있으면 같은 400만 반복한다.
//  6) 재시도로 절대 안 풀리는 실패(사라진 챌린지·비멤버·게스트)를 '잠시 후 다시 시도'로 말하지 않는다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import BetSheet from './BetSheet';
import { createBet, joinBet } from '@/services/groupApi';
import { logGroupBetCreated, logGroupBetJoined } from '@/services/analyticsEvents';
import type { GroupChallengeBet, GroupChallengeResponse } from '@/types/dto/group';

// SheetShell이 useSafeAreaInsets를 쓴다 — 테스트 트리엔 SafeAreaProvider가 없어 고정값으로 대체한다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// groupErrorCode는 실제 구현을 남긴다(code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  createBet: jest.fn(),
  joinBet: jest.fn(),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logGroupBetCreated: jest.fn(),
  logGroupBetJoined: jest.fn(),
}));

// 날짜 경계를 테스트가 직접 고정한다(개설 전송값의 date).
jest.mock('@/utils/localDate', () => ({ todayStr: jest.fn(() => '2026-08-01') }));

// 게스트 안내가 계정 설정으로 보낸다 — 시트가 직접 네비게이션을 쥔다(GroupFindSheet와 같은 관행).
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// 잔액은 CoinContext가 정본 — Provider 대신 훅을 대체해 잔액·미상 여부와 refresh 호출을 직접 본다.
// coinsVersion은 '이 잔액이 몇 번째로 받아 온 값인가' — 서버 부족 판정을 풀어도 되는지의 기준이다.
let mockCoins = 100;
let mockCoinsLoaded = true;
let mockCoinsVersion = 1;
const mockRefresh = jest.fn(async () => true);
// latestCoinsVersion()은 **렌더를 거치지 않은** 최신 버전이다 — 목에서도 그 성질을 그대로 둔다.
// (mockCoinsVersion을 바꾸고 rerender하지 않으면, 렌더된 coinsVersion은 낡고 이 함수만 최신이 된다 —
//  실제 CoinContext에서 잔액 응답이 적용된 직후~다음 렌더 사이의 창과 같은 상태다.)
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({
    coins: mockCoins,
    coinsLoaded: mockCoinsLoaded,
    coinsVersion: mockCoinsVersion,
    latestCoinsVersion: () => mockCoinsVersion,
    refresh: mockRefresh,
  }),
}));

const mockCreateBet = createBet as jest.MockedFunction<typeof createBet>;
const mockJoinBet = joinBet as jest.MockedFunction<typeof joinBet>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const CHALLENGE_ID = 'c1';
const BET_ID = 'b1';
const onClose = jest.fn();
const onDone = jest.fn();

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

function bet(over: Partial<GroupChallengeBet> = {}): GroupChallengeBet {
  return {
    betId: BET_ID,
    stake: 30,
    pot: 60,
    status: 'OPEN',
    myJoined: false,
    myAchievedNow: false,
    participants: [
      { userId: 'u1', nickname: '재영' },
      { userId: 'u2', nickname: '수빈' },
    ],
    ...over,
  };
}

function challenge(over: Partial<GroupChallengeResponse> = {}): GroupChallengeResponse {
  return {
    id: CHALLENGE_ID,
    missionType: 'DURATION',
    missionCategory: 'FOCUS',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    status: 'ACTIVE',
    createdAt: '2026-08-01T06:00:00',
    canParticipate: true,
    memberProgress: null,
    bet: null,
    lastSettledBet: null,
    ...over,
  };
}

function sheet(
  mode: 'create' | 'join',
  over: Partial<GroupChallengeResponse> = {},
  myAchieved = false,
) {
  return (
    <BetSheet
      groupId={GROUP_ID}
      challenge={challenge(over)}
      mode={mode}
      myAchieved={myAchieved}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

async function renderSheet(
  mode: 'create' | 'join',
  over: Partial<GroupChallengeResponse> = {},
  myAchieved = false,
) {
  const result = await render(sheet(mode, over, myAchieved));
  await act(async () => {});
  return result;
}

async function submit() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.submit'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCoins = 100;
  mockCoinsLoaded = true;
  mockCoinsVersion = 1;
  mockCreateBet.mockResolvedValue({ betId: BET_ID });
  mockJoinBet.mockResolvedValue(undefined);
});

describe('개설 모드', () => {
  test('기본 판돈은 가장 낮은 10이고 date는 오늘(로컬)이다', async () => {
    await renderSheet('create');
    await submit();

    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 10,
      date: '2026-08-01',
    });
    expect(logGroupBetCreated).toHaveBeenCalledWith({ stake: 10 });
    expect(onDone).toHaveBeenCalled();
  });

  test('고른 판돈이 그대로 나간다', async () => {
    await renderSheet('create');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.50'));
    });
    await submit();

    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 50,
      date: '2026-08-01',
    });
    expect(logGroupBetCreated).toHaveBeenCalledWith({ stake: 50 });
  });

  test('챌린지 요약과 내 코인을 함께 보여준다', async () => {
    await renderSheet('create');
    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();
    // 판돈 칩에도 '100'이 있어 문구가 아니라 자리(testID)로 잡는다.
    expect(screen.getByTestId('group.bet.balance')).toHaveTextContent('100');
    // 시트를 열 때 서버 잔액을 다시 받는다 — 판돈 차감·정산 지급은 서버가 하기 때문이다.
    expect(mockRefresh).toHaveBeenCalled();
  });

  // 개설자는 자동 참가라(계약 §2-1) 달성자는 **개설도** 서버가 거절한다(BET_ALREADY_ACHIEVED).
  // 참가 모드와 같은 잠금을 개설에도 건다 — 근거만 다르다(내기가 없어 진행률에서 파생한 myAchieved).
  // 문구는 카드의 개설 차단 사유와 같은 문장이다 — 참가 문구를 쓰면 참가 버튼이 없는 자리에서
  // 무엇이 막혔는지 말해 주지 못한다.
  test('열어 둔 사이 목표를 달성하면 CTA를 잠그고 개설 사유를 적는다', async () => {
    const { rerender } = await renderSheet('create');
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();

    await act(async () => {
      rerender(sheet('create', {}, true));
    });

    expect(screen.getByText('이미 오늘 목표를 달성해서 내기를 열 수 없어요')).toBeOnTheScreen();
    await submit();
    expect(mockCreateBet).not.toHaveBeenCalled();
  });

  // 숫자만 있으면 VoiceOver는 "10 30 50 100"이라고만 읽는다 — 무엇을 고르는 자리인지도,
  // 무엇이 골라졌는지도 알 수 없다. 바로 위 '내 코인'과 값이 겹치면 더 모호하다(F9).
  test('판돈 칩은 단위와 선택 상태까지 읽힌다', async () => {
    await renderSheet('create');

    const chip10 = screen.getByTestId('group.bet.stake.10');
    expect(chip10).toHaveProp('accessibilityRole', 'button');
    expect(chip10).toHaveProp('accessibilityLabel', '판돈 10코인');
    expect(chip10).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('group.bet.stake.50')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: false }),
    );
  });
});

describe('참가 모드', () => {
  test('카드가 쥔 betId로 참가하고 판돈을 계측한다', async () => {
    await renderSheet('join', { bet: bet() });
    await submit();

    expect(mockJoinBet).toHaveBeenCalledWith(GROUP_ID, BET_ID);
    expect(logGroupBetJoined).toHaveBeenCalledWith({ stake: 30 });
    expect(onDone).toHaveBeenCalled();
    // 참가 모드는 판돈을 고르는 자리가 아니다 — 개설자가 정한 값을 받아들일 뿐이다.
    expect(screen.queryByTestId('group.bet.stake.50')).toBeNull();
  });

  // 시트는 **살아 있는 challenge**를 받는다(부모가 매 렌더 파생) — 열어 둔 사이 내가 목표를
  // 달성하면 서버는 참가를 거절한다(BET_ALREADY_ACHIEVED). 카드가 진입 시점에 막는 것과 같은
  // 기준을 시트도 끝까지 밀어, 눌러서 실패로 알게 되지 않도록 한다.
  test('열어 둔 사이 목표를 달성하면 CTA를 잠그고 사유를 적는다', async () => {
    const { rerender } = await renderSheet('join', { bet: bet() });
    expect(screen.getByText('참가하기')).toBeOnTheScreen();

    await act(async () => {
      rerender(sheet('join', { bet: bet({ myAchievedNow: true }) }));
    });

    expect(screen.getByText('이미 오늘 목표를 달성해서 참가할 수 없어요')).toBeOnTheScreen();
    await submit();
    expect(mockJoinBet).not.toHaveBeenCalled();
  });

  test('판돈·현재 팟·참가자 목록을 보여준다', async () => {
    await renderSheet('join', { bet: bet() });
    expect(screen.getByText('30')).toBeOnTheScreen();
    expect(screen.getByText('60')).toBeOnTheScreen();
    expect(screen.getByText('참가자 2명')).toBeOnTheScreen();
    expect(screen.getByText('재영')).toBeOnTheScreen();
    expect(screen.getByText('수빈')).toBeOnTheScreen();
  });

  // 정원(10명)이 다 차고 접근성 글꼴이 크면 칩이 여러 줄로 늘어난다 — 시트 패널은 하단 고정이라
  // 높이 제한이 없으면 위쪽(제목·내 코인)이 화면 밖으로 밀린다(코덱스 리뷰). 참가자 영역만
  // 높이가 묶인 스크롤 영역이어야 하고, 그 안에서 전원을 볼 수 있어야 한다.
  test('참가자가 정원까지 차도 목록은 높이가 묶인 스크롤 영역에 담긴다', async () => {
    const participants = Array.from({ length: 10 }, (_, i) => ({
      userId: `u${i}`,
      nickname: `아주그럴듯하게긴닉네임${i}`,
    }));
    await renderSheet('join', { bet: bet({ participants }) });

    const list = screen.getByTestId('group.bet.participants');
    expect(list.type).toBe('RCTScrollView');
    expect(StyleSheet.flatten(list.props.style)).toMatchObject({ maxHeight: expect.any(Number) });
    expect(screen.getByText('참가자 10명')).toBeOnTheScreen();
    expect(screen.getByText('아주그럴듯하게긴닉네임9')).toBeOnTheScreen();
  });
});

describe('잔액 부족', () => {
  test('판돈보다 코인이 적으면 CTA를 잠그고 부족분을 적는다', async () => {
    mockCoins = 20;
    await renderSheet('create');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.50'));
    });

    expect(screen.getByText('코인이 부족해요 (30 필요)')).toBeOnTheScreen();
    await submit();
    expect(mockCreateBet).not.toHaveBeenCalled();
  });

  test('판돈을 낮추면 다시 열린다', async () => {
    mockCoins = 20;
    await renderSheet('create');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.50'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.10'));
    });

    expect(screen.getByText('내기 열기')).toBeOnTheScreen();
    await submit();
    expect(mockCreateBet).toHaveBeenCalled();
  });

  test('참가 모드도 판돈을 못 내면 막는다', async () => {
    mockCoins = 10;
    await renderSheet('join', { bet: bet() });

    expect(screen.getByText('코인이 부족해요 (20 필요)')).toBeOnTheScreen();
    await submit();
    expect(mockJoinBet).not.toHaveBeenCalled();
  });
});

// 잔액 '미상'(F1) — 못 받은 잔액의 초기값 0을 '0코인'으로 읽으면, 코인 500을 가진 사용자가
// `코인이 부족해요 (10 필요)`를 보며 영영 내기를 못 건다. 모르는 값으로 사용자를 잠그지 않는다.
describe('잔액 미상', () => {
  test('잔액을 못 받았으면 숫자를 지어내지 않고 부족 판정도 하지 않는다', async () => {
    mockCoinsLoaded = false;
    mockCoins = 0;
    await renderSheet('create');

    expect(screen.getByTestId('group.bet.balance')).toHaveTextContent('—');
    expect(screen.getByText('잔액을 불러오지 못했어요')).toBeOnTheScreen();
    // CTA는 열어 둔다 — 판정은 서버(INSUFFICIENT_CURRENCY)에 맡긴다.
    expect(screen.getByText('내기 열기')).toBeOnTheScreen();
    await submit();
    expect(mockCreateBet).toHaveBeenCalled();
  });

  test('인라인 재시도로 잔액을 다시 받는다', async () => {
    mockCoinsLoaded = false;
    await renderSheet('create');
    mockRefresh.mockClear();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.balance.retry'));
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  test('잔액을 받은 뒤에는 미상 안내가 사라진다', async () => {
    await renderSheet('create');
    expect(screen.getByTestId('group.bet.balance')).toHaveTextContent('100');
    expect(screen.queryByText('잔액을 불러오지 못했어요')).toBeNull();
  });
});

describe('에러 분기', () => {
  // 서버 판정을 앱 상태로 승격한다 — refresh가 실패해 낡은 큰 잔액이 남아 있어도
  // "이 판돈으로는 안 된다"는 이미 확정이다. 안 잠그면 같은 400만 무한 반복한다(F3).
  test('INSUFFICIENT_CURRENCY — 인라인으로 알리고 CTA를 잠근다', async () => {
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(400, 'INSUFFICIENT_CURRENCY'));
    await renderSheet('create');
    mockRefresh.mockClear();
    await submit();

    expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
    expect(mockRefresh).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    // 같은 판돈으로 또 눌러도 나가지 않는다.
    await submit();
    expect(mockCreateBet).toHaveBeenCalledTimes(1);
  });

  test('INSUFFICIENT_CURRENCY — 잔액을 다시 받으면 부족분까지 적는다', async () => {
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(400, 'INSUFFICIENT_CURRENCY'));
    await renderSheet('create');
    // 400과 함께 도착하는 실제 잔액(다른 기기에서 이미 썼다) — 그제서야 부족분을 계산할 수 있다.
    mockRefresh.mockImplementationOnce(async () => {
      mockCoins = 5;
      return true;
    });
    await submit();

    // 부족분은 CTA 라벨이 규격대로 들고 있다(§1) — 같은 문장을 인라인에 또 적지 않는다.
    expect(screen.getByText('코인이 부족해요 (5 필요)')).toBeOnTheScreen();
    expect(screen.queryByText('코인이 부족해요')).toBeNull();
  });

  // 판정은 **그 판돈 이상**에 유효하다 — 50을 못 내는 지갑이 100을 낼 수는 없다.
  // 판돈을 바꿨다고 무조건 풀면, 잔액 재조회가 늦거나 실패해 낡은 큰 잔액이 남은 상황에서
  // 서버가 이미 불가능하다고 확정한 더 큰 금액을 반복 전송하게 된다.
  test('INSUFFICIENT_CURRENCY — 판돈을 올리면 판정이 유지되고, 내리면 풀린다', async () => {
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(400, 'INSUFFICIENT_CURRENCY'));
    await renderSheet('create');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.50'));
    });
    await submit();
    expect(mockCreateBet).toHaveBeenCalledTimes(1);

    // 더 큰 판돈 — 앞선 판정이 그대로 근거다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.100'));
    });
    expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
    await submit();
    expect(mockCreateBet).toHaveBeenCalledTimes(1);

    // 더 낮은 판돈 — 400은 다른(더 큰) 금액에 대한 판정이라 더 이상 근거가 아니다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.30'));
    });
    expect(screen.queryByText('코인이 부족해요')).toBeNull();

    await submit();
    expect(mockCreateBet).toHaveBeenLastCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 30,
      date: '2026-08-01',
    });
  });

  // 참가 모드는 판돈 칩이 없어 '판돈을 바꾸는' 해제 경로 자체가 없다 — 판정 이후에 도착한
  // 권위 있는 잔액이 낼 수 있다고 말하면 풀어야 시트를 닫았다 여는 것 말고도 길이 생긴다.
  test('INSUFFICIENT_CURRENCY — 판정 뒤에 받은 잔액이 낼 수 있다고 하면 풀린다', async () => {
    mockJoinBet.mockRejectedValueOnce(axiosErrorWith(400, 'INSUFFICIENT_CURRENCY'));
    const { rerender } = await renderSheet('join', { bet: bet() });
    await submit();

    // 잔액 재조회는 아직 낡은 값(100)을 쥐고 있다 — 크기만 보면 낼 수 있어 보여도 잠근 채 둔다.
    expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
    await submit();
    expect(mockJoinBet).toHaveBeenCalledTimes(1);

    // 집중 세션 보상이 들어와 **새 잔액**이 도착했다(버전이 올랐다).
    mockCoins = 200;
    mockCoinsVersion = 2;
    await act(async () => {
      rerender(sheet('join', { bet: bet() }));
    });

    expect(screen.queryByText('코인이 부족해요')).toBeNull();
    await submit();
    expect(mockJoinBet).toHaveBeenCalledTimes(2);
  });

  // 판정을 푸는 기준은 '판정보다 **나중에** 도착한 잔액'이다 — 요청이 나가 있는 사이 도착한
  // 잔액은 서버 판정보다 앞선 값이라 근거가 될 수 없다. 판정 시점을 제출 렌더의 클로저로 재면
  // 그 잔액이 '판정 이후'로 세어져 CTA가 곧바로 다시 열리고 같은 400만 반복한다.
  test('INSUFFICIENT_CURRENCY — 요청 중에 도착한 잔액으로는 판정이 풀리지 않는다', async () => {
    let rejectJoin: (e: unknown) => void = () => {};
    mockJoinBet.mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        rejectJoin = reject;
      }),
    );
    const { rerender } = await renderSheet('join', { bet: bet() });

    // 제출했지만 응답은 아직 오지 않았다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.submit'));
    });
    expect(mockJoinBet).toHaveBeenCalledTimes(1);

    // 시트를 열 때 시작한 잔액 조회가 그제서야 끝났다 — 차감 전 값이라 '낼 수 있다'고 말한다.
    mockCoins = 100;
    mockCoinsVersion = 2;
    await act(async () => {
      rerender(sheet('join', { bet: bet() }));
    });

    // 그 뒤에 서버가 부족을 확정한다 — 방금 도착한 잔액보다 **나중**의 사실이다.
    await act(async () => {
      rejectJoin(axiosErrorWith(400, 'INSUFFICIENT_CURRENCY'));
    });

    expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
    await submit();
    expect(mockJoinBet).toHaveBeenCalledTimes(1);
  });

  // 위 테스트의 더 좁은 창 — 잔액이 CoinContext에 **적용은 됐는데 이 시트가 아직 다시 그려지지
  // 않은** 순간에 400이 도착하는 경우다. 시트가 effect로 버전을 미러링하면 그 값은 한 틱 낡아,
  // 판정이 방금 도착한 잔액보다 **이전** 것으로 기록되고 다음 렌더에서 스스로 풀린다(코덱스 리뷰).
  test('INSUFFICIENT_CURRENCY — 렌더 전에 적용된 잔액도 판정보다 앞선 것으로 센다', async () => {
    let rejectJoin: (e: unknown) => void = () => {};
    mockJoinBet.mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        rejectJoin = reject;
      }),
    );
    const { rerender } = await renderSheet('join', { bet: bet() });

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.submit'));
    });

    // 시트 오픈 조회가 끝나 Context에는 새 잔액이 실렸다 — **rerender하지 않는다**(아직 렌더 전).
    mockCoins = 100;
    mockCoinsVersion = 2;

    await act(async () => {
      rejectJoin(axiosErrorWith(400, 'INSUFFICIENT_CURRENCY'));
    });

    // 이제 그 잔액이 화면에 반영된다 — 판정과 같은 버전이라 판정을 뒤집지 못한다.
    await act(async () => {
      rerender(sheet('join', { bet: bet() }));
    });

    expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
    await submit();
    expect(mockJoinBet).toHaveBeenCalledTimes(1);
  });

  // 누가 먼저 열었는지는 앱이 알 수 없다 — 성공 직후 재조회 전에 다시 누른 **본인**일 수도 있다.
  test('BET_ALREADY_EXISTS — 사실 범위 안에서만 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_EXISTS'));
    await renderSheet('create');
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '이미 오늘 내기가 열려 있어요',
      '최신 상태로 새로고침할게요.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  // 응답만 타임아웃되고 서버에선 개설이 성립했을 수 있다 — 그 경우 판돈은 이미 빠졌는데
  // 전역 잔액은 차감 전 값으로 남는다. 남이 먼저 연 경우엔 같은 값을 다시 확인할 뿐이라 무해하다.
  test('BET_ALREADY_EXISTS — 잔액도 다시 받는다', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_EXISTS'));
    await renderSheet('create');
    mockRefresh.mockClear();
    await submit();

    expect(mockRefresh).toHaveBeenCalled();
  });

  test('BET_ALREADY_ACHIEVED — 카드와 같은 사유 문구로 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_ACHIEVED'));
    await renderSheet('join', { bet: bet() });
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '참가할 수 없어요',
      '이미 오늘 목표를 달성해서 참가할 수 없어요',
    );
    expect(onDone).toHaveBeenCalled();
  });

  test('BET_CLOSED(참가) — 마감을 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CLOSED'));
    await renderSheet('join', { bet: bet() });
    await submit();

    expect(alertSpy).toHaveBeenCalledWith('마감된 내기예요', '이미 마감돼 참가할 수 없어요.');
    expect(onDone).toHaveBeenCalled();
  });

  // 같은 코드가 개설에선 'date가 오늘(KST)이 아니다'라는 뜻이다(계약 §4) —
  // 아직 만들지도 않은 내기에 "이미 마감돼 참가할 수 없어요"는 뜻이 통하지 않는다.
  test('BET_CLOSED(개설) — 날짜 문제로 말한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CLOSED'));
    await renderSheet('create');
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '오늘 내기만 열 수 있어요',
      '날짜가 바뀌었어요. 새로고침 후 다시 시도해주세요.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  // 챌린지 비활성은 이 시트에서 재시도해도 영원히 같은 실패다(GROMO-1025) — 예전엔 switch에
  // 분기가 없어 default('잠시 후 다시 시도')로 떨어지고 시트도 남아, 같은 영구 실패를 반복했다.
  test('BET_CHALLENGE_INACTIVE(개설) — 끝난 챌린지를 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CHALLENGE_INACTIVE'));
    await renderSheet('create');
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '끝난 챌린지예요',
      '종료된 챌린지에는 내기를 열 수 없어요.',
    );
    expect(onDone).toHaveBeenCalled();
    expect(screen.queryByText('내기를 열지 못했어요. 잠시 후 다시 시도해주세요.')).toBeNull();
  });

  // 참가도 같은 코드로 막힌다 — 문구만 staleBetSheetAlert의 참가 분기와 같은 문장으로 갈린다.
  test('BET_CHALLENGE_INACTIVE(참가) — 끝난 챌린지를 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CHALLENGE_INACTIVE'));
    await renderSheet('join', { bet: bet() });
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '끝난 챌린지예요',
      '종료된 챌린지의 내기에는 참가할 수 없어요.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  test('NOT_FOUND — 사라진 챌린지를 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(404, 'NOT_FOUND'));
    await renderSheet('create');
    await submit();

    expect(alertSpy).toHaveBeenCalledWith('사라진 챌린지예요', '방장이 챌린지를 없앴을 수 있어요.');
    expect(onDone).toHaveBeenCalled();
  });

  // 챌린지가 아니라 **내기**가 사라진 코드다(계약 §2-2 BET_NOT_FOUND) — 공통 문구로 떨어뜨리면
  // 영원히 같은 실패를 '잠시 후 다시 시도'하라고 말하게 된다.
  test('BET_NOT_FOUND — 사라진 내기를 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinBet.mockRejectedValueOnce(axiosErrorWith(404, 'BET_NOT_FOUND'));
    await renderSheet('join', { bet: bet() });
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '사라진 내기예요',
      '이미 없어진 내기예요. 최신 상태로 새로고침할게요.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  test('MEMBER_ONLY — 그룹원만 이용할 수 있다고 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinBet.mockRejectedValueOnce(axiosErrorWith(403, 'MEMBER_ONLY'));
    await renderSheet('join', { bet: bet() });
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '그룹원만 이용할 수 있어요',
      '그룹에서 나갔거나 더 이상 멤버가 아니에요.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  // 게스트는 재화를 쓸 수 없다 — '잠시 후 다시 시도'는 거짓이라 로그인 안내로 갈아 끼운다.
  test('GUEST_FORBIDDEN — 로그인 안내로 바뀌고 계정 설정으로 보낸다', async () => {
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(403, 'GUEST_FORBIDDEN'));
    await renderSheet('create');
    await submit();

    expect(screen.getByText('로그인하면 내기에 참여할 수 있어요')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.bet.submit')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.login'));
    });
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('SettingsAccount');
  });

  test('BET_ALREADY_JOINED — 성공 취급(계측은 발행하지 않는다)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_JOINED'));
    await renderSheet('join', { bet: bet() });
    await submit();

    expect(onDone).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    // 새 참가가 아니다 — 이미 성립한 참가를 두 번 세면 참가율이 부푼다.
    expect(logGroupBetJoined).not.toHaveBeenCalled();
  });

  test('모르는 실패는 공통 문구로 떨어뜨린다', async () => {
    mockJoinBet.mockRejectedValueOnce(axiosErrorWith(500));
    await renderSheet('join', { bet: bet() });
    await submit();

    expect(screen.getByText('참가하지 못했어요. 잠시 후 다시 시도해주세요.')).toBeOnTheScreen();
    expect(onDone).not.toHaveBeenCalled();
  });
});

// 전송 중엔 CTA도 딤 탭도 막혀 있다(언마운트 방지) — 최대 15초(axios 타임아웃) 동안
// 멈춘 화면으로 보이지 않게 진행 중임을 한 줄로 알린다(F10).
describe('전송 중', () => {
  test('처리 중 안내를 세우고 끝나면 걷는다', async () => {
    let finish: (v: { betId: string }) => void = () => {};
    mockCreateBet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderSheet('create');
    await submit();

    expect(screen.getByText('처리 중이에요…')).toBeOnTheScreen();

    await act(async () => {
      finish({ betId: BET_ID });
    });
    expect(onDone).toHaveBeenCalled();
  });

  // 10을 보낸 뒤 100을 누를 수 있으면, 서버엔 10이 간 채 화면의 마지막 선택만 100이 된다 —
  // 성공 후 사용자는 자기가 100을 걸었다고 오인한다. 금액이 확정된 뒤엔 칩을 잠근다.
  test('전송 중에는 판돈을 바꿀 수 없다', async () => {
    let finish: (v: { betId: string }) => void = () => {};
    mockCreateBet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderSheet('create');
    await submit();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.100'));
    });
    expect(screen.getByTestId('group.bet.stake.100')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: false, disabled: true }),
    );
    expect(screen.getByTestId('group.bet.stake.10')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true }),
    );

    await act(async () => {
      finish({ betId: BET_ID });
    });
    // 나간 금액도 처음 고른 10 그대로다.
    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 10,
      date: '2026-08-01',
    });
  });
});
