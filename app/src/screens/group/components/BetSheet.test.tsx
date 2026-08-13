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
import { createBet, joinBet, joinSession } from '@/services/groupApi';
import { logGroupBetCreated, logGroupBetJoined } from '@/services/analyticsEvents';
import type { GroupBetSession, GroupChallengeBet, GroupChallengeResponse } from '@/types/dto/group';

// 첫 렌더가 RN 모듈을 콜드 로드하는 무거운 스위트라 CI 러너에선 기본 5s를 넘겨 flaky timeout이 났다 —
// 로직이 아니라 콜드 스타트 지연이므로 이 파일 한정으로 타임아웃을 넉넉히 준다.
jest.setTimeout(20000);

// SheetShell이 useSafeAreaInsets를 쓴다 — 테스트 트리엔 SafeAreaProvider가 없어 고정값으로 대체한다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// groupErrorCode는 실제 구현을 남긴다(code 분기까지 검증).
// joinSession은 챌린지 v2 회차 참여 경로(GROMO-1275) — 신서버 응답(bet.session)에서만 나간다.
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  createBet: jest.fn(),
  joinBet: jest.fn(),
  joinSession: jest.fn(),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logCurrencyInsufficient: jest.fn(),
  logGroupBetCreated: jest.fn(),
  logGroupBetJoined: jest.fn(),
  logGroupChallengeJoined: jest.fn(),
  logGroupChallengeDeleted: jest.fn(),
}));

// SCREEN_TIME의 차단 판정(이미 목표 초과)은 시트가 내 진행 행에서 직접 읽는다 — userId 정본은
// UserContext다(부모가 내려주는 myAchieved prop은 FOCUS 의미로 이미 배선돼 있다).
let mockUserId: string | null = 'u1';
jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ userId: mockUserId }),
}));

// 날짜 경계를 테스트가 직접 고정한다(개설 전송값의 date — 마감 후엔 내일 날짜가 나간다).
// 시트는 KST 고정 버전을 쓴다(bet_date는 서버 KST 판정 — PR #473 리뷰) — 로컬 버전은
// 이 모듈을 함께 로드하는 다른 코드가 깨지지 않게 같은 값으로 남겨 둔다.
jest.mock('@/utils/localDate', () => ({
  todayStr: jest.fn(() => '2026-08-01'),
  tomorrowStr: jest.fn(() => '2026-08-02'),
  todayStrKst: jest.fn(() => '2026-08-01'),
  tomorrowStrKst: jest.fn(() => '2026-08-02'),
}));

// 창 마감 판정(GROMO-1103)은 Asia/Seoul 벽시계 초로 비교한다 — '지금'을 테스트가 직접 고정한다.
// timeStrToSeconds는 실제 구현을 남긴다(자정 걸침 창 판정까지 검증).
let mockNowSec = 10 * 3600; // 기본 10:00 — 아래 창(09~11시) 기준 '아직 열려 있음'
jest.mock('@/utils/challengeTime', () => ({
  ...jest.requireActual('@/utils/challengeTime'),
  nowSecondsInZone: jest.fn(() => mockNowSec),
}));

// 잔액은 CoinContext가 정본 — Provider 대신 훅을 대체해 잔액·미상 여부와 refresh 호출을 직접 본다.
// coinsVersion은 '이 잔액이 몇 번째로 받아 온 값인가' — 서버 부족 판정을 풀어도 되는지의 기준이다.
// 기본 잔액은 최고 프리셋(3,000 — N30 상한)까지 잠기지 않는 값 — 부족 시나리오는 각 테스트가 내려 잡는다.
let mockCoins = 5000;
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

// 선택지 없는 결과 통보는 토스트로 나간다(GROMO-1491 / 정책 D8·D19 —
// docs/prd/motion-v2/policy.md, 상위 정본 병합 전까지 여기가 정본) — useToast는 Provider
// 밖에서 throw하므로 훅 자체를 목으로 대체한다.
const mockToastShow = jest.fn();
jest.mock('@/store/ToastContext', () => ({ useToast: () => ({ show: mockToastShow }) }));

const mockCreateBet = createBet as jest.MockedFunction<typeof createBet>;
const mockJoinBet = joinBet as jest.MockedFunction<typeof joinBet>;
const mockJoinSession = joinSession as jest.MockedFunction<typeof joinSession>;

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
  mockCoins = 5000;
  mockCoinsLoaded = true;
  mockCoinsVersion = 1;
  mockUserId = 'u1';
  mockNowSec = 10 * 3600;
  mockCreateBet.mockResolvedValue({ betId: BET_ID });
  mockJoinBet.mockResolvedValue(undefined);
  mockJoinSession.mockResolvedValue(undefined);
});

describe('개설 모드', () => {
  // 프리셋은 상한 대비 비율(10/30/50/100% — N30)이라 상한 3,000 기준 300/900/1,500/3,000이다.
  test('기본 참가비는 가장 낮은 300이고 date는 오늘(KST)이다', async () => {
    await renderSheet('create');
    await submit();

    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 300,
      date: '2026-08-01',
    });
    expect(logGroupBetCreated).toHaveBeenCalledWith({
      stake: 300,
      mission_type: 'DURATION',
      mission_category: 'FOCUS',
    });
    expect(onDone).toHaveBeenCalled();
  });

  test('고른 참가비가 그대로 나간다', async () => {
    await renderSheet('create');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.1500'));
    });
    await submit();

    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 1500,
      date: '2026-08-01',
    });
    expect(logGroupBetCreated).toHaveBeenCalledWith({
      stake: 1500,
      mission_type: 'DURATION',
      mission_category: 'FOCUS',
    });
  });

  test('챌린지 요약과 내 코인을 함께 보여준다', async () => {
    await renderSheet('create');
    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();
    // 판돈 칩과 값이 겹칠 수 있어 문구가 아니라 자리(testID)로 잡는다.
    expect(screen.getByTestId('group.bet.balance')).toHaveTextContent('5000');
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

  // 숫자만 있으면 VoiceOver는 "300 900 1500 3000"이라고만 읽는다 — 무엇을 고르는 자리인지도,
  // 무엇이 골라졌는지도 알 수 없다. 바로 위 '내 코인'과 값이 겹치면 더 모호하다(F9).
  test('참가비 칩은 단위와 선택 상태까지 읽힌다', async () => {
    await renderSheet('create');

    const chip300 = screen.getByTestId('group.bet.stake.300');
    expect(chip300).toHaveProp('accessibilityRole', 'button');
    expect(chip300).toHaveProp('accessibilityLabel', '참가비 300코인');
    expect(chip300).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('group.bet.stake.1500')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: false }),
    );
  });
});

describe('참가 모드', () => {
  test('카드가 쥔 betId로 참가하고 참가비를 계측한다', async () => {
    await renderSheet('join', { bet: bet() });
    await submit();

    expect(mockJoinBet).toHaveBeenCalledWith(GROUP_ID, BET_ID);
    expect(logGroupBetJoined).toHaveBeenCalledWith({
      stake: 30,
      mission_type: 'DURATION',
      mission_category: 'FOCUS',
    });
    expect(onDone).toHaveBeenCalled();
    // 참가 모드는 판돈을 고르는 자리가 아니다 — 개설자가 정한 값을 받아들일 뿐이다.
    expect(screen.queryByTestId('group.bet.stake.1500')).toBeNull();
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

  test('참가비·현재 적립금·참가자 목록을 보여준다', async () => {
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
  test('참가비보다 코인이 적으면 CTA를 잠그고 부족분을 적는다', async () => {
    mockCoins = 500;
    await renderSheet('create');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.1500'));
    });

    expect(screen.getByText('코인이 부족해요 (1000 필요)')).toBeOnTheScreen();
    await submit();
    expect(mockCreateBet).not.toHaveBeenCalled();
  });

  test('참가비를 낮추면 다시 열린다', async () => {
    mockCoins = 500;
    await renderSheet('create');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.1500'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.300'));
    });

    expect(screen.getByText('내기 열기')).toBeOnTheScreen();
    await submit();
    expect(mockCreateBet).toHaveBeenCalled();
  });

  test('참가 모드도 참가비를 못 내면 막는다', async () => {
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
    expect(screen.getByTestId('group.bet.balance')).toHaveTextContent('5000');
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
    expect(screen.getByText('코인이 부족해요 (295 필요)')).toBeOnTheScreen();
    expect(screen.queryByText('코인이 부족해요')).toBeNull();
  });

  // 판정은 **그 판돈 이상**에 유효하다 — 50을 못 내는 지갑이 100을 낼 수는 없다.
  // 판돈을 바꿨다고 무조건 풀면, 잔액 재조회가 늦거나 실패해 낡은 큰 잔액이 남은 상황에서
  // 서버가 이미 불가능하다고 확정한 더 큰 금액을 반복 전송하게 된다.
  test('INSUFFICIENT_CURRENCY — 참가비를 올리면 판정이 유지되고, 내리면 풀린다', async () => {
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(400, 'INSUFFICIENT_CURRENCY'));
    await renderSheet('create');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.1500'));
    });
    await submit();
    expect(mockCreateBet).toHaveBeenCalledTimes(1);

    // 더 큰 판돈 — 앞선 판정이 그대로 근거다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.3000'));
    });
    expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
    await submit();
    expect(mockCreateBet).toHaveBeenCalledTimes(1);

    // 더 낮은 판돈 — 400은 다른(더 큰) 금액에 대한 판정이라 더 이상 근거가 아니다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.900'));
    });
    expect(screen.queryByText('코인이 부족해요')).toBeNull();

    await submit();
    expect(mockCreateBet).toHaveBeenLastCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 900,
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

  // 취소(CANCELED)된 내기는 신서버(1201/#498)에선 이 코드를 만들 수 없다 — 재개설이 성공한다.
  // 구서버(V28 이전)는 취소 행으로도 409를 내면서 카드에선 걸러 주므로 '참가' 약속은 걸 수 없다
  // (codex 리뷰) — 존재 사실 + 새로고침 안내까지만, 양쪽 서버에서 참인 문장으로 말한다.
  test('BET_ALREADY_EXISTS — 이미 열려 있음을 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_EXISTS'));
    await renderSheet('create');
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '이미 오늘 내기가 열려 있어요',
      '이미 오늘 내기가 있어요. 새로고침해서 최신 상태를 확인해 주세요.',
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

  // '취소된 날짜 재개설 성공'의 앱 레벨 테스트는 두지 않는다(codex 리뷰) — 취소는 서버가
  // 카드 응답에서 걸러 앱은 bet: null 로만 관측하므로, 컴포넌트 층에선 일반 개설 성공과
  // 구별되는 입력이 없다(중복 테스트가 된다). 재개설 허용 규칙은 서버 GroupBetServiceTest
  // ("취소된 내기만 있는 날짜엔 재개설 허용")가 잠근다.

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
      '날짜가 바뀌었어요. 새로고침 후 다시 시도해 주세요.',
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
    expect(screen.queryByText('내기를 열지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeNull();
  });

  // 참가 분기는 **선제 방어**다 — 현재 서버는 이 코드를 개설(createBet)에서만 던지고 joinBet은
  // 챌린지 상태를 보지 않는다(클로드 리뷰). switch가 모드 공용이라 함께 커버해 두고, 서버가
  // 참가에도 같은 검사를 추가하는 날 문구(staleBetSheetAlert 참가 분기와 같은 문장)까지 대비한다.
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

    expect(screen.getByText('참가하지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeOnTheScreen();
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

  // 300을 보낸 뒤 3000을 누를 수 있으면, 서버엔 300이 간 채 화면의 마지막 선택만 3000이 된다 —
  // 성공 후 사용자는 자기가 3000을 걸었다고 오인한다. 금액이 확정된 뒤엔 칩을 잠근다.
  test('전송 중에는 참가비를 바꿀 수 없다', async () => {
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
      fireEvent.press(screen.getByTestId('group.bet.stake.3000'));
    });
    expect(screen.getByTestId('group.bet.stake.3000')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: false, disabled: true }),
    );
    expect(screen.getByTestId('group.bet.stake.300')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true }),
    );

    await act(async () => {
      finish({ betId: BET_ID });
    });
    // 나간 금액도 처음 고른 300 그대로다.
    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 300,
      date: '2026-08-01',
    });
  });
});

// ── 확장 배치(계약 contract.md §2) — SCREEN_TIME·창 내기 · 몰수 고지 ──────────────
// SCREEN_TIME의 차단 방향은 FOCUS와 반대다: achieved===true는 '잠정 달성'(지금까지 이하 유지)
// 이라 잠그면 하루 시작 직후 사실상 전원이 잠기고, 막아야 하는 건 확정 패배(이미 초과)뿐이다.
describe('SCREEN_TIME 내기', () => {
  const stProgress = (achieved: boolean | null) => [
    { userId: 'u1', nickname: '재영', progressMinutes: 30, achieved },
  ];

  test('잠정 달성(myAchievedNow·myAchieved)으로는 참가·개설을 잠그지 않는다', async () => {
    // 참가 — 서버가 myAchievedNow:true(잠정)를 줘도 CTA는 열려 있다.
    await renderSheet('join', {
      missionCategory: 'SCREEN_TIME',
      bet: bet({ myAchievedNow: true }),
      memberProgress: stProgress(true),
    });
    await submit();
    expect(mockJoinBet).toHaveBeenCalledWith(GROUP_ID, BET_ID);

    // 개설 — 부모가 FOCUS 의미로 파생한 myAchieved:true(잠정 달성)도 잠그지 않는다.
    await renderSheet(
      'create',
      { missionCategory: 'SCREEN_TIME', memberProgress: stProgress(true) },
      true,
    );
    await submit();
    expect(mockCreateBet).toHaveBeenCalled();
  });

  test('이미 목표를 초과(확정 패배)했으면 CTA를 잠그고 사유를 적는다', async () => {
    // 참가 — 내 진행 행 achieved===false(초과)가 근거다.
    await renderSheet('join', {
      missionCategory: 'SCREEN_TIME',
      bet: bet(),
      memberProgress: stProgress(false),
    });
    expect(screen.getByText('이미 목표를 초과해서 참가할 수 없어요')).toBeOnTheScreen();
    await submit();
    expect(mockJoinBet).not.toHaveBeenCalled();

    // 개설 — 같은 근거, 개설 문장.
    await renderSheet('create', {
      missionCategory: 'SCREEN_TIME',
      memberProgress: stProgress(false),
    });
    expect(screen.getByText('이미 목표를 초과해서 내기를 열 수 없어요')).toBeOnTheScreen();
    await submit();
    expect(mockCreateBet).not.toHaveBeenCalled();
  });

  test('미집계(null)는 어느 쪽으로도 잠그지 않는다 — 3상 규칙', async () => {
    await renderSheet('join', {
      missionCategory: 'SCREEN_TIME',
      bet: bet(),
      memberProgress: stProgress(null),
    });
    await submit();
    expect(mockJoinBet).toHaveBeenCalled();
  });

  // 레이스로 클라 잠금을 지나쳐도 서버가 확정 판정으로 거절한다(409 BET_ALREADY_FAILED) —
  // 이 시트에서 재시도해도 오늘은 영원히 같은 실패라 닫고 재조회한다.
  test('BET_ALREADY_FAILED는 Alert로 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_FAILED'));
    await renderSheet('join', { missionCategory: 'SCREEN_TIME', bet: bet() });
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '참가할 수 없어요',
      '이미 목표를 초과해서 참가할 수 없어요',
    );
    expect(onDone).toHaveBeenCalled();

    // 개설 경로는 개설 문장으로 갈린다.
    alertSpy.mockClear();
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_FAILED'));
    await renderSheet('create', { missionCategory: 'SCREEN_TIME' });
    await submit();
    expect(alertSpy).toHaveBeenCalledWith(
      '내기를 열 수 없어요',
      '이미 목표를 초과해서 내기를 열 수 없어요',
    );
  });

  // 게이트 확대(전 조합 허용)가 아직 배포되지 않은 서버는 FOCUS×DURATION 밖 내기를
  // BET_FOCUS_ONLY로 거절한다 — 앱이 진입점을 먼저 연 배포 공백기의 실존 경로다.
  // default('잠시 후 다시 시도')로 떨어뜨리면 영원한 실패에 재시도를 권하게 된다.
  test('구서버 BET_FOCUS_ONLY는 전용 문구로 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(400, 'BET_FOCUS_ONLY'));
    await renderSheet('create', { missionCategory: 'SCREEN_TIME' });
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '아직 내기를 걸 수 없는 챌린지예요',
      '지금은 하루 목표 집중 챌린지에만 내기를 걸 수 있어요. 서버 업데이트 후 열 수 있어요.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  // 계약 §2 "카드·시트 안내 문구 필수" — 15분 눈금 측정 위로 코인이 움직인다는 사실을
  // 돈이 나가기 전에 고지한다. FOCUS 내기에는 붙이지 않는다(측정 문제가 없다).
  test('SCREEN_TIME 내기에만 측정 한계 고지가 붙는다', async () => {
    await renderSheet('create', { missionCategory: 'SCREEN_TIME' });
    expect(
      screen.getByText(/스크린타임은 15분 단위로 집계돼 오차가 있을 수 있어요/),
    ).toBeOnTheScreen();

    await renderSheet('create');
    expect(screen.queryByText(/스크린타임은 15분 단위로 집계돼/)).toBeNull();
  });
});

describe('몰수 고지·창 내기 문구', () => {
  // 승자 0명 = 전액 소멸(계약 확정 정책). 구 문구 '전액 환불돼요'가 남아 있으면 화면이
  // 거짓을 말한다 — 개설·참가 모두에서 몰수를 고지한다.
  test('개설·참가 노트가 몰수 룰을 말한다', async () => {
    await renderSheet('create');
    expect(screen.getByText(/아무도 달성하지 못하면 참가비는 사라져요/)).toBeOnTheScreen();
    expect(screen.queryByText(/전액 환불돼요/)).toBeNull();

    await renderSheet('join', { bet: bet() });
    expect(screen.getByText(/아무도 달성하지 못하면 참가비는 사라져요/)).toBeOnTheScreen();
  });

  // 창 내기의 BET_CLOSED(개설)는 '날짜가 바뀌었다'가 아니라 '오늘 창이 끝났다'다(계약 §2 —
  // now ≥ 오늘 창 endAt). 일형 문구를 그대로 내면 원인(시간대 종료)을 말해 주지 못한다.
  // 내일 날짜 재시도(GROMO-1103)까지 막힌 뒤에만 이 문구가 선다 — 구서버(내일도 BET_CLOSED)의 경로다.
  test('창 챌린지의 BET_CLOSED — 내일 재시도까지 막히면 창 종료 문구로 알린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CLOSED'));
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CLOSED'));
    await renderSheet('create', {
      missionType: 'TIME_WINDOW',
      durationMinutes: 60,
      windowStart: '09:00:00',
      windowEnd: '11:00:00',
    });
    await submit();

    expect(mockCreateBet).toHaveBeenCalledTimes(2);
    expect(mockCreateBet).toHaveBeenLastCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 300,
      date: '2026-08-02',
    });
    expect(alertSpy).toHaveBeenCalledWith(
      '내기를 열 수 있는 시간이 지났어요',
      '오늘 시간대가 끝나 내기를 열 수 없어요. 내일 다시 열 수 있어요.',
    );
    expect(onDone).toHaveBeenCalled();
  });
});

// ── 참가비 자유 입력(계약 §2, GROMO-1097) — 입력 필드가 단일 소스, 칩은 프리셋 ──────────
describe('참가비 직접 입력', () => {
  test('입력한 참가비가 그대로 나간다 — 프리셋 밖 값(250)도 허용', async () => {
    mockCoins = 1000; // 잔액 부족 잠금과 겹치지 않게 — 여기서 보는 건 전송값뿐이다.
    await renderSheet('create');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('group.bet.stake.input'), '250');
    });
    await submit();

    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 250,
      date: '2026-08-01',
    });
    expect(logGroupBetCreated).toHaveBeenCalledWith({
      stake: 250,
      mission_type: 'DURATION',
      mission_category: 'FOCUS',
    });
  });

  test('경계값 1·3000은 허용된다', async () => {
    await renderSheet('create');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('group.bet.stake.input'), '1');
    });
    await submit();
    expect(mockCreateBet).toHaveBeenLastCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 1,
      date: '2026-08-01',
    });

    // 성공 후 submitting은 열린 채 남는다(시트는 닫히는 전제) — 3000은 새 시트에서 본다.
    await renderSheet('create');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('group.bet.stake.input'), '3000');
    });
    await submit();
    expect(mockCreateBet).toHaveBeenLastCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 3000,
      date: '2026-08-01',
    });
  });

  // 모달 금지(스펙) — 잠긴 CTA 옆에 같은 근거를 인라인으로 말한다. 문장은 서버
  // BET_INVALID_STAKE 메시지와 같다(같은 사실을 두 자리에서 달리 말하지 않는다).
  test('범위 밖(0·3001)·빈 값이면 CTA를 잠그고 인라인으로 알린다', async () => {
    await renderSheet('create');

    for (const bad of ['0', '3001', '']) {
      await act(async () => {
        fireEvent.changeText(screen.getByTestId('group.bet.stake.input'), bad);
      });
      expect(screen.getByText('참가비는 1~3,000코인 사이로 입력해 주세요')).toBeOnTheScreen();
      await submit();
      expect(mockCreateBet).not.toHaveBeenCalled();
    }
  });

  test('숫자가 아닌 문자는 입력 단계에서 걸러진다', async () => {
    await renderSheet('create');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('group.bet.stake.input'), '12a');
    });
    expect(screen.getByTestId('group.bet.stake.input')).toHaveProp('value', '12');
  });

  test('칩을 누르면 입력 필드에 값이 반영된다 — 무효 입력으로 잠긴 상태도 풀린다', async () => {
    await renderSheet('create');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('group.bet.stake.input'), '');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.stake.1500'));
    });

    expect(screen.getByTestId('group.bet.stake.input')).toHaveProp('value', '1500');
    expect(screen.queryByText('참가비는 1~3,000코인 사이로 입력해 주세요')).toBeNull();
    await submit();
    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 1500,
      date: '2026-08-01',
    });
  });

  test('직접 입력이 프리셋과 같으면 칩이 선택 상태로 켜진다 — 칩은 입력값의 파생 표시다', async () => {
    await renderSheet('create');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('group.bet.stake.input'), '900');
    });
    expect(screen.getByTestId('group.bet.stake.900')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true }),
    );

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('group.bet.stake.input'), '901');
    });
    expect(screen.getByTestId('group.bet.stake.900')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: false }),
    );
  });
});

// ── 시간대 마감 후 내일 적용(계약 §3, GROMO-1103) ────────────────────────────────
// 마감 뒤의 개설을 실패 모달로 끝내지 않는다 — 처음부터 내일 내기로 열고, 그 사실을
// 돈이 나가기 전에(시트 안내) 또는 나간 직후에(재시도 성공 Alert) 말한다.
describe('마감 후 내일 내기', () => {
  const windowChallenge = {
    missionType: 'TIME_WINDOW' as const,
    durationMinutes: 60,
    windowStart: '09:00:00',
    windowEnd: '11:00:00',
  };

  test('오늘 창이 끝났으면 처음부터 내일 날짜로 열고 안내를 세운다', async () => {
    mockNowSec = 12 * 3600; // 12:00 — 11:00 창 종료 후
    await renderSheet('create', windowChallenge);

    expect(screen.getByText('오늘 시간대가 끝나 내일 시간대부터 적용돼요')).toBeOnTheScreen();
    await submit();

    expect(mockCreateBet).toHaveBeenCalledTimes(1);
    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 300,
      date: '2026-08-02',
    });
    expect(onDone).toHaveBeenCalled();
  });

  test('창이 아직 열려 있으면 안내 없이 오늘 날짜로 나간다', async () => {
    mockNowSec = 10 * 3600;
    await renderSheet('create', windowChallenge);

    expect(screen.queryByTestId('group.bet.tomorrowNote')).toBeNull();
    await submit();
    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 300,
      date: '2026-08-01',
    });
  });

  // 자정 걸침 창(start > end)의 실질 마감은 자정(서버 날짜 게이트)이다 — end(01:00)가 낮보다
  // 이르다고 '끝났다'로 읽으면 하루 종일 내일 내기만 걸리는 오판이 된다.
  test('자정 걸침 창(22:00~01:00)은 낮 시간을 마감으로 오인하지 않는다', async () => {
    mockNowSec = 12 * 3600;
    await renderSheet('create', {
      ...windowChallenge,
      windowStart: '22:00:00',
      windowEnd: '01:00:00',
    });

    expect(screen.queryByTestId('group.bet.tomorrowNote')).toBeNull();
    await submit();
    expect(mockCreateBet).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      stake: 300,
      date: '2026-08-01',
    });
  });

  // 클라 시계로는 아직 열려 있었는데 서버가 마감을 확정한 경합 — 실패 모달 대신 내일 날짜로
  // 정확히 1회 재시도한다. 시트는 닫히므로 안내는 토스트로 세운다(계약 §3 · 정책 D8/D19).
  test('BET_CLOSED 경합 — 내일 날짜로 1회 재시도하고 성공하면 같은 안내를 알린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CLOSED'));
    await renderSheet('create', windowChallenge);
    await submit();

    expect(mockCreateBet).toHaveBeenCalledTimes(2);
    expect(mockCreateBet.mock.calls[0][2]).toEqual({ stake: 300, date: '2026-08-01' });
    expect(mockCreateBet.mock.calls[1][2]).toEqual({ stake: 300, date: '2026-08-02' });
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '오늘 시간대가 끝나 내일 내기로 열었어요',
      tone: 'success',
    });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
    // ⚠️ 시트는 RN Modal이라 토스트가 그 아래 깔린다 — 닫은 **뒤** 알려야 보인다.
    expect(onDone.mock.invocationCallOrder[0]).toBeLessThan(
      mockToastShow.mock.invocationCallOrder[0],
    );
    // 재시도 성공도 실제 개설이다 — 계측이 발행된다.
    expect(logGroupBetCreated).toHaveBeenCalledWith({
      stake: 300,
      mission_type: 'TIME_WINDOW',
      mission_category: 'FOCUS',
    });
  });

  // 재시도의 실패는 코드별 분기를 그대로 탄다 — 남이 먼저 연 내일 내기(BET_ALREADY_EXISTS)에
  // '시간이 지났어요'도, '이미 **오늘** 내기가 있어요'도 거짓이다(PR #473 리뷰). 재시도는
  // 내일 날짜로 나갔으므로 문구도 내일 내기의 사실을 말해야 한다.
  test('재시도가 BET_ALREADY_EXISTS로 막히면 내일 내기 문구로 알린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CLOSED'));
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_EXISTS'));
    await renderSheet('create', windowChallenge);
    await submit();

    expect(mockCreateBet).toHaveBeenCalledTimes(2);
    expect(alertSpy).toHaveBeenCalledWith(
      '이미 내일 내기가 열려 있어요',
      '이미 내일 내기가 있어요. 새로고침해서 최신 상태를 확인해 주세요.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  // 처음부터 내일 날짜로 보낸 개설(마감 후)의 충돌도 같은 내일 문구다 — 오늘 문구는
  // 오늘 날짜로 보낸 요청에만 남는다.
  test('마감 후 개설의 BET_ALREADY_EXISTS도 내일 내기 문구로 알린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockNowSec = 12 * 3600; // 창 종료 후 — 처음부터 내일 날짜로 나간다
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_EXISTS'));
    await renderSheet('create', windowChallenge);
    await submit();

    expect(mockCreateBet).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      '이미 내일 내기가 열려 있어요',
      '이미 내일 내기가 있어요. 새로고침해서 최신 상태를 확인해 주세요.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  // 일형(DURATION)의 BET_CLOSED는 창 마감이 아니라 날짜 어긋남이다 — 내일 재시도 대상이 아니다.
  test('일형 챌린지의 BET_CLOSED는 재시도하지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CLOSED'));
    await renderSheet('create');
    await submit();

    expect(mockCreateBet).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      '오늘 내기만 열 수 있어요',
      '날짜가 바뀌었어요. 새로고침 후 다시 시도해 주세요.',
    );
  });
});

// ── 챌린지 v2 — 하루형 참가 시트 진행분 공개(GROMO-1275, N16·§C4·FR-34) ─────────
// '오늘'은 2026-08-01(KST), 벽시계 10:00 고정 — 자정까지 남은 시간 14시간.
describe('하루형 진행분 공개 (GROMO-1275)', () => {
  const SESSION_ID = 's-today';
  function daySession(over: Partial<GroupBetSession> = {}): GroupBetSession {
    return {
      sessionId: SESSION_ID,
      sessionDate: '2026-08-01',
      stake: 30,
      goalMinutes: 60,
      pot: 60,
      status: 'OPEN',
      startsAt: '2026-07-31T15:00:00Z',
      joinClosesAt: '2026-08-01T14:59:59Z',
      myLeaveDeadlineAt: null,
      closesAt: '2026-08-01T14:59:59Z',
      myJoined: false,
      myAchievedNow: false,
      participants: [
        { userId: 'u2', nickname: '민지', progressMinutes: 52, achieved: false },
        { userId: 'u3', nickname: '준호', progressMinutes: 18, achieved: false },
      ],
      ...over,
    };
  }
  // 신서버 하루형 챌린지 — bet에 오늘 회차가 실려 있다(N36 브리지 필드는 기존 bet() 그대로).
  function dayOver(
    sessionOver: Partial<GroupBetSession> = {},
    over: Partial<GroupChallengeResponse> = {},
  ): Partial<GroupChallengeResponse> {
    return {
      bet: bet({ enabled: true, session: daySession(sessionOver) }),
      // 내 진행분 — 카드 진행 리스트와 같은 소스(memberProgress). u1이 나다.
      memberProgress: [
        { userId: 'u1', nickname: '재영', progressMinutes: 0, achieved: false },
        { userId: 'u2', nickname: '민지', progressMinutes: 52, achieved: false },
      ],
      ...over,
    };
  }

  test('기존 참가자의 진행분과 나를 함께 보여주고, 남은 시간을 적는다', async () => {
    await renderSheet('join', dayOver());

    // 헤더 — 오늘 남은 시간(KST 자정까지). 10:00 고정이라 14시간.
    expect(screen.getByText(/오늘 남은 시간 14시간/)).toBeOnTheScreen();
    expect(screen.getByText('지금 참여 중인 사람')).toBeOnTheScreen();
    expect(screen.getByText('민지')).toBeOnTheScreen();
    expect(screen.getByText('52/60분')).toBeOnTheScreen();
    expect(screen.getByText('18/60분')).toBeOnTheScreen();
    // 나 — 아직 참가 전이지만 출발선 비교의 기준이라 함께 그린다(FOCUS는 값 없음 = 0분).
    expect(screen.getByText('나')).toBeOnTheScreen();
    expect(screen.getByText('0/60분')).toBeOnTheScreen();
    // 출발선 안내(§C4) — 몰수 룰 노트에 이어 붙는다.
    expect(screen.getByText(/먼저 시작한 사람이 유리해요/)).toBeOnTheScreen();
  });

  test('회차가 있으면 joinSession으로 참가한다 — 레거시 joinBet이 아니다', async () => {
    await renderSheet('join', dayOver());
    await submit();

    expect(mockJoinSession).toHaveBeenCalledWith(GROUP_ID, SESSION_ID);
    expect(mockJoinBet).not.toHaveBeenCalled();
    expect(logGroupBetJoined).toHaveBeenCalledWith({
      stake: 30,
      mission_type: 'DURATION',
      mission_category: 'FOCUS',
    });
    expect(onDone).toHaveBeenCalled();
  });

  test('남은 시간이 부족하면 경고만 하고 버튼은 살아 있다(N23·FR-35-1)', async () => {
    mockNowSec = 23 * 3600 + 30 * 60; // 23:30 — 남은 30분 < 목표 60분
    await renderSheet('join', dayOver());

    expect(screen.getByTestId('group.bet.timeShort')).toHaveTextContent(
      '남은 30분으로 60분을 채우기는 어려워요',
    );
    // 차단하지 않는다 — 확정(이미 초과)과 불리(시간 부족)는 다르다.
    await submit();
    expect(mockJoinSession).toHaveBeenCalledWith(GROUP_ID, SESSION_ID);
  });

  test('남은 시간이 충분하면 경고가 없다', async () => {
    await renderSheet('join', dayOver());
    expect(screen.queryByTestId('group.bet.timeShort')).toBeNull();
  });

  test('SCREEN_TIME 미집계는 —로 적고 시간 부족 경고를 세우지 않는다(3상)', async () => {
    mockNowSec = 23 * 3600 + 30 * 60;
    await renderSheet(
      'join',
      dayOver(
        {
          participants: [{ userId: 'u2', nickname: '민지', progressMinutes: null, achieved: null }],
        },
        {
          missionCategory: 'SCREEN_TIME',
          memberProgress: [
            { userId: 'u1', nickname: '재영', progressMinutes: null, achieved: null },
          ],
        },
      ),
    );

    // 미집계는 0분이 아니다 — 민지·나 둘 다 '—'.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // 스크린타임은 시간을 채우는 미션이 아니다 — 경고 자체가 성립하지 않는다.
    expect(screen.queryByTestId('group.bet.timeShort')).toBeNull();
  });

  test('참가 시트 잔액 표기는 「참가비 N · 내 잔액 M」까지다(N46) — 차감 후 값 병기 금지', async () => {
    await renderSheet('join', dayOver());
    expect(screen.getByTestId('group.bet.balanceRow')).toHaveTextContent(
      '참가비 30 · 내 잔액 5000',
    );
  });

  // #570 codex ⑦ — 시트를 연 뒤 정산·무효화가 먼저 끝나면 회차가 닫힌다. 재시도해도 같은 실패다.
  test('BET_NOT_OPEN — 이미 끝난 날임을 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinSession.mockRejectedValueOnce(axiosErrorWith(409, 'BET_NOT_OPEN'));
    await renderSheet('join', dayOver());
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '이미 끝난 날이에요',
      '결과가 나왔거나 닫힌 날이라 참가할 수 없어요.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  test('BET_SESSION_CLOSED — 마감을 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinSession.mockRejectedValueOnce(axiosErrorWith(409, 'BET_SESSION_CLOSED'));
    await renderSheet('join', dayOver());
    await submit();

    expect(alertSpy).toHaveBeenCalledWith('마감됐어요', '이미 마감돼 참가할 수 없어요.');
    expect(onDone).toHaveBeenCalled();
  });

  test('BET_SCREENTIME_PERMISSION_REQUIRED — 권한 안내로 알리고 닫는다(N50)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinSession.mockRejectedValueOnce(
      axiosErrorWith(409, 'BET_SCREENTIME_PERMISSION_REQUIRED'),
    );
    await renderSheet('join', dayOver());
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '참가할 수 없어요',
      '스크린타임 권한을 허용해야 참여할 수 있어요.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  test('BET_INSUFFICIENT_BALANCE — 잔액 부족 판정으로 승격해 CTA를 잠근다', async () => {
    mockJoinSession.mockRejectedValueOnce(axiosErrorWith(409, 'BET_INSUFFICIENT_BALANCE'));
    await renderSheet('join', dayOver());
    await submit();

    expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
    await submit();
    expect(mockJoinSession).toHaveBeenCalledTimes(1);
  });

  test('창형·구서버(session 없음)는 종전 참가자 칩 렌더 그대로다', async () => {
    // 구서버 — session 필드 자체가 없다 → 레거시 joinBet 경로·칩 목록.
    await renderSheet('join', { bet: bet() });
    expect(screen.getByText('참가자 2명')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.bet.dayProgress')).toBeNull();
    await submit();
    expect(mockJoinBet).toHaveBeenCalledWith(GROUP_ID, BET_ID);
    expect(mockJoinSession).not.toHaveBeenCalled();
  });
});
