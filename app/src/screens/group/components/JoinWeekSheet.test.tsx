// JoinWeekSheet 부분 예약 테스트(GROMO-1276 — §C2·N15) — 돈이 걸린 자리라 잠그는 것:
//  1) 총액이 CTA 전에 읽힌다(N일 × 참가비 = 합계). 보여준 날짜 집합이 그대로 전송된다(명시 지정).
//  2) 잔액 부족은 전체 버튼을 잠그되 **끝내지 않는다** — 몇 개까지 되는지 적고 축소 액션을 준다.
//  3) 부분 예약은 앞 날짜부터다 — 먼저 오는 날이 먼저 도는 날이다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import { Alert } from 'react-native';
import JoinWeekSheet, { type JoinWeekEntry } from './JoinWeekSheet';
import { joinWeekSessions } from '@/services/groupApi';
import { getAuthSessionGeneration, triggerLogout } from '@/services/api';
import { logGroupBetJoined } from '@/services/analyticsEvents';

jest.setTimeout(20000);

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// groupApi가 계측 모듈을 물고 온다(firebase 네이티브) — 다른 스위트와 같은 이유로 목이다.
jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeDeleted: jest.fn(),
  logGroupBetJoined: jest.fn(),
}));

// groupErrorCode는 실제 구현을 남긴다(code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  joinWeekSessions: jest.fn(),
}));

// 유저 부재(GROMO-1247) 분기가 인증 세대를 본다 — 세대를 갈아 끼워 '낡은 응답'을 재현한다.
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api'),
  getAuthSessionGeneration: jest.fn(() => 0),
  triggerLogout: jest.fn(),
}));

let mockCoins = 240;
let mockCoinsLoaded = true;
let mockCoinsVersion = 1;
const mockRefresh = jest.fn(async () => true);
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({
    coins: mockCoins,
    coinsLoaded: mockCoinsLoaded,
    coinsVersion: mockCoinsVersion,
    latestCoinsVersion: () => mockCoinsVersion,
    refresh: mockRefresh,
  }),
}));

const mockJoinWeek = joinWeekSessions as jest.MockedFunction<typeof joinWeekSessions>;
const mockTriggerLogout = triggerLogout as jest.MockedFunction<typeof triggerLogout>;
const mockGetAuthSessionGeneration = getAuthSessionGeneration as jest.MockedFunction<
  typeof getAuthSessionGeneration
>;

const GROUP_ID = 'g1';
const CHALLENGE_ID = 'c1';
const DATES = ['2026-08-10', '2026-08-12', '2026-08-14']; // 월·수·금
// 기본은 균일 단가 30 — 금액이 갈리는 케이스는 각 테스트가 entries를 직접 만든다.
const ENTRIES = DATES.map((date) => ({ date, stake: 30 }));
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

function weekElement(entries: JoinWeekEntry[] = ENTRIES) {
  return (
    <JoinWeekSheet
      groupId={GROUP_ID}
      challengeId={CHALLENGE_ID}
      label="매일 09:00~12:00 90분 집중"
      entries={entries}
      startTimeLabel="09:00"
      missionType="DURATION"
      missionCategory="FOCUS"
      onClose={onClose}
      onDone={onDone}
    />
  );
}

async function renderWeek(entries: JoinWeekEntry[] = ENTRIES) {
  const result = await render(weekElement(entries));
  await act(async () => {});
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuthSessionGeneration.mockReturnValue(0);
  mockCoins = 240;
  mockCoinsLoaded = true;
  mockCoinsVersion = 1;
  // 기본은 "보낸 날짜가 전부 새로 걸렸다" — 건너뛴 날짜 시나리오는 각 테스트가 직접 만든다.
  mockJoinWeek.mockImplementation(async (_g, _c, dates) => ({
    joined: dates.map((date, i) => ({ sessionId: `s${i}`, sessionDate: date })),
    totalStake: dates.length * 30,
  }));
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
  // 예약도 '참여 결심 1건' — 일수는 파라미터로 남긴다(#570 codex ⑧).
  expect(logGroupBetJoined).toHaveBeenCalledTimes(1);
  expect(logGroupBetJoined).toHaveBeenCalledWith({
    stake: 30,
    session_count: 3,
    mission_type: 'DURATION',
    mission_category: 'FOCUS',
  });
});

// #570 리뷰 — 이미 열린 회차는 개설 시점 stake가 박제돼 있고 미래 날짜는 지금 설정값이
// 박제된다. 단가 하나로 곱하면 관리자가 참가비를 바꾼 직후 **표시 합계 ≠ 실제 차감**이 된다.
test('날짜별 금액이 갈리면 합계를 실제 차감액으로 내고 단가 표기를 지운다', async () => {
  await renderWeek([
    { date: '2026-08-10', stake: 100 }, // 오늘 — 이미 열린 회차의 박제값
    { date: '2026-08-12', stake: 30 }, // 미래 — 예약 시점에 설정값이 박제된다
    { date: '2026-08-14', stake: 30 },
  ]);

  // 없는 단가('× S코인')를 지어내지 않는다 — 날짜별 금액은 위 행에 이미 다 적혀 있다.
  expect(screen.getByTestId('group.bet.week.total')).toHaveTextContent('3일 · 합계 160코인');
  expect(screen.getByTestId('group.bet.week.total')).not.toHaveTextContent('×');
  expect(screen.getByTestId('group.bet.balanceRow')).toHaveTextContent('합계 160 · 내 잔액 240');
  // 행에는 각 날짜의 실제 금액이 적힌다.
  expect(screen.getByLabelText('8/10(월) 참가비 100코인')).toBeOnTheScreen();
  expect(screen.getByLabelText('8/12(수) 참가비 30코인')).toBeOnTheScreen();
});

test('금액이 갈릴 때 부분 예약도 날짜별 금액으로 자른다 — 몫 나눗셈이 아니다', async () => {
  mockCoins = 140; // 100 + 30 = 130까지만 가능(세 번째 날에서 160 초과)
  await renderWeek([
    { date: '2026-08-10', stake: 100 },
    { date: '2026-08-12', stake: 30 },
    { date: '2026-08-14', stake: 30 },
  ]);

  expect(screen.getByTestId('group.bet.week.shortage')).toHaveTextContent(
    '코인이 20 부족해요. 2일(130코인)만 참여할 수 있어요',
  );
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.partial'));
  });
  expect(mockJoinWeek).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, ['2026-08-10', '2026-08-12']);
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

// 서버 판정 유지(#570 codex — BetSheet insufficientVerdict 패턴): refresh가 안 끝났거나 낡은 큰
// 잔액이 남아 있어도(여기선 240 ≥ 90) "그 총액으로는 안 된다"는 이미 확정 — 반복 전송을 막는다.
// #570 codex ④ — join-week은 다른 기기에서 이미 참가한 날짜를 조용히 건너뛴다. 요청값으로
// 세면 걸리지도 않은 날이 지표에 실리고, 전부 건너뛴 요청까지 성공 이벤트가 된다.
test('건너뛴 날짜는 계측에서 빠진다 — 응답 joined가 기준이다', async () => {
  mockJoinWeek.mockResolvedValueOnce({
    joined: [{ sessionId: 's0', sessionDate: '2026-08-10' }], // 3일 중 1일만 새로 걸렸다
    totalStake: 30,
  });
  await renderWeek();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });

  expect(logGroupBetJoined).toHaveBeenCalledTimes(1);
  expect(logGroupBetJoined).toHaveBeenCalledWith(
    expect.objectContaining({ session_count: 1, stake: 30 }),
  );
});

test('전부 건너뛰었으면(새 예약 0건) 성공 이벤트를 발행하지 않는다', async () => {
  mockJoinWeek.mockResolvedValueOnce({ joined: [], totalStake: 0 });
  await renderWeek();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });

  expect(logGroupBetJoined).not.toHaveBeenCalled();
  // 요청 자체는 성공이라 시트는 닫고 재조회를 태운다(사용자에겐 이미 참여한 상태가 맞다).
  expect(onDone).toHaveBeenCalled();
});

test('joined를 모르는 응답(구·경계)은 보낸 값으로 폴백한다', async () => {
  mockJoinWeek.mockResolvedValueOnce({ totalStake: 90 } as never);
  await renderWeek();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });
  expect(logGroupBetJoined).toHaveBeenCalledWith(expect.objectContaining({ session_count: 3 }));
});

// #570 codex ⑥ — 판정은 "그 총액 이상은 안 된다"는 사실이다. 전체가 거절된 뒤 잔액이 조금
// 들어오면 **축소분은 낼 수 있는데**, 전체 총액으로만 재면 부분 예약 버튼까지 영영 잠긴다.
test('전체가 거절돼도 새 잔액이 감당하는 축소분은 다시 보낼 수 있다', async () => {
  mockJoinWeek.mockRejectedValueOnce(axiosErrorWith(409, 'BET_INSUFFICIENT_BALANCE'));
  const { rerender } = await renderWeek(); // 3일 × 30 = 90
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });
  expect(mockJoinWeek).toHaveBeenCalledTimes(1);

  // 판정 이후 새 잔액이 도착했지만 전체(90)는 여전히 못 낸다 — 2일(60)은 낼 수 있다.
  mockCoins = 70;
  mockCoinsVersion = 2;
  await act(async () => {
    rerender(weekElement());
  });

  // 전체 CTA는 잠긴 채(90 > 70), 축소 액션은 열린다.
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });
  expect(mockJoinWeek).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.partial'));
  });
  expect(mockJoinWeek).toHaveBeenLastCalledWith(GROUP_ID, CHALLENGE_ID, [
    '2026-08-10',
    '2026-08-12',
  ]);
});

test('총액 기준 BET_INSUFFICIENT_BALANCE — 판정을 유지해 CTA를 잠그고, 판정 이후 잔액만 푼다', async () => {
  mockJoinWeek.mockRejectedValueOnce(axiosErrorWith(409, 'BET_INSUFFICIENT_BALANCE'));
  const { rerender } = await renderWeek();
  mockRefresh.mockClear();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });

  expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
  expect(mockRefresh).toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();

  // 클라 잔액(240)은 총액(90)을 낼 수 있다고 말하지만 — 판정보다 낡은 값이라 근거가 아니다.
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });
  expect(mockJoinWeek).toHaveBeenCalledTimes(1);

  // 판정 **이후에 도착한** 권위 있는 잔액이 낼 수 있다고 하면 그때 푼다.
  mockCoinsVersion = 2;
  await act(async () => {
    rerender(weekElement());
  });
  expect(screen.queryByText('코인이 부족해요')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });
  expect(mockJoinWeek).toHaveBeenCalledTimes(2);
});

// GROMO-1247 — 유저 부재는 챌린지 부재가 아니라 **내 계정**이 없다는 뜻이다.
test('유저 부재(USER_NOT_FOUND) — 사라진 챌린지로 위장하지 않고 재로그인을 유도한다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetAuthSessionGeneration.mockReturnValue(4);
  mockJoinWeek.mockRejectedValueOnce(axiosErrorWith(404, 'USER_NOT_FOUND'));
  await renderWeek();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });

  expect(alertSpy).toHaveBeenCalledWith(
    '로그인이 필요해요',
    '로그인 정보가 만료됐어요. 다시 로그인해 주세요.',
    [expect.objectContaining({ text: '확인' })],
    { cancelable: false },
  );
  expect(onDone).not.toHaveBeenCalled();
  alertSpy.mockRestore();
});

// 4라운드 회귀 — 세대가 갈린 응답은 안내를 의도적으로 생략한다(sessionErrors ①). 그때 제출
// 표시가 남으면 시트가 dismissible={false} + 스피너로 영구 고정된다(JoinNextSheet와 동일).
test('낡은 세대의 유저 부재 — 안내 없이 버리되 시트는 닫을 수 있는 상태로 남는다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetAuthSessionGeneration.mockReturnValueOnce(4).mockReturnValue(5);
  mockJoinWeek.mockRejectedValueOnce(axiosErrorWith(404, 'USER_NOT_FOUND'));
  await renderWeek();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.week.submit'));
  });

  expect(alertSpy).not.toHaveBeenCalled();
  expect(mockTriggerLogout).not.toHaveBeenCalled();
  expect(screen.getByTestId('group.bet.week.close')).not.toBeDisabled();
  expect(screen.getByTestId('group.bet.week.submit')).not.toBeDisabled();
  alertSpy.mockRestore();
});
