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
jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  yesterdayStr: jest.fn(() => '2026-07-31'),
}));

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
  focusChallengeId?: string | null;
}): ChallengeResultCandidate[] {
  return pickChallengeResults({
    today: args.today ?? null,
    yesterday: args.yesterday ?? null,
    todayDate: TODAY,
    yesterdayDate: YESTERDAY,
    now: args.now ?? NOW,
    myUserId: 'me',
    focusChallengeId: args.focusChallengeId ?? null,
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
    expect(out[0]).toMatchObject({
      challengeId: 'c1',
      date: YESTERDAY,
      achievers: ['나'],
      failed: ['수빈'],
      pending: ['민지'],
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

  test('INACTIVE 챌린지는 제외한다', () => {
    const out = pick({ yesterday: [challenge({ status: 'INACTIVE' })] });
    expect(out).toHaveLength(0);
  });

  // GROMO-1088 — 종료 푸시가 지목한 챌린지만 상태 필터를 넘는다. 종료 푸시는 정의상 끝난
  // 챌린지를 가리키므로, 서버가 종료를 INACTIVE 전이로 표현하면 예외 없이는 모달이 못 뜬다.
  test('딥링크가 지목한 챌린지는 INACTIVE여도 후보가 된다', () => {
    const out = pick({
      yesterday: [challenge({ status: 'INACTIVE' })],
      focusChallengeId: 'c1',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ challengeId: 'c1', date: YESTERDAY });
  });

  test('지목한 챌린지가 아니면 INACTIVE는 그대로 제외한다', () => {
    const out = pick({
      yesterday: [challenge({ id: 'c1', status: 'INACTIVE' }), challenge({ id: 'c2' })],
      focusChallengeId: 'c9',
    });
    expect(out.map((c) => c.challengeId)).toEqual(['c2']);
  });

  test('지목해도 판정이 하나도 없으면 후보를 만들지 않는다(집계 전 — 다음 조회가 이어받는다)', () => {
    const out = pick({
      yesterday: [
        challenge({
          status: 'INACTIVE',
          memberProgress: [{ userId: 'me', nickname: '나', progressMinutes: null, achieved: null }],
        }),
      ],
      focusChallengeId: 'c1',
    });
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
    achievers: ['나'],
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
