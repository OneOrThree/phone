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
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
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

// 잔액은 CoinContext가 정본 — Provider 대신 훅을 대체해 잔액과 refresh 호출을 직접 본다.
let mockCoins = 100;
const mockRefresh = jest.fn(async () => {});
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({ coins: mockCoins, refresh: mockRefresh }),
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

async function renderSheet(mode: 'create' | 'join', over: Partial<GroupChallengeResponse> = {}) {
  const result = await render(
    <BetSheet
      groupId={GROUP_ID}
      challenge={challenge(over)}
      mode={mode}
      onClose={onClose}
      onDone={onDone}
    />,
  );
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

  test('판돈·현재 팟·참가자 목록을 보여준다', async () => {
    await renderSheet('join', { bet: bet() });
    expect(screen.getByText('30')).toBeOnTheScreen();
    expect(screen.getByText('60')).toBeOnTheScreen();
    expect(screen.getByText('참가자 2명')).toBeOnTheScreen();
    expect(screen.getByText('재영')).toBeOnTheScreen();
    expect(screen.getByText('수빈')).toBeOnTheScreen();
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

describe('에러 분기', () => {
  test('INSUFFICIENT_CURRENCY — 시트를 열어 둔 채 인라인으로 알리고 잔액을 다시 받는다', async () => {
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(400, 'INSUFFICIENT_CURRENCY'));
    await renderSheet('create');
    mockRefresh.mockClear();
    await submit();

    expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
    expect(mockRefresh).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    // 실패 후에도 다시 시도할 수 있어야 한다(submitting이 걸려 있으면 안 된다).
    await submit();
    expect(mockCreateBet).toHaveBeenCalledTimes(2);
  });

  test('BET_ALREADY_EXISTS — 알리고 닫는다(카드 상태가 이미 낡았다)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_EXISTS'));
    await renderSheet('create');
    await submit();

    expect(alertSpy).toHaveBeenCalledWith(
      '이미 오늘 내기가 있어요',
      '다른 그룹원이 먼저 내기를 열었어요.',
    );
    expect(onDone).toHaveBeenCalled();
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

  test('BET_CLOSED — 마감을 알리고 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CLOSED'));
    await renderSheet('join', { bet: bet() });
    await submit();

    expect(alertSpy).toHaveBeenCalledWith('마감된 내기예요', '이미 마감돼 참가할 수 없어요.');
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

    expect(screen.getByText('참가하지 못했어요. 잠시 후 다시 시도해주세요.')).toBeOnTheScreen();
    expect(onDone).not.toHaveBeenCalled();
  });
});
