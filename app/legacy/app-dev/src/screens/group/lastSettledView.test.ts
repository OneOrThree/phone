// lastSettledView 선택기 테스트(#570 codex ①) — v2 `lastSettledSession`과 구서버
// `lastSettledBet`가 한 표시 모델로 접히는지, 그리고 정산 감지 서명이 두 축에서 같은 사건을
// 잡는지를 잠근다. 이 선택이 없으면 v2 응답만 오는 서버에서 카드 '지난 결과'와 잔액 재동기화가
// 첫 정산 이후 **영영 빈 채로** 남는다.
import type { GroupChallengeResponse, LastSettledSession } from '@/types/dto/group';
import {
  pickLastSettled,
  settledSignatureOf,
  voidBanner,
  voidReasonKey,
  voidSummary,
} from './lastSettledView';
// 시트가 export 하는 배너 함수도 같은 소스를 쓰는지 함께 잠근다 — 두 화면이 갈리지 않는 것이
// 이 테스트의 목적이라, 소비자 쪽 함수를 직접 부르지 않으면 위임이 끊겨도 통과해 버린다.
import { statusBanner, voidReasonBanner } from './components/LastBetResultSheet';

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

  // SETTLED·FORFEITED에 사유가 실려 와도 문장을 바꿀 근거가 아니다(판정이 끝난 회차다).
  test('판정이 끝난 상태의 사유는 문장을 바꾸지 않는다', () => {
    const view = pickLastSettled(
      challenge({ lastSettledSession: session({ status: 'FORFEITED', voidReason: 'WHATEVER' }) }),
    );
    expect(view?.voidReason).toBeNull();
  });

  // v2 REFUNDED = 24h 자동 환불(LLD) — 판정도 무산도 아니라 전용 문구가 필요하다(#570 codex ⑤).
  test('사유 없는 v2 REFUNDED는 자동 환불로 갈라진다', () => {
    const view = pickLastSettled(
      challenge({ lastSettledSession: session({ status: 'REFUNDED', voidReason: null }) }),
    );
    expect(view?.bet.status).toBe('REFUNDED');
    expect(view?.voidReason).toBe('AUTO_REFUND');
    expect(voidSummary(view?.voidReason ?? null)).toBe('정산이 지연돼 환불');
    expect(voidBanner(view?.voidReason ?? null)).toBe('정산이 지연됐어요. 참가비는 돌려드렸어요');
  });

  // 서버는 24h 초과 환불에 사유를 함께 실어 보낸다. 폴백 경로와 **같은 문장**이어야 한다 —
  // 갈리면 사유 유무에 따라 같은 사건이 다른 말로 설명된다(codex 리뷰).
  test('사유가 실린 REFUNDED와 사유 없는 폴백이 같은 문장으로 수렴한다', () => {
    expect(voidSummary('REFUND_DEADLINE')).toBe(voidSummary('AUTO_REFUND'));
    expect(voidBanner('REFUND_DEADLINE')).toBe(voidBanner('AUTO_REFUND'));
  });

  // 돈을 돌려받은 사건을 「무효」라고 부르지 않는다 — 무효는 판정 없이 없던 일이 된 것이다.
  test('24h 초과 환불 문구에 「무효」가 들어가지 않는다', () => {
    expect(voidSummary('REFUND_DEADLINE')).not.toContain('무효');
    expect(voidBanner('REFUND_DEADLINE')).not.toContain('무효');
    expect(voidBanner('REFUND_DEADLINE')).toContain('돌려드렸어요');
  });

  test('구서버 REFUNDED(레거시)는 종전 문장 그대로다 — 자동 환불로 단정하지 않는다', () => {
    const view = pickLastSettled(
      challenge({
        lastSettledBet: {
          betDate: '2026-07-30',
          stake: 10,
          pot: 20,
          status: 'REFUNDED',
          results: [],
        },
      }),
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

describe('무효화 사유 문구', () => {
  // 값 축 이문(policy N33 ↔ LLD) — 서버가 어느 쪽을 내보내도 같은 키로 접혀 같은 문장이 된다.
  test('인원 미달은 두 표기를 모두 받는다', () => {
    expect(voidReasonKey('SHORT_PARTICIPANTS')).toBe('SHORT_PARTICIPANTS');
    expect(voidReasonKey('INSUFFICIENT_PARTICIPANTS')).toBe('SHORT_PARTICIPANTS');
    expect(voidSummary('SHORT_PARTICIPANTS')).toBe('참가자가 부족해 무산');
    expect(voidSummary('INSUFFICIENT_PARTICIPANTS')).toBe('참가자가 부족해 무산');
  });

  test('삭제·기한 사유도 각자 문장을 갖는다', () => {
    expect(voidSummary('CHALLENGE_DELETED')).toBe('챌린지 삭제로 무효');
    expect(voidSummary('REFUND_DEADLINE')).toBe('정산이 지연돼 환불');
  });

  test('모르는 값·없음은 null — 문구를 지어내지 않고 호출부가 폴백한다', () => {
    expect(voidReasonKey('SOMETHING_NEW')).toBeNull();
    expect(voidSummary('SOMETHING_NEW')).toBeNull();
    expect(voidSummary(null)).toBeNull();
    expect(voidBanner('SOMETHING_NEW')).toBeNull();
    expect(voidBanner(null)).toBeNull();
  });

  // ⚠️ 재발 방지(#570 리뷰) — 카드 요약과 시트 배너는 **같은 표**에서 나와야 한다. 예전처럼
  // 두 곳이 각자 switch를 들면 새 사유를 한쪽만 갱신하고 잊는데, 그게 이번 라운드에 고친
  // "카드와 시트가 갈리는" 버그의 재발 구조다. 아래 표는 사유 4종 + 미상 값에 대해 두 화면이
  // **같은 사유 분류**로 떨어지는지 검사한다 — 한쪽만 바꾸면 이 테스트가 깨진다.
  test.each([
    [
      'SHORT_PARTICIPANTS',
      '참가자가 부족해 무산',
      '참가자가 부족해 무산됐어요. 참가비는 돌려드렸어요',
    ],
    [
      'INSUFFICIENT_PARTICIPANTS',
      '참가자가 부족해 무산',
      '참가자가 부족해 무산됐어요. 참가비는 돌려드렸어요',
    ],
    [
      'CHALLENGE_DELETED',
      '챌린지 삭제로 무효',
      '챌린지가 삭제돼 무효가 됐어요. 참가비는 돌려드렸어요',
    ],
    ['REFUND_DEADLINE', '정산이 지연돼 환불', '정산이 지연됐어요. 참가비는 돌려드렸어요'],
    // 앱 파생 폴백도 같은 키로 접혀 같은 문장이 나온다(codex 리뷰 — 갈라 두니 문구가 둘이었다).
    ['AUTO_REFUND', '정산이 지연돼 환불', '정산이 지연됐어요. 참가비는 돌려드렸어요'],
  ])('%s — 카드 요약과 시트 배너가 같은 분류에서 나온다', (reason, summary, banner) => {
    // 카드(짧은 요약)
    expect(voidSummary(reason)).toBe(summary);
    // 시트(돈의 행방까지) — 시트 컴포넌트가 export 하는 함수도 같은 소스를 위임한다.
    expect(voidBanner(reason)).toBe(banner);
    expect(voidReasonBanner(reason)).toBe(banner);
    // 둘 다 같은 키로 접혔다 = 분류가 갈리지 않았다.
    expect(voidReasonKey(reason)).not.toBeNull();
    expect(statusBanner('REFUNDED', reason)).toBe(banner);
  });

  test('미상 값에서는 카드·시트 **둘 다** 폴백한다 — 한쪽만 문구를 지어내지 않는다', () => {
    expect(voidSummary('UNKNOWN_REASON')).toBeNull();
    expect(voidReasonBanner('UNKNOWN_REASON')).toBeNull();
    // 시트 배너는 상태 기반 종전 문장으로 떨어진다(환불 사실 자체는 여전히 참이다).
    expect(statusBanner('REFUNDED', 'UNKNOWN_REASON')).toBe('달성한 사람이 없어 전원 환불됐어요');
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
