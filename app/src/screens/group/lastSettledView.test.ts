// lastSettledView 선택기 테스트(#570 codex ①) — v2 `lastSettledSession`과 구서버
// `lastSettledBet`가 한 표시 모델로 접히는지, 그리고 정산 감지 서명이 두 축에서 같은 사건을
// 잡는지를 잠근다. 이 선택이 없으면 v2 응답만 오는 서버에서 카드 '지난 결과'와 잔액 재동기화가
// 첫 정산 이후 **영영 빈 채로** 남는다.
import type { GroupChallengeResponse, LastSettledSession } from '@/types/dto/group';
import { pickLastSettled, settledSignatureOf } from './lastSettledView';

function challenge(over: Partial<GroupChallengeResponse> = {}): GroupChallengeResponse {
  return {
    id: 'c1',
    missionType: 'DURATION',
    missionCategory: 'FOCUS',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    status: 'ACTIVE',
    createdAt: '2026-08-01T06:00:00',
    canParticipate: true,
    memberProgress: null,
    ...over,
  };
}

function session(over: Partial<LastSettledSession> = {}): LastSettledSession {
  return {
    sessionId: 's1',
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
    ...over,
  };
}

describe('pickLastSettled', () => {
  test('v2 회차를 표시 모델로 접는다 — 날짜 축은 sessionDate다', () => {
    expect(pickLastSettled(challenge({ lastSettledSession: session() }))).toEqual({
      bet: {
        betDate: '2026-07-31',
        stake: 30,
        pot: 90,
        status: 'SETTLED',
        goalMinutes: 60,
        results: session().results,
      },
      voidReason: null,
    });
  });

  // VOIDED는 환불 사건이라 상태는 REFUNDED로 접되, **사유를 함께 실어야** 시트가
  // "달성한 사람이 없어"(하지도 않은 판정) 대신 무산 문장을 쓴다(#570 codex ④).
  test('VOIDED(무산·삭제 무효화)는 환불로 표시하고 사유를 함께 넘긴다', () => {
    const view = pickLastSettled(
      challenge({
        lastSettledSession: session({ status: 'VOIDED', voidReason: 'SHORT_PARTICIPANTS' }),
      }),
    );
    expect(view?.bet.status).toBe('REFUNDED');
    expect(view?.voidReason).toBe('SHORT_PARTICIPANTS');
  });

  test('무효화가 아닌 상태의 사유는 문장을 바꾸지 않는다', () => {
    const view = pickLastSettled(
      challenge({ lastSettledSession: session({ status: 'REFUNDED', voidReason: 'WHATEVER' }) }),
    );
    expect(view?.voidReason).toBeNull();
  });

  test('UNUSED(참가자 0명)는 결과에서 제외한다(N52)', () => {
    expect(
      pickLastSettled(challenge({ lastSettledSession: session({ status: 'UNUSED' }) })),
    ).toBeNull();
  });

  test('v2 필드가 없으면 구서버 lastSettledBet로 폴백한다', () => {
    const legacy = {
      betDate: '2026-07-30',
      stake: 10,
      pot: 20,
      status: 'SETTLED' as const,
      results: [],
    };
    expect(pickLastSettled(challenge({ lastSettledBet: legacy }))).toEqual({
      bet: legacy,
      voidReason: null,
    });
  });

  test('둘 다 없으면 null', () => {
    expect(pickLastSettled(challenge())).toBeNull();
  });

  test('v2 필드가 우선한다 — 구 필드가 함께 와도 회차가 정본이다', () => {
    const view = pickLastSettled(
      challenge({
        lastSettledSession: session(),
        lastSettledBet: { betDate: '2026-07-01', stake: 1, pot: 2, status: 'SETTLED', results: [] },
      }),
    );
    expect(view?.bet.betDate).toBe('2026-07-31');
  });
});

describe('settledSignatureOf', () => {
  test('내가 참가한 v2 정산은 날짜·상태·내 결과까지 서명한다', () => {
    expect(settledSignatureOf(challenge({ lastSettledSession: session() }), 'u1')).toBe(
      'c1:2026-07-31:SETTLED:true:45',
    );
  });

  test('null(미확정)과 0(확정된 0코인)을 뭉개지 않는다 — 지급 확정 순간을 놓치지 않는다', () => {
    const pending = settledSignatureOf(
      challenge({ lastSettledSession: session({ myAchieved: null, myPayout: null }) }),
      'u1',
    );
    const settled = settledSignatureOf(
      challenge({ lastSettledSession: session({ myAchieved: true, myPayout: 0 }) }),
      'u1',
    );
    expect(pending).not.toBe(settled);
  });

  test('내가 참가하지 않은 정산은 서명하지 않는다 — 남의 정산으로 잔액을 다시 받지 않는다', () => {
    expect(
      settledSignatureOf(challenge({ lastSettledSession: session({ myJoined: false }) }), 'u1'),
    ).toBe('');
  });

  test('myJoined를 모르는 응답은 결과 명단에서 나를 찾아 판정한다', () => {
    const s = session({ myJoined: undefined, myAchieved: undefined, myPayout: undefined });
    expect(settledSignatureOf(challenge({ lastSettledSession: s }), 'u2')).toBe(
      'c1:2026-07-31:SETTLED:false:0',
    );
    expect(settledSignatureOf(challenge({ lastSettledSession: s }), 'u9')).toBe('');
  });

  test('구서버 응답도 같은 규칙으로 서명한다', () => {
    const legacy = {
      betDate: '2026-07-30',
      stake: 10,
      pot: 20,
      status: 'SETTLED' as const,
      results: [{ userId: 'u1', nickname: '재영', achieved: true, payout: 20 }],
    };
    expect(settledSignatureOf(challenge({ lastSettledBet: legacy }), 'u1')).toBe(
      'c1:2026-07-30:SETTLED:true:20',
    );
  });

  test('로그인 전(userId 없음)에는 서명하지 않는다', () => {
    expect(settledSignatureOf(challenge({ lastSettledSession: session() }), null)).toBe('');
  });
});
