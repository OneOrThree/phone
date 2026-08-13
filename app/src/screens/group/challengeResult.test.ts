// 챌린지 결과 후보 선정 + 1회 가드 단위 테스트 — 정본 IA §4.3·§8 (GROMO-1279 · N53).
// 화면 테스트(GroupRoomScreen.test)가 배선을 잠그고, 여기서는 순수 계산과 가드 저장 규칙을 잠근다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  filterUnseenChallengeResults,
  markChallengeResultSeen,
  pickChallengeResults,
  type ChallengeResultCandidate,
} from './challengeResult';
import type { MyChallengeResultEntry } from '@/types/dto/group';

// 60일 프룬 컷오프가 실제 시계를 타면 픽스처 날짜가 미래/과거로 흔들린다 — 고정한다.
// 마커 값(sessionDate)이 KST 축이라 컷오프도 KST 축(kstDateStr)이다.
jest.useFakeTimers().setSystemTime(new Date(2026, 7, 1, 14, 30, 0)); // 2026-08-01 (러너 TZ = KST)

const USER_ID = 'me';

function entry(over: Partial<MyChallengeResultEntry> = {}): MyChallengeResultEntry {
  return {
    sessionId: 's1',
    groupId: 'g1',
    groupName: '아침 6시 집중방',
    challengeId: 'c1',
    challengeDeleted: false,
    challengeEnded: false,
    sessionDate: '2026-07-31',
    stake: 30,
    pot: 90,
    status: 'SETTLED',
    voidReason: null,
    goalMinutes: 60,
    myAchieved: true,
    myPayout: 45,
    results: [
      { userId: 'me', nickname: '나', achieved: true, payout: 45, progressMinutes: 70 },
      { userId: 'u2', nickname: '수빈', achieved: false, payout: 0, progressMinutes: 20 },
    ],
    ...over,
  };
}

describe('pickChallengeResults — /me/challenge-results → 후보', () => {
  test('정산 완료 회차를 후보로 만든다(명단 3상 분리 + 손익 동반)', () => {
    const out = pickChallengeResults([
      entry({
        results: [
          { userId: 'me', nickname: '나', achieved: true, payout: 45, progressMinutes: 70 },
          { userId: 'u2', nickname: '수빈', achieved: false, payout: 0, progressMinutes: 20 },
          { userId: 'u3', nickname: '민지', achieved: null, payout: null, progressMinutes: null },
        ],
      }),
    ]);

    expect(out).toHaveLength(1);
    // 명단은 이름만이 아니라 판정 근거(기록 분)·정산 금액을 함께 들고 온다(GROMO-1191·1279).
    // 미집계·미판정은 0으로 뭉개지 않고 null 그대로 — 모달이 '—'로 비울 수 있어야 한다.
    expect(out[0]).toMatchObject({
      sessionId: 's1',
      challengeId: 'c1',
      groupName: '아침 6시 집중방',
      date: '2026-07-31',
      status: 'SETTLED',
      stake: 30,
      pot: 90,
      goalMinutes: 60,
      achievers: [{ userId: 'me', nickname: '나', progressMinutes: 70, payout: 45 }],
      failed: [{ userId: 'u2', nickname: '수빈', progressMinutes: 20, payout: 0 }],
      pending: [{ userId: 'u3', nickname: '민지', progressMinutes: null, payout: null }],
      myAchieved: true,
      myPayout: 45,
      memberCount: 3,
    });
  });

  test('무산·환불·몰수도 결과다 — SETTLED가 아니어도 후보가 된다(IA §4.3)', () => {
    const out = pickChallengeResults([
      entry({ sessionId: 's-f', status: 'FORFEITED' }),
      entry({ sessionId: 's-v', status: 'VOIDED', voidReason: 'SHORT_PARTICIPANTS' }),
      entry({ sessionId: 's-r', status: 'REFUNDED' }),
    ]);
    expect(out.map((c) => c.sessionId)).toEqual(['s-f', 's-v', 's-r']);
  });

  // 삭제 환불은 BET_VOID_REFUND 푸시가 알린다(N48) — 모달까지 띄우면 같은 사건 이중 통지.
  // 서버가 이미 거르지만(FR-44-4) 방어적으로 다시 거른다.
  test('삭제된 챌린지의 회차는 후보가 되지 않는다(N48 — 푸시와 이중 통지 금지)', () => {
    const out = pickChallengeResults([
      entry({ sessionId: 's-del', challengeDeleted: true }),
      entry({ sessionId: 's-void-del', status: 'VOIDED', voidReason: 'CHALLENGE_DELETED' }),
      entry({ sessionId: 's-ok' }),
    ]);
    expect(out.map((c) => c.sessionId)).toEqual(['s-ok']);
  });

  test('결말이 아닌 상태(OPEN·UNUSED·미지의 값)는 방어적으로 버린다', () => {
    const out = pickChallengeResults([
      entry({ sessionId: 's-open', status: 'OPEN' }),
      entry({ sessionId: 's-unused', status: 'UNUSED' }),
      entry({ sessionId: 's-new', status: 'SOMETHING_NEW' as MyChallengeResultEntry['status'] }),
    ]);
    expect(out).toHaveLength(0);
  });

  test('명단이 비어 있으면 후보가 없다(렌더할 것이 없다)', () => {
    expect(pickChallengeResults([entry({ results: [] })])).toHaveLength(0);
  });

  test('ENDED 챌린지의 회차도 실린다(N38→N53 — 종료가 결과를 지우지 않는다)', () => {
    expect(pickChallengeResults([entry({ challengeEnded: true })])).toHaveLength(1);
  });

  // 미션 스냅샷(GROMO-1583) — 모달의 FOCUS 창 관용치 고지가 이 4필드로 조건을 세운다.
  // 여기서 떨어지면 모달은 스냅샷을 영영 못 받고 고지 조건이 서지 않는다(PR #566이 만든 갭).
  test('미션 스냅샷 4필드를 후보로 옮긴다', () => {
    const [out] = pickChallengeResults([
      entry({
        missionCategory: 'FOCUS',
        missionType: 'TIME_WINDOW',
        windowStart: '06:00',
        windowEnd: '08:00',
      }),
    ]);
    expect(out).toMatchObject({
      missionCategory: 'FOCUS',
      missionType: 'TIME_WINDOW',
      windowStart: '06:00',
      windowEnd: '08:00',
    });
  });

  // 나중에 붙은 additive 필드라 구서버 응답엔 통째로 없다(undefined) — 창형이 아닌 회차의
  // null과 같은 '모른다'로 접어, 소비자가 두 가지 없음을 구분하지 않게 한다.
  test('미션 스냅샷이 없는 구서버 응답은 null로 접는다', () => {
    const [out] = pickChallengeResults([entry()]);
    expect(out).toMatchObject({
      missionCategory: null,
      missionType: null,
      windowStart: null,
      windowEnd: null,
    });
  });

  test('sessionDate 내림차순 정렬 — 최근 것부터, 동률은 서버 순서 유지', () => {
    const out = pickChallengeResults([
      entry({ sessionId: 's-old', sessionDate: '2026-07-29' }),
      entry({ sessionId: 's-new', sessionDate: '2026-07-31' }),
      entry({ sessionId: 's-new2', sessionDate: '2026-07-31' }),
    ]);
    expect(out.map((c) => c.sessionId)).toEqual(['s-new', 's-new2', 's-old']);
  });
});

describe('1회 노출 가드 — 계정 스코프 세션 마커(IA §8)', () => {
  const candidate = (sessionId: string, date = '2026-07-31'): ChallengeResultCandidate =>
    pickChallengeResults([entry({ sessionId, sessionDate: date })])[0];

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  // markChallengeResultSeen은 fire-and-forget이라 내부 비동기 완료를 기다릴 고리가 없다 —
  // 페이크 타이머 밑에서 마이크로태스크+타이머를 굴려 setItem·정리까지 끝낸 뒤 검증한다.
  async function flushAsync() {
    // 가드 쓰기는 setItem → getAllKeys → multiGet → multiRemove의 await 사슬이다 — 사슬 길이보다
    // 넉넉히 마이크로태스크를 굴린다(페이크 타이머라 setTimeout 기반 대기는 쓸 수 없다).
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve();
    }
  }

  test('기록한 세션만 걸러진다', async () => {
    markChallengeResultSeen(USER_ID, 's1', '2026-07-31');
    await flushAsync();

    const out = await filterUnseenChallengeResults(USER_ID, [
      candidate('s1'), // 본 것
      candidate('s2'), // 다른 회차 — 새 결과
    ]);
    expect(out?.map((c) => c.sessionId)).toEqual(['s2']);
  });

  test('가드 키는 계정 스코프다 — 다른 계정이 본 기록으로 내 결과를 거르지 않는다', async () => {
    markChallengeResultSeen('other-user', 's1', '2026-07-31');
    await flushAsync();

    const out = await filterUnseenChallengeResults(USER_ID, [candidate('s1')]);
    expect(out).toHaveLength(1);
  });

  test('60일 지난 마커는 기록 시점에 정리된다 — 경계 안쪽은 남는다', async () => {
    // 2026-08-01 기준 컷오프는 2026-06-02 — 그보다 오래된 마커만 지워진다.
    await AsyncStorage.setItem(`gromo:sessionResult:${USER_ID}:s-old`, '2026-05-30');
    await AsyncStorage.setItem(`gromo:sessionResult:${USER_ID}:s-keep`, '2026-07-01');
    markChallengeResultSeen(USER_ID, 's1', '2026-07-31');
    await flushAsync();

    expect(await AsyncStorage.getItem(`gromo:sessionResult:${USER_ID}:s-old`)).toBeNull();
    expect(await AsyncStorage.getItem(`gromo:sessionResult:${USER_ID}:s-keep`)).toBe('2026-07-01');
    expect(await AsyncStorage.getItem(`gromo:sessionResult:${USER_ID}:s1`)).toBe('2026-07-31');
  });

  test('구 형식 마커(gromo:challengeResult:*)는 날짜와 무관하게 정리된다', async () => {
    await AsyncStorage.setItem('gromo:challengeResult:c9:2026-07-31', '1');
    markChallengeResultSeen(USER_ID, 's1', '2026-07-31');
    await flushAsync();

    expect(await AsyncStorage.getItem('gromo:challengeResult:c9:2026-07-31')).toBeNull();
  });

  // 읽기 실패는 '아무것도 노출하지 않는다'로 끝나야 하지만, **'볼 것이 없다'와 같은 값이면
  // 안 된다**(codex 후속 리뷰 P2). 같은 값으로 뭉개면 탈퇴자 화면이 "결과 0건"으로 읽고 즉시
  // 방을 내려(onLeft) 다른 소속 그룹이 없는 사용자는 그 정산 결과를 영영 못 본다.
  test('가드를 못 읽으면 null — 노출은 하지 않되 "없다"로 확정하지 않는다', async () => {
    // spyOn + mockRestore 금지 — 공식 mock의 메서드는 이미 jest.fn 이라 복원하면 구현이 사라져
    // 이후 테스트의 multiGet이 undefined를 돌려준다. 1회 오버라이드만 얹는다.
    (AsyncStorage.multiGet as jest.Mock).mockRejectedValueOnce(new Error('storage'));
    const out = await filterUnseenChallengeResults(USER_ID, [candidate('s1')]);
    expect(out).toBeNull();
  });

  test('후보가 실제로 없으면 빈 배열 — null(판정 불가)과 구분된다', async () => {
    expect(await filterUnseenChallengeResults(USER_ID, [])).toEqual([]);

    await AsyncStorage.setItem(`gromo:sessionResult:${USER_ID}:s1`, '2026-07-31');
    expect(await filterUnseenChallengeResults(USER_ID, [candidate('s1')])).toEqual([]);
  });
});
