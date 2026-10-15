// 클라 표시 공식이 서버 지급 공식과 어긋나지 않게 잠근다(GROMO-1193).
//
// 이 파일의 값은 축하 모달의 "+N ⏳ 획득!" 표기에만 쓰이고 실제 지급은 서버가 한다.
// 두 공식이 갈리면 사용자는 받은 것과 다른 금액을 보게 되므로, 아래 기대값은
// back/src/main/java/com/oneorthree/phone/currency/service/CurrencyRewardPolicy.java 를
// 보고 적었다. 서버 공식을 바꾸면 이 테스트가 먼저 깨져야 한다.
import { focusGoalReward, screenTimeGoalReward } from './currencyRewards';

describe('focusGoalReward — 집중 목표(시간당 +10, 8h 캡)', () => {
  test('목표 미설정(0 이하)은 0', () => {
    expect(focusGoalReward(0)).toBe(0);
    expect(focusGoalReward(-30)).toBe(0);
  });

  test('1시간 미만도 최소 한 구간(+10)은 받는다', () => {
    expect(focusGoalReward(1)).toBe(10);
    expect(focusGoalReward(59)).toBe(10);
  });

  test('시간당 +10, 부분 시간은 내림', () => {
    expect(focusGoalReward(60)).toBe(10);
    expect(focusGoalReward(90)).toBe(10); // 1시간 30분 → 1구간
    expect(focusGoalReward(120)).toBe(20);
    expect(focusGoalReward(420)).toBe(70);
  });

  test('8시간에서 동결 — 그 이상은 계속 +80', () => {
    expect(focusGoalReward(480)).toBe(80);
    expect(focusGoalReward(600)).toBe(80);
    expect(focusGoalReward(1440)).toBe(80); // 상한(24h)
  });
});

describe('screenTimeGoalReward — 스크린타임 목표(상한이 빡셀수록 많이)', () => {
  test('상한 미설정(0 이하)은 0 — 서버 지급 스킵 규칙과 일치', () => {
    expect(screenTimeGoalReward(0)).toBe(0);
    expect(screenTimeGoalReward(-10)).toBe(0);
  });

  test('구간별 금액과 경계값', () => {
    expect(screenTimeGoalReward(60)).toBe(80);
    expect(screenTimeGoalReward(61)).toBe(70);
    expect(screenTimeGoalReward(120)).toBe(70);
    expect(screenTimeGoalReward(180)).toBe(60);
    expect(screenTimeGoalReward(240)).toBe(50);
    expect(screenTimeGoalReward(300)).toBe(40);
    expect(screenTimeGoalReward(360)).toBe(30);
    expect(screenTimeGoalReward(420)).toBe(20);
    expect(screenTimeGoalReward(421)).toBe(10);
    expect(screenTimeGoalReward(1440)).toBe(10);
  });

  test('상한이 낮을수록 금액이 크다(단조 감소)', () => {
    const limits = [30, 60, 120, 180, 240, 300, 360, 420, 480];
    const rewards = limits.map(screenTimeGoalReward);
    for (let i = 1; i < rewards.length; i += 1) {
      expect(rewards[i]).toBeLessThanOrEqual(rewards[i - 1]);
    }
  });
});
