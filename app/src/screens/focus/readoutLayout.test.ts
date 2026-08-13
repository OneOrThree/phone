// 집중 세션 세로 예산 — 기기 × 글자 배율 조합에서 겹침이 생기지 않는지 못을 박는다(GROMO-1381).
//
// 이 계산은 두 번 회귀했다. ① 기기 높이를 안 보고 고정 pt를 썼다가 667pt 기기에서 캐릭터가
// 아래 요소를 뚫었고 ② 그걸 고친 뒤에도 시스템 글자 배율을 안 봐서, 글자를 키운 사용자에게는
// 확대된 숫자가 다시 예산을 넘겼다(둘 다 codex 리뷰). 눈으로 세는 계산이라 표로 잠근다.
//
// ⚠️ GROMO-1525에서 원형 진행 링을 걷어내며 **링 축을 단언하던 케이스만** 지웠다.
//    아래 케이스는 전부 링과 무관한 접근성·레이아웃 계약이다 — 위 두 회귀의 재발 방지선이므로
//    링이 사라졌다고 같이 지우면 안 된다.
//
// ⚠️ 애니메이션이 아니라 **레이아웃 산수**라 단언해도 되는 영역이다(정책 D14의 금지 대상 아님).
import { focusReadoutLayout, readoutUsedHeight } from './readoutLayout';

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
  // ⚠️ 뽀모도로는 세트배지·세트도트를, 카운트다운은 '목표 HH:MM:SS' 줄을 함께 그린다.
  //    예산이 이걸 빼먹으면 캐릭터가 줄지 않아 리드아웃이 페이저를 밀어낸다(codex 리뷰).
  test('뽀모도로는 배지·도트 높이까지 예산에 넣는다', () => {
    for (const { availH, w } of DEVICES) {
      const plain = focusReadoutLayout(availH, w, 3.1, false);
      const pomo = focusReadoutLayout(availH, w, 3.1, true);
      expect(pomo.charSize).toBeLessThanOrEqual(plain.charSize);
    }
    // 예산이 실제로 물리는 지점 — 여기서 동률이면 배지·도트가 빠진 것이다.
    const plain = focusReadoutLayout(647, 375, 3.1, false);
    const pomo = focusReadoutLayout(647, 375, 3.1, true);
    expect(pomo.charSize).toBeLessThan(plain.charSize);
  });

  test('카운트다운은 목표 라벨 높이까지 예산에 넣는다', () => {
    const plain = focusReadoutLayout(647, 375, 3.1, false, false);
    const goal = focusReadoutLayout(647, 375, 3.1, false, true);
    expect(goal.charSize).toBeLessThan(plain.charSize);
  });

  // 하한(MIN_FIT)이 "없는 공간을 만들어 내는" 걸 막는다. 어떤 조합에서도 실제 합계가
  // 가용 높이를 넘으면 리드아웃이 페이저를 밀어내 캐릭터·도트가 겹친다.
  // ⚠️ 합계는 **반드시 readoutUsedHeight로** 센다 — 손으로 다시 쓰다가 CHROME_FRAME과
  //    글자 몫을 빠뜨려 55pt 초과를 통과시킨 적이 있다(codex 리뷰 2차).
  test('어떤 기기 × 배율 × 모드에서도 실제 합계가 가용 높이를 넘지 않는다', () => {
    for (const { availH, w } of DEVICES) {
      for (const fontScale of [1.0, 1.15, 1.35, 2.0, 2.6, 3.1]) {
        for (const withBadges of [true, false]) {
          for (const withGoal of [true, false]) {
            const l = focusReadoutLayout(availH, w, fontScale, withBadges, withGoal);
            expect(readoutUsedHeight(l, fontScale, withBadges, withGoal)).toBeLessThanOrEqual(
              availH,
            );
          }
        }
      }
    }
  });

  test('표준 배율에서는 타이머 지정 크기가 기본값(52pt) 그대로다', () => {
    for (const fontScale of [1.0, 1.15, 1.35]) {
      const l = focusReadoutLayout(647, 375, fontScale, false);
      // 폭 계산값이 기본값보다 커서 아무것도 깎이지 않는다 = 기존 렌더와 동일(E2E 경로 보호).
      expect(l.timerFontSize).toBe(52);
    }
  });

  // 이 화면의 유일한 핵심 정보는 숫자다. 그 숫자가 화면 폭을 넘어 말줄임되면 안 된다.
  test.each(DEVICES)('$name: 숫자는 화면 폭 안에 들어간다', ({ w, availH }) => {
    for (const fontScale of SCALES) {
      const l = focusReadoutLayout(availH, w, fontScale);
      // 좌우 여백 48을 남기고도 들어가야 한다.
      expect(renderedTimerWidth(l.timerFontSize, fontScale)).toBeLessThanOrEqual(w - 48);
    }
  });

  test('접근성 배율에서도 숫자는 기본(52pt)보다 크게 그려진다 — 확대를 되돌리지 않는다', () => {
    for (const { availH, w } of DEVICES) {
      for (const fontScale of [2.0, 3.1]) {
        const l = focusReadoutLayout(availH, w, fontScale);
        // 지정 크기는 폭에 맞춰 낮아지지만, 시스템 배율이 곱해진 **그려지는 크기**는 여전히 더 크다.
        expect(l.timerFontSize * fontScale).toBeGreaterThan(52);
      }
    }
  });

  test('가장 작은 지원 기기의 표준 배율에서도 캐릭터가 쓸 만한 크기로 남는다', () => {
    const l = focusReadoutLayout(647, 375, 1.0);
    expect(l.charSize).toBeGreaterThanOrEqual(120);
  });
});
