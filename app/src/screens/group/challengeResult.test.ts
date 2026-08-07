// 챌린지 결과 선택 로직 + 1회 가드 단위 테스트 — 계약 contract.md §2 "앱 UI 계약 (A3)".
// 화면 테스트(GroupRoomScreen.test)가 배선을 잠그고, 여기서는 시각을 주입해 창 경계를 정밀하게 잠근다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  filterUnseenChallengeResults,
  markChallengeResultSeen,
  pickChallengeResults,
  type ChallengeResultCandidate,
} from './challengeResult';
import type { GroupChallengeResponse } from '@/types/dto/group';

// 가드 정리(prune)의 기준(어제)이 실제 시계를 타면 픽스처 날짜가 미래/과거로 흔들린다 — 고정한다.
// prune의 축은 KST다(GROMO-1219 — 가드 키의 date가 KST 축). **로컬 버전은 일부러 다른 날짜**라,
// 코드가 로컬 축(yesterdayStr)을 부르면 prune 단언이 어긋나 곧장 드러난다(축 분리 검증).
jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  yesterdayStr: jest.fn(() => '2026-07-30'),
  yesterdayStrKst: jest.fn(() => '2026-07-31'),
}));

// 창 종료 판정의 벽시계 축(KST) 호출을 단언하기 위한 스파이 — 동작은 실물 그대로다
// (러너 TZ가 KST라 값은 로컬과 같지만, **어느 축을 불렀는지**는 호출 인자로 잠근다).
jest.mock('@/utils/challengeTime', () => ({
  ...jest.requireActual('@/utils/challengeTime'),
  nowSecondsInZone: jest.fn((...args: unknown[]) =>
    jest.requireActual('@/utils/challengeTime').nowSecondsInZone(...args),
  ),
}));
const mockNowSecondsInZone = jest.requireMock('@/utils/challengeTime')
  .nowSecondsInZone as jest.Mock;

const TODAY = '2026-08-01';
const YESTERDAY = '2026-07-31';

// 기준 시각 — 2026-08-01 14:30:00 (로컬/KST, jest.config가 KST 고정).
const NOW = new Date(2026, 7, 1, 14, 30, 0);

function challenge(over: Partial<GroupChallengeResponse> = {}): GroupChallengeResponse {
  return {
    id: 'c1',
    missionType: 'DURATION',
    missionCategory: 'FOCUS',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    status: 'ACTIVE',
    createdAt: '2026-07-30T06:00:00',
    canParticipate: true,
    memberProgress: [
      { userId: 'me', nickname: '나', progressMinutes: 70, achieved: true },
      { userId: 'u2', nickname: '수빈', progressMinutes: 20, achieved: false },
    ],
    bet: null,
    lastSettledBet: null,
    ...over,
  };
}

function windowChallenge(windowEnd: string, over: Partial<GroupChallengeResponse> = {}) {
  return challenge({
    missionType: 'TIME_WINDOW',
    durationMinutes: null,
    windowStart: '09:00:00',
    windowEnd,
    ...over,
  });
}

function pick(args: {
  today?: GroupChallengeResponse[] | null;
  yesterday?: GroupChallengeResponse[] | null;
  now?: Date;
}): ChallengeResultCandidate[] {
  return pickChallengeResults({
    today: args.today ?? null,
    yesterday: args.yesterday ?? null,
    todayDate: TODAY,
    yesterdayDate: YESTERDAY,
    now: args.now ?? NOW,
    myUserId: 'me',
  });
}

describe('pickChallengeResults — 어제 결과', () => {
  test('어제 조회의 판정을 어제 date 후보로 만든다(명단 3상 분리)', () => {
    const out = pick({
      yesterday: [
        challenge({
          memberProgress: [
            { userId: 'me', nickname: '나', progressMinutes: 70, achieved: true },
            { userId: 'u2', nickname: '수빈', progressMinutes: 20, achieved: false },
            { userId: 'u3', nickname: '민지', progressMinutes: null, achieved: null },
          ],
        }),
      ],
    });

    expect(out).toHaveLength(1);
    // 명단은 이름만이 아니라 판정 근거(기록 분)를 함께 들고 온다(GROMO-1191).
    // 미집계는 0분으로 뭉개지 않고 null 그대로 — 모달이 '—'로 비울 수 있어야 한다.
    expect(out[0]).toMatchObject({
      challengeId: 'c1',
      date: YESTERDAY,
      goalMinutes: 60,
      achievers: [{ userId: 'me', nickname: '나', progressMinutes: 70 }],
      failed: [{ userId: 'u2', nickname: '수빈', progressMinutes: 20 }],
      pending: [{ userId: 'u3', nickname: '민지', progressMinutes: null }],
      myAchieved: true,
      memberCount: 3,
      hadBet: false,
    });
  });

  test('전원 achieved=null이면 후보를 만들지 않는다(가드를 태우면 확정 결과를 영영 못 본다)', () => {
    const out = pick({
      yesterday: [
        challenge({
          memberProgress: [
            { userId: 'me', nickname: '나', progressMinutes: null, achieved: null },
            { userId: 'u2', nickname: '수빈', progressMinutes: null, achieved: null },
          ],
        }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  test('memberProgress가 null·빈 배열이면 후보가 없다(구서버·미지원)', () => {
    expect(pick({ yesterday: [challenge({ memberProgress: null })] })).toHaveLength(0);
    expect(pick({ yesterday: [challenge({ memberProgress: [] })] })).toHaveLength(0);
  });

  test('기준일보다 뒤에 만들어진 챌린지는 제외한다(없던 날의 전원 미달성을 만들지 않는다)', () => {
    const out = pick({ yesterday: [challenge({ createdAt: '2026-08-01T06:00:00' })] });
    expect(out).toHaveLength(0);
  });

  // 딥링크가 지목해도 마찬가지다 — 서버가 INACTIVE 챌린지의 memberProgress를 항상 null로
  // 내려주므로(GroupChallengeService.isProgressTarget) 상태 필터를 열어도 후보가 되지 않는다.
  test('INACTIVE 챌린지는 제외한다', () => {
    const out = pick({ yesterday: [challenge({ status: 'INACTIVE' })] });
    expect(out).toHaveLength(0);
  });

  test('내기가 걸려 있던 날짜면 hadBet=true(정산 안내 문구의 근거)', () => {
    const out = pick({
      yesterday: [
        challenge({
          bet: {
            betId: 'b1',
            stake: 30,
            pot: 60,
            status: 'OPEN',
            myJoined: true,
            myAchievedNow: true,
            participants: [],
          },
        }),
      ],
    });
    expect(out[0]?.hadBet).toBe(true);
  });
});

describe('pickChallengeResults — 창형 당일 결과(창 endAt < now)', () => {
  test('오늘 창이 끝났으면 오늘 date 후보를 만들고 어제 후보를 대체한다', () => {
    const out = pick({
      today: [
        windowChallenge('12:00:00', {
          memberProgress: [{ userId: 'me', nickname: '나', progressMinutes: 60, achieved: true }],
        }),
      ],
      yesterday: [
        windowChallenge('12:00:00', {
          memberProgress: [{ userId: 'me', nickname: '나', progressMinutes: 0, achieved: false }],
        }),
      ],
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: TODAY, myAchieved: true });
  });

  test('창 종료 판정의 벽시계는 기기 로컬이 아니라 KST다(GROMO-1219)', () => {
    mockNowSecondsInZone.mockClear();
    pick({ today: [windowChallenge('12:00:00')] });
    expect(mockNowSecondsInZone).toHaveBeenCalledWith('Asia/Seoul', NOW);
  });

  test('창이 아직 안 끝났으면(endAt ≥ now) 어제 결과를 쓴다 — 경계 포함', () => {
    // 14:30:00 정각 종료 = 아직 '지난' 것이 아니다(endAt < now 미충족).
    const out = pick({
      today: [windowChallenge('14:30:00')],
      yesterday: [
        windowChallenge('14:30:00', {
          memberProgress: [{ userId: 'me', nickname: '나', progressMinutes: 0, achieved: false }],
        }),
      ],
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: YESTERDAY, myAchieved: false });

    // 1초라도 지나면 오늘 결과로 넘어간다.
    const after = pick({
      today: [windowChallenge('14:29:59')],
      yesterday: [windowChallenge('14:29:59')],
    });
    expect(after).toHaveLength(1);
    expect(after[0].date).toBe(TODAY);
  });

  test('DURATION 챌린지는 오늘 결과를 만들지 않는다(하루가 끝나야 확정)', () => {
    const out = pick({ today: [challenge()], yesterday: null });
    expect(out).toHaveLength(0);
  });

  // 결과 모달의 5분 관용치 고지(GROMO-1217)는 후보의 missionType×missionCategory로 조건을
  // 건다 — 후보가 이 두 필드를 응답 그대로 들고 오지 않으면 고지가 조용히 사라진다.
  test('후보는 missionType·missionCategory를 응답 그대로 들고 온다(관용치 고지의 근거)', () => {
    const out = pick({ today: [windowChallenge('12:00:00')], yesterday: null });
    expect(out[0]).toMatchObject({ missionType: 'TIME_WINDOW', missionCategory: 'FOCUS' });

    const duration = pick({ yesterday: [challenge()] });
    expect(duration[0]).toMatchObject({ missionType: 'DURATION', missionCategory: 'FOCUS' });
  });

  test('어제 조회가 실패(null)해도 오늘 창 종료 결과는 만든다 — 부분 실패 무영향', () => {
    const out = pick({ today: [windowChallenge('12:00:00')], yesterday: null });
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe(TODAY);
  });

  test('오늘 조회가 실패(null)하면 창형도 어제 결과로 남는다', () => {
    const out = pick({ today: null, yesterday: [windowChallenge('12:00:00')] });
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe(YESTERDAY);
  });

  test('어제 결과 → 오늘(창 종료) 결과 순서로 정렬된다', () => {
    const out = pick({
      today: [challenge({ id: 'c-day' }), windowChallenge('12:00:00', { id: 'c-win' })],
      yesterday: [challenge({ id: 'c-day' }), windowChallenge('12:00:00', { id: 'c-win' })],
    });
    expect(out.map((c) => `${c.challengeId}:${c.date}`)).toEqual([
      `c-day:${YESTERDAY}`,
      `c-win:${TODAY}`,
    ]);
  });
});

describe('1회 노출 가드', () => {
  const candidate = (challengeId: string, date: string): ChallengeResultCandidate => ({
    challengeId,
    date,
    missionType: 'DURATION',
    missionCategory: 'FOCUS',
    label: '하루 60분 집중',
    goalMinutes: 60,
    achievers: [{ userId: 'me', nickname: '나', progressMinutes: 70 }],
    failed: [],
    pending: [],
    myAchieved: true,
    memberCount: 1,
    hadBet: false,
  });

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  // markChallengeResultSeen은 fire-and-forget이라 내부 비동기 완료를 기다릴 고리가 없다 —
  // 마이크로태스크를 비워 setItem·정리까지 끝낸 뒤 검증한다.
  async function flushAsync() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  test('기록한 결과(챌린지×날짜)만 걸러진다', async () => {
    markChallengeResultSeen('c1', YESTERDAY);
    await flushAsync();

    const out = await filterUnseenChallengeResults([
      candidate('c1', YESTERDAY), // 본 것
      candidate('c1', TODAY), // 같은 챌린지, 다른 날짜 — 새 결과
      candidate('c2', YESTERDAY), // 다른 챌린지
    ]);
    expect(out.map((c) => `${c.challengeId}:${c.date}`)).toEqual([
      `c1:${TODAY}`,
      `c2:${YESTERDAY}`,
    ]);
  });

  test('어제보다 오래된 마커는 기록 시점에 정리된다', async () => {
    await AsyncStorage.setItem('gromo:challengeResult:c9:2026-07-20', '1');
    markChallengeResultSeen('c1', TODAY);
    await flushAsync();

    expect(await AsyncStorage.getItem('gromo:challengeResult:c9:2026-07-20')).toBeNull();
    // 어제·오늘 마커는 남는다(둘 다 아직 노출 판정에 쓰인다).
    expect(await AsyncStorage.getItem(`gromo:challengeResult:c1:${TODAY}`)).toBe('1');
  });
});
