// ChallengeCard 진행 3상 렌더 + 방장 삭제 테스트 — 명세 docs/app/group-plan-2.md §3-2.
//
// 여기서 잠그는 것:
//  1) 진행 표기 3상. `progressMinutes: 0`(집중을 아직 안 함)과 `null`(스크린타임 미집계)은
//     완전히 다른 뜻인데 falsy 하나로 뭉개면 둘 다 같은 칸으로 보인다.
//  2) 삭제는 방장만(우측 상단 X — GROMO-1101), 그리고 **확인 Alert를 거친 뒤에만** onDelete가
//     불린다 — 오탭으로 챌린지가 사라지면 되돌릴 방법이 없다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import type { AlertButton } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import ChallengeCard from './ChallengeCard';
import {
  cancelBet,
  challengeGroupId,
  getChallengeDeletionPreview,
  getMyOpenBetSessions,
  joinNextSession,
  joinWeekSessions,
  leaveBet,
  leaveSession,
} from '@/services/groupApi';
import { logGroupBetCanceled, logGroupBetJoined } from '@/services/analyticsEvents';
import { todayStrKst } from '@/utils/localDate';
import { T } from '@/constants/theme';
import type {
  ChallengeMemberProgress,
  GroupBetSession,
  GroupChallengeBet,
  GroupChallengeResponse,
  LastSettledBet,
} from '@/types/dto/group';

// 첫 렌더가 RN 모듈을 콜드 로드하는 무거운 스위트라 CI 러너에선 기본 5s를 넘겨 flaky timeout이 났다 —
// 로직이 아니라 콜드 스타트 지연이므로 이 파일 한정으로 타임아웃을 넉넉히 준다.
jest.setTimeout(20000);

// 카드가 참가 철회의 API·계측을 직접 쥔다(부모 GroupRoomScreen이 A3 전유라 콜백을 못 늘린 흡수) —
// groupErrorCode는 실제 구현을 남긴다(철회 에러 code 분기까지 검증).
// 챌린지 v2(1276·1419·1425)의 신설 API도 카드·카드가 여는 시트가 직접 쥔다 — 같은 이유로 목이다.
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  leaveBet: jest.fn(),
  cancelBet: jest.fn(),
  challengeGroupId: jest.fn(),
  getChallengeDeletionPreview: jest.fn(),
  getMyOpenBetSessions: jest.fn(),
  leaveSession: jest.fn(),
  joinNextSession: jest.fn(),
  joinWeekSessions: jest.fn(),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logGroupBetCanceled: jest.fn(),
  logGroupChallengeDeleted: jest.fn(),
  // 예약 성공도 참여 계측을 발행한다(#570 codex ⑧) — 카드가 여는 시트가 부른다.
  logGroupBetJoined: jest.fn(),
  logGroupChallengeJoined: jest.fn(),
}));
// 잔액은 CoinContext가 정본 — 철회 성공 후 환불 반영을 위한 refresh 호출만 본다.
const mockRefreshCoins = jest.fn(async () => true);
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({ refresh: mockRefreshCoins }),
}));
// 지난 내기 결과 시트(SheetShell)가 useSafeAreaInsets를 쓴다 — 테스트 트리엔 Provider가 없다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));
// 히스토리 push(GROMO-1221) — 카드가 useNavigation을 직접 쥔다(부모는 형제 워크스트림 전유).
// 실제 스택 없이 navigate 호출만 붙잡는다(NoticeScreen.test의 홀더 관행).
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
// 철회 버튼의 '시작 전' 판정이 시간에 기댄다 — '오늘'과 KST 벽시계를 테스트가 직접 고정한다.
// 카드의 날짜축은 서버 판정과 같은 KST다(GROMO-1219) — **로컬 버전은 일부러 다른 날짜**라,
// 코드가 로컬 축(todayStr)을 부르면 오늘/내일/과거 판정이 어긋나 곧장 드러난다(축 분리 검증).
jest.mock('@/utils/localDate', () => ({
  todayStr: jest.fn(() => '2026-07-31'),
  todayStrKst: jest.fn(() => '2026-08-01'),
}));
// 조치가 필요 없는 통보는 확인 버튼 없는 토스트다 — 훅 자체를 목으로 대체한다(카드를
// ToastProvider로 감싸지 않아도 되게, GroupProfileEditScreen.test 관행).
// 톤은 두 갈래로 갈린다: **진짜 못 한 것**(마감 지남·정산됨·권한 없음)만 tone:'error'이고,
// '이미 …' 계열(이미 참여 중·이미 정리됨·이미 취소됨)은 원하던 상태가 이미 성립한 것이라
// tone을 **생략**해 중립 배너로 낸다(오너 결정 2026-08-11). 아래 단언들이 그 경계를 잠근다.
// 근거: GROMO-1491 / 정책 D19 — docs/prd/motion-v2/policy.md(상위 정본 병합 전까지 여기가 정본).
const mockToastShow = jest.fn();
jest.mock('@/store/ToastContext', () => ({ useToast: () => ({ show: mockToastShow }) }));
// 주간 대상 산출은 '오늘'이 주(월~일) 어디냐에 따라 갈린다 — 요일을 옮기는 테스트만 이 목의
// 반환값을 바꾸고, beforeEach가 기본값(토요일)으로 되돌린다.
const mockTodayStrKst = todayStrKst as jest.MockedFunction<typeof todayStrKst>;
// KST 벽시계는 기본 10:00 — 자정 걸침 창(GROMO-1208) 시나리오만 값을 바꾼다(BetSheet.test 관행).
// 되돌리기는 beforeEach가 맡는다 — 안 되돌리면 뒤 테스트가 조용히 00:30 세계에서 돈다.
let mockNowSec = 10 * 3600;
jest.mock('@/utils/challengeTime', () => ({
  ...jest.requireActual('@/utils/challengeTime'),
  nowSecondsInZone: jest.fn(() => mockNowSec),
}));

const mockLeaveBet = leaveBet as jest.MockedFunction<typeof leaveBet>;
const mockCancelBet = cancelBet as jest.MockedFunction<typeof cancelBet>;
const mockChallengeGroupId = challengeGroupId as jest.MockedFunction<typeof challengeGroupId>;
const mockGetDeletionPreview = getChallengeDeletionPreview as jest.MockedFunction<
  typeof getChallengeDeletionPreview
>;
const mockGetMyOpenBetSessions = getMyOpenBetSessions as jest.MockedFunction<
  typeof getMyOpenBetSessions
>;
const mockLeaveSession = leaveSession as jest.MockedFunction<typeof leaveSession>;
const mockJoinNextSession = joinNextSession as jest.MockedFunction<typeof joinNextSession>;
const mockJoinWeekSessions = joinWeekSessions as jest.MockedFunction<typeof joinWeekSessions>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const CHALLENGE_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';
const onDelete = jest.fn();
const onOpenBet = jest.fn();

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

function progress(over: Partial<ChallengeMemberProgress> = {}): ChallengeMemberProgress {
  return { userId: 'u1', nickname: '재영', progressMinutes: 32, achieved: false, ...over };
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
    memberProgress: [progress()],
    ...over,
  };
}

function bet(over: Partial<GroupChallengeBet> = {}): GroupChallengeBet {
  return {
    betId: 'b1',
    stake: 30,
    pot: 90,
    status: 'OPEN',
    myJoined: false,
    myAchievedNow: false,
    participants: [
      { userId: 'u1', nickname: '재영' },
      { userId: 'u2', nickname: '수빈' },
      { userId: 'u3', nickname: '민지' },
    ],
    ...over,
  };
}

function lastSettledBet(over: Partial<LastSettledBet> = {}): LastSettledBet {
  return {
    betDate: '2026-07-31',
    stake: 30,
    pot: 90,
    status: 'SETTLED',
    results: [
      { userId: 'u1', nickname: '재영', achieved: true, payout: 45 },
      { userId: 'u2', nickname: '수빈', achieved: true, payout: 45 },
      { userId: 'u3', nickname: '민지', achieved: false, payout: 0 },
    ],
    ...over,
  };
}

// 내기 영역은 onOpenBet을 받은 카드에만 그린다 — 부모가 시트를 쥐지 않으면 진입점도 없다.
async function renderCard(over: Partial<GroupChallengeResponse> = {}, betLocked = false) {
  return render(
    <ChallengeCard
      challenge={challenge(over)}
      isOwner={false}
      onDelete={onDelete}
      onOpenBet={onOpenBet}
      betLocked={betLocked}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // 회차 참가 마감(joinClosesAt) 판정은 서버가 준 **절대 시각**과 지금을 비교한다(벽시계 초가
  // 아니다 — 자정 걸침·기기 시계 사고 회피). '지금'을 고정하지 않으면 픽스처의 마감 시각이
  // 실제 실행일 기준으로 이미 지나 테스트가 날짜와 함께 썩는다. KST 10:00 = 01:00Z로 못 박는다
  // (아래 mockNowSec 10:00과 같은 순간 — 두 시간축이 어긋나면 분기 판정이 서로 모순된다).
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-01T01:00:00Z'));
  mockTodayStrKst.mockReturnValue('2026-08-01'); // 요일을 옮긴 테스트가 남긴 값을 되돌린다.
  mockNowSec = 10 * 3600; // KST 10:00 — 시각을 바꾼 테스트가 남긴 값을 되돌린다.
  mockLeaveBet.mockResolvedValue(undefined);
  mockCancelBet.mockResolvedValue(undefined);
  mockChallengeGroupId.mockReturnValue(GROUP_ID);
  mockGetDeletionPreview.mockResolvedValue({ openSessions: [], totalRefund: 0 });
  mockGetMyOpenBetSessions.mockResolvedValue([]);
  mockLeaveSession.mockResolvedValue(undefined);
  mockJoinNextSession.mockResolvedValue({
    sessionId: 's-next',
    sessionDate: '2026-08-03',
    stake: 30,
  });
  mockJoinWeekSessions.mockImplementation(async (_g, _c, dates) => ({
    joined: dates.map((date, i) => ({ sessionId: `s${i}`, sessionDate: date })),
    totalStake: dates.length * 30,
  }));
});

describe('미션 라벨', () => {
  test('DURATION은 카테고리에 따라 집중/스크린타임으로 갈린다', async () => {
    await render(<ChallengeCard challenge={challenge()} isOwner={false} onDelete={onDelete} />);
    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();

    await render(
      <ChallengeCard
        challenge={challenge({ missionCategory: 'SCREEN_TIME' })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('하루 60분 스크린타임')).toBeOnTheScreen();
  });

  test('TIME_WINDOW는 HH:mm 구간으로 적는다(서버 HH:mm:ss를 잘라 쓴다)', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionType: 'TIME_WINDOW',
          durationMinutes: null,
          windowStart: '09:00:00',
          windowEnd: '11:00:00',
          // 서버가 TIME_WINDOW 진행률을 지원하지 않아 항상 null이다(백 명세 결정 3).
          memberProgress: null,
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('매일 09:00~11:00 집중')).toBeOnTheScreen();
    // 진행 리스트 자체가 없다 — 빈 리스트로 그리면 '아무도 안 했다'로 읽힌다.
    expect(screen.queryByText('재영')).toBeNull();
    // 대신 왜 비어 있는지 한 줄로 알린다(그냥 비우면 '아무도 안 했다'로 읽히는 건 마찬가지다).
    expect(screen.getByText('이 챌린지는 진행률을 표시하지 않아요')).toBeOnTheScreen();
  });

  test('TIME_WINDOW에 창 목표분(V20)이 있으면 라벨에 함께 적고 진행률도 그린다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionType: 'TIME_WINDOW',
          durationMinutes: 90,
          windowStart: '09:00:00',
          windowEnd: '11:00:00',
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: 30, achieved: false }),
          ],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('매일 09:00~11:00 90분 집중')).toBeOnTheScreen();
    // 신서버(V20+)는 창 클리핑 진행률을 채워 준다 — 일형과 같은 3상 규칙으로 그린다.
    expect(screen.getByText('30/90분')).toBeOnTheScreen();
    expect(screen.queryByText('이 챌린지는 진행률을 표시하지 않아요')).toBeNull();
  });

  test('라벨을 못 만들면 세그먼트와 같은 카테고리 명칭으로 떨어진다', async () => {
    // durationMinutes 결손 — 라벨 자리에 카테고리명만 남는다. 고르는 자리(세그먼트)와 명칭을 맞춘다.
    await render(
      <ChallengeCard
        challenge={challenge({ durationMinutes: null })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('집중 시간')).toBeOnTheScreen();
  });
});

describe('멤버 진행 3상', () => {
  test('달성 · 진행 중 · 미집계를 각각 다르게 적는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: 40, achieved: true }),
            progress({ userId: 'u2', nickname: '수빈', progressMinutes: 90, achieved: false }),
            progress({ userId: 'u3', nickname: '민지', progressMinutes: null, achieved: null }),
          ],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText('달성 ✓')).toBeOnTheScreen();
    expect(screen.getByText('90/60분')).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
  });

  test('progressMinutes 0은 미집계(—)가 아니라 0분으로 적는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          memberProgress: [progress({ progressMinutes: 0, achieved: false })],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('0/60분')).toBeOnTheScreen();
    expect(screen.queryByText('—')).toBeNull();
  });

  test('미집계 —는 실제 값과 다른 색·무게로 그린다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          memberProgress: [progress({ progressMinutes: null, achieved: null })],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText('—')).toHaveStyle({ color: T.inkFaint, fontWeight: '500' });
    // 기호만으로는 0분인지 값이 없는 건지 알 수 없다 — 카드 하단에 뜻을 적는다.
    expect(screen.getByText('— 는 아직 집계되지 않았어요')).toBeOnTheScreen();
  });

  test('미집계 카드가 아니면 미집계 캡션을 붙이지 않는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({ missionCategory: 'SCREEN_TIME' })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.queryByText('— 는 아직 집계되지 않았어요')).toBeNull();
  });

  test('achieved=true라도 progressMinutes가 null이면 달성으로 칠하지 않는다', async () => {
    // 서버가 계약을 어긴 조합 — 텍스트는 '—'인데 초록으로 칠하면 달성한 것으로 읽힌다.
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          memberProgress: [progress({ progressMinutes: null, achieved: true })],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('—')).not.toHaveStyle({ color: T.successInk });
  });

  test('달성은 색만이 아니라 배경 칩으로도 구분한다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          memberProgress: [progress({ progressMinutes: 70, achieved: true })],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('달성 ✓')).toHaveStyle({
      color: T.successInk,
      backgroundColor: T.successBg,
    });
  });
});

describe('내 행', () => {
  test('내 행을 맨 위로 올리고 강조한다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          memberProgress: [
            progress({ userId: 'u2', nickname: '수빈', progressMinutes: 10 }),
            progress({ userId: 'me', nickname: '나', progressMinutes: 20 }),
            progress({ userId: 'u3', nickname: '민지', progressMinutes: 30 }),
          ],
        })}
        isOwner={false}
        myUserId="me"
        onDelete={onDelete}
      />,
    );

    // 10명이면 닉네임을 눈으로 훑어야 내 진행률을 찾는다 — 내 행이 항상 첫 줄이어야 한다.
    const names = screen.getAllByText(/^(나|수빈|민지)$/).map((el) => el.props.children);
    expect(names).toEqual(['나', '수빈', '민지']);
    expect(screen.getByText('나')).toHaveStyle({ color: T.accentDeep });
  });

  test('myUserId가 없으면 서버 순서를 그대로 둔다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          memberProgress: [
            progress({ userId: 'u2', nickname: '수빈', progressMinutes: 10 }),
            progress({ userId: 'me', nickname: '나', progressMinutes: 20 }),
          ],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    const names = screen.getAllByText(/^(나|수빈)$/).map((el) => el.props.children);
    expect(names).toEqual(['수빈', '나']);
  });

  test('행 전체를 하나의 접근성 라벨로 읽는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: null, achieved: null }),
            progress({ userId: 'u2', nickname: '수빈', progressMinutes: 40, achieved: true }),
          ],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );

    // '—'는 VoiceOver가 "대시"로 읽는다 — 뜻을 그대로 담은 라벨로 묶는다.
    expect(screen.getByLabelText('재영 아직 집계되지 않음')).toBeOnTheScreen();
    expect(screen.getByLabelText('수빈 달성')).toBeOnTheScreen();
  });
});

describe('캡션', () => {
  test('SCREEN_TIME 카드는 목표의 방향(이하)을 한 줄로 알린다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({ missionCategory: 'SCREEN_TIME' })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('오늘 스크린타임을 목표 이하로 유지해요')).toBeOnTheScreen();
  });

  test('FOCUS 카드에는 스크린타임 캡션을 붙이지 않는다', async () => {
    await render(<ChallengeCard challenge={challenge()} isOwner={false} onDelete={onDelete} />);
    expect(screen.queryByText('오늘 스크린타임을 목표 이하로 유지해요')).toBeNull();
  });

  test('canParticipate=false면 참여 불가 사유를 노출한다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({ missionCategory: 'SCREEN_TIME', canParticipate: false })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('스크린타임 권한이 없어 참여할 수 없어요')).toBeOnTheScreen();
  });

  // SCREEN_TIME 창 카드의 측정 한계 고지는 계약 필수 문구다(contract.md §2 — 15분 눈금 측정
  // 위로 코인이 움직인다). 일형 카드에는 붙이지 않는다 — 일형은 일일 통계라 눈금 문제가 없다.
  test('SCREEN_TIME 창 카드에는 측정 한계 캡션을, 일형에는 붙이지 않는다', async () => {
    const MEASURE =
      '사용 시간은 15분 단위로 집계돼 오차가 있을 수 있어요. 앱 버전이나 기기 상태에 따라 집계가 늦거나 누락될 수 있어요';
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          missionType: 'TIME_WINDOW',
          durationMinutes: 60,
          windowStart: '09:00:00',
          windowEnd: '11:00:00',
          memberProgress: null,
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText(MEASURE)).toBeOnTheScreen();

    await render(
      <ChallengeCard
        challenge={challenge({ missionCategory: 'SCREEN_TIME' })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.queryByText(MEASURE)).toBeNull();
  });
});

// 내기 영역 4상 — 명세 docs/app/group-bet-plan.md §1.
// 상태를 하나라도 잘못 그리면 사용자가 **돈을 잃는다**: 없는 내기를 참가로 보이면 헛탭이고,
// 참여 중을 참가 가능으로 보이면 두 번 걸려 하고, 달성자에게 참가를 열면 서버가 거절할 요청만 만든다.
describe('내기 영역 4상', () => {
  test('① 내기가 없으면 개설 진입점만 둔다', async () => {
    await renderCard({ bet: null });

    const btn = screen.getByText('내기 걸기');
    await act(async () => {
      fireEvent.press(btn);
    });
    expect(onOpenBet).toHaveBeenCalledWith('create');
  });

  test('② OPEN인데 미참가면 참가 행 — 참가비·인원·참가하기를 한 줄로 적는다', async () => {
    await renderCard({ bet: bet() });

    const row = screen.getByText('🪙 참가비 30 · 3명 참여 중 — 참가하기');
    expect(row).toBeOnTheScreen();
    expect(screen.queryByText('내기 걸기')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).toHaveBeenCalledWith('join');
  });

  test('③ 이미 오늘 목표를 달성했으면 참가를 막고 사유를 적는다', async () => {
    await renderCard({ bet: bet({ myAchievedNow: true }) });

    expect(screen.getByText('이미 오늘 목표를 달성해서 참가할 수 없어요')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`));
    });
    // 눌러도 시트가 열리지 않는다 — 서버가 BET_ALREADY_ACHIEVED로 거절할 요청이다.
    expect(onOpenBet).not.toHaveBeenCalled();
  });

  test('④ 참여 중이면 적립금까지 보여 주고 참가 진입점을 없앤다', async () => {
    await renderCard({ bet: bet({ myJoined: true }) });

    expect(screen.getByText('🪙 참가비 30 · 적립금 90 · 3명 참여')).toBeOnTheScreen();
    expect(screen.getByText('참여 중')).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.join.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.queryByText('내기 걸기')).toBeNull();
  });

  test('정산이 끝난 내기에는 참여 중 칩을 달지 않는다', async () => {
    await renderCard({ bet: bet({ myJoined: true, status: 'SETTLED' }) });

    expect(screen.getByText('🪙 참가비 30 · 적립금 90 · 3명 참여')).toBeOnTheScreen();
    expect(screen.queryByText('참여 중')).toBeNull();
  });

  // 서버가 필드를 아직 안 내려주는 배포 구간(백 워커 병행 구현) — undefined는 '내기 없음'이
  // 아니라 '내기를 모르는 서버'다. 없는 엔드포인트로 나가 계속 실패할 버튼을 세우지 않는다(코덱스 리뷰).
  test('bet 필드가 아예 없는 서버에서는 내기 영역을 그리지 않는다', async () => {
    await renderCard();
    expect(screen.queryByText('내기 걸기')).toBeNull();
    expect(screen.queryByTestId(`group.bet.create.${CHALLENGE_ID}`)).toBeNull();

    // 같은 서버가 지난 내기도 내려주지 못하므로 '지난 내기' 줄도 없다.
    await renderCard({ lastSettledBet: undefined });
    expect(screen.queryByText(/지난 내기/)).toBeNull();
  });

  // 앱은 INACTIVE를 '끝난 챌린지'로 본다(만들기 시트의 중복 판정도 ACTIVE만 센다). 서버 개설
  // 경로는 상태를 보지 않아 요청이 그대로 성립하므로, 진입점을 여는 카드가 막아야 한다(코덱스 리뷰).
  test('끝난 챌린지(INACTIVE)에는 개설 진입점을 두지 않는다', async () => {
    await renderCard({ status: 'INACTIVE', bet: null, lastSettledBet: null });
    expect(screen.queryByText('내기 걸기')).toBeNull();

    // 열린 내기가 남아 있어도 참가로 들어가지 못한다 — 상태만 읽힌다.
    await renderCard({ status: 'INACTIVE', bet: bet(), lastSettledBet: null });
    expect(screen.queryByTestId(`group.bet.join.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.getByText('🪙 참가비 30 · 적립금 90 · 3명 참여')).toBeOnTheScreen();

    // 지난 내기(읽기 전용)는 끝난 챌린지에서도 그대로 보여 준다.
    await renderCard({ status: 'INACTIVE', bet: null, lastSettledBet: lastSettledBet() });
    expect(screen.getByText('지난 내기(7월 31일): 3명 중 2명 달성')).toBeOnTheScreen();
  });

  // 개설자는 자동 참가라 달성자는 개설도 서버가 거절한다(계약 §2-1 BET_ALREADY_ACHIEVED).
  // 내기가 없는 카드엔 myAchievedNow가 없으므로 내 진행 행에서 읽는다.
  test('이미 달성했으면 개설 진입점도 잠그고 사유를 적는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          bet: null,
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: 60, achieved: true }),
            progress({ userId: 'u2', nickname: '수빈', progressMinutes: 10, achieved: false }),
          ],
        })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );

    expect(screen.getByText('이미 오늘 목표를 달성해서 내기를 열 수 없어요')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.create.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).not.toHaveBeenCalled();
  });

  test('남이 달성한 것으로는 내 개설 진입점을 잠그지 않는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          bet: null,
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: 10, achieved: false }),
            progress({ userId: 'u2', nickname: '수빈', progressMinutes: 60, achieved: true }),
          ],
        })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );

    expect(screen.queryByText('이미 오늘 목표를 달성해서 내기를 열 수 없어요')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.create.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).toHaveBeenCalledWith('create');
  });

  // 내기 게이트는 전 조합이다(계약 §2 — 카테고리 제한 제거). 목표분 없는 창 챌린지만
  // 판정 자체가 불가라 진입점을 닫는다.
  test('betSupported 4조합 — DURATION 전부·목표분 있는 창은 열리고, 목표분 없는 창만 닫힌다', async () => {
    // ① FOCUS × DURATION (현행)
    await renderCard({ bet: null, lastSettledBet: null });
    expect(screen.getByText('내기 걸기')).toBeOnTheScreen();

    // ③ SCREEN_TIME × DURATION (신규 허용)
    await renderCard({ missionCategory: 'SCREEN_TIME', bet: null, lastSettledBet: null });
    expect(screen.getByText('내기 걸기')).toBeOnTheScreen();

    // ② FOCUS × TIME_WINDOW + 목표분 (신규)
    await renderCard({
      missionType: 'TIME_WINDOW',
      durationMinutes: 60,
      windowStart: '09:00:00',
      windowEnd: '11:00:00',
      memberProgress: null,
      bet: null,
      lastSettledBet: null,
    });
    expect(screen.getByText('내기 걸기')).toBeOnTheScreen();

    // ④ SCREEN_TIME × TIME_WINDOW + 목표분 (신규)
    await renderCard({
      missionCategory: 'SCREEN_TIME',
      missionType: 'TIME_WINDOW',
      durationMinutes: 60,
      windowStart: '09:00:00',
      windowEnd: '11:00:00',
      memberProgress: null,
      bet: null,
      lastSettledBet: null,
    });
    expect(screen.getByText('내기 걸기')).toBeOnTheScreen();
  });

  test('목표분 없는 창 챌린지에는 지난 내기까지 아무것도 그리지 않는다', async () => {
    await renderCard({
      missionType: 'TIME_WINDOW',
      durationMinutes: null,
      windowStart: '09:00:00',
      windowEnd: '11:00:00',
      memberProgress: null,
      bet: null,
      lastSettledBet: lastSettledBet(),
    });
    expect(screen.queryByText('내기 걸기')).toBeNull();
    expect(screen.queryByText(/지난 내기/)).toBeNull();
  });

  // SCREEN_TIME의 차단 방향은 반대다(계약 §2) — achieved===true는 '잠정 달성'(지금까지 이하
  // 유지)이라 잠그면 하루 시작 직후 사실상 전원이 잠긴다. 막는 건 확정 패배(초과)뿐이다.
  test('SCREEN_TIME은 myAchievedNow(잠정 달성)로 참가를 잠그지 않는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          bet: bet({ myAchievedNow: true }),
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: 10, achieved: true }),
          ],
        })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).toHaveBeenCalledWith('join');
    expect(screen.queryByText('이미 오늘 목표를 달성해서 참가할 수 없어요')).toBeNull();
  });

  test('SCREEN_TIME은 이미 목표를 초과(확정 패배)했을 때 참가·개설을 잠근다', async () => {
    // 참가 — 내 진행 행 achieved===false(초과)면 잠그고 사유를 적는다.
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          bet: bet(),
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: 90, achieved: false }),
          ],
        })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );
    expect(screen.getByText('이미 목표를 초과해서 참가할 수 없어요')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).not.toHaveBeenCalled();

    // 개설 — 같은 근거로 잠근다(개설자는 자동 참가라 서버도 BET_ALREADY_FAILED로 거절한다).
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          bet: null,
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: 90, achieved: false }),
          ],
        })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );
    expect(screen.getByText('이미 목표를 초과해서 내기를 열 수 없어요')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.create.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).not.toHaveBeenCalled();
  });

  // FOCUS의 미달성(achieved===false)은 아직 기회가 있는 상태다 — SCREEN_TIME 잠금 근거를
  // 그대로 옮겨 쓰면 집중을 시작도 안 한 사람이 전부 잠긴다.
  test('FOCUS는 achieved=false(아직 미달성)로 잠그지 않는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          bet: null,
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: 10, achieved: false }),
          ],
        })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.create.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).toHaveBeenCalledWith('create');
  });

  test('onOpenBet을 받지 않으면 내기 영역 자체가 없다', async () => {
    await render(
      <ChallengeCard challenge={challenge({ bet: null })} isOwner onDelete={onDelete} />,
    );
    expect(screen.queryByText('내기 걸기')).toBeNull();
  });

  // 부모가 성공 직후 재조회하는 동안(betLocked) 카드는 아직 '내기 이전' 모습이다 —
  // 그 창에서 다시 누르면 같은 내기를 또 열려 하고 서버가 BET_ALREADY_EXISTS로 튕긴다(F6).
  test('betLocked면 개설·참가 진입점이 눌리지 않는다(영역은 남는다)', async () => {
    await renderCard({ bet: null }, true);
    expect(screen.getByText('내기 걸기')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.create.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).not.toHaveBeenCalled();

    await renderCard({ bet: bet() }, true);
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).not.toHaveBeenCalled();
  });

  // 스크린리더는 자리를 이름으로 읽는다 — role이 없으면 '내기 걸기'가 그냥 글자로만 읽힌다(F9).
  test('내기 진입점 2종은 버튼으로 읽힌다', async () => {
    await renderCard({ bet: null });
    expect(screen.getByTestId(`group.bet.create.${CHALLENGE_ID}`)).toHaveProp(
      'accessibilityRole',
      'button',
    );

    await renderCard({ bet: bet() });
    expect(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`)).toHaveProp(
      'accessibilityRole',
      'button',
    );
  });
});

// 내일 내기 표시 — 서버는 오늘 내기가 없으면 내일 내기를 폴백으로 내려줄 수 있다(계약 §3 응답
// 보수, W2). 표기가 없으면 오늘 내기로 오인한 채 돈을 건다. '오늘'은 2026-08-01 고정(상단 mock).
describe('내일 내기 표시', () => {
  test('bet.date가 내일이면 참가 행·참여 중 행에 내일 시작 배지를 붙인다', async () => {
    // 참가 행(미참가·OPEN).
    await renderCard({ bet: bet({ date: '2026-08-02' }) });
    expect(screen.getByText('내일 시작')).toBeOnTheScreen();

    // 참여 중 행 — '참여 중'(상태 칩)과 나란히 선다.
    await renderCard({ bet: bet({ date: '2026-08-02', myJoined: true }) });
    expect(screen.getByText('내일 시작')).toBeOnTheScreen();
    expect(screen.getByText('참여 중')).toBeOnTheScreen();
  });

  test('오늘 내기·date를 모르는 구서버에는 붙이지 않는다', async () => {
    await renderCard({ bet: bet({ date: '2026-08-01' }) });
    expect(screen.queryByText('내일 시작')).toBeNull();

    // date 필드가 없는 구서버 — 조회일(오늘) 내기로 간주한다(DTO 주석).
    await renderCard({ bet: bet() });
    expect(screen.queryByText('내일 시작')).toBeNull();
  });

  // 미래 내기는 오늘 진행률 스냅샷으로 잠그지 않는다(#473 리뷰) — 내일의 집중·사용량은 미지수다.
  // 서버가 폴백 내기의 myAchievedNow=false를 보장하지만 앱도 방어적으로 끊는다.
  test('FOCUS 오늘 달성(myAchievedNow)이어도 내일 내기 참가는 잠그지 않는다', async () => {
    await renderCard({ bet: bet({ date: '2026-08-02', myAchievedNow: true }) });

    expect(screen.queryByText('이미 오늘 목표를 달성해서 참가할 수 없어요')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).toHaveBeenCalledWith('join');
  });

  test('SCREEN_TIME 오늘 확정 초과여도 내일 내기 참가는 잠그지 않는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          bet: bet({ date: '2026-08-02' }),
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: 90, achieved: false }),
          ],
        })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );

    expect(screen.queryByText('이미 목표를 초과해서 참가할 수 없어요')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).toHaveBeenCalledWith('join');
  });
});

// 지난 내기 결과는 네이티브 Alert가 아니라 앱 컨셉 바텀시트로 펼친다(GROMO-1099 — Alert 나열이
// '아이폰 알림창' 증상의 정체였다). 시트 내부 표기(손익 환산·미판정·상태 배너·캐릭터)는
// LastBetResultSheet.test가 잠근다 — 여기서는 카드가 시트를 올바른 데이터로 여닫는 것만 본다.
describe('지난 내기', () => {
  test('캡션 1줄에 날짜·달성 인원을 적는다', async () => {
    await renderCard({ bet: null, lastSettledBet: lastSettledBet() });
    expect(screen.getByText('지난 내기(7월 31일): 3명 중 2명 달성')).toBeOnTheScreen();
  });

  test('탭하면 결과 시트를 연다 — Alert가 아니다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderCard({ bet: null, lastSettledBet: lastSettledBet() });

    // 누르기 전엔 시트가 없다.
    expect(screen.queryByTestId('group.bet.result.sheet')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('group.bet.result.sheet')).toBeOnTheScreen();
    // 카드가 쥔 lastSettledBet이 그대로 들어갔다 — 날짜·손익 환산(payout 45 - 판돈 30 = +15).
    expect(screen.getByText('7월 31일 · 3명 참가')).toBeOnTheScreen();
    expect(screen.getAllByText('+15')).toHaveLength(2);
    expect(screen.getByText('-30')).toBeOnTheScreen();
  });

  test('확인을 누르면 시트가 닫힌다', async () => {
    await renderCard({ bet: null, lastSettledBet: lastSettledBet() });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.result.close'));
    });
    // 확인 CTA는 SheetShell의 퇴장 애니메이션(220ms)을 태운 뒤에 onClose를 부른다(GROMO-1381) —
    // 그만큼 기다려야 카드가 시트를 내린다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(screen.queryByTestId('group.bet.result.sheet')).toBeNull();
  });

  test('지난 내기가 없으면 캡션을 붙이지 않는다', async () => {
    await renderCard({ bet: null, lastSettledBet: null });
    expect(screen.queryByText(/지난 내기/)).toBeNull();
  });

  // 승자 0명의 결말(REFUNDED 환불/FORFEITED 소멸)이 시트까지 이어지는지 — 상태가 데이터로
  // 전달되는 것만 확인한다(문구·배너 규격은 시트 테스트가 정본).
  test('REFUNDED 내기도 시트로 열리고 환불 배너가 보인다', async () => {
    await renderCard({
      bet: null,
      lastSettledBet: lastSettledBet({
        status: 'REFUNDED',
        results: [
          { userId: 'u1', nickname: '재영', achieved: false, payout: 30 },
          { userId: 'u2', nickname: '수빈', achieved: false, payout: 30 },
        ],
      }),
    });

    // null이 아닌 미달성만 세는 집계 규칙은 그대로다.
    expect(screen.getByText('지난 내기(7월 31일): 2명 중 0명 달성')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });
    expect(screen.getByText('달성한 사람이 없어 전원 환불됐어요')).toBeOnTheScreen();
  });

  // 계약 §3은 achieved·payout을 nullable로 둔다(정산 전·부분 실패) — 캡션 집계는 null을
  // 달성으로도 미달성으로도 세지 않고, 시트는 미판정으로 적는다(F7).
  test('미판정(null) 참가자는 달성 집계에서 빼고 시트에 미판정으로 적는다', async () => {
    await renderCard({
      bet: null,
      lastSettledBet: lastSettledBet({
        results: [
          { userId: 'u1', nickname: '재영', achieved: true, payout: 60 },
          { userId: 'u2', nickname: '수빈', achieved: null, payout: null },
        ],
      }),
    });

    expect(screen.getByText('지난 내기(7월 31일): 2명 중 1명 달성')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });
    expect(screen.getByText('미판정')).toBeOnTheScreen();
  });
});

// 히스토리 진입(GROMO-1221) — 시트의 '지난 기록 더보기'가 '시트 닫기 → 화면 push'로 배타
// 전환된다. 열림 상태가 유니온({kind:'last'}|{kind:'history'})이라 둘이 동시에 참일 수 없고,
// push는 시트가 언마운트된 커밋 뒤(이펙트)에만 나간다 — 모달이 뜬 채 push 금지가 계약이다.
describe('지난 기록 더보기 → 히스토리 push', () => {
  test('시트가 닫힌 뒤에야 navigate가 나간다 — 열린 채 push 금지', async () => {
    // navigate가 불리는 그 순간, 시트는 이미 트리에서 내려가 있어야 한다(커밋 후 이펙트 보장).
    mockNavigate.mockImplementationOnce(() => {
      expect(screen.queryByTestId('group.bet.result.sheet')).toBeNull();
    });
    await renderCard({ bet: null, lastSettledBet: lastSettledBet() });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });
    expect(screen.getByTestId('group.bet.result.sheet')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.result.history'));
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    // 그룹 축 내역 화면(GROMO-1277)으로 가되, 이 진입점은 **이 챌린지만** 보는 필터다.
    // 미션 메타는 더 이상 param으로 나르지 않는다 — 응답의 회차 스냅샷에 실려 온다.
    // 대신 필터 사실을 헤더가 말할 수 있게 라벨을 넘긴다(카드가 그리는 문장 그대로).
    expect(mockNavigate).toHaveBeenCalledWith('GroupChallengeHistory', {
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      challengeLabel: '하루 60분 집중',
    });
    expect(screen.queryByTestId('group.bet.result.sheet')).toBeNull();
  });

  // 내역 화면의 필터 헤더는 이 라벨을 그대로 쓴다("… 만 보는 중"). 스크린타임 목표는 방향이
  // 반대라(60분 **이하**) 카드의 방향 캡션이 없는 그 화면에서는 라벨이 방향을 말해야 한다
  // (codex 리뷰 P2 · policy §A9 시안 `하루 폰 2시간 이하`). 카드 본문 문구는 그대로 둔다 —
  // 캡션이 이미 방향을 말하는 자리라 두 번 말할 필요가 없다.
  test('스크린타임 카드가 넘기는 필터 라벨에는 목표 방향(이하)이 들어간다', async () => {
    await renderCard({
      missionCategory: 'SCREEN_TIME',
      bet: null,
      lastSettledBet: lastSettledBet(),
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.result.history'));
    });

    expect(mockNavigate).toHaveBeenCalledWith('GroupChallengeHistory', {
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      challengeLabel: '하루 60분 이하 스크린타임',
    });
    // 카드 본문의 미션 줄은 종전 그대로 — 방향은 전용 캡션이 말한다.
    expect(screen.getByText('오늘 스크린타임을 목표 이하로 유지해요')).toBeOnTheScreen();
  });

  test('groupId 캐시 미적중이면 push 대신 공통 실패 문구 — 반쪽 파라미터로 화면을 열지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockChallengeGroupId.mockReturnValue(null);
    await renderCard({ bet: null, lastSettledBet: lastSettledBet() });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.result.history'));
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('기록을 열 수 없어요', '잠시 후 다시 시도해 주세요.');
  });
});

// 삭제는 우측 상단 X 버튼이다(GROMO-1101) — 옛 롱프레스는 발견 가능성이 0이라 힌트 캡션까지
// 필요했다. X는 방장에게만 그린다(서버도 NOT_OWNER 403으로 방장 전용).
describe('방장 삭제 (X 버튼)', () => {
  test('X → 확인 Alert의 삭제를 눌러야 onDelete가 불린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<ChallengeCard challenge={challenge()} isOwner onDelete={onDelete} />);

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.challenge.delete.${CHALLENGE_ID}`));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    // Alert만 뜬 시점에는 아직 아무것도 지우지 않는다.
    expect(onDelete).not.toHaveBeenCalled();

    // 확인 버튼을 직접 눌러본다.
    const buttons = alertSpy.mock.calls[0][2];
    buttons?.find((b) => b.text === '삭제')?.onPress?.();
    expect(onDelete).toHaveBeenCalledWith(CHALLENGE_ID);
  });

  test('X 버튼은 방장에게만 그린다', async () => {
    await render(<ChallengeCard challenge={challenge()} isOwner onDelete={onDelete} />);
    expect(screen.getByTestId(`group.challenge.delete.${CHALLENGE_ID}`)).toBeOnTheScreen();

    await render(<ChallengeCard challenge={challenge()} isOwner={false} onDelete={onDelete} />);
    expect(screen.queryByTestId(`group.challenge.delete.${CHALLENGE_ID}`)).toBeNull();
  });

  test('롱프레스 삭제와 힌트 캡션은 제거됐다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<ChallengeCard challenge={challenge()} isOwner onDelete={onDelete} />);

    // 힌트가 사라졌다 — X 버튼이 스스로를 설명한다.
    expect(screen.queryByText('길게 눌러 삭제')).toBeNull();
    // 카드 본체 롱프레스는 더 이상 아무 일도 하지 않는다.
    await act(async () => {
      fireEvent(screen.getByTestId(`group.challenge.card.${CHALLENGE_ID}`), 'longPress');
    });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

// 참가 철회(계약 §4) — 참가 중 && OPEN && 시작 전. 옛 '개설자 단독 취소' 버튼을 이 버튼 하나로
// 통합했다(GROMO-1102 — 단독 개설자가 철회하면 서버가 내기를 자동 CANCELED 한다).
// 진입점이 카드에 사는 이유: 참여 중(myJoined) 상태에선 부모(GroupRoomScreen)의 stale 검사가
// 내기 시트를 즉시 닫아 버려 시트에 철회를 둘 수 없고, 부모는 A3 전유라 콜백을 못 늘린다.
// '오늘'은 2026-08-01, KST 벽시계는 10:00으로 고정돼 있다(상단 mock).
describe('참가 철회', () => {
  // 철회 가능한 표준 상태 — 참여 중·OPEN·내일(DURATION은 미래 내기만 철회 가능) 내기.
  const leavableBet = () => bet({ myJoined: true, date: '2026-08-02' });

  // 재조회 응답을 흉내 내려면 같은 카드에 **새 challenge 객체**를 다시 내려야 한다
  // (카드는 객체가 갈리는 것을 '재조회 도착' 신호로 쓴다 — GROMO-1112).
  function joinedCard(
    betOver: Partial<GroupChallengeBet> = {},
    challengeOver: Partial<GroupChallengeResponse> = {},
    onBetChanged?: () => void,
  ) {
    return (
      <ChallengeCard
        challenge={challenge({ bet: { ...leavableBet(), ...betOver }, ...challengeOver })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />
    );
  }

  function renderJoined(
    betOver: Partial<GroupChallengeBet> = {},
    challengeOver: Partial<GroupChallengeResponse> = {},
    onBetChanged?: () => void,
  ) {
    return render(joinedCard(betOver, challengeOver, onBetChanged));
  }

  // 확인 Alert의 CTA까지 눌러 준다 — 반복 시나리오에서 같은 6줄을 다시 쓰지 않으려고 묶는다.
  // Alert는 각 테스트가 spy로 갈아 끼워 두고, 여기서는 **마지막** 호출의 버튼만 본다.
  // CTA 문구는 「참여 취소」다(N27) — 레거시 '철회하기'는 같은 행동의 옛 이름이었다.
  async function confirmLeave() {
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`));
    });
    const calls = (Alert.alert as unknown as jest.Mock).mock.calls;
    const buttons = calls[calls.length - 1][2] as AlertButton[] | undefined;
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });
  }

  test('참여 중·OPEN·시작 전이면 철회 버튼이 보인다 — 개설자·단독이 아니어도', async () => {
    // 개설자는 남(u2)이고 참가자도 3명이다 — 옛 취소 조건이었다면 안 보였을 조합.
    await renderJoined({ creatorUserId: 'u2' });
    expect(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeOnTheScreen();
  });

  test('노출 조건이 하나라도 깨지면 철회 버튼을 그리지 않는다', async () => {
    // 참가 중이 아니다.
    await renderJoined({ myJoined: false });
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();

    // OPEN이 아니다(이미 정산됨).
    await renderJoined({ status: 'SETTLED' });
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();

    // 오늘 DURATION 내기 — 하루 집계가 이미 진행 중이라 철회 불가(계약 §4).
    await renderJoined({ date: '2026-08-01' });
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();

    // date를 모르는 구서버 — 조회일(오늘) 내기로 간주해 DURATION은 숨긴다.
    await renderJoined({ date: undefined });
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();
  });

  // TIME_WINDOW의 '시작 전'은 KST 벽시계와 창 시작 시각 비교다(계약 §1 해석·§4).
  test('창 내기는 오늘이라도 창 시작 전이면 철회할 수 있고, 시작 후면 없다', async () => {
    const windowChallenge = (windowStart: string): Partial<GroupChallengeResponse> => ({
      missionType: 'TIME_WINDOW',
      durationMinutes: 60,
      windowStart,
      windowEnd: '23:00:00',
      memberProgress: null,
    });

    // 지금 10:00 < 시작 11:00 — 아직 시작 전.
    await renderJoined({ date: '2026-08-01' }, windowChallenge('11:00:00'));
    expect(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeOnTheScreen();

    // 지금 10:00 ≥ 시작 09:00 — 이미 창이 시작됐다.
    await renderJoined({ date: '2026-08-01' }, windowChallenge('09:00:00'));
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();

    // 내일 창 내기는 시각과 무관하게 항상 시작 전이다.
    await renderJoined({ date: '2026-08-02' }, windowChallenge('09:00:00'));
    expect(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeOnTheScreen();
  });

  test('확인 Alert를 거쳐 철회 API를 부르고, 남은 인원이 있으면 참가 진입점이 되살아난다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderJoined(); // 참가자 3명

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`));
    });
    // 확인 전에는 아무것도 하지 않는다 — 돈이 걸린 동작이라 한 겹 거친다.
    expect(mockLeaveBet).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      '참여 취소',
      '참가비 30코인을 돌려받고 내기에서 빠질까요?',
      expect.anything(),
    );

    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    // groupId는 카드 prop이 아니라 groupApi 조회 캐시에서 역참조한다.
    expect(mockLeaveBet).toHaveBeenCalledWith(GROUP_ID, 'b1');
    // 환불된 잔액은 서버가 정본 — 다시 받는다.
    expect(mockRefreshCoins).toHaveBeenCalled();
    // 남이 남은 내기는 살아 있다 — '내기 취소' 계측은 발행하지 않는다(내기가 닫힌 게 아니다).
    expect(logGroupBetCanceled).not.toHaveBeenCalled();
    // 내 참가 표시는 걷고(철회 버튼·'참여 중' 칩) 같은 자리에 참가 진입점을 세운다(GROMO-1112) —
    // 캡션만 남기면 다음 재조회 전까지 다시 들어갈 방법이 없다.
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.queryByText('참여 중')).toBeNull();
    // 인원은 내 몫을 뺀 값이다 — 응답은 아직 내가 낀 3명이다.
    expect(screen.getByText('🪙 참가비 30 · 2명 참여 중 — 참가하기')).toBeOnTheScreen();
    // 방금 빠졌다는 사실은 진입점 아래 캡션으로 남는다.
    expect(screen.getByText('참여를 취소했어요. 참가비는 잔액으로 돌아왔어요')).toBeOnTheScreen();
  });

  test('되살아난 참가 진입점을 누르면 참가 모드로 내기 시트가 열린다', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderJoined();
    await confirmLeave();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).toHaveBeenCalledWith('join');
  });

  test('철회 → 재참여 → 다시 철회를 반복할 수 있다', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { rerender } = await renderJoined();

    await confirmLeave();
    expect(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`)).toBeOnTheScreen();

    // 재참여 후의 재조회 — 서버 상태가 철회 전과 **완전히 같아진다**(같은 내기·같은 인원·참가 중).
    // 낙관 표시를 값으로만 비교하면 이 순간을 못 잡아 '빠졌어요'가 그대로 남는다.
    await act(async () => {
      rerender(joinedCard());
    });
    expect(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeOnTheScreen();
    expect(screen.getByText('참여 중')).toBeOnTheScreen();
    expect(screen.queryByText('참여를 취소했어요. 참가비는 잔액으로 돌아왔어요')).toBeNull();

    // 두 번째 철회도 첫 번째와 똑같이 동작한다.
    await confirmLeave();
    expect(mockLeaveBet).toHaveBeenCalledTimes(2);
    expect(screen.getByText('🪙 참가비 30 · 2명 참여 중 — 참가하기')).toBeOnTheScreen();
    expect(screen.getByText('참여를 취소했어요. 참가비는 잔액으로 돌아왔어요')).toBeOnTheScreen();
  });

  test('재조회가 도착하면 낙관 표시를 버리고 서버 값을 그대로 그린다', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { rerender } = await renderJoined();
    await confirmLeave();
    expect(screen.getByText('🪙 참가비 30 · 2명 참여 중 — 참가하기')).toBeOnTheScreen();

    // 내가 빠진 사이 남이 들어와 인원이 되돌아온 응답 — 낙관값(2명)이 아니라 서버 값(3명)이다.
    await act(async () => {
      rerender(
        joinedCard({
          myJoined: false,
          participants: [
            { userId: 'u2', nickname: '수빈' },
            { userId: 'u3', nickname: '민지' },
            { userId: 'u4', nickname: '지훈' },
          ],
        }),
      );
    });
    expect(screen.getByText('🪙 참가비 30 · 3명 참여 중 — 참가하기')).toBeOnTheScreen();
    expect(screen.queryByText('참여를 취소했어요. 참가비는 잔액으로 돌아왔어요')).toBeNull();
  });

  test('철회 성공은 부모 재조회를 태운다 — 실패하면 태우지 않는다', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onBetChanged = jest.fn();
    // 마지막 참가자가 빠지면 내기가 CANCELED로 닫히고 챌린지는 휴면으로 남는다(GROMO-1201) —
    // 재조회해야 카드가 닫힌 내기·휴면 상태로 갱신된다.
    await renderJoined(
      { participants: [{ userId: 'u1', nickname: '재영' }], pot: 30 },
      {},
      onBetChanged,
    );
    await confirmLeave();
    expect(onBetChanged).toHaveBeenCalledTimes(1);

    mockLeaveBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_LEAVE_CLOSED'));
    const failing = jest.fn();
    await renderJoined({}, {}, failing);
    await confirmLeave();
    expect(failing).not.toHaveBeenCalled();
  });

  test('끝난 챌린지(INACTIVE)에서 빠지면 참가 진입점 대신 정보 행만 남는다', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // 새로 돈을 걸 수 없는 카드다(betOpenable=false) — 되살릴 진입점이 없다.
    await renderJoined({}, { status: 'INACTIVE' });
    await confirmLeave();

    expect(screen.queryByTestId(`group.bet.join.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.getByText('🪙 참가비 30 · 적립금 60 · 2명 참여')).toBeOnTheScreen();
    expect(screen.getByText('참여를 취소했어요. 참가비는 잔액으로 돌아왔어요')).toBeOnTheScreen();
  });

  test('마지막 참가자의 철회는 내기가 닫히므로 취소 계측을 발행하고 자리 캡션만 남긴다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderJoined({
      creatorUserId: 'u1',
      participants: [{ userId: 'u1', nickname: '재영' }],
      pot: 30,
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    // 서버가 내기를 CANCELED로 닫는 경우다(계약 §4) — 기존 '내기 취소' 계측의 의미가 보존된다.
    expect(logGroupBetCanceled).toHaveBeenCalledWith({ stake: 30, participants_count: 1 });
    expect(screen.getByText('참여를 취소했어요. 참가비는 잔액으로 돌아왔어요')).toBeOnTheScreen();
    // 아무도 남지 않았다 — 유지해 그릴 내기 정보 행이 없다.
    expect(screen.queryByText(/적립금/)).toBeNull();
    // 재참여 진입점도 세우지 않는다 — 내기가 CANCELED로 닫혀 들어갈 OPEN 내기가 없다.
    // 챌린지는 지워지지 않고 휴면으로 남는다(GROMO-1201) — 재조회하면 휴면 카드로 갱신된다.
    expect(screen.queryByTestId(`group.bet.join.${CHALLENGE_ID}`)).toBeNull();
  });

  test('실패는 code별 전용 문구로 알리고 계측·자리 표시를 하지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLeaveBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_LEAVE_CLOSED'));
    await renderJoined();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    // 조치가 없는 종결 통보라 확인 버튼이 필요 없다 → tone:'error' 토스트(GROMO-1491 / D19).
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '내기가 시작된 뒤라 참여 취소를 못 했어요',
      tone: 'error',
    });
    // 실패 통보 Alert는 서지 않는다 — 여기 유일한 Alert는 위에서 누른 '참여 취소' 확인이다.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(logGroupBetCanceled).not.toHaveBeenCalled();
    // 실패했으므로 자리 표시로 갈아 끼우지 않는다 — 내 참가는 그대로 살아 있다.
    expect(screen.queryByText('참여를 취소했어요. 참가비는 잔액으로 돌아왔어요')).toBeNull();
  });

  // ❌ 유지 — '화면을 새로고침해 주세요'는 사용자 조치를 요구한다(정책 D19).
  test('BET_NOT_JOINED는 새로고침 조치를 요구하므로 Alert로 남는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLeaveBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_NOT_JOINED'));
    await renderJoined();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    expect(alertSpy).toHaveBeenLastCalledWith(
      '참여 취소를 못 했어요',
      '참가 중인 내기가 아니에요. 화면을 새로고침해 주세요.',
    );
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  test('BET_NOT_OPEN은 조치가 없는 종결 통보라 토스트로 알린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLeaveBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_NOT_OPEN'));
    await renderJoined();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    expect(mockToastShow).toHaveBeenCalledWith({
      message: '이미 정산됐거나 닫힌 내기라 참여 취소를 못 했어요',
      tone: 'error',
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});

// 당일 단독 개설자 carve-out(#474 리뷰 회귀 지적) — 철회는 '시작 전'만 허용이라(계약 §4)
// 당일 '개설자 단독 OPEN' 내기가 어느 버튼으로도 못 닫히는 회귀가 생겼다. 이 조합만
// 기존 cancelBet(시작 여부를 보지 않는다)으로 복원한다. 시작 전이면 철회가 우선(배타).
describe('당일 단독 개설자 취소 carve-out', () => {
  const soloCreatorBet = (over: Partial<GroupChallengeBet> = {}) =>
    bet({
      myJoined: true,
      creatorUserId: 'u1',
      participants: [{ userId: 'u1', nickname: '재영' }],
      pot: 30,
      date: '2026-08-01', // 오늘(DURATION) — 시작 전이 아니라 철회는 닫혀 있다.
      ...over,
    });

  function renderSolo(
    betOver: Partial<GroupChallengeBet> = {},
    challengeOver: Partial<GroupChallengeResponse> = {},
  ) {
    return render(
      <ChallengeCard
        challenge={challenge({ bet: soloCreatorBet(betOver), ...challengeOver })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );
  }

  // 창(TIME_WINDOW) 챌린지 오버라이드 — carve-out의 '시작 전' 판정은 창에선 벽시계 비교다.
  const windowChallenge = (
    windowStart: string,
    windowEnd: string,
  ): Partial<GroupChallengeResponse> => ({
    missionType: 'TIME_WINDOW',
    durationMinutes: 60,
    windowStart,
    windowEnd,
    memberProgress: null,
  });

  test('당일 내기의 단독 개설자에겐 철회 대신 취소 버튼이 보인다', async () => {
    await renderSolo();
    expect(screen.getByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();
  });

  test('시작 전(내일 내기)이면 철회가 우선 — 취소 버튼은 서지 않는다', async () => {
    await renderSolo({ date: '2026-08-02' });
    expect(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeNull();
  });

  test('오늘 창 내기 — 창 시작 전(10:00 < 11:00)이면 철회가 우선, 취소는 없다', async () => {
    await renderSolo({}, windowChallenge('11:00:00', '13:00:00'));
    expect(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeNull();
  });

  test('오늘 창 내기 — 창 시작 후(10:00 ≥ 09:00)면 취소 carve-out이 선다', async () => {
    await renderSolo({}, windowChallenge('09:00:00', '11:00:00'));
    expect(screen.getByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();
  });

  // GROMO-1208 회귀 고정 — 자정 걸침 창(22:00~01:00)의 **어제** 내기를 00:30에 보면, 초만
  // 비교(1800 < 79200)하던 옛 판정은 '시작 전'으로 읽어 철회를 세웠고(서버는 창 시작을
  // bet_date에 앵커해 BET_LEAVE_CLOSED로 거절) 취소는 !leavable 뒤라 어느 버튼도 못 서는
  // dead-end였다. 과거 날짜 내기는 항상 시작 후다 — 취소 carve-out이 선다.
  test('자정 걸침 창의 어제 내기 — 철회 대신 취소가 서서 dead-end가 풀린다', async () => {
    mockNowSec = 0.5 * 3600; // KST 00:30 — 어제 22시에 시작된 창이 아직 흐르는 시각.
    await renderSolo({ date: '2026-07-31' }, windowChallenge('22:00:00', '01:00:00'));
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.getByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeOnTheScreen();
  });

  test('타 참가자가 있거나 개설자가 아니면(모르면) 취소도 없다', async () => {
    // 다른 참가자가 있다 — 판돈이 남의 돈까지 걷혀 있다.
    await renderSolo({
      participants: [
        { userId: 'u1', nickname: '재영' },
        { userId: 'u2', nickname: '수빈' },
      ],
    });
    expect(screen.queryByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeNull();

    // 내가 개설자가 아니다.
    await renderSolo({ creatorUserId: 'u2' });
    expect(screen.queryByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeNull();

    // creatorUserId를 모르는 구서버 — 개설자를 판정할 수 없어 진입점을 세우지 않는다.
    await renderSolo({ creatorUserId: undefined });
    expect(screen.queryByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeNull();
  });

  test('확인 Alert를 거쳐 취소 API·계측·자리 캡션까지 잇는다(옛 플로우 그대로)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderSolo();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.cancel.${CHALLENGE_ID}`));
    });
    // 확인 전에는 아무것도 하지 않는다 — 돈이 걸린 동작이라 한 겹 거친다.
    // 제목·CTA는 「참여 취소」(N27)이되, 질문은 '내기를 닫을까요' 그대로다 — 단독 참가자라
    // 내 참여를 무르면 내기 자체가 닫히고, 그 결과는 물음에서 지우면 안 된다.
    expect(alertSpy).toHaveBeenCalledWith(
      '참여 취소',
      '참가비 30코인을 돌려받고 내기를 닫을까요?',
      expect.anything(),
    );

    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    // 철회 API가 아니라 기존 취소 API로 나간다.
    expect(mockCancelBet).toHaveBeenCalledWith(GROUP_ID, 'b1');
    expect(mockLeaveBet).not.toHaveBeenCalled();
    expect(mockRefreshCoins).toHaveBeenCalled();
    // 내기가 통째로 닫히는 동작이라 항상 취소 계측이다.
    expect(logGroupBetCanceled).toHaveBeenCalledWith({ stake: 30, participants_count: 1 });
    // 자리 캡션은 누른 버튼의 동사(「참여 취소」)를 따르되, 내기가 닫혔다는 결과까지 말한다.
    expect(
      screen.getByText('참여를 취소해 내기가 닫혔어요. 참가비는 잔액으로 돌아왔어요'),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeNull();
    // 취소는 내기를 통째로 닫는 동작이라 재참여 진입점을 세우지 않는다(GROMO-1112 — 철회와 다르다).
    expect(screen.queryByTestId(`group.bet.join.${CHALLENGE_ID}`)).toBeNull();
  });

  test('실패는 code별 문구로 알리고 계측·자리 캡션을 남기지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCancelBet.mockRejectedValueOnce(axiosErrorWith(409, 'BET_CANCEL_HAS_OTHERS'));
    await renderSolo();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.cancel.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    // 조치가 없는 종결 통보라 tone:'error' 토스트다(GROMO-1491 / D19) — Alert는 확인 1회뿐.
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '다른 참가자가 있어 취소할 수 없어요',
      tone: 'error',
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(logGroupBetCanceled).not.toHaveBeenCalled();
    expect(
      screen.queryByText('참여를 취소해 내기가 닫혔어요. 참가비는 잔액으로 돌아왔어요'),
    ).toBeNull();
  });

  // 나머지 두 이관 코드 (GROMO-1491 / codex 리뷰) — 위 테스트는 HAS_OTHERS 하나만 덮었다.
  // 세 코드가 각기 다른 문구로 갈리는데 둘이 안 잠겨 있어, 문구가 뒤바뀌거나 Alert 로
  // 되돌아가도 스위트가 통과했다.
  test.each([
    ['BET_CANCEL_FORBIDDEN', '내기를 연 사람만 취소할 수 있어요'],
    ['BET_NOT_OPEN', '이미 정산됐거나 닫힌 내기라 참여 취소를 못 했어요'],
  ])('내기 취소 거절 — %s 는 해당 문구의 error 토스트다', async (code, message) => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCancelBet.mockRejectedValueOnce(axiosErrorWith(409, code));
    await renderSolo();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.cancel.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    expect(mockToastShow).toHaveBeenCalledWith({ message, tone: 'error' });
    // Alert 는 확인 1회뿐 — 통보가 Alert 로 되돌아가면 깨진다.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    // 실패했으므로 계측도 자리 캡션도 남지 않는다.
    expect(logGroupBetCanceled).not.toHaveBeenCalled();
  });
});

// 휴면 배지(GROMO-1201) — 마지막 참가자가 철회해도 서버는 챌린지를 지우지 않고 남긴다.
// OPEN 내기가 없고 과거 이력만 있는 챌린지에 dormant=true가 내려오면 카드가 칩·캡션으로
// 표시만 가른다. 문구는 계약 §2 고정('휴면' — '비활성'은 INACTIVE 대비 예약).
describe('휴면 배지', () => {
  test('dormant=true면 휴면 칩과 참가자 없음 캡션을 그린다', async () => {
    await renderCard({ dormant: true, bet: null, lastSettledBet: lastSettledBet() });
    expect(screen.getByText('휴면')).toBeOnTheScreen();
    expect(screen.getByText('참가자가 없어요')).toBeOnTheScreen();
  });

  test('dormant를 모르는 구서버(undefined)·false에는 아무것도 그리지 않는다', async () => {
    // 필드가 아예 없는 구서버 — undefined는 '휴면 아님'이 아니라 '휴면을 모르는 서버'다.
    await renderCard({ bet: null });
    expect(screen.queryByText('휴면')).toBeNull();
    expect(screen.queryByText('참가자가 없어요')).toBeNull();

    await renderCard({ dormant: false, bet: null });
    expect(screen.queryByText('휴면')).toBeNull();
    expect(screen.queryByText('참가자가 없어요')).toBeNull();
  });

  test('휴면이어도 내기 걸기는 눌린다 — 새 내기가 서면 서버가 휴면을 해제한다', async () => {
    await renderCard({ dormant: true, bet: null });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.create.${CHALLENGE_ID}`));
    });
    expect(onOpenBet).toHaveBeenCalledWith('create');
  });
});

// ── 챌린지 v2 — 요일 배지·다음 회차(GROMO-1274) ────────────────────────────────
// '오늘'은 KST 2026-08-01(토), 벽시계 10:00 고정(상단 mock). 다음 활성일 픽스처는 8/3(월) —
// KST 자정 시작 = '2026-08-02T15:00:00Z'(하루형 회차 시작 instant).
const NEXT_MON_AT = '2026-08-02T15:00:00Z';

describe('요일 배지·다음 회차 (GROMO-1274)', () => {
  test('repeatDays가 있으면 7칸 배지와 다음 활성일 문구를 그린다', async () => {
    await renderCard({
      repeatDays: ['MON', 'WED', 'FRI'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
    });

    for (const day of ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) {
      expect(screen.getByTestId(`group.challenge.dow.${CHALLENGE_ID}.${day}`)).toBeOnTheScreen();
    }
    // 하루형은 시각 표기가 없다(자정 시작) — 날짜·요일만.
    expect(screen.getByTestId(`group.challenge.next.${CHALLENGE_ID}`)).toHaveTextContent(
      '다음 8/3(월)',
    );
  });

  test('구서버 응답(repeatDays 없음)에는 배지 행을 그리지 않는다 — 종전 렌더 유지', async () => {
    await renderCard();
    expect(screen.queryByTestId(`group.challenge.dow.${CHALLENGE_ID}.MON`)).toBeNull();
    expect(screen.queryByTestId(`group.challenge.next.${CHALLENGE_ID}`)).toBeNull();
  });

  test('비활성 요일엔 진행 리스트 자리에 쉬는 날 문구가 서고 카드가 가라앉는다(FR-16-2)', async () => {
    await renderCard({
      repeatDays: ['MON', 'WED', 'FRI'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      memberProgress: null, // 서버는 비활성 요일에 진행률을 재지 않는다
    });

    expect(screen.getByText('오늘은 쉬는 날이에요')).toBeOnTheScreen();
    // '진행률을 표시하지 않는 챌린지'로 오독되면 안 된다 — 캡션을 갈아 끼운다.
    expect(screen.queryByText('이 챌린지는 진행률을 표시하지 않아요')).toBeNull();
    // 카드 전체 침강 — 감추지 않고 옅게(스타일로 판정).
    const card = screen.getByTestId(`group.challenge.card.${CHALLENGE_ID}`);
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({ opacity: expect.any(Number) });
  });

  test('서버 activeToday가 있으면 우선한다 — 활성이면 침강하지 않고 진행 중 문구', async () => {
    await renderCard({ repeatDays: ['SAT'], activeToday: true, nextSessionAt: NEXT_MON_AT });

    expect(screen.queryByText('오늘은 쉬는 날이에요')).toBeNull();
    // 하루형 활성일은 자정 시작·자정 종료 — 하루 종일 '진행 중'이 사실이다.
    expect(screen.getByTestId(`group.challenge.next.${CHALLENGE_ID}`)).toHaveTextContent(
      '진행 중 · 자정 종료',
    );
    const card = screen.getByTestId(`group.challenge.card.${CHALLENGE_ID}`);
    expect(StyleSheet.flatten(card.props.style).opacity).toBeUndefined();
  });

  test('창형 활성일 — 창 시작 전엔 오늘 시각, 창이 끝나면 다음 활성일로 말한다', async () => {
    const windowOver: Partial<GroupChallengeResponse> = {
      missionType: 'TIME_WINDOW',
      windowStart: '11:00:00',
      windowEnd: '12:00:00',
      repeatDays: ['SAT', 'MON'],
      activeToday: true,
      nextSessionAt: NEXT_MON_AT,
    };
    // 10:00(고정) < 11:00 — 아직 시작 전.
    await renderCard(windowOver);
    expect(screen.getByTestId(`group.challenge.next.${CHALLENGE_ID}`)).toHaveTextContent(
      '오늘 11:00',
    );

    // 13:00 — 오늘 창이 끝났다. '오늘 11:00'으로 두면 거짓말이 된다(ux §02).
    mockNowSec = 13 * 3600;
    await renderCard(windowOver);
    expect(screen.getByTestId(`group.challenge.next.${CHALLENGE_ID}`)).toHaveTextContent(
      '다음 8/3(월) 11:00',
    );
  });

  // #570 codex ② — 종료·삭제된 챌린지도 요일은 그대로다. 상태를 안 보면 하루형이 영영
  // 「진행 중 · 자정 종료」로 남아, 끝난 챌린지가 돌고 있는 것처럼 읽힌다.
  test('끝난 챌린지(INACTIVE)는 오늘 활성 요일이어도 진행 중으로 말하지 않는다', async () => {
    await renderCard({
      status: 'INACTIVE',
      repeatDays: ['SAT'],
      activeToday: true,
      nextSessionAt: NEXT_MON_AT,
    });

    // 배지 줄은 남는다(언제 도는 챌린지였는지는 여전히 정보다) — 진행 문구만 걷힌다.
    expect(screen.getByTestId(`group.challenge.dow.${CHALLENGE_ID}.SAT`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.challenge.next.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.queryByText(/진행 중/)).toBeNull();
  });

  test('요일 줄은 한 문장으로 읽힌다(a11y)', async () => {
    await renderCard({
      repeatDays: ['MON', 'WED', 'FRI'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
    });
    expect(screen.getByLabelText('매주 월·수·금 반복 · 다음 8/3(월)')).toBeOnTheScreen();
  });
});

// ── 챌린지 v2 — 다음 활성일 1건 예약(GROMO-1419, N45·FR-31-1) ──────────────────
describe('다음 활성일 참여 (GROMO-1419)', () => {
  // 신서버 쉬는 날 카드 — 오늘 회차 없음(bet.session === null) + 다음 활성일 8/3(월).
  const restingOver = (
    betOver: Partial<GroupChallengeBet> = {},
  ): Partial<GroupChallengeResponse> => ({
    repeatDays: ['MON', 'WED', 'FRI'],
    activeToday: false,
    nextSessionAt: NEXT_MON_AT,
    memberProgress: null,
    bet: bet({ enabled: true, session: null, myJoined: false, participants: [], ...betOver }),
  });

  test('오늘 회차가 없으면 날짜가 적힌 참여 버튼이 선다', async () => {
    await renderCard(restingOver());
    expect(screen.getByTestId(`group.bet.joinNext.${CHALLENGE_ID}`)).toHaveTextContent(
      '8/3(월) 참여하기',
    );
  });

  test('버튼 → 확인 시트 → 참여까지 — join-next 한 건이 나가고 재조회를 태운다', async () => {
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge(restingOver())}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.joinNext.${CHALLENGE_ID}`));
    });
    // 확인 시트 — 예약 대상 날짜가 CTA에도 박혀 있다(FR-31-1: 버튼 문구는 날짜로 쓴다).
    expect(screen.getByTestId('group.bet.joinNext.submit')).toHaveTextContent('8/3(월) 참여하기');
    // 잔액 표기는 N46 단독 소유 컴포넌트(1424) — 「참가비 N · 내 잔액 M」 형식.
    // (이 스위트의 CoinContext 목은 잔액을 싣지 않아 미상 '—'가 온다 — 형식만 잠근다.)
    expect(screen.getByTestId('group.bet.balanceRow')).toHaveTextContent(/참가비 30 · 내 잔액/);

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.joinNext.submit'));
    });
    expect(mockJoinNextSession).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID);
    expect(onBetChanged).toHaveBeenCalled();
  });

  test('이미 예약했으면(nextSessionJoined) 버튼 대신 예약 상태와 참여 취소가 선다', async () => {
    await renderCard({ ...restingOver(), nextSessionJoined: true });

    expect(screen.queryByTestId(`group.bet.joinNext.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.getByText('참여 중')).toBeOnTheScreen();
    // 버튼 문구는 「참여 취소」다(N27) — 그냥 '취소'는 시트 닫기와 헷갈린다.
    expect(screen.getByTestId(`group.bet.leaveNext.${CHALLENGE_ID}`)).toHaveTextContent(
      '참여 취소',
    );
  });

  test('참여 취소 — 내 OPEN 목록에서 (챌린지, 날짜)로 찾아 날짜 단위로 취소한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetMyOpenBetSessions.mockResolvedValue([
      {
        sessionId: 's-reserved',
        groupId: GROUP_ID,
        challengeId: CHALLENGE_ID,
        sessionDate: '2026-08-03',
        missionCategory: 'FOCUS',
        missionType: 'DURATION',
        goalMinutes: 60,
        windowStart: null,
        windowEnd: null,
        closesAt: '2026-08-03T14:59:59Z',
        settleAfter: '2026-08-03T15:00:00Z',
      },
    ]);
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge({ ...restingOver(), nextSessionJoined: true })}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leaveNext.${CHALLENGE_ID}`));
    });
    const calls = alertSpy.mock.calls;
    const buttons = calls[calls.length - 1][2] as AlertButton[] | undefined;
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    expect(mockLeaveSession).toHaveBeenCalledWith(GROUP_ID, 's-reserved');
    expect(mockRefreshCoins).toHaveBeenCalled();
    expect(onBetChanged).toHaveBeenCalled();
  });

  // 예약 취소도 같은 규칙(#570 codex ③) — 목록에서 사라졌거나 404면 종결 상태로 처리한다.
  test('예약이 이미 사라졌으면 종결 상태로 알리고 카드를 갱신한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetMyOpenBetSessions.mockResolvedValue([]); // 내 OPEN 목록에 없다
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge({ ...restingOver(), nextSessionJoined: true })}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leaveNext.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as
      | AlertButton[]
      | undefined;
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    expect(mockLeaveSession).not.toHaveBeenCalled();
    // 조치가 없는 종결 통보라 토스트다(GROMO-1491 / D19) — Alert는 확인 1회뿐.
    // tone 없음(중립 배너)까지 잠근다 — 이미 원하던 상태라 danger를 쓰지 않는다
    // (오너 결정 2026-08-11). tone:'error'가 붙으면 이 단언이 깨진다.
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '이미 정리된 예약이에요 — 최신 상태로 새로고침할게요',
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onBetChanged).toHaveBeenCalled();
  });

  // ── 이관 지점 고정 (GROMO-1491 / codex 리뷰) ────────────────────────────────
  // 위 테스트들은 "API 호출 전 target 없음" 경로만 덮는다. 서버가 실제로 거절하는 네 코드는
  // 통보 채널(토스트 ↔ Alert)도, 부수효과(onBetChanged 호출 여부)도 고정돼 있지 않았다.
  // 그래서 토스트가 Alert로 되돌아가거나 재조회가 빠져도 스위트가 통과했다.
  //
  // ⚠️ 분기마다 부수효과가 **다르다** — 이게 이 표의 핵심이다.
  //    종결 상태(이미 정리됨/이미 취소됨/이미 닫힘)는 재조회를 태워 버튼을 걷어내야 하고,
  //    LEAVE_CLOSED 는 "시간이 지났다"는 사실만 알리고 화면은 자연 재조회에 맡긴다.
  describe.each([
    [
      'BET_SESSION_NOT_FOUND',
      '이미 정리된 예약이에요 — 최신 상태로 새로고침할게요',
      undefined,
      true,
    ],
    ['BET_LEAVE_CLOSED', '취소할 수 있는 시간이 지나 참여 취소를 못 했어요', 'error', false],
    ['BET_NOT_JOINED', '이미 취소된 참여예요 — 최신 상태로 새로고침할게요', undefined, true],
    ['BET_NOT_OPEN', '이미 정산됐거나 닫힌 날이라 참여 취소를 못 했어요', 'error', true],
  ])('예약 취소 거절 — %s', (code, message, tone, refetches) => {
    test(`토스트로 알리고(tone=${tone ?? '없음'}) 재조회는 ${refetches ? '태운다' : '안 태운다'}`, async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockGetMyOpenBetSessions.mockResolvedValue([
        {
          sessionId: 's-reserved',
          groupId: GROUP_ID,
          challengeId: CHALLENGE_ID,
          sessionDate: '2026-08-03',
          missionCategory: 'FOCUS',
          missionType: 'DURATION',
          goalMinutes: 60,
          windowStart: null,
          windowEnd: null,
          closesAt: '2026-08-03T14:59:59Z',
          settleAfter: '2026-08-03T15:00:00Z',
        },
      ]);
      mockLeaveSession.mockRejectedValueOnce(axiosErrorWith(409, code));
      const onBetChanged = jest.fn();
      await render(
        <ChallengeCard
          challenge={challenge({ ...restingOver(), nextSessionJoined: true })}
          isOwner={false}
          onDelete={onDelete}
          onOpenBet={onOpenBet}
          onBetChanged={onBetChanged}
        />,
      );

      await act(async () => {
        fireEvent.press(screen.getByTestId(`group.bet.leaveNext.${CHALLENGE_ID}`));
      });
      const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as
        | AlertButton[]
        | undefined;
      await act(async () => {
        buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
      });

      expect(mockLeaveSession).toHaveBeenCalledWith(GROUP_ID, 's-reserved');
      // 통보는 토스트다 — tone 유무까지 잠근다(중립 배너 ↔ error 가 바뀌면 깨진다).
      expect(mockToastShow).toHaveBeenCalledWith(
        tone === undefined ? { message } : { message, tone },
      );
      // Alert 는 **확인 1회뿐**이어야 한다. 통보가 Alert 로 되돌아가면 2회가 되어 깨진다.
      expect(alertSpy).toHaveBeenCalledTimes(1);
      if (refetches) {
        expect(onBetChanged).toHaveBeenCalled();
      } else {
        expect(onBetChanged).not.toHaveBeenCalled();
      }
    });
  });

  test('구서버(bet.session 필드 없음)에는 버튼이 서지 않는다 — 종전 렌더 유지', async () => {
    await renderCard({
      repeatDays: ['MON', 'WED', 'FRI'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      bet: bet(), // session 필드 자체가 없다
    });
    expect(screen.queryByTestId(`group.bet.joinNext.${CHALLENGE_ID}`)).toBeNull();
  });

  // 자정 드리프트(#570 codex ③) — 요청이 나가 있는 사이 서버가 다음 활성일을 새로 계산하면
  // 화면과 다른 날짜에 참가비가 걸린다. 참가는 이미 성립했으므로 성공 처리하되 **침묵하지 않는다**.
  test('응답 날짜가 화면과 다르면 실제 예약된 날짜를 명시로 알린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockJoinNextSession.mockResolvedValue({
      sessionId: 's-drift',
      sessionDate: '2026-08-05', // 화면은 8/3(월)을 보여줬다
      stake: 30,
    });
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge(restingOver())}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.joinNext.${CHALLENGE_ID}`));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.joinNext.submit'));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      '예약된 날짜가 바뀌었어요',
      expect.stringContaining('8/5(수)로 예약됐어요'),
    );
    // 성공은 성공대로 — 재조회를 태워 카드가 실제 예약 상태로 갈아 끼워진다.
    expect(onBetChanged).toHaveBeenCalled();
  });

  test('날짜가 같으면 드리프트 안내가 없다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderCard(restingOver());
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.joinNext.${CHALLENGE_ID}`));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.joinNext.submit'));
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

// ── v2 응답의 내기 꺼짐(#570 codex ①) — bet=null은 "생성 시 껐다 = 불변"(N26)이다 ──
describe('v2 내기 꺼짐 (N26)', () => {
  test('v2 응답(repeatDays 존재)의 bet=null에는 내기 걸기 진입점을 세우지 않는다', async () => {
    await renderCard({
      repeatDays: ['MON', 'WED', 'FRI'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      bet: null,
    });
    // 레거시 개설 버튼도, 내기 영역 자체도 없다(ux §05 분기 0 — 영역 자체가 없다).
    expect(screen.queryByTestId(`group.bet.create.${CHALLENGE_ID}`)).toBeNull();
  });

  test('구서버(repeatDays 없음)의 bet=null에는 종전 개설 진입점이 그대로 선다', async () => {
    await renderCard({ bet: null });
    expect(screen.getByTestId(`group.bet.create.${CHALLENGE_ID}`)).toBeOnTheScreen();
  });

  // #572/B8 betConfig — "설정은 켜졌는데 오늘 회차만 없는 날"(마지막 참가자 취소·lazy 개설 전).
  // bet=null만 보고 접으면 **참여할 수 없는 챌린지**가 된다.
  test('betConfig.enabled=true · bet=null이면 예약 진입점을 세운다(오늘 참가 버튼은 없다)', async () => {
    await renderCard({
      repeatDays: ['MON', 'WED', 'FRI'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      bet: null,
      betConfig: { enabled: true, stake: 50 },
    });

    expect(screen.getByTestId(`group.bet.joinNext.${CHALLENGE_ID}`)).toHaveTextContent(
      '8/3(월) 참여하기',
    );
    // 참가비는 회차가 없어도 설정에서 읽는다.
    expect(screen.getByText('50코인')).toBeOnTheScreen();
    // 오늘 회차가 없으니 오늘 참가 행도, 레거시 개설 버튼도 없다.
    expect(screen.queryByTestId(`group.bet.join.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.queryByTestId(`group.bet.create.${CHALLENGE_ID}`)).toBeNull();
  });

  // #570 codex ① — 버튼만 서고 시트가 안 뜨면 "무반응 버튼"이다. 회차 없는 날이 바로 이
  // 시트가 필요한 날이라, 마운트 조건이 bet에 매여 있으면 기능 전체가 죽는다.
  test('bet=null이어도 예약 시트가 실제로 열리고 예약까지 간다', async () => {
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge({
          repeatDays: ['MON', 'WED', 'FRI'],
          activeToday: false,
          nextSessionAt: NEXT_MON_AT,
          bet: null,
          betConfig: { enabled: true, stake: 50 },
        })}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.joinNext.${CHALLENGE_ID}`));
    });

    // 시트가 실제로 떴고, 참가비는 betConfig에서 온다.
    expect(screen.getByTestId('group.bet.joinNext.submit')).toHaveTextContent('8/3(월) 참여하기');
    expect(screen.getByTestId('group.bet.balanceRow')).toHaveTextContent(/참가비 50 · 내 잔액/);

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.joinNext.submit'));
    });
    expect(mockJoinNextSession).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID);
    expect(onBetChanged).toHaveBeenCalled();
  });

  test('bet=null이어도 주간 예약 시트가 열리고 합계에 설정 참가비를 쓴다', async () => {
    // 화요일(8/4)로 옮겨 남은 활성일을 2개(수·금) 만든다 — 토요일 기준으로는 이번 주에 남는
    // 날이 하루뿐이라(주는 월~일) 버튼 노출 규칙(≥2)에 걸려 이 경로를 못 밟는다.
    mockTodayStrKst.mockReturnValue('2026-08-04');
    await renderCard({
      repeatDays: ['WED', 'FRI'],
      activeToday: false,
      nextSessionAt: '2026-08-04T15:00:00Z', // 8/5(수) 자정 시작
      bet: null, // 오늘 회차가 없다(비활성 요일)
      betConfig: { enabled: true, stake: 50 },
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });

    expect(screen.getByTestId('group.bet.week.total')).toHaveTextContent(
      '2일 × 50코인 = 합계 100코인',
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.week.submit'));
    });
    expect(mockJoinWeekSessions).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, [
      '2026-08-05',
      '2026-08-07',
    ]);
  });

  // #572/B8 nextSessionStake — 회차는 개설 시점 stake를 **박제**한다. 설정이 낮아졌거나
  // 브리지 기간에 구앱이 다른 stake로 열었으면 설정값과 갈리고, 그때 차감되는 건 박제값이다.
  // 안내 금액과 차감 금액이 어긋나면 사용자가 안내보다 더 잃는다 — 표시·판정 축을 박제값에 맞춘다.
  test('다음 회차에 박제된 참가비가 있으면 카드·시트가 그 금액으로 안내한다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          repeatDays: ['MON', 'WED', 'FRI'],
          activeToday: false,
          nextSessionAt: NEXT_MON_AT,
          bet: null,
          betConfig: { enabled: true, stake: 30 }, // 지금 설정값
          nextSessionStake: 100, // 이미 열린 다음 회차의 박제값 — 실제 차감액
        })}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );

    // 카드 칩도 박제값으로 — 여기서 30을 적으면 시트에서 금액이 뒤바뀐 것처럼 읽힌다.
    expect(screen.getByText('100코인')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.joinNext.${CHALLENGE_ID}`));
    });
    // 시트의 표시·잔액 판정 축(stake prop)도 같은 값이다.
    expect(screen.getByTestId('group.bet.balanceRow')).toHaveTextContent(/참가비 100 · 내 잔액/);
  });

  test('nextSessionStake가 null이면 설정값으로 폴백한다 — 회차 미개설이라 설정값이 박제된다', async () => {
    await renderCard({
      repeatDays: ['MON', 'WED', 'FRI'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      bet: null,
      betConfig: { enabled: true, stake: 30 },
      nextSessionStake: null,
    });
    expect(screen.getByText('30코인')).toBeOnTheScreen();
  });

  test('betConfig.enabled=false면 v2 규칙대로 내기 영역 자체가 없다', async () => {
    await renderCard({
      repeatDays: ['MON', 'WED', 'FRI'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      bet: null,
      betConfig: { enabled: false, stake: 50 },
    });
    expect(screen.queryByTestId(`group.bet.joinNext.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.queryByTestId(`group.bet.create.${CHALLENGE_ID}`)).toBeNull();
  });
});

// ── 오늘 참가 마감 경과(#570 codex ③) · 권한 없는 예약 진입점(#570 codex ④) ──────────
describe('오늘 참가 마감·권한 가드', () => {
  // 창형 09:00~12:00, 오늘(8/1 토)이 활성일. 회차는 정산 전까지 OPEN이지만 참가 마감은 창 시작이다.
  const closedTodaySession = (over: Partial<GroupBetSession> = {}): GroupBetSession => ({
    sessionId: 's-closed',
    sessionDate: '2026-08-01',
    stake: 30,
    goalMinutes: 90,
    pot: 60,
    status: 'OPEN',
    startsAt: '2026-08-01T00:00:00Z', // KST 09:00 — 지금(KST 10:00)은 창 안이다
    joinClosesAt: '2026-08-01T00:00:00Z',
    myLeaveDeadlineAt: null,
    closesAt: '2026-08-01T03:00:00Z',
    myJoined: false,
    myAchievedNow: false,
    participants: [],
    ...over,
  });
  const windowOver = (
    over: Partial<GroupChallengeResponse> = {},
    sessionOver: Partial<GroupBetSession> = {},
  ): Partial<GroupChallengeResponse> => ({
    missionType: 'TIME_WINDOW',
    windowStart: '09:00:00',
    windowEnd: '12:00:00',
    repeatDays: ['SAT', 'MON'],
    activeToday: true,
    nextSessionAt: NEXT_MON_AT,
    bet: bet({ enabled: true, session: closedTodaySession(sessionOver) }),
    ...over,
  });

  test('참가 마감이 지났으면 오늘 참가 버튼 대신 다음 활성일 예약으로 전환한다', async () => {
    await renderCard(windowOver());

    // 누르면 항상 실패하는 「참가하기」가 서면 안 된다(BET_SESSION_CLOSED).
    expect(screen.queryByTestId(`group.bet.join.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.getByTestId(`group.bet.joinNext.${CHALLENGE_ID}`)).toHaveTextContent(
      '8/3(월) 참여하기',
    );
  });

  test('마감이 지나도 이미 참가 중이면 참여 중 행이 우선이다', async () => {
    // 브리지는 레거시 4필드를 **오늘 회차 기준으로 병기**한다(N36) — 픽스처도 두 축을 맞춘다.
    await renderCard({
      ...windowOver({}, { myJoined: true }),
      bet: bet({ enabled: true, myJoined: true, session: closedTodaySession({ myJoined: true }) }),
    });
    expect(screen.queryByTestId(`group.bet.joinNext.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.getByText('참여 중')).toBeOnTheScreen();
  });

  test('마감 전이면 종전대로 오늘 참가 행이 선다', async () => {
    await renderCard(
      windowOver({}, { joinClosesAt: '2026-08-01T05:00:00Z' }), // KST 14:00 — 아직 열려 있다
    );
    expect(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.joinNext.${CHALLENGE_ID}`)).toBeNull();
  });

  test('canParticipate=false면 예약 진입점(단건·주간)을 세우지 않는다 — 서버가 N50으로 거절한다', async () => {
    await renderCard(windowOver({ canParticipate: false, missionCategory: 'SCREEN_TIME' }));

    expect(screen.getByText('스크린타임 권한이 없어 참여할 수 없어요')).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.joinNext.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.queryByTestId(`group.bet.week.${CHALLENGE_ID}`)).toBeNull();
  });
});

// ── 브리지 철거 후의 정식 v2 응답(#570 codex ②) ────────────────────────────────
// 서버가 최상위 레거시 필드(status·myJoined·participants)를 빼고 회차만 내리는 형태.
// 분기를 레거시 축에 걸어 두면 **참여 가능한 회차가 정보 행으로 떨어지고**, 참여자는
// 참여 중 표시·당일 취소를 통째로 잃는다 — 조용히 깨지는 종류라 지금 잠근다.
describe('정식 v2 응답 (레거시 필드 없음)', () => {
  // 레거시 4필드가 빠진 응답 — 타입은 브리지 계약이라 아직 필수라서 캐스팅으로 재현한다.
  function v2Bet(session: GroupBetSession): GroupChallengeBet {
    return { betId: 'b1', stake: session.stake, enabled: true, session } as GroupChallengeBet;
  }
  const openSession = (over: Partial<GroupBetSession> = {}): GroupBetSession => ({
    sessionId: 's-today',
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
      { userId: 'u2', nickname: '수빈' },
      { userId: 'u3', nickname: '민지' },
    ],
    ...over,
  });
  const v2Over = (sessionOver: Partial<GroupBetSession> = {}): Partial<GroupChallengeResponse> => ({
    repeatDays: ['SAT'],
    activeToday: true,
    nextSessionAt: NEXT_MON_AT,
    betConfig: { enabled: true, stake: 30 },
    bet: v2Bet(openSession(sessionOver)),
  });

  test('미참가·OPEN이면 참가 진입점이 선다 — 정보 행으로 떨어지지 않는다', async () => {
    await renderCard(v2Over());
    expect(screen.getByTestId(`group.bet.join.${CHALLENGE_ID}`)).toHaveTextContent(
      /참가비 30 · 2명 참여 중 — 참가하기/,
    );
  });

  test('참여 중이면 참여 중 표시와 당일 취소가 회차 값으로 선다', async () => {
    await renderCard(
      v2Over({
        myJoined: true,
        participants: [{ userId: 'u1', nickname: '재영' }],
        pot: 30,
        myLeaveDeadlineAt: '2026-08-01T01:03:00Z', // 지금(01:00Z)+3분
      }),
    );

    expect(screen.getByText('참여 중')).toBeOnTheScreen();
    expect(screen.getByText('🪙 참가비 30 · 적립금 30 · 1명 참여')).toBeOnTheScreen();
    expect(screen.getByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`)).toBeOnTheScreen();
  });
});

// ── 오늘 회차 참여 취소(#570 codex ② — N22·N27) ────────────────────────────────
// 하루형 당일 참가자에게는 이 버튼이 **유일한 환불 창**이다: 회차 시작이 자정이라 레거시
// '시작 전' 판정은 영영 false다. 마감 판정 근거는 서버 myLeaveDeadlineAt 하나뿐이다.
describe('오늘 참여 취소 (N22)', () => {
  const joinedDaySession = (over: Partial<GroupBetSession> = {}): GroupBetSession => ({
    sessionId: 's-today',
    sessionDate: '2026-08-01',
    stake: 30,
    goalMinutes: 60,
    pot: 60,
    status: 'OPEN',
    startsAt: '2026-07-31T15:00:00Z', // 하루형 — 자정 시작(이미 지났다)
    joinClosesAt: '2026-08-01T14:59:59Z',
    // 지금(01:00Z)으로부터 3분 뒤 — 참가 후 5분 유예의 잔여분(N22).
    myLeaveDeadlineAt: '2026-08-01T01:03:00Z',
    closesAt: '2026-08-01T14:59:59Z',
    myJoined: true,
    myAchievedNow: false,
    participants: [{ userId: 'u1', nickname: '재영' }],
    ...over,
  });
  const joinedOver = (
    sessionOver: Partial<GroupBetSession> = {},
  ): Partial<GroupChallengeResponse> => ({
    repeatDays: ['SAT'],
    activeToday: true,
    nextSessionAt: NEXT_MON_AT,
    bet: bet({ enabled: true, myJoined: true, session: joinedDaySession(sessionOver) }),
  });

  // #570 codex ① — join-week로 미래를 예약한 뒤 오늘도 참여 중이면 카드는 오늘 행을 그린다.
  // 미래 예약 취소를 그 분기에 묶어 두면 **이미 낸 돈을 무를 자리가 화면에서 사라진다**.
  test('오늘도 참여 중이면서 미래를 예약해 뒀으면 두 취소 동선이 모두 뜬다', async () => {
    await renderCard({ ...joinedOver(), nextSessionJoined: true });

    expect(screen.getByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`group.bet.leaveNext.${CHALLENGE_ID}`)).toHaveTextContent(
      '참여 취소',
    );
    // 예약 상태 행은 날짜와 금액을 함께 말한다(무엇을 취소하는지가 버튼 옆에 있어야 한다).
    expect(screen.getByLabelText('8/3(월) 참여 취소')).toBeOnTheScreen();
  });

  test('예약이 없으면 미래 취소 행도 없다', async () => {
    await renderCard(joinedOver());
    expect(screen.queryByTestId(`group.bet.leaveNext.${CHALLENGE_ID}`)).toBeNull();
  });

  // #570 codex ④ — 다른 기기에서 이미 취소했으면 취소할 대상이 없다(404와 같은 사실).
  test('BET_NOT_JOINED는 종결 상태로 알리고 재조회를 태운다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLeaveSession.mockRejectedValueOnce(axiosErrorWith(409, 'BET_NOT_JOINED'));
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge(joinedOver())}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as
      | AlertButton[]
      | undefined;
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    // 조치가 없는 종결 통보라 토스트다(GROMO-1491 / D19) — Alert는 확인 1회뿐.
    // tone 없음(중립 배너)까지 잠근다 — 이미 원하던 상태라 danger를 쓰지 않는다
    // (오너 결정 2026-08-11).
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '이미 취소된 참여예요 — 최신 상태로 새로고침할게요',
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onBetChanged).toHaveBeenCalled();
  });

  // #570 리뷰 — BET_NOT_OPEN도 종결 상태다. 재조회를 안 태우면 이미 정산된 회차에
  // 「참여 취소」 버튼이 계속 떠서 같은 실패를 반복해 누르게 된다.
  test('BET_NOT_OPEN도 종결 상태로 알리고 재조회를 태운다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLeaveSession.mockRejectedValueOnce(axiosErrorWith(409, 'BET_NOT_OPEN'));
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge(joinedOver())}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as
      | AlertButton[]
      | undefined;
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    expect(mockToastShow).toHaveBeenCalledWith({
      message: '이미 정산됐거나 닫힌 날이라 참여 취소를 못 했어요',
      tone: 'error',
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onBetChanged).toHaveBeenCalled();
  });

  test('유예가 남아 있으면 「참여 취소」와 남은 시간이 뜬다', async () => {
    await renderCard(joinedOver());

    expect(screen.getByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`)).toHaveTextContent(
      '참여 취소',
    );
    expect(screen.getByTestId(`group.bet.leaveCountdown.${CHALLENGE_ID}`)).toHaveTextContent(
      '3분 0초 안에 취소할 수 있어요',
    );
    // 회차 축을 아는 응답에는 레거시 철회·취소 버튼을 세우지 않는다(배타).
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.queryByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeNull();
  });

  test('확인 후 회차 단위로 취소하고 잔액·카드를 다시 받는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge(joinedOver())}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as
      | AlertButton[]
      | undefined;
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    expect(mockLeaveSession).toHaveBeenCalledWith(GROUP_ID, 's-today');
    expect(mockRefreshCoins).toHaveBeenCalled();
    expect(onBetChanged).toHaveBeenCalled();
  });

  // #570 codex ⑤ — 예전엔 마감이 지나도 버튼이 활성으로 남아, 시간이 남아 보이는 버튼을 눌렀다가
  // 서버 BET_LEAVE_CLOSED로 거절당했다. 카운트다운이 마감에 닿는 순간 버튼도 함께 내려간다.
  test('마감이 지나면 초읽기와 버튼이 함께 사라진다(가짜 타이머)', async () => {
    // 가짜 타이머가 Date까지 가져간다(modern) — beforeEach의 Date.now 스파이 대신 이쪽이 시계다.
    jest.useFakeTimers({ now: Date.parse('2026-08-01T01:00:00Z') });
    try {
      // 지금(01:00:00Z)으로부터 2초 뒤 마감.
      await renderCard(joinedOver({ myLeaveDeadlineAt: '2026-08-01T01:00:02Z' }));

      expect(screen.getByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`)).toBeOnTheScreen();
      expect(screen.getByTestId(`group.bet.leaveCountdown.${CHALLENGE_ID}`)).toHaveTextContent(
        '2초 안에 취소할 수 있어요',
      );

      // 1초 경과 — 표시만 갱신된다.
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId(`group.bet.leaveCountdown.${CHALLENGE_ID}`)).toHaveTextContent(
        '1초 안에 취소할 수 있어요',
      );

      // 마감 도달 — 버튼과 초읽기가 함께 사라진다(부모 상태는 이때 한 번만 바뀐다).
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.queryByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`)).toBeNull();
      expect(screen.queryByTestId(`group.bet.leaveCountdown.${CHALLENGE_ID}`)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('마감이 몇 시간 뒤면 초읽기를 켜지 않는다 — 매초 타이머는 그 창에서만 돈다', async () => {
    await renderCard(joinedOver({ myLeaveDeadlineAt: '2026-08-01T09:00:00Z' })); // 8시간 뒤
    expect(screen.getByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.leaveCountdown.${CHALLENGE_ID}`)).toBeNull();
  });

  test('유예가 지났으면 버튼도 초읽기도 없다 — 서버 마감 시각이 유일한 근거다', async () => {
    await renderCard(joinedOver({ myLeaveDeadlineAt: '2026-08-01T00:59:00Z' })); // 이미 지남
    expect(screen.queryByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`)).toBeNull();
    expect(screen.queryByTestId(`group.bet.leaveCountdown.${CHALLENGE_ID}`)).toBeNull();
  });

  test('마감 시각이 없으면(미참여·구 응답) 버튼을 세우지 않는다', async () => {
    await renderCard(joinedOver({ myLeaveDeadlineAt: null }));
    expect(screen.queryByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`)).toBeNull();
  });

  test('실패는 code별 문구로 알리고 재조회를 태우지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLeaveSession.mockRejectedValueOnce(axiosErrorWith(409, 'BET_LEAVE_CLOSED'));
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge(joinedOver())}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as
      | AlertButton[]
      | undefined;
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    expect(mockToastShow).toHaveBeenCalledWith({
      message: '취소할 수 있는 시간이 지나 참여 취소를 못 했어요',
      tone: 'error',
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onBetChanged).not.toHaveBeenCalled();
  });

  // #570 codex ③ — 카드를 그린 뒤 회차가 삭제·정산되면 404다. 공통 문구로 떨어뜨리면
  // 취소할 대상이 없는데도 같은 실패를 반복하게 된다 — 종결 상태로 처리하고 카드를 갱신한다.
  test('회차가 사라졌으면(404) 종결 상태로 알리고 재조회를 태운다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLeaveSession.mockRejectedValueOnce(axiosErrorWith(404, 'BET_SESSION_NOT_FOUND'));
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge(joinedOver())}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leaveToday.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as
      | AlertButton[]
      | undefined;
    await act(async () => {
      buttons?.find((b) => b.text === '참여 취소')?.onPress?.();
    });

    // tone 없음(중립 배너)까지 잠근다 — 이미 원하던 상태라 danger를 쓰지 않는다
    // (오너 결정 2026-08-11).
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '이미 정리된 날이에요 — 최신 상태로 새로고침할게요',
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onBetChanged).toHaveBeenCalled();
  });
});

// ── v2 지난 결과 소비(#570 codex ①) — lastSettledSession 우선, 구서버는 lastSettledBet ──
describe('지난 결과 v2 (lastSettledSession)', () => {
  test('v2 필드가 있으면 그것으로 지난 결과 줄을 그린다', async () => {
    await renderCard({
      repeatDays: ['MON', 'WED', 'FRI'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      bet: null,
      betConfig: { enabled: true, stake: 30 },
      lastSettledSession: {
        sessionId: 's-past',
        sessionDate: '2026-07-31',
        stake: 30,
        pot: 90,
        status: 'SETTLED',
        goalMinutes: 60,
        myJoined: true,
        myAchieved: true,
        myPayout: 45,
        results: [
          { userId: 'u1', nickname: '재영', achieved: true, payout: 45 },
          { userId: 'u2', nickname: '수빈', achieved: false, payout: 0 },
        ],
      },
    });
    expect(screen.getByText('지난 내기(7월 31일): 2명 중 1명 달성')).toBeOnTheScreen();
  });

  test('v2 필드가 없으면 구서버 lastSettledBet로 폴백한다', async () => {
    await renderCard({ bet: bet(), lastSettledBet: lastSettledBet() });
    expect(screen.getByText('지난 내기(7월 31일): 3명 중 2명 달성')).toBeOnTheScreen();
  });

  // #570 codex ④ — 무산·삭제 환불은 **판정을 한 적이 없다**. "달성한 사람이 없어"라고 적으면
  // 하지도 않은 판정의 결과를 말하는 거짓이 된다.
  test('무산(VOIDED) 회차는 시트에서 사유별 문장으로 말한다 — 판정 결과를 지어내지 않는다', async () => {
    await renderCard({
      repeatDays: ['MON'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      bet: null,
      betConfig: { enabled: true, stake: 30 },
      lastSettledSession: {
        sessionId: 's-void',
        sessionDate: '2026-07-31',
        stake: 30,
        pot: 30,
        status: 'VOIDED',
        voidReason: 'SHORT_PARTICIPANTS',
        goalMinutes: 60,
        myJoined: true,
        myAchieved: null,
        myPayout: 30,
        results: [{ userId: 'u1', nickname: '재영', achieved: null, payout: 30 }],
      },
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });

    expect(screen.getByText('참가자가 부족해 무산됐어요. 참가비는 돌려드렸어요')).toBeOnTheScreen();
    expect(screen.queryByText('달성한 사람이 없어 전원 환불됐어요')).toBeNull();
  });

  // #570 codex ① — 시트를 열기 전에 카드 한 줄이 먼저 읽힌다. 여기서 「1명 중 0명 달성」이면
  // 판정한 적 없는 회차를 판정 결과로 말하는 것이라 시트만 고쳐서는 해결되지 않는다.
  test('무산 회차의 카드 요약도 달성 집계 대신 사유로 말한다', async () => {
    await renderCard({
      repeatDays: ['MON'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      bet: null,
      betConfig: { enabled: true, stake: 30 },
      lastSettledSession: {
        sessionId: 's-void',
        sessionDate: '2026-07-31',
        stake: 30,
        pot: 30,
        status: 'VOIDED',
        voidReason: 'INSUFFICIENT_PARTICIPANTS', // policy N33 표기 — LLD 표기와 함께 수용된다
        goalMinutes: 60,
        myJoined: true,
        myAchieved: null,
        myPayout: 30,
        results: [{ userId: 'u1', nickname: '재영', achieved: null, payout: 30 }],
      },
    });

    expect(screen.getByText('지난 내기(7월 31일): 참가자가 부족해 무산')).toBeOnTheScreen();
    expect(screen.queryByText(/명 달성/)).toBeNull();
  });

  test('삭제 무효화는 삭제 사유로 적는다', async () => {
    await renderCard({
      repeatDays: ['MON'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      bet: null,
      betConfig: { enabled: true, stake: 30 },
      lastSettledSession: {
        sessionId: 's-void2',
        sessionDate: '2026-07-31',
        stake: 30,
        pot: 60,
        status: 'VOIDED',
        voidReason: 'CHALLENGE_DELETED',
        results: [
          { userId: 'u1', nickname: '재영', achieved: null, payout: 30 },
          { userId: 'u2', nickname: '수빈', achieved: null, payout: 30 },
        ],
      },
    });
    expect(screen.getByText('지난 내기(7월 31일): 챌린지 삭제로 무효')).toBeOnTheScreen();
  });

  test('사유를 모르는 환불(구서버)은 종전 문장으로 폴백한다', async () => {
    await renderCard({ bet: bet(), lastSettledBet: lastSettledBet({ status: 'REFUNDED' }) });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });
    expect(screen.getByText('달성한 사람이 없어 전원 환불됐어요')).toBeOnTheScreen();
  });

  test('참가자 0명으로 닫힌 회차(UNUSED)는 지난 결과로 그리지 않는다(N52)', async () => {
    await renderCard({
      repeatDays: ['MON'],
      activeToday: false,
      nextSessionAt: NEXT_MON_AT,
      bet: null,
      betConfig: { enabled: true, stake: 30 },
      lastSettledSession: {
        sessionId: 's-unused',
        sessionDate: '2026-07-31',
        stake: 30,
        pot: 0,
        status: 'UNUSED',
        results: [],
      },
    });
    expect(screen.queryByText(/지난 내기/)).toBeNull();
  });
});

// ── 챌린지 v2 — 이번 주 남은 날 전부(GROMO-1276, N14·§C2) ──────────────────────
describe('이번 주 남은 날 전부 (GROMO-1276)', () => {
  // 오늘 8/1(토)·내일 8/2(일)이 활성 — 남은 참가 가능 날 2개(주는 월~일이라 8/3(월)은 다음 주다).
  const openSession = (over: Partial<GroupBetSession> = {}): GroupBetSession => ({
    sessionId: 's-today',
    sessionDate: '2026-08-01',
    stake: 30,
    goalMinutes: 60,
    pot: 0,
    status: 'OPEN',
    startsAt: '2026-07-31T15:00:00Z',
    joinClosesAt: '2026-08-01T14:59:59Z',
    myLeaveDeadlineAt: null,
    closesAt: '2026-08-01T14:59:59Z',
    myJoined: false,
    myAchievedNow: false,
    participants: [],
    ...over,
  });
  const weekendOver = (
    sessionOver: Partial<GroupBetSession> = {},
  ): Partial<GroupChallengeResponse> => ({
    repeatDays: ['SAT', 'SUN'],
    activeToday: true,
    nextSessionAt: '2026-08-01T15:00:00Z', // 8/2(일) 자정 시작
    bet: bet({ enabled: true, session: openSession(sessionOver), myJoined: false }),
  });

  test('남은 참가 가능 날이 2개 이상이면 버튼이 서고, 시트가 합계를 먼저 말한다', async () => {
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge(weekendOver())}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });

    // N일 × 참가비 = 총액이 지금 빠진다는 사실이 CTA 전에 읽힌다(N15).
    expect(screen.getByTestId('group.bet.week.total')).toHaveTextContent(
      '2일 × 30코인 = 합계 60코인',
    );
    // 잔액 표기는 N46 컴포넌트 재사용 — 합계 라벨(미상 잔액은 '—' — 형식만 잠근다).
    expect(screen.getByTestId('group.bet.balanceRow')).toHaveTextContent(/합계 60 · 내 잔액/);

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.week.submit'));
    });
    // 오늘 포함 이번 주 남은 활성일 전부를 **명시 지정**으로 보낸다(부분 예약 계약 — LLD §2.2).
    expect(mockJoinWeekSessions).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, [
      '2026-08-01',
      '2026-08-02',
    ]);
    expect(onBetChanged).toHaveBeenCalled();
  });

  // ── await 뒤에 여는 시트의 승인 게이트(GROMO-1576) ──────────────────────────
  // 이 시트는 탭과 마운트 사이에 예약 현황 조회가 끼어 있어서 **여는 시점을 응답이 정한다.**
  // 그 사이 루트의 챌린지 결과 모달이 slot을 얻어 노출까지 갈 수 있는데, 조정자는 보유자를
  // 뺏지 않으므로 그대로 마운트하면 RN Modal 두 개가 겹친다. 그러면 결과 모달이 **사실상 안
  // 보인 채** seen 마커와 ack이 나간다(둘 다 렌더 커밋 시점에 찍힌다 — 인지 시점이 아니다).
  test('승인을 받기 전에는 주간 시트를 마운트하지 않는다', async () => {
    let allow: (granted: boolean) => void = () => undefined;
    const onRequestSheetSlot = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          allow = resolve;
        }),
    );
    await render(
      <ChallengeCard
        challenge={challenge(weekendOver())}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onRequestSheetSlot={onRequestSheetSlot}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });

    // 조회는 끝났지만 승인 전이다 — 트리에 없다(가려진 것이 아니다).
    expect(onRequestSheetSlot).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId('group.bet.week.total', { includeHiddenElements: true }),
    ).toBeNull();

    // 승인이 떨어지면 그때 연다 — 사용자의 탭이 증발하지 않는다.
    await act(async () => {
      allow(true);
    });
    expect(screen.getByTestId('group.bet.week.total')).toBeOnTheScreen();
  });

  test('승인이 거절되면(화면을 떠났다) 주간 시트를 열지 않는다', async () => {
    const onRequestSheetSlot = jest.fn(async () => false);
    await render(
      <ChallengeCard
        challenge={challenge(weekendOver())}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onRequestSheetSlot={onRequestSheetSlot}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });

    expect(onRequestSheetSlot).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId('group.bet.week.total', { includeHiddenElements: true }),
    ).toBeNull();
  });

  // #570 codex ⑧ — 예약도 '참여를 결심한 한 번의 행동'이라 1건으로 세고, 규모는 파라미터로.
  test('주간 예약 성공은 참여 계측 1건 + 일수를 남긴다', async () => {
    await renderCard(weekendOver());
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.week.submit'));
    });

    expect(logGroupBetJoined).toHaveBeenCalledTimes(1);
    expect(logGroupBetJoined).toHaveBeenCalledWith({
      stake: 30, // 하루치 축(총액이 아니다 — 단건 참가와 같은 금액대 축을 유지한다)
      session_count: 2,
      mission_type: 'DURATION',
      mission_category: 'FOCUS',
    });
  });

  // #570 codex ② — 다음 활성일 회차가 이미 열려 있으면 그 날 몫도 박제값이다(오늘만이 아니다).
  test('다음 활성일 몫은 nextSessionStake로 계산한다', async () => {
    await renderCard({
      ...weekendOver({ stake: 100 }), // 오늘(8/1) 박제값
      betConfig: { enabled: true, stake: 30 },
      nextSessionAt: '2026-08-01T15:00:00Z', // 8/2(일) — 이미 열려 있다
      nextSessionStake: 70, // 그 회차의 박제값
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });

    // 100(오늘 박제) + 70(다음 회차 박제) = 170. 설정값(30)을 쓰면 130이 된다.
    expect(screen.getByTestId('group.bet.week.total')).toHaveTextContent('2일 · 합계 170코인');
    expect(screen.getByLabelText('8/2(일) 참가비 70코인')).toBeOnTheScreen();
  });

  // #570 리뷰 — 오늘 회차는 이미 열려 있어 **박제값**(bet.session.stake)이 나가고, 미래 날짜는
  // 예약 시점에 **설정값**(betConfig.stake)이 박제된다. 설정을 바꾼 직후엔 둘이 갈리므로
  // 합계를 단가 하나로 곱하면 화면이 안내한 금액과 실제 차감이 어긋난다.
  test('오늘이 포함되면 오늘 몫은 박제값, 미래 날짜는 설정값으로 합계를 낸다', async () => {
    await renderCard({
      ...weekendOver({ stake: 100 }), // 오늘 회차의 박제 참가비 100
      betConfig: { enabled: true, stake: 30 }, // 지금 설정값 30 — 미래 날짜에 박제될 값
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });

    // 100(오늘) + 30(8/2) = 130. 설정값 일괄이면 60, 박제값 일괄이면 200이 된다.
    expect(screen.getByTestId('group.bet.week.total')).toHaveTextContent('2일 · 합계 130코인');
    expect(screen.getByLabelText('8/1(토) 참가비 100코인')).toBeOnTheScreen();
    expect(screen.getByLabelText('8/2(일) 참가비 30코인')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.week.submit'));
    });
    expect(mockJoinWeekSessions).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, [
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  test('금액이 전부 같으면 종전 단가 표기를 유지한다', async () => {
    await renderCard({
      ...weekendOver({ stake: 30 }),
      betConfig: { enabled: true, stake: 30 },
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });
    expect(screen.getByTestId('group.bet.week.total')).toHaveTextContent(
      '2일 × 30코인 = 합계 60코인',
    );
  });

  test('오늘 회차에 이미 참가했으면 오늘을 빼고 — 남은 날 1개라 버튼 자체가 없다', async () => {
    await renderCard(weekendOver({ myJoined: true }));
    expect(screen.queryByTestId(`group.bet.week.${CHALLENGE_ID}`)).toBeNull();
  });

  test('구서버(bet.session 필드 없음)에는 버튼이 없다', async () => {
    await renderCard({
      repeatDays: ['SAT', 'SUN'],
      activeToday: true,
      bet: bet(),
    });
    expect(screen.queryByTestId(`group.bet.week.${CHALLENGE_ID}`)).toBeNull();
  });

  // 부분 예약을 여러 날 해 둔 경우(#570 codex ②) — nextSessionJoined는 가장 가까운 1건뿐이라
  // 카드 응답만으로는 나머지 예약일을 모른다. 시트를 **열 때** 내 OPEN 목록에서 예약일 전체를
  // 받아 뺀다 — 합계가 실제 나갈 돈보다 부풀면 안 된다(N15).
  test('이미 예약해 둔 날은 시트를 열 때 대상·합계에서 빠진다', async () => {
    mockGetMyOpenBetSessions.mockResolvedValue([
      {
        sessionId: 's-sun',
        groupId: GROUP_ID,
        challengeId: CHALLENGE_ID,
        sessionDate: '2026-08-02', // 일요일은 이미 예약했다
        missionCategory: 'FOCUS',
        missionType: 'DURATION',
        goalMinutes: 60,
        windowStart: null,
        windowEnd: null,
        closesAt: '2026-08-02T14:59:59Z',
        settleAfter: '2026-08-02T15:00:00Z',
      },
    ]);
    await renderCard(weekendOver());
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });

    expect(screen.getByTestId('group.bet.week.total')).toHaveTextContent(
      '1일 × 30코인 = 합계 30코인',
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.week.submit'));
    });
    expect(mockJoinWeekSessions).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, ['2026-08-01']);
  });

  test('남은 날을 전부 예약해 뒀으면 시트 대신 사실을 알리고 재조회를 태운다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetMyOpenBetSessions.mockResolvedValue(
      ['2026-08-01', '2026-08-02'].map((d, i) => ({
        sessionId: `s-${i}`,
        groupId: GROUP_ID,
        challengeId: CHALLENGE_ID,
        sessionDate: d,
        missionCategory: 'FOCUS' as const,
        missionType: 'DURATION' as const,
        goalMinutes: 60,
        windowStart: null,
        windowEnd: null,
        closesAt: `${d}T14:59:59Z`,
        settleAfter: `${d}T15:00:00Z`,
      })),
    );
    const onBetChanged = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge(weekendOver())}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onBetChanged={onBetChanged}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });

    // 이미 원하던 상태인 종결 통보라 확인 버튼 없는 토스트다(GROMO-1491 / D19). 단 **중립 배너**다 —
    // 아무것도 잘못되지 않았으므로 danger를 쓰지 않는다(오너 결정 2026-08-11). tone 없음을 잠근다.
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '이번 주 남은 날은 이미 모두 참여하고 있어요',
    });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('group.bet.week.submit')).toBeNull();
    expect(onBetChanged).toHaveBeenCalled();
  });

  test('예약 현황 조회가 실패하면 시트를 열지 않는다 — 부푼 합계로 돈을 받지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetMyOpenBetSessions.mockRejectedValue(axiosErrorWith(500));
    await renderCard(weekendOver());
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.week.${CHALLENGE_ID}`));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      '참여 정보를 확인하지 못했어요',
      '잠시 후 다시 시도해 주세요.',
    );
    expect(screen.queryByTestId('group.bet.week.submit')).toBeNull();
  });
});

// ── 챌린지 v2 — 진행 중 삭제 2단계 경고(GROMO-1425, N29·N49·FR-12-1) ────────────
// ── 시트 열림 보고(GROMO-1578) ──
// 카드가 여는 시트 4종은 전부 SheetShell asModal(RN 네이티브 Modal)이라, 부모(GroupRoomScreen)의
// 결과 모달과 겹치면 딤이 2겹으로 포개지고 표시 순서가 플랫폼 재량이 된다. 열림은 **카드 state**라
// 부모가 알 수 있는 통로는 이 콜백뿐이다 — 여기가 끊기면 부모의 배타 조건이 조용히 무력해진다.
describe('시트 열림 보고 (GROMO-1578)', () => {
  test('지난 결과 시트를 여닫으면 열림/닫힘을 그대로 올린다', async () => {
    const onSheetVisibilityChange = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge({ bet: null, lastSettledBet: lastSettledBet() })}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onSheetVisibilityChange={onSheetVisibilityChange}
      />,
    );
    // 마운트 직후엔 닫힘 보고 1회 — 부모의 집합에 이 카드가 들어가지 않는다.
    expect(onSheetVisibilityChange).toHaveBeenLastCalledWith(CHALLENGE_ID, false);

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });
    expect(onSheetVisibilityChange).toHaveBeenLastCalledWith(CHALLENGE_ID, true);

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.bet.result.close'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400)); // 퇴장 애니메이션(220ms)
    });
    expect(onSheetVisibilityChange).toHaveBeenLastCalledWith(CHALLENGE_ID, false);
  });

  // 이펙트만으로는 늦다(codex 사전 게이트 P2). 시트의 네이티브 Modal은 여는 커밋에 이미
  // 마운트되는데 열림 보고 이펙트는 그 커밋이 끝난 **뒤에** 돈다 — 그 사이에 부모의 결과 큐가
  // 채워지면(BET_RESULT 포그라운드 재조회, GROMO-1580) 두 Modal이 같은 프레임에 뜬다.
  // 그래서 여는 핸들러가 openSheet()로 먼저 보고한다. 그 호출이 빠지면 열림 보고가 이펙트 1회로
  // 줄어 아래 단언이 깨진다 — 이 테스트가 지키는 것은 "보고가 오는가"가 아니라 "언제 오는가"다.
  test('시트를 여는 이벤트에서 먼저 보고한다 — 이펙트를 기다리지 않는다', async () => {
    const onSheetVisibilityChange = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge({ bet: null, lastSettledBet: lastSettledBet() })}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onSheetVisibilityChange={onSheetVisibilityChange}
      />,
    );
    onSheetVisibilityChange.mockClear();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });

    const openReports = onSheetVisibilityChange.mock.calls.filter(([, open]) => open === true);
    expect(openReports.length).toBeGreaterThanOrEqual(2); // 핸들러 1 + 이펙트 1
  });

  test('다음 활성일 예약 시트도 같은 보고를 한다', async () => {
    const onSheetVisibilityChange = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge({
          repeatDays: ['MON', 'WED', 'FRI'],
          activeToday: false,
          nextSessionAt: NEXT_MON_AT,
          memberProgress: null,
          bet: bet({ enabled: true, session: null, myJoined: false, participants: [] }),
        })}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onSheetVisibilityChange={onSheetVisibilityChange}
      />,
    );
    expect(onSheetVisibilityChange).toHaveBeenLastCalledWith(CHALLENGE_ID, false);

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.joinNext.${CHALLENGE_ID}`));
    });
    expect(onSheetVisibilityChange).toHaveBeenLastCalledWith(CHALLENGE_ID, true);
  });

  test('삭제 경고 시트도 같은 보고를 한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockResolvedValue({
      openSessions: [{ sessionDate: '2026-08-01', participantCount: 3, pot: 90 }],
      totalRefund: 90,
    });
    const onSheetVisibilityChange = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge({
          repeatDays: ['MON', 'WED', 'FRI'],
          activeToday: false,
          nextSessionAt: NEXT_MON_AT,
        })}
        isOwner
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onSheetVisibilityChange={onSheetVisibilityChange}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.challenge.delete.${CHALLENGE_ID}`));
    });
    const calls = alertSpy.mock.calls;
    await act(async () => {
      (calls[calls.length - 1][2] as AlertButton[] | undefined)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });

    expect(screen.getByTestId('group.challenge.delete.confirm')).toBeOnTheScreen();
    expect(onSheetVisibilityChange).toHaveBeenLastCalledWith(CHALLENGE_ID, true);
  });

  // 시트를 문 채 카드가 사라지면(재조회로 챌린지가 목록에서 빠짐) 부모의 열림 집합에 이 카드가
  // 영영 남아 결과 모달이 다시는 뜨지 않는다 — 언마운트에서 반드시 닫힘을 보고해야 한다.
  test('시트가 열린 채 언마운트되면 닫힘을 보고한다', async () => {
    const onSheetVisibilityChange = jest.fn();
    const { unmount } = await render(
      <ChallengeCard
        challenge={challenge({ bet: null, lastSettledBet: lastSettledBet() })}
        isOwner={false}
        onDelete={onDelete}
        onOpenBet={onOpenBet}
        onSheetVisibilityChange={onSheetVisibilityChange}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.last.${CHALLENGE_ID}`));
    });
    expect(onSheetVisibilityChange).toHaveBeenLastCalledWith(CHALLENGE_ID, true);

    await act(async () => {
      unmount();
    });
    expect(onSheetVisibilityChange).toHaveBeenLastCalledWith(CHALLENGE_ID, false);
  });
});

describe('진행 중 삭제 2단계 (GROMO-1425)', () => {
  const v2Over: Partial<GroupChallengeResponse> = {
    repeatDays: ['MON', 'WED', 'FRI'],
    activeToday: false,
    nextSessionAt: NEXT_MON_AT,
  };

  async function renderOwner(over: Partial<GroupChallengeResponse> = {}) {
    return render(
      <ChallengeCard
        challenge={challenge({ ...v2Over, ...over })}
        isOwner
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );
  }

  async function pressDeleteX() {
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.challenge.delete.${CHALLENGE_ID}`));
    });
  }

  function lastAlertButtons(alertSpy: jest.SpyInstance): AlertButton[] | undefined {
    const calls = alertSpy.mock.calls;
    return calls[calls.length - 1][2] as AlertButton[] | undefined;
  }

  test('참가비가 걸린 날이 없으면 기존 1단계 확인으로 끝난다 — 안 위험할 때 두 번 묻지 않는다(N29)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockResolvedValue({ openSessions: [], totalRefund: 0 });
    await renderOwner();
    await pressDeleteX();

    expect(mockGetDeletionPreview).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID);
    expect(alertSpy).toHaveBeenCalledWith(
      '챌린지 삭제',
      '이 챌린지를 삭제할까요?',
      expect.anything(),
    );
    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });
    expect(onDelete).toHaveBeenCalledWith(CHALLENGE_ID);
    expect(screen.queryByTestId('group.challenge.delete.confirm')).toBeNull();
  });

  test('참가비가 걸린 날이 있으면 1단계 뒤 수치 경고 시트를 거쳐야 삭제된다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockResolvedValue({
      openSessions: [
        { sessionDate: '2026-08-01', participantCount: 3, pot: 90 },
        { sessionDate: '2026-08-03', participantCount: 2, pot: 60 },
      ],
      totalRefund: 150,
    });
    await renderOwner();
    await pressDeleteX();

    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });
    // 1단계만으로는 삭제되지 않는다 — 2단계 시트가 수치를 들고 선다.
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('지금 진행 중인 챌린지예요')).toBeOnTheScreen();
    expect(screen.getByText('8/1(토)')).toBeOnTheScreen();
    expect(screen.getByText('3명 · 90코인')).toBeOnTheScreen();
    expect(screen.getByText(/적립금 150코인이 전원에게 돌아가요/)).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.confirm'));
    });
    expect(onDelete).toHaveBeenCalledWith(CHALLENGE_ID);
    // 삭제는 OPEN 회차를 무효화하고 전원 환불한다(FR-12) — 그룹장 자신이 참가했으면 지갑이
    // 늘어나는데, 삭제된 챌린지는 재조회 응답에서 사라져 정산 감지가 변화를 못 잡는다(#570 ③).
    expect(mockRefreshCoins).toHaveBeenCalled();
  });

  // #570 codex ③ — 환불은 서버 삭제가 끝나야 반영된다. 호출 전에 잔액을 받으면 환불 전 값이다.
  test('잔액 갱신은 삭제 완료를 기다린 뒤에 돈다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockResolvedValue({
      openSessions: [{ sessionDate: '2026-08-01', participantCount: 3, pot: 90 }],
      totalRefund: 90,
    });
    let finishDelete: () => void = () => {};
    const slowDelete = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve;
        }),
    );
    await render(
      <ChallengeCard
        challenge={challenge(v2Over)}
        isOwner
        onDelete={slowDelete}
        onOpenBet={onOpenBet}
      />,
    );
    await pressDeleteX();
    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.confirm'));
    });

    // 서버 삭제가 아직 안 끝났다 — 이 시점의 잔액 조회는 환불 전 값이라 의미가 없다.
    expect(slowDelete).toHaveBeenCalledWith(CHALLENGE_ID);
    expect(mockRefreshCoins).not.toHaveBeenCalled();

    await act(async () => {
      finishDelete();
    });
    expect(mockRefreshCoins).toHaveBeenCalled();
  });

  // #570 codex ① — 최종 확정이 프리뷰 재조회를 기다리는 동안 사용자가 시트를 닫을 수 있다.
  // 그 뒤 도착한 응답이 삭제를 실행하면 **명시적으로 그만둔 뒤에 챌린지가 사라진다**.
  test('검증 대기 중 시트를 닫으면 뒤늦게 도착한 응답으로 삭제하지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const shown = {
      openSessions: [{ sessionDate: '2026-08-01', participantCount: 3, pot: 90 }],
      totalRefund: 90,
    };
    mockGetDeletionPreview.mockResolvedValueOnce(shown);
    await renderOwner();
    await pressDeleteX();
    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });

    // 재검증 응답을 붙잡아 둔다 — 아직 도착하지 않은 상태를 만든다.
    let resolvePreview: (v: typeof shown) => void = () => {};
    mockGetDeletionPreview.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.confirm'));
    });
    // 사용자가 그만두기로 시트를 닫는다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.dismiss'));
    });
    expect(screen.queryByText('지금 진행 중인 챌린지예요')).toBeNull();

    // 이제 검증 응답이 도착한다 — 수치가 **같아도** 삭제가 나가면 안 된다.
    await act(async () => {
      resolvePreview(shown);
    });
    expect(onDelete).not.toHaveBeenCalled();
    expect(mockRefreshCoins).not.toHaveBeenCalled();
  });

  // #570 codex ⑨ — 프리뷰를 받은 뒤 Alert·시트를 거치는 동안 누가 더 참가할 수 있다.
  // 낡은 수치로 확정하면 경고가 거짓이 된 상태로 돈이 움직인다.
  test('확정 직전 영향 범위가 달라졌으면 삭제하지 않고 새 수치를 보여준다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockResolvedValueOnce({
      openSessions: [{ sessionDate: '2026-08-01', participantCount: 3, pot: 90 }],
      totalRefund: 90,
    });
    await renderOwner();
    await pressDeleteX();
    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });
    expect(screen.getByText('3명 · 90코인')).toBeOnTheScreen();

    // 그 사이 한 명이 더 참가했다.
    mockGetDeletionPreview.mockResolvedValue({
      openSessions: [{ sessionDate: '2026-08-01', participantCount: 4, pot: 120 }],
      totalRefund: 120,
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.confirm'));
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      '걸린 돈이 바뀌었어요',
      '바뀐 내용을 확인하고 다시 눌러 주세요.',
    );
    // 시트는 새 수치로 갈아 끼워진 채 남는다 — 다시 누르면 그때 삭제된다.
    expect(screen.getByText('4명 · 120코인')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.confirm'));
    });
    expect(onDelete).toHaveBeenCalledWith(CHALLENGE_ID);
  });

  test('확정 직전 걸린 돈이 사라졌으면 경고 없이 바로 삭제한다(N29)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockResolvedValueOnce({
      openSessions: [{ sessionDate: '2026-08-01', participantCount: 3, pot: 90 }],
      totalRefund: 90,
    });
    await renderOwner();
    await pressDeleteX();
    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });

    mockGetDeletionPreview.mockResolvedValue({ openSessions: [], totalRefund: 0 });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.confirm'));
    });

    expect(onDelete).toHaveBeenCalledWith(CHALLENGE_ID);
    // 환불이 없으니 잔액을 다시 받지 않는다(불필요한 조회를 만들지 않는다).
    expect(mockRefreshCoins).not.toHaveBeenCalled();
  });

  // #570 codex ③ — 0건 프리뷰의 1단계 Alert가 떠 있는 동안 다른 멤버가 참가할 수 있다.
  // 그대로 삭제하면 **걸린 돈을 한 번도 안 보여준 채** 조건 없는 삭제가 나간다.
  test('0건이었어도 확정 시점에 참여가 생겼으면 수치 경고로 전환한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockResolvedValueOnce({ openSessions: [], totalRefund: 0 });
    await renderOwner();
    await pressDeleteX();

    // 확인 Alert가 떠 있는 사이 누군가 join-next로 들어왔다.
    mockGetDeletionPreview.mockResolvedValue({
      openSessions: [{ sessionDate: '2026-08-03', participantCount: 1, pot: 30 }],
      totalRefund: 30,
    });
    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      '걸린 돈이 생겼어요',
      '방금 참여한 사람이 있어요. 내용을 확인해 주세요.',
    );
    expect(screen.getByText('1명 · 30코인')).toBeOnTheScreen();
  });

  test('0건이 그대로면 종전처럼 1단계로 끝난다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockResolvedValue({ openSessions: [], totalRefund: 0 });
    await renderOwner();
    await pressDeleteX();
    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });

    expect(onDelete).toHaveBeenCalledWith(CHALLENGE_ID);
    expect(screen.queryByText('지금 진행 중인 챌린지예요')).toBeNull();
  });

  test('확정 직전 재조회가 실패하면 삭제하지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockResolvedValueOnce({
      openSessions: [{ sessionDate: '2026-08-01', participantCount: 3, pot: 90 }],
      totalRefund: 90,
    });
    await renderOwner();
    await pressDeleteX();
    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });

    mockGetDeletionPreview.mockRejectedValue(axiosErrorWith(500));
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.confirm'));
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      '삭제 영향을 확인하지 못했어요',
      '잠시 후 다시 시도해 주세요.',
    );
  });

  test('그만두기는 삭제 없이 시트만 접는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockResolvedValue({
      openSessions: [{ sessionDate: '2026-08-01', participantCount: 3, pot: 90 }],
      totalRefund: 90,
    });
    await renderOwner();
    await pressDeleteX();
    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challenge.delete.dismiss'));
    });
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('지금 진행 중인 챌린지예요')).toBeNull();
  });

  test('프리플라이트가 실패하면 삭제로 진행하지 않는다 — 수치 없는 경고는 경고가 아니다(N49)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDeletionPreview.mockRejectedValue(axiosErrorWith(500));
    await renderOwner();
    await pressDeleteX();

    expect(alertSpy).toHaveBeenCalledWith(
      '삭제 영향을 확인하지 못했어요',
      '잠시 후 다시 시도해 주세요.',
    );
    expect(onDelete).not.toHaveBeenCalled();
  });

  test('구서버(repeatDays 없음)는 프리플라이트 없이 종전 1단계 확인 그대로다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(
      <ChallengeCard challenge={challenge()} isOwner onDelete={onDelete} onOpenBet={onOpenBet} />,
    );
    await pressDeleteX();

    expect(mockGetDeletionPreview).not.toHaveBeenCalled();
    await act(async () => {
      lastAlertButtons(alertSpy)
        ?.find((b) => b.text === '삭제')
        ?.onPress?.();
    });
    expect(onDelete).toHaveBeenCalledWith(CHALLENGE_ID);
  });
});
