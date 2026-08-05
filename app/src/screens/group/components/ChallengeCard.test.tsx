// ChallengeCard 진행 3상 렌더 + 방장 삭제 테스트 — 명세 docs/app/group-plan-2.md §3-2.
//
// 여기서 잠그는 것:
//  1) 진행 표기 3상. `progressMinutes: 0`(집중을 아직 안 함)과 `null`(스크린타임 미집계)은
//     완전히 다른 뜻인데 falsy 하나로 뭉개면 둘 다 같은 칸으로 보인다.
//  2) 삭제는 방장만(우측 상단 X — GROMO-1101), 그리고 **확인 Alert를 거친 뒤에만** onDelete가
//     불린다 — 오탭으로 챌린지가 사라지면 되돌릴 방법이 없다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import ChallengeCard from './ChallengeCard';
import { cancelBet, challengeGroupId, leaveBet } from '@/services/groupApi';
import { logGroupBetCanceled } from '@/services/analyticsEvents';
import { T } from '@/constants/theme';
import type {
  ChallengeMemberProgress,
  GroupChallengeBet,
  GroupChallengeResponse,
  LastSettledBet,
} from '@/types/dto/group';

// 첫 렌더가 RN 모듈을 콜드 로드하는 무거운 스위트라 CI 러너에선 기본 5s를 넘겨 flaky timeout이 났다 —
// 로직이 아니라 콜드 스타트 지연이므로 이 파일 한정으로 타임아웃을 넉넉히 준다.
jest.setTimeout(20000);

// 카드가 참가 철회의 API·계측을 직접 쥔다(부모 GroupRoomScreen이 A3 전유라 콜백을 못 늘린 흡수) —
// groupErrorCode는 실제 구현을 남긴다(철회 에러 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  leaveBet: jest.fn(),
  cancelBet: jest.fn(),
  challengeGroupId: jest.fn(),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logGroupBetCanceled: jest.fn(),
  logGroupChallengeDeleted: jest.fn(),
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
// 철회 버튼의 '시작 전' 판정이 시간에 기댄다 — '오늘'과 KST 벽시계를 테스트가 직접 고정한다.
jest.mock('@/utils/localDate', () => ({ todayStr: jest.fn(() => '2026-08-01') }));
jest.mock('@/utils/challengeTime', () => ({
  ...jest.requireActual('@/utils/challengeTime'),
  nowSecondsInZone: jest.fn(() => 10 * 3600), // KST 10:00:00 고정
}));

const mockLeaveBet = leaveBet as jest.MockedFunction<typeof leaveBet>;
const mockCancelBet = cancelBet as jest.MockedFunction<typeof cancelBet>;
const mockChallengeGroupId = challengeGroupId as jest.MockedFunction<typeof challengeGroupId>;

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
  mockLeaveBet.mockResolvedValue(undefined);
  mockCancelBet.mockResolvedValue(undefined);
  mockChallengeGroupId.mockReturnValue(GROUP_ID);
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

  function renderJoined(
    betOver: Partial<GroupChallengeBet> = {},
    challengeOver: Partial<GroupChallengeResponse> = {},
  ) {
    return render(
      <ChallengeCard
        challenge={challenge({ bet: { ...leavableBet(), ...betOver }, ...challengeOver })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );
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

  test('확인 Alert를 거쳐 철회 API를 부르고, 남은 인원이 있으면 내기를 유지해 그린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderJoined(); // 참가자 3명

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`));
    });
    // 확인 전에는 아무것도 하지 않는다 — 돈이 걸린 동작이라 한 겹 거친다.
    expect(mockLeaveBet).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      '참가 철회',
      '참가비 30코인을 돌려받고 내기에서 빠질까요?',
      expect.anything(),
    );

    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '철회하기')?.onPress?.();
    });

    // groupId는 카드 prop이 아니라 groupApi 조회 캐시에서 역참조한다.
    expect(mockLeaveBet).toHaveBeenCalledWith(GROUP_ID, 'b1');
    // 환불된 잔액은 서버가 정본 — 다시 받는다.
    expect(mockRefreshCoins).toHaveBeenCalled();
    // 남이 남은 내기는 살아 있다 — '내기 취소' 계측은 발행하지 않는다(내기가 닫힌 게 아니다).
    expect(logGroupBetCanceled).not.toHaveBeenCalled();
    // 내기는 유지해 보여 주되(스펙) 내 몫을 뺀 값으로, 내 참가 표시만 걷는다.
    expect(screen.getByText('🪙 참가비 30 · 적립금 60 · 2명 참여')).toBeOnTheScreen();
    expect(screen.queryByText('참여 중')).toBeNull();
    expect(screen.getByText('내기에서 빠졌어요. 참가비는 잔액으로 돌아왔어요')).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.leave.${CHALLENGE_ID}`)).toBeNull();
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
      buttons?.find((b) => b.text === '철회하기')?.onPress?.();
    });

    // 서버가 내기를 CANCELED로 닫는 경우다(계약 §4) — 기존 '내기 취소' 계측의 의미가 보존된다.
    expect(logGroupBetCanceled).toHaveBeenCalledWith({ stake: 30, participants_count: 1 });
    expect(screen.getByText('내기에서 빠졌어요. 참가비는 잔액으로 돌아왔어요')).toBeOnTheScreen();
    // 아무도 남지 않았다 — 유지해 그릴 내기 정보 행이 없다.
    expect(screen.queryByText(/적립금/)).toBeNull();
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
      buttons?.find((b) => b.text === '철회하기')?.onPress?.();
    });

    expect(alertSpy).toHaveBeenCalledWith('철회할 수 없어요', '내기가 시작된 뒤에는 뺄 수 없어요.');
    expect(logGroupBetCanceled).not.toHaveBeenCalled();
    // 실패했으므로 자리 표시로 갈아 끼우지 않는다 — 내 참가는 그대로 살아 있다.
    expect(screen.queryByText('내기에서 빠졌어요. 참가비는 잔액으로 돌아왔어요')).toBeNull();
  });

  test.each([
    ['BET_NOT_JOINED', '참가 중인 내기가 아니에요. 화면을 새로고침해 주세요.'],
    ['BET_NOT_OPEN', '이미 정산됐거나 닫힌 내기예요.'],
  ])('%s는 사실을 그대로 말한다', async (code, message) => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLeaveBet.mockRejectedValueOnce(axiosErrorWith(409, code));
    await renderJoined();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.bet.leave.${CHALLENGE_ID}`));
    });
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '철회하기')?.onPress?.();
    });

    expect(alertSpy).toHaveBeenCalledWith('철회할 수 없어요', message);
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

  function renderSolo(betOver: Partial<GroupChallengeBet> = {}) {
    return render(
      <ChallengeCard
        challenge={challenge({ bet: soloCreatorBet(betOver) })}
        isOwner={false}
        myUserId="u1"
        onDelete={onDelete}
        onOpenBet={onOpenBet}
      />,
    );
  }

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
    // 확인 전에는 아무것도 하지 않는다 — 옛 취소 확인 문구 관례 그대로.
    expect(mockCancelBet).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      '내기 취소',
      '참가비 30코인을 돌려받고 내기를 닫을까요?',
      expect.anything(),
    );

    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.text === '취소하기')?.onPress?.();
    });

    // 철회 API가 아니라 기존 취소 API로 나간다.
    expect(mockCancelBet).toHaveBeenCalledWith(GROUP_ID, 'b1');
    expect(mockLeaveBet).not.toHaveBeenCalled();
    expect(mockRefreshCoins).toHaveBeenCalled();
    // 내기가 통째로 닫히는 동작이라 항상 취소 계측이다.
    expect(logGroupBetCanceled).toHaveBeenCalledWith({ stake: 30, participants_count: 1 });
    // 자리 캡션은 누른 버튼의 동사('취소')를 따른다.
    expect(screen.getByText('내기를 취소했어요. 참가비는 잔액으로 돌아왔어요')).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.bet.cancel.${CHALLENGE_ID}`)).toBeNull();
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
      buttons?.find((b) => b.text === '취소하기')?.onPress?.();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      '취소할 수 없어요',
      '다른 참가자가 있어 취소할 수 없어요.',
    );
    expect(logGroupBetCanceled).not.toHaveBeenCalled();
    expect(screen.queryByText('내기를 취소했어요. 참가비는 잔액으로 돌아왔어요')).toBeNull();
  });
});
