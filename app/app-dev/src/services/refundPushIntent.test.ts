import {
  consumeRefundPushIntent,
  markRefundIntentFromInbox,
  markRefundPushIntent,
  resetRefundPushIntent,
} from '@/services/refundPushIntent';

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const OTHER = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d99';

beforeEach(() => resetRefundPushIntent());

describe('환불 푸시 출처 표식 (GROMO-1579)', () => {
  test('세운 그룹과 같으면 소비된다', () => {
    markRefundPushIntent(GROUP_ID);
    expect(consumeRefundPushIntent(GROUP_ID)).toBe(true);
  });

  test('세우지 않았으면 서지 않는다 — 외부 딥링크 위조 방어', () => {
    expect(consumeRefundPushIntent(GROUP_ID)).toBe(false);
  });

  // 대상이 어긋나면 소비하지 않고 버린다 — 남기면 엉뚱한 방이 다음에 물려받는다.
  test('다른 그룹으로 들어가면 서지 않고, 표식도 남지 않는다', () => {
    markRefundPushIntent(OTHER);
    expect(consumeRefundPushIntent(GROUP_ID)).toBe(false);
    expect(consumeRefundPushIntent(OTHER)).toBe(false);
  });

  test('1회용이다', () => {
    markRefundPushIntent(GROUP_ID);
    expect(consumeRefundPushIntent(GROUP_ID)).toBe(true);
    expect(consumeRefundPushIntent(GROUP_ID)).toBe(false);
  });
});

// 보관함 항목 탭은 푸시 계층(navigateFromPush)을 거치지 않아 표식이 서지 않았고, 그래서
// 비멤버가 보관함에서 환불 알림을 다시 열면 착지 실패가 그대로 남았다(codex 리뷰).
describe('보관함에서 다시 열기', () => {
  test('BET_VOID_REFUND 항목이면 링크의 g= 로 표식을 세운다', () => {
    markRefundIntentFromInbox('BET_VOID_REFUND', `gromo://group?g=${GROUP_ID}&result=1&refund=1`);
    expect(consumeRefundPushIntent(GROUP_ID)).toBe(true);
  });

  test('다른 타입이면 세우지 않는다', () => {
    markRefundIntentFromInbox('BET_RESULT', `gromo://group?g=${GROUP_ID}&result=1`);
    expect(consumeRefundPushIntent(GROUP_ID)).toBe(false);
  });

  test('타입이 없거나 g= 가 없으면 세우지 않는다', () => {
    markRefundIntentFromInbox(null, `gromo://group?g=${GROUP_ID}&refund=1`);
    expect(consumeRefundPushIntent(GROUP_ID)).toBe(false);
    markRefundIntentFromInbox('BET_VOID_REFUND', 'gromo://group');
    expect(consumeRefundPushIntent(GROUP_ID)).toBe(false);
  });
});
