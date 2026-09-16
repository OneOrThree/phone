// challengeHistoryView 테스트 — 그룹 챌린지 내역 한 줄의 표시 판단(GROMO-1277).
//
// 여기서 잠그는 것:
//  1) 미션 라벨이 **회차 스냅샷**에서 나온다 — 챌린지 행이 없어도 한 줄이 온전하다(N6-1).
//  2) 요약은 "판정이 일어난 날"에만 달성 집계 — 무산·환불·몰수는 결말을 말한다(#570 재발 방지).
//  3) 무효화 사유 문구가 lastSettledView의 **공용 매핑과 같은 문자열**이다(사본 금지 교차 검증).
//  4) 손익 3상: 미참가(null) ≠ 환불 ≠ 0코인. 그룹 축이라 내가 안 낀 줄이 목록에 섞인다.
import {
  notJoinedText,
  refundedText,
  historyBasis,
  historyDelta,
  historyMissionLabel,
  historyRowA11y,
  historySummary,
  showToleranceNotice,
} from './challengeHistoryView';
import { voidSummary } from './lastSettledView';
import type { GroupChallengeHistoryItem } from '@/types/dto/group';

function item(over: Partial<GroupChallengeHistoryItem> = {}): GroupChallengeHistoryItem {
  return {
    sessionId: 's1',
    sessionDate: '2026-08-10',
    challengeId: 'c1',
    challengeDeleted: false,
    missionCategory: 'FOCUS',
    missionType: 'DURATION',
    goalMinutes: 60,
    windowStart: null,
    windowEnd: null,
    stake: 30,
    pot: 90,
    status: 'SETTLED',
    voidReason: null,
    myPayout: 45,
    myAchieved: true,
    myProgressMinutes: 72,
    achievedCount: 2,
    participantCount: 3,
    ...over,
  };
}

describe('historyMissionLabel — 스냅샷이 소스', () => {
  test('하루형은 목표분으로 문장을 만든다(카드·시트와 같은 문구 규칙)', () => {
    expect(historyMissionLabel(item())).toBe('하루 60분 집중');
  });

  // 내역의 창 문장에는 「매일」이 없다(policy §A9의 목록 시안도 `집중 09–12시 90분`이다).
  // 회차 스냅샷에 repeatDays가 없고 이 화면엔 요일 배지도 없어서, 월요일만 도는 챌린지의
  // 지난 기록까지 「매일 …」로 설명하면 없는 사실을 말하게 된다(codex 리뷰).
  test('창형은 창 시각 + 목표분 — 서버 HH:mm:ss도 HH:mm으로 접힌다', () => {
    expect(
      historyMissionLabel(
        item({
          missionType: 'TIME_WINDOW',
          missionCategory: 'SCREEN_TIME',
          goalMinutes: 90,
          windowStart: '09:00:00',
          windowEnd: '12:00:00',
        }),
      ),
    ).toBe('09:00~12:00 90분 이하 스크린타임');
  });

  // 스크린타임 목표는 집중과 **방향이 반대다** — 60분을 채우는 게 아니라 60분 **이하**로
  // 유지해야 달성이다. 카드에는 방향 캡션(`오늘 스크린타임을 목표 이하로 유지해요`)이 따로
  // 서지만 이 목록엔 없다: 라벨이 방향을 말하지 않으면 `55/60분`이 **달성으로 찍힌 줄**이
  // "목표에 못 미쳤는데 달성"으로 읽힌다(codex 리뷰 · policy §A9 시안 `하루 폰 2시간 이하`).
  test('스크린타임 이력은 목표 방향(이하)을 라벨에 싣는다', () => {
    expect(historyMissionLabel(item({ missionCategory: 'SCREEN_TIME' }))).toBe(
      '하루 60분 이하 스크린타임',
    );
  });

  test('집중 이력에는 「이하」를 붙이지 않는다 — 목표 방향이 반대다', () => {
    expect(historyMissionLabel(item())).not.toContain('이하');
    expect(
      historyMissionLabel(
        item({
          missionType: 'TIME_WINDOW',
          goalMinutes: 90,
          windowStart: '09:00',
          windowEnd: '12:00',
        }),
      ),
    ).not.toContain('이하');
  });

  test('창형 이력은 「매일」이라고 단정하지 않는다 — 요일 반복 챌린지의 과거 기록이 섞여 있다', () => {
    const windowed = item({
      missionType: 'TIME_WINDOW',
      missionCategory: 'FOCUS',
      goalMinutes: 90,
      windowStart: '09:00',
      windowEnd: '12:00',
    });
    expect(historyMissionLabel(windowed)).not.toContain('매일');
    // 창 목표분이 없는 구 스냅샷(문장이 갈리는 다른 가지)에서도 마찬가지다.
    expect(historyMissionLabel({ ...windowed, goalMinutes: null })).not.toContain('매일');
    // 낭독도 같은 문장을 쓴다 — 눈으로 본 줄과 귀로 들은 줄이 갈리면 안 된다.
    expect(historyRowA11y(windowed, '8/10(월)')).not.toContain('매일');
  });

  test('스냅샷이 비면(구 정산분) 카테고리 명사로 떨어진다 — 목표를 지어내지 않는다', () => {
    expect(historyMissionLabel(item({ goalMinutes: null }))).toBe('집중 시간');
  });

  // 서버 계약상 카테고리는 항상 온다(V39 NOT NULL + 전량 백필). 그래도 방어를 잠근다:
  // 폴백(categoryLabel)은 null을 FOCUS로 뭉개 「집중 시간」이라고 **단언**하므로, 한 번이라도
  // null이 새면 과거 스크린타임 이력이 집중 챌린지로 보인다 — 가장 크게 갈리는 축이다.
  test('카테고리를 모르면 라벨을 만들지 않는다 — 「집중 시간」으로 단언하지 않는다', () => {
    expect(historyMissionLabel(item({ missionCategory: null, missionType: null }))).toBeNull();
    expect(historyMissionLabel(item({ missionCategory: null }))).toBeNull();
  });

  test('카테고리만 알면 명사까지만 — 방식(창·하루)을 모르면 시간을 지어내지 않는다', () => {
    expect(historyMissionLabel(item({ missionCategory: 'SCREEN_TIME', missionType: null }))).toBe(
      '스크린타임',
    );
  });

  test('행 음성 라벨은 라벨이 없는 줄에서 그 자리만 비운다', () => {
    const a11y = historyRowA11y(item({ missionCategory: null, missionType: null }), '8월 10일(월)');
    expect(a11y).not.toContain('집중');
    expect(a11y).toContain('8월 10일(월)');
  });
});

describe('historySummary — 판정한 날만 집계로 말한다', () => {
  test('정산된 날은 참가 인원 대비 달성 인원', () => {
    expect(historySummary(item())).toBe('3명 중 2명 달성');
  });

  test('무산은 사유로 말한다 — 집계로 적으면 하지도 않은 판정을 말하게 된다', () => {
    const summary = historySummary(
      item({ status: 'VOIDED', voidReason: 'INSUFFICIENT_PARTICIPANTS', achievedCount: 0 }),
    );
    expect(summary).toBe('참가자가 부족해 무산');
    // 카드·시트와 **같은 표**에서 나온 문자열이다(사본을 만들면 여기서 갈린다).
    expect(summary).toBe(voidSummary('INSUFFICIENT_PARTICIPANTS'));
  });

  test('삭제 무효화도 공용 매핑을 그대로 쓴다 — 값 축 별칭까지 같은 문장', () => {
    expect(historySummary(item({ status: 'VOIDED', voidReason: 'CHALLENGE_DELETED' }))).toBe(
      voidSummary('CHALLENGE_DELETED'),
    );
  });

  test('사유를 모르는 VOIDED는 집계 대신 무산 사실만 — 없는 사유를 지어내지 않는다', () => {
    expect(historySummary(item({ status: 'VOIDED', voidReason: 'WAT' }))).toBe('무산돼 전원 환불');
  });

  test('달성자 0명의 결말은 몰수다 — 적립금이 소멸한다', () => {
    expect(historySummary(item({ status: 'FORFEITED', achievedCount: 0 }))).toBe(
      '아무도 달성하지 못해 참가비 소멸',
    );
  });

  // REFUNDED는 **달성자가 없어서 생기는 상태가 아니다** — 정산 시도가 24시간을 넘겨 자동
  // 환불된 회차다(IA §4.2 상태도 · §4.3). 달성자 0명은 FORFEITED로 갈린다. 자동 환불을 받은
  // 사용자에게 "달성한 사람이 없어서"라고 말하면 **원인을 틀리게** 알려준다(codex 리뷰).
  test('REFUNDED는 정산 지연 자동 환불로 말한다 — 「달성한 사람이 없어」가 아니다', () => {
    const summary = historySummary(item({ status: 'REFUNDED', achievedCount: 0 }));
    expect(summary).not.toContain('달성');
    // 화면마다 다른 말로 같은 상태를 설명하지 않는다 — 카드가 쓰는 공용 표의 AUTO_REFUND 그대로.
    expect(summary).toBe(voidSummary('AUTO_REFUND'));
  });

  // 사유 축은 무산 전용이 아니라 **종료 사유** 축이라 REFUNDED에도 실려 온다(N55).
  // 실려 오면 상태로 역추론하지 않고 그 값을 그대로 분기한다 — 문구 소스는 여전히 공용 표다.
  test('사유가 실려 온 REFUNDED도 공용 표의 같은 문장을 쓴다', () => {
    const summary = historySummary(item({ status: 'REFUNDED', voidReason: 'REFUND_DEADLINE' }));
    expect(summary).not.toContain('달성');
    expect(summary).toBe(voidSummary('REFUND_DEADLINE'));
  });

  // 실제 서버는 사유를 **항상** 실어 보내므로 위 두 경로 중 사유 있는 쪽만 사용자에게 닿는다.
  // 둘이 갈리면 폴백 경로를 고쳐도 화면은 안 바뀐다 — 실제로 그래서 「무효」가 남아 있었다.
  test('사유 유무와 무관하게 REFUNDED 문장이 하나로 수렴한다', () => {
    const withReason = historySummary(item({ status: 'REFUNDED', voidReason: 'REFUND_DEADLINE' }));
    const withoutReason = historySummary(item({ status: 'REFUNDED', voidReason: null }));
    expect(withReason).toBe(withoutReason);
  });

  // 돈을 돌려받은 사건을 「무효」라고 부르지 않는다(codex 리뷰) — 무효는 판정 없이 없던 일이
  // 된 것이고, 24h 초과는 정산이 늦어 돌려준 것이다.
  test('24h 초과 환불을 「무효」라고 말하지 않는다', () => {
    const summary = historySummary(item({ status: 'REFUNDED', voidReason: 'REFUND_DEADLINE' }));
    expect(summary).not.toContain('무효');
    expect(summary).toContain('환불');
  });
});

describe('historyDelta — 미참가 · 환불 · 손익을 뭉개지 않는다', () => {
  test('참가해서 이긴 날은 손익(payout − stake)에 +를 붙인다', () => {
    expect(historyDelta(item())).toEqual({ text: '+15', tone: 'plus' });
  });

  test('몰수는 payout 0이라 −참가비로 떨어진다', () => {
    expect(historyDelta(item({ status: 'FORFEITED', myPayout: 0, myAchieved: false }))).toEqual({
      text: '-30',
      tone: 'minus',
    });
  });

  test('미참가 회차는 0코인이 아니라 미참여 — 그룹 축이라 남의 날도 목록에 있다', () => {
    expect(
      historyDelta(item({ myPayout: null, myAchieved: null, myProgressMinutes: null })),
    ).toEqual({ text: notJoinedText(), tone: 'muted' });
  });

  test('환불로 끝난 날은 숫자 0이 아니라 환불이라고 적는다', () => {
    expect(
      historyDelta(item({ status: 'VOIDED', voidReason: 'CHALLENGE_DELETED', myPayout: 30 })),
    ).toEqual({ text: refundedText(), tone: 'zero' });
    expect(historyDelta(item({ status: 'REFUNDED', myPayout: 30 }))).toEqual({
      text: refundedText(),
      tone: 'zero',
    });
  });

  test('정산됐는데 손익이 0인 날은 숫자 0 — 환불과 다른 사실이다', () => {
    expect(historyDelta(item({ myPayout: 30 }))).toEqual({ text: '0', tone: 'zero' });
  });
});

describe('historyBasis — 내 판정 근거', () => {
  test('참가했고 실측 분이 있으면 기록/목표를 적는다', () => {
    expect(historyBasis(item())).toBe('72/60분');
  });

  test('목표를 모르면 분모를 지어내지 않는다', () => {
    expect(historyBasis(item({ goalMinutes: null }))).toBe('72분');
  });

  test('미계측(null)·미참가는 근거 자체를 그리지 않는다 — 0분으로 뭉개면 거짓이다', () => {
    expect(historyBasis(item({ myProgressMinutes: null }))).toBeNull();
    expect(historyBasis(item({ myPayout: null, myProgressMinutes: 72 }))).toBeNull();
  });
});

describe('historyRowA11y — 행 전체를 한 덩어리로 읽는다', () => {
  test('날짜·미션·요약·근거·참가비·적립금·손익이 한 문장으로 묶인다(코인 단위까지)', () => {
    expect(historyRowA11y(item(), '8/10(월)')).toBe(
      '8/10(월), 하루 60분 집중, 3명 중 2명 달성, 72/60분, 참가비 30코인, 적립금 90코인, 15코인 획득',
    );
  });

  // 카드 컨테이너가 accessible이라 자식 Text('참가비 30 · 적립금 90')는 따로 읽히지 않는다 —
  // 이 라벨에 없으면 스크린 리더 사용자에겐 판돈과 총액이 존재하지 않는 것과 같다(codex 리뷰).
  test('돈이 오간 화면이라 참가비·적립금은 미참가 줄에서도 읽힌다', () => {
    const a11y = historyRowA11y(
      item({ stake: 50, pot: 150, myPayout: null, myProgressMinutes: null }),
      '8/10(월)',
    );
    expect(a11y).toContain('참가비 50코인');
    expect(a11y).toContain('적립금 150코인');
    // 시각 순서(… 참가비·적립금 줄이 마지막)를 뒤집지 않는다 — 참가비가 적립금보다 먼저다.
    expect(a11y.indexOf('참가비 50코인')).toBeLessThan(a11y.indexOf('적립금 150코인'));
  });

  test('삭제된 챌린지는 그 사실이 낭독에 포함된다', () => {
    expect(historyRowA11y(item({ challengeDeleted: true }), '8/10(월)')).toContain('삭제된 챌린지');
  });

  test('미참가 줄은 손익 자리에 미참여라고 읽는다', () => {
    expect(historyRowA11y(item({ myPayout: null, myProgressMinutes: null }), '8/10(월)')).toContain(
      notJoinedText(),
    );
  });
});

describe('showToleranceNotice — 줄마다 실린 스냅샷으로 판단(진입 경로 무관)', () => {
  const focusWindow = {
    missionCategory: 'FOCUS',
    missionType: 'TIME_WINDOW',
    windowStart: '09:00',
    windowEnd: '12:00',
  } as const;

  test('창형 집중 + 실측 분이 실제로 그려지면 세운다', () => {
    expect(showToleranceNotice([item(focusWindow)])).toBe(true);
  });

  test('하루형만 있으면 세우지 않는다 — 관용치는 창형 집중 전용', () => {
    expect(showToleranceNotice([item()])).toBe(false);
  });

  test('스크린타임 창은 세우지 않는다', () => {
    expect(showToleranceNotice([item({ ...focusWindow, missionCategory: 'SCREEN_TIME' })])).toBe(
      false,
    );
  });

  test('창형 집중이어도 그려질 숫자가 없으면 모순될 대상이 없다', () => {
    expect(showToleranceNotice([item({ ...focusWindow, myProgressMinutes: null })])).toBe(false);
  });

  test('여러 챌린지가 섞인 목록에서 한 줄만 해당돼도 세운다(그룹 축)', () => {
    expect(showToleranceNotice([item(), item({ ...focusWindow, sessionId: 's2' })])).toBe(true);
  });
});
