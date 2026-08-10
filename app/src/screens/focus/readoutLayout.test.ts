// 집중 세션 세로 예산 — 기기 × 글자 배율 조합에서 겹침이 생기지 않는지 못을 박는다(GROMO-1381).
//
// 이 계산은 두 번 회귀했다. ① 기기 높이를 안 보고 고정 pt를 썼다가 667pt 기기에서 캐릭터가
// 링을 뚫었고 ② 그걸 고친 뒤에도 시스템 글자 배율을 안 봐서, 글자를 키운 사용자에게는 확대된
// 숫자가 다시 링을 뚫었다(둘 다 codex 리뷰). 눈으로 세는 계산이라 표로 잠근다.
//
// ⚠️ 애니메이션이 아니라 **레이아웃 산수**라 단언해도 되는 영역이다(정책 D14의 금지 대상 아님).
import { focusReadoutLayout, readoutUsedHeight, RING_STROKE } from './readoutLayout';

// 지원 하한부터 최신까지. availH = 화면 높이 − 안전영역(상·하).
const DEVICES: { name: string; w: number; availH: number }[] = [
  { name: 'SE2/SE3/8 (667)', w: 375, availH: 667 - 20 - 0 },
  { name: '13 mini (812)', w: 375, availH: 812 - 50 - 34 },
  { name: 'iPhone 15 (852)', w: 393, availH: 852 - 59 - 34 },
  { name: '15 Pro Max (932)', w: 430, availH: 932 - 62 - 34 },
];

// 표준 Dynamic Type 밴드(약 0.82~1.35)와 접근성 밴드(그 위)를 함께 본다.
const SCALES = [1.0, 1.15, 1.35, 2.0, 3.1];

// hms()는 항상 8글자 + tabular-nums라 폭이 내용과 무관하다. readoutLayout이 쓰는 것과 같은 계수.
const TIMER_W_PER_PT = 3.85;
const renderedTimerWidth = (fontSize: number, fontScale: number) =>
  fontSize * fontScale * TIMER_W_PER_PT;

describe('focusReadoutLayout — 기기 × 글자 배율', () => {
  test.each(DEVICES)('$name: 링을 그리면 숫자가 링 안에 들어간다 (모든 배율)', ({ w, availH }) => {
    for (const fontScale of SCALES) {
      const l = focusReadoutLayout(availH, w, fontScale, true);
      if (!l.showRing) continue; // 링을 포기한 배치는 폭 제약 자체가 없다
      const inner = l.ringSize - 2 * RING_STROKE;
      expect(renderedTimerWidth(l.timerFontSize, fontScale)).toBeLessThanOrEqual(inner);
    }
  });

  test.each(DEVICES)('$name: 캐릭터와 링이 세로 예산 안에 함께 들어간다', ({ w, availH }) => {
    for (const fontScale of SCALES) {
      const l = focusReadoutLayout(availH, w, fontScale, true);
      // 링 밖 고정 요소(프레임 165 + 리드아웃 105)를 뺀 나머지가 둘이 쓸 수 있는 전부다.
      const budget = availH - (165 + 105 + 48 * (fontScale - 1));
      expect(l.charSize + l.ringSize).toBeLessThanOrEqual(budget);
    }
  });

  test.each(DEVICES)('$name: 링은 화면 폭을 넘지 않는다', ({ w, availH }) => {
    for (const fontScale of SCALES) {
      const l = focusReadoutLayout(availH, w, fontScale, true);
      expect(l.ringSize).toBeLessThanOrEqual(w);
    }
  });

  test('배율이 오르면 캐릭터가 줄어 링에 자리를 내준다 — 숫자를 깎지 않는다', () => {
    const { availH, w } = { availH: 759, w: 393 }; // iPhone 15
    const base = focusReadoutLayout(availH, w, 1.0, true);
    const large = focusReadoutLayout(availH, w, 1.35, true);
    expect(large.showRing).toBe(true);
    // 링은 커지고 캐릭터는 줄어든다(장식이 기능에 양보한다).
    expect(large.ringSize).toBeGreaterThan(base.ringSize);
    expect(large.charSize).toBeLessThan(base.charSize);
    // 지정 fontSize는 유지 — 시스템 배율이 그대로 곱해져 실제로 더 크게 그려진다.
    expect(large.timerFontSize).toBe(base.timerFontSize);
  });

  test('접근성 배율에서는 링을 포기하고 숫자만 남긴다', () => {
    for (const { availH, w } of DEVICES) {
      expect(focusReadoutLayout(availH, w, 2.0, true).showRing).toBe(false);
      expect(focusReadoutLayout(availH, w, 3.1, true).showRing).toBe(false);
    }
  });

  // ⚠️ 링을 포기해도 뽀모도로는 세트배지·세트도트를 계속 그리고, 타이머도 독립된 줄이 된다.
  //    폴백 예산이 이걸 빼먹으면 캐릭터가 줄지 않아 리드아웃이 페이저를 밀어낸다(codex 리뷰).
  //    ⚠️ 합계는 **반드시 readoutUsedHeight로** 센다 — 손으로 다시 쓰다가 CHROME_FRAME과
  //       글자 몫을 빠뜨려 55pt 초과를 통과시킨 적이 있다(codex 리뷰 2차).
  test('링을 포기한 뽀모도로는 배지·도트 높이까지 예산에 넣는다', () => {
    for (const { availH, w } of DEVICES) {
      const plain = focusReadoutLayout(availH, w, 3.1, true, false);
      const pomo = focusReadoutLayout(availH, w, 3.1, true, true);
      expect(plain.showRing).toBe(false);
      expect(pomo.showRing).toBe(false);
      expect(pomo.charSize).toBeLessThanOrEqual(plain.charSize);
    }
    // 예산이 실제로 물리는 지점 — 여기서 동률이면 배지·도트가 빠진 것이다.
    const plain = focusReadoutLayout(647, 375, 3.1, true, false);
    const pomo = focusReadoutLayout(647, 375, 3.1, true, true);
    expect(pomo.charSize).toBeLessThan(plain.charSize);
  });

  // ⚠️ 카운트다운은 링을 포기해도 '목표 HH:MM:SS' 줄을 계속 그린다(codex 리뷰).
  test('링을 포기한 카운트다운은 목표 라벨 높이까지 예산에 넣는다', () => {
    const plain = focusReadoutLayout(647, 375, 3.1, true, false, false);
    const goal = focusReadoutLayout(647, 375, 3.1, true, false, true);
    expect(goal.charSize).toBeLessThan(plain.charSize);
  });

  // 하한(MIN_FIT)이 "없는 공간을 만들어 내는" 걸 막는다. 어떤 조합에서도 실제 합계가
  // 가용 높이를 넘으면 리드아웃이 페이저를 밀어내 캐릭터·도트가 겹친다.
  test('어떤 기기 × 배율 × 모드에서도 실제 합계가 가용 높이를 넘지 않는다', () => {
    for (const { availH, w } of DEVICES) {
      for (const fontScale of [1.0, 1.15, 1.35, 2.0, 2.6, 3.1]) {
        for (const wantRing of [true, false]) {
          for (const withBadges of [true, false]) {
            for (const withGoal of [true, false]) {
              const l = focusReadoutLayout(availH, w, fontScale, wantRing, withBadges, withGoal);
              expect(readoutUsedHeight(l, fontScale, withBadges, withGoal)).toBeLessThanOrEqual(
                availH,
              );
            }
          }
        }
      }
    }
  });

  test('카운트업은 링을 쓰지 않는다 — 표준 배율에선 기본 크기 그대로', () => {
    for (const fontScale of [1.0, 1.15, 1.35]) {
      const l = focusReadoutLayout(647, 375, fontScale, false);
      expect(l.showRing).toBe(false);
      expect(l.ringSize).toBe(0);
      // 폭 계산값이 기본값보다 커서 아무것도 깎이지 않는다 = 기존 렌더와 동일(E2E 경로 보호).
      expect(l.timerFontSize).toBe(52);
    }
  });

  // ── 링 폴백의 마지막 칸 ────────────────────────────────────────────────────────
  // 링을 포기한 이유가 "숫자는 지킨다"이므로, 그 숫자가 화면 폭을 넘어 말줄임되면 안 된다.
  test.each(DEVICES)('$name: 링을 포기해도 숫자는 화면 폭 안에 들어간다', ({ w, availH }) => {
    for (const fontScale of SCALES) {
      for (const wantRing of [true, false]) {
        const l = focusReadoutLayout(availH, w, fontScale, wantRing);
        if (l.showRing) continue; // 링이 있는 경우는 위 '링 안에 들어간다' 테스트가 본다
        // 좌우 여백 48을 남기고도 들어가야 한다.
        expect(renderedTimerWidth(l.timerFontSize, fontScale)).toBeLessThanOrEqual(w - 48);
      }
    }
  });

  test('접근성 배율에서도 숫자는 기본(52pt)보다 크게 그려진다 — 확대를 되돌리지 않는다', () => {
    for (const { availH, w } of DEVICES) {
      for (const fontScale of [2.0, 3.1]) {
        const l = focusReadoutLayout(availH, w, fontScale, true);
        expect(l.showRing).toBe(false);
        // 지정 크기는 폭에 맞춰 낮아지지만, 시스템 배율이 곱해진 **그려지는 크기**는 여전히 더 크다.
        expect(l.timerFontSize * fontScale).toBeGreaterThan(52);
      }
    }
  });

  test('가장 작은 지원 기기의 표준 배율에서도 캐릭터가 쓸 만한 크기로 남는다', () => {
    const l = focusReadoutLayout(647, 375, 1.0, true);
    expect(l.showRing).toBe(true);
    expect(l.charSize).toBeGreaterThanOrEqual(120);
  });
});
