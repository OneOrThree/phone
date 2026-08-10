// JoinWeekSheet 부분 예약 테스트(GROMO-1276 — §C2·N15) — 돈이 걸린 자리라 잠그는 것:
//  1) 총액이 CTA 전에 읽힌다(N일 × 참가비 = 합계). 보여준 날짜 집합이 그대로 전송된다(명시 지정).
//  2) 잔액 부족은 전체 버튼을 잠그되 **끝내지 않는다** — 몇 개까지 되는지 적고 축소 액션을 준다.
//  3) 부분 예약은 앞 날짜부터다 — 먼저 오는 날이 먼저 도는 날이다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import { Alert } from 'react-native';
import JoinWeekSheet from './JoinWeekSheet';
import { joinWeekSessions } from '@/services/groupApi';

jest.setTimeout(20000);

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// groupApi가 계측 모듈을 물고 온다(firebase 네이티브) — 다른 스위트와 같은 이유로 목이다.
jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeDeleted: jest.fn(),
}));

// groupErrorCode는 실제 구현을 남긴다(code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  joinWeekSessions: jest.fn(),
}));

let mockCoins = 240;
let mockCoinsLoaded = true;
const mockRefresh = jest.fn(async () => true);
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({ coins: mockCoins, coinsLoaded: mockCoinsLoaded, refresh: mockRefresh }),
}));

const mockJoinWeek = joinWeekSessions as jest.MockedFunction<typeof joinWeekSessions>;

const GROUP_ID = 'g1';
const CHALLENGE_ID = 'c1';
const DATES = ['2026-08-10', '2026-08-12', '2026-08-14']; // 월·수·금
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

async function renderWeek(dates: string[] = DATES) {
  const result = await render(
    <JoinWeekSheet
      groupId={GROUP_ID}
      challengeId={CHALLENGE_ID}
      label="매일 09:00~12:00 90분 집중"
      dates={dates}
      startTimeLabel="09:00"
      stake={30}
      onClose={onClose}
      onDone={onDone}
    />,
  );
  await act(async () => {});
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCoins = 240;
  mockCoinsLoaded = true;
  mockJoinWeek.mockResolvedValue({ joined: [], totalStake: 90 });
});

test('날짜별 참가비·합계·잔액을 먼저 보여주고, 보여준 날짜 그대로 전송한다', async () => {
  await renderWeek();

  expect(screen.getByText('8/10(월) 09:00')).toBeOnTheScreen();
  expect(screen.getByText('8/12(수) 09:00')).toBeOnTheScreen();
  expect(screen.getByText('8/14(금) 09:00')).toBeOnTheScreen();
  expect(screen.getByTestId('group.bet.week.total')).toHaveTextContent(
    '3일 × 30코인 = 합계 90코인',
  );
  // N46 — 차감 후 값(→ 150)은 병기하지 않는다.
  expect(screen.getByTestId('group.bet.balanceRow')).toHaveTextContent('합계 90 · 내 잔액 240');
  // 시트를 열 때 서버 잔액을 다시 받는다(BetSheet §0-3과 같은 이유).
  expect(mockRefresh).toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });
  expect(mockJoinWeek).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, DATES);
  expect(onDone).toHaveBeenCalled();
});

test('잔액 부족 — 전체 CTA는 잠그되 가능한 날수를 적고 축소 액션을 준다(§C2)', async () => {
  mockCoins = 70; // 90 필요 — 2일(60코인)까지 가능
  await renderWeek();

  expect(screen.getByTestId('group.bet.week.shortage')).toHaveTextContent(
    '코인이 20 부족해요. 2일(60코인)만 참여할 수 있어요',
  );
  // 전체 버튼은 잠긴다 — 눌러도 나가지 않는다.
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });
  expect(mockJoinWeek).not.toHaveBeenCalled();

  // 축소 액션 — **앞 날짜부터** 가능한 만큼만.
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.partial'));
  });
  expect(mockJoinWeek).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, ['2026-08-10', '2026-08-12']);
  expect(onDone).toHaveBeenCalled();
});

test('한 날도 못 내면 축소 액션조차 없다', async () => {
  mockCoins = 10;
  await renderWeek();

  expect(screen.getByTestId('group.bet.week.shortage')).toHaveTextContent(
    '코인이 80 부족해요. 참여할 수 있는 날이 없어요',
  );
  expect(screen.queryByTestId('group.bet.week.partial')).toBeNull();
});

test('잔액 미상이면 부족 판정을 하지 않는다 — 판정은 서버 총액 선검사에 맡긴다', async () => {
  mockCoinsLoaded = false;
  await renderWeek();

  expect(screen.queryByTestId('group.bet.week.shortage')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });
  expect(mockJoinWeek).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, DATES);
});

test('INVALID_SESSION_DATES — 낡은 화면임을 알리고 닫는다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockJoinWeek.mockRejectedValueOnce(axiosErrorWith(400, 'INVALID_SESSION_DATES'));
  await renderWeek();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });

  expect(alertSpy).toHaveBeenCalledWith(
    '참여할 수 있는 날이 바뀌었어요',
    '최신 상태로 새로고침할게요.',
  );
  expect(onDone).toHaveBeenCalled();
});

test('총액 기준 BET_INSUFFICIENT_BALANCE — 잔액을 다시 받고 인라인으로 알린다', async () => {
  mockJoinWeek.mockRejectedValueOnce(axiosErrorWith(409, 'BET_INSUFFICIENT_BALANCE'));
  await renderWeek();
  mockRefresh.mockClear();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });

  expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
  expect(mockRefresh).toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});
