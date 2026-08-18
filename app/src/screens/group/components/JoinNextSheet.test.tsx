// JoinNextSheet 테스트(GROMO-1419 — N45·FR-31-1) — 돈이 미래 날짜에 걸리는 자리라 잠그는 것:
//  1) 서버가 확정한 잔액 부족은 **상태로 승격**해 CTA를 잠근다(#570 codex ②) — 낡은 큰 잔액이
//     남아 있어도 같은 실패를 반복 전송하지 않는다. 푸는 건 판정 이후 버전의 잔액뿐이다.
//  2) 자정 드리프트 — 제출 직전 KST 기준일이 바뀌었으면 **돈이 나가기 전에** 끊는다.
//  3) N46 잔액 표기 형식(「참가비 N · 내 잔액 M」)은 공용 컴포넌트가 쥔다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import {
  OVERLAY_PRIORITY,
  OverlaySlotProvider,
  useOverlayMaxPriority,
} from '@/store/OverlaySlotContext';
import { AxiosError, AxiosHeaders } from 'axios';
import JoinNextSheet from './JoinNextSheet';
import { joinNextSession } from '@/services/groupApi';
import { getAuthSessionGeneration, triggerLogout } from '@/services/api';
import { logGroupBetJoined } from '@/services/analyticsEvents';

jest.setTimeout(20000);

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// groupApi가 계측 모듈(firebase 네이티브)을 물고 온다 — 다른 스위트와 같은 이유로 목이다.
jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeDeleted: jest.fn(),
  logGroupBetJoined: jest.fn(),
  logGroupChallengeJoined: jest.fn(),
}));

// groupErrorCode는 실제 구현을 남긴다(code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  joinNextSession: jest.fn(),
}));

// 유저 부재(GROMO-1247) 분기가 인증 세대를 본다 — 세대를 갈아 끼워 '낡은 응답'을 재현한다.
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api'),
  getAuthSessionGeneration: jest.fn(() => 0),
  triggerLogout: jest.fn(),
}));

// '오늘'(KST)은 테스트가 고정한다 — 드리프트 선제 차단이 이 값을 본다.
let mockTodayKst = '2026-08-01';
jest.mock('@/utils/localDate', () => ({
  todayStr: jest.fn(() => '2026-08-01'),
  todayStrKst: jest.fn(() => mockTodayKst),
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

const mockJoinNext = joinNextSession as jest.MockedFunction<typeof joinNextSession>;
const mockTriggerLogout = triggerLogout as jest.MockedFunction<typeof triggerLogout>;
const mockGetAuthSessionGeneration = getAuthSessionGeneration as jest.MockedFunction<
  typeof getAuthSessionGeneration
>;

const GROUP_ID = 'g1';
const CHALLENGE_ID = 'c1';
const SESSION_DATE = '2026-08-03'; // 월요일
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

function nextElement() {
  return (
    <JoinNextSheet
      groupId={GROUP_ID}
      challengeId={CHALLENGE_ID}
      label="하루 60분 집중"
      sessionDate={SESSION_DATE}
      startTimeLabel={null}
      stake={30}
      missionType="DURATION"
      missionCategory="FOCUS"
      onClose={onClose}
      onDone={onDone}
    />
  );
}

async function renderNext() {
  const result = await render(nextElement());
  await act(async () => {});
  return result;
}

async function submit() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.bet.joinNext.submit'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuthSessionGeneration.mockReturnValue(0);
  mockTodayKst = '2026-08-01';
  mockCoins = 240;
  mockCoinsLoaded = true;
  mockCoinsVersion = 1;
  mockJoinNext.mockResolvedValue({
    sessionId: 's-next',
    sessionDate: SESSION_DATE,
    stake: 30,
  });
});

test('예약 대상 날짜를 제목·CTA·안내에 못 박고, 잔액을 N46 형식으로 적는다', async () => {
  await renderNext();

  expect(screen.getByTestId('group.bet.joinNext.submit')).toHaveTextContent('8/3(월) 참여하기');
  expect(screen.getByTestId('group.bet.balanceRow')).toHaveTextContent('참가비 30 · 내 잔액 240');
  expect(mockRefresh).toHaveBeenCalled();

  await submit();
  expect(mockJoinNext).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID);
  expect(onDone).toHaveBeenCalled();
  // 예약도 참여 1건으로 센다(#570 codex ⑧) — 금액은 서버가 확정한 박제값이 정본이다.
  expect(logGroupBetJoined).toHaveBeenCalledWith({
    stake: 30,
    session_count: 1,
    mission_type: 'DURATION',
    mission_category: 'FOCUS',
  });
});

test('잔액이 모자라면 CTA가 부족분을 들고 잠긴다', async () => {
  mockCoins = 10;
  await renderNext();

  expect(screen.getByTestId('group.bet.joinNext.submit')).toHaveTextContent(
    '코인이 부족해요 (20 필요)',
  );
  await submit();
  expect(mockJoinNext).not.toHaveBeenCalled();
});

// #572/B8 — 카드가 넘기는 stake는 **다음 회차의 박제값**이다(설정값이 아니다). 시트의 표시·
// 잔액 판정이 같은 축을 써야 안내 금액과 차감 금액이 어긋나지 않는다.
test('전달받은 참가비로 표시·잔액 판정을 한다 — 두 자리가 같은 축이다', async () => {
  mockCoins = 60;
  await render(
    <JoinNextSheet
      groupId={GROUP_ID}
      challengeId={CHALLENGE_ID}
      label="하루 60분 집중"
      sessionDate={SESSION_DATE}
      startTimeLabel={null}
      stake={100} // 박제값 — 설정값(30)보다 크다
      missionType="DURATION"
      missionCategory="FOCUS"
      onClose={onClose}
      onDone={onDone}
    />,
  );
  await act(async () => {});

  expect(screen.getByTestId('group.bet.balanceRow')).toHaveTextContent('참가비 100 · 내 잔액 60');
  // 판정도 같은 값으로 — 설정값(30)으로 재면 낼 수 있다고 잘못 열린다.
  expect(screen.getByTestId('group.bet.joinNext.submit')).toHaveTextContent(
    '코인이 부족해요 (40 필요)',
  );
  await submit();
  expect(mockJoinNext).not.toHaveBeenCalled();
});

// #570 codex ② — BetSheet insufficientVerdict 패턴 이식.
test('BET_INSUFFICIENT_BALANCE — 판정을 유지해 CTA를 잠그고, 판정 이후 잔액만 푼다', async () => {
  mockJoinNext.mockRejectedValueOnce(axiosErrorWith(409, 'BET_INSUFFICIENT_BALANCE'));
  const { rerender } = await renderNext();
  await submit();

  // 클라 잔액(240)은 30을 낼 수 있다고 말하지만 — 판정보다 낡은 값이라 근거가 아니다.
  expect(screen.getByText('코인이 부족해요')).toBeOnTheScreen();
  await submit();
  expect(mockJoinNext).toHaveBeenCalledTimes(1);
  expect(onDone).not.toHaveBeenCalled();

  // 판정 **이후에 도착한** 권위 있는 잔액이 감당한다고 하면 그때 푼다.
  mockCoinsVersion = 2;
  await act(async () => {
    rerender(nextElement());
  });
  expect(screen.queryByText('코인이 부족해요')).toBeNull();
  await submit();
  expect(mockJoinNext).toHaveBeenCalledTimes(2);
});

// #570 codex ③ — 자정을 넘기면 서버가 다음 활성일을 새로 계산한다. 돈이 나가기 전에 끊는다.
test('제출 직전 KST 기준일이 바뀌었으면 요청을 보내지 않고 다시 열게 한다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await renderNext();
  mockTodayKst = '2026-08-02'; // 자정 경과
  await submit();

  expect(mockJoinNext).not.toHaveBeenCalled();
  expect(alertSpy).toHaveBeenCalledWith(
    '날짜가 바뀌었어요',
    '자정이 지나 예약할 날짜가 달라졌을 수 있어요. 최신 상태로 다시 열어 주세요.',
    expect.anything(),
    expect.anything(),
  );
  expect(onDone).toHaveBeenCalled();
});

test('응답 날짜가 화면과 다르면 실제 예약된 날짜를 알린다 — 성공은 성공대로', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockJoinNext.mockResolvedValue({ sessionId: 's-drift', sessionDate: '2026-08-05', stake: 30 });
  await renderNext();
  await submit();

  expect(alertSpy).toHaveBeenCalledWith(
    '예약된 날짜가 바뀌었어요',
    expect.stringContaining('8/5(수)로 예약됐어요'),
    expect.anything(),
    expect.anything(),
  );
  expect(onDone).toHaveBeenCalled();
});

test('BET_ALREADY_JOINED는 성공 취급 — 원하던 상태에 이미 도달했다', async () => {
  mockJoinNext.mockRejectedValueOnce(axiosErrorWith(409, 'BET_ALREADY_JOINED'));
  await renderNext();
  await submit();

  expect(onDone).toHaveBeenCalled();
  expect(mockRefresh).toHaveBeenCalled();
});

test('BET_SCREENTIME_PERMISSION_REQUIRED — 권한 안내로 알리고 닫는다(N50)', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockJoinNext.mockRejectedValueOnce(axiosErrorWith(409, 'BET_SCREENTIME_PERMISSION_REQUIRED'));
  await renderNext();
  await submit();

  expect(alertSpy).toHaveBeenCalledWith(
    '참여할 수 없어요',
    '스크린타임 권한을 허용해야 참여할 수 있어요.',
    expect.anything(),
    expect.anything(),
  );
  expect(onDone).toHaveBeenCalled();
});

// GROMO-1247 — 유저 부재는 챌린지 부재가 아니라 **내 계정**이 없다는 뜻이라 새로고침이 아니라
// 재로그인으로 보낸다.
test('유저 부재(USER_NOT_FOUND) — 사라진 챌린지로 위장하지 않고 재로그인을 유도한다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetAuthSessionGeneration.mockReturnValue(4);
  mockJoinNext.mockRejectedValueOnce(axiosErrorWith(404, 'USER_NOT_FOUND'));
  await renderNext();
  await submit();

  expect(alertSpy).toHaveBeenCalledWith(
    '로그인이 필요해요',
    '로그인 정보가 만료됐어요. 다시 로그인해 주세요.',
    [expect.objectContaining({ text: '확인' })],
    // onDismiss가 붙는다 — 안내가 자리를 쥐고 있어 닫힘 경로 둘 다 반납해야 한다(GROMO-1576).
    expect.objectContaining({ cancelable: false }),
  );
  // '사라진 챌린지예요'로 새로고침시키지 않는다.
  expect(onDone).not.toHaveBeenCalled();
  // ⚠️ **띄운 안내는 반드시 닫는다.** 이 안내는 자리를 모듈 스코프에 쥐므로(sessionErrors.ts),
  //    안 닫고 끝내면 그 점유가 다음 테스트의 Provider로 **물려진다**(새 Provider가 다시 등록).
  const sessionButtons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as unknown as {
    onPress?: () => void;
  }[];
  sessionButtons[0].onPress?.();
  alertSpy.mockRestore();
});

// 4라운드 회귀 — 세대가 갈린(= 이미 새 세션이 성립한) 응답은 안내를 **의도적으로 생략**한다.
// 그때 제출 표시가 남으면 시트가 dismissible={false} + 스피너로 영구 고정돼 앱 재시작 외엔
// 빠져나갈 수 없다. '조용히 버린다'는 화면을 잠그는 게 아니다.
test('낡은 세대의 유저 부재 — 안내 없이 버리되 시트는 닫을 수 있는 상태로 남는다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  // 요청은 세대 4에서 나가고(첫 호출), 응답 처리 시점엔 이미 5다(그 뒤 호출).
  mockGetAuthSessionGeneration.mockReturnValueOnce(4).mockReturnValue(5);
  mockJoinNext.mockRejectedValueOnce(axiosErrorWith(404, 'USER_NOT_FOUND'));
  await renderNext();
  await submit();

  expect(alertSpy).not.toHaveBeenCalled();
  expect(mockTriggerLogout).not.toHaveBeenCalled();
  // 스피너·잠금이 풀려 있어야 한다 — 여기가 4라운드에 실제로 깨졌던 자리다.
  expect(screen.getByTestId('group.bet.joinNext.close')).not.toBeDisabled();
  expect(screen.getByTestId('group.bet.joinNext.submit')).toHaveTextContent('8/3(월) 참여하기');
  alertSpy.mockRestore();
});

// ── 실패 통보는 자리를 쥐고 뜬다(GROMO-1576) ─────────────────────────────────
// ⚠️ `failAndReload`는 Alert를 띄운 **직후 `onDone()`으로 시트를 닫는다.** 그 순간 이 시트가
//    쥐고 있던 등록이 끊기는데 네이티브 Alert는 사용자 앞에 그대로 남는다. 그 틈에 결과가
//    도착하면 자리가 비었다고 보고 **이 Alert 뒤에서** 마운트되며 seen/ack이 나간다.
//    (창을 연 것은 이 파일이 아니라 이 배치의 나머지다 — 예전엔 결과 모달이 방 진입 1회에만
//     떠서 채우러 올 것이 없었다.)
// 호출부가 여럿이어도 `failAndReload` **함수 하나**가 전부를 덮으므로 대표 1건만 잠근다.
// ⚠️ 유지만 단정하면 영구 점유를 못 잡는다 — 닫으면 반납되는 것까지 함께 본다.
function OverlayProbe({ onValue }: { onValue: (value: number) => void }) {
  onValue(useOverlayMaxPriority());
  return null;
}

test('실패 통보가 떠 있는 동안 자리를 쥐고, 닫으면 반납한다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const values: number[] = [];
  const latest = () => values[values.length - 1];
  await render(
    <OverlaySlotProvider>
      <OverlayProbe onValue={(v) => values.push(v)} />
      {nextElement()}
    </OverlaySlotProvider>,
  );
  await act(async () => {});
  expect(latest()).toBe(-1);

  // ⚠️ 기준일 변경은 **렌더 뒤**여야 한다 — 마운트 시점에 캡처한 openedTodayKst와 비교하므로
  //    렌더 전에 바꾸면 드리프트가 성립하지 않는다.
  mockTodayKst = '2026-08-02'; // 자정 경과
  await submit();

  // 시트는 이미 닫히는 중인데(onDone) 통보는 아직 떠 있다 — 그 사이 자리가 비면 안 된다.
  expect(onDone).toHaveBeenCalled();
  expect(latest()).toBe(OVERLAY_PRIORITY.sheet);

  // 반납 주체는 시트가 아니라 통보 자신이다 — 사용자가 닫으면 그때 풀린다.
  const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[] | undefined;
  await act(async () => {
    buttons?.[0]?.onPress?.();
  });
  await act(async () => {});
  expect(latest()).toBe(-1);
  alertSpy.mockRestore();
});

// ⚠️ **동기 경로에는 `afterSlot`이 가진 신원 대조가 없다** — 그 비대칭이 이 창을 만들었다.
//    요청을 기다리는 사이 딥링크가 groupId를 바꾸면 부모가 이 시트를 언마운트하는데, 진행 중인
//    Promise는 취소되지 않아 그 뒤에 failAndReload가 불린다. 그대로 띄우면 사라진 A 그룹 시트의
//    Alert가 B 화면 위에 뜨고, 그 사이 B에서 노출된(이미 ack된) 결과를 덮는다.
//    ⚠️ **막는 것만 단정하면 가드가 과하게 걸려도 초록이다** — 마운트 상태의 통보가 그대로 뜨는
//       것까지 한 테스트에서 함께 본다(그것까지 막으면 사용자가 실패 안내를 못 받는다).
test('언마운트 뒤 도착한 실패는 안 뜨고, 마운트 상태의 실패는 그대로 뜬다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  // ① 요청을 손으로 붙잡아 "응답은 아직"인 구간을 만든 뒤 시트를 언마운트한다.
  let rejectJoin: (reason: unknown) => void = () => undefined;
  mockJoinNext.mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectJoin = reject;
    }) as ReturnType<typeof joinNextSession>,
  );
  const view = await renderNext();
  await submit();
  await act(async () => {
    view.unmount();
  });

  await act(async () => {
    rejectJoin(axiosErrorWith(404, 'NOT_FOUND'));
  });
  await act(async () => {});
  expect(alertSpy).not.toHaveBeenCalled();

  // ② 마운트된 상태의 같은 실패는 **그대로** 뜬다.
  mockJoinNext.mockRejectedValueOnce(axiosErrorWith(404, 'NOT_FOUND'));
  await renderNext();
  await submit();
  expect(alertSpy).toHaveBeenCalledWith(
    '사라진 챌린지예요',
    '방장이 챌린지를 없앴을 수 있어요.',
    expect.anything(),
    expect.anything(),
  );
  alertSpy.mockRestore();
});
