// 집중 세션(세로)의 '캐릭터 + 타이머' 세로 예산 계산 (GROMO-1381 · 링 제거는 GROMO-1525).
//
// 화면 모듈에서 떼어 낸 **순수 함수**다. FocusSessionScreen을 import 하면 서비스·컨텍스트 체인이
// 통째로 딸려와 jest에서 못 돌리는데, 여기 로직은 기기·글자 배율 조합마다 못을 박아야 하는
// 산수라서 따로 둔다.
//
// ── 왜 계산이 필요한가 ────────────────────────────────────────────────────────────────
// 캐릭터를 고정 크기로 두면 667pt 기기(SE·8)에서 남는 공간을 넘어 캐릭터가 페이지 도트와 겹친다.
// 게다가 Text의 allowFontScaling 기본값 때문에 시스템 '글자 크기'를 키운 사용자에게는 타이머가
// **다시 확대**되어, 확대된 타이머 줄이 캐릭터 몫을 그만큼 더 먹는다(codex 리뷰).
//
// ── 무엇을 양보시키는가 (접근성 판단) ──────────────────────────────────────────────────
// 타이머 숫자에는 maxFontSizeMultiplier를 **걸지 않는다.** 이 화면에서 사용자가 실제로 읽어야
// 하는 정보는 남은 시간 하나다. 숫자를 잘라 캐릭터를 지키면 "글자를 키운 사용자에게만 이 화면이
// 예외"가 되는데, 그건 접근성 설정을 무시하는 것과 같다. 그래서 양보 순서는:
//   ① 배율이 오르면 타이머 줄이 커진다(사용자의 확대를 되돌리지 않는다)
//   ② 커진 만큼 캐릭터가 줄어 값을 치른다(장식이 기능에 자리를 내준다)
//   ③ 그래도 폭이 모자라면 지정 fontSize만 낮춘다 — 배율은 그대로 곱해지므로 **그려지는 크기는
//      여전히 기본(52pt)보다 크고**, 8글자가 물리적으로 들어갈 수 있는 최대치에서 멈춘다.
//
// ⚠️ GROMO-1525 이전에는 여기에 **원형 진행 링** 축(showRing/ringSize)이 하나 더 있었다.
//    링을 걷어내면서 축만 제거했고, 위 캐릭터·타이머 예산은 링과 무관한 접근성 회귀 수정이라
//    그대로 남긴다. (링이 돌아오면 축을 다시 얹는다 — 값·근거는 문서에 남겨 뒀다.)

import { T } from '@/constants/theme';

const BASE_CHAR = 230;
/** 안전 하한. 현재 지원 기기(≥667pt)·표준 배율에선 걸리지 않는다. */
const MIN_FIT = 0.62;

/**
 * 타이머 문자열의 폭 ÷ 지정 fontSize.
 * hms()는 항상 8글자(HH:MM:SS)이고 tabular-nums라 문자열 내용과 무관하게 폭이 같다.
 * 52pt에서 약 200pt를 실측해 얻은 값이다.
 */
const TIMER_W_PER_PT = 3.85;

/**
 * 리드아웃이 가로로 쓸 수 있는 폭 = 화면 폭 − 이 여백. 타이머 폭의 상한이다.
 * (s.readout에는 paddingHorizontal이 없어 폭을 다 쓸 수 있지만, 화면 가장자리에 글자가 닿지 않게
 *  다른 영역과 같은 좌우 여백 T.space.xxl(24)×2를 남긴다.)
 */
const H_MARGIN = 48;

/**
 * 타이머가 폭에 못 들어갈 때를 대비한 최후 방어선. 계산은 TIMER_W_PER_PT 추정에 기대는데,
 * 실제 폰트 메트릭이 추정보다 넓으면 말줄임이 난다 — 그때 잘리는 대신 줄어들게 한다.
 */
export const PLAIN_TIMER_MIN_FONT_SCALE = 0.6;

// 세로 고정 요소(실측): topBar 52(36 + paddingVertical 8×2) + dots 23(7 + 8×2)
//                     + controls 90(60 + paddingBottom 30)
const CHROME_FRAME = 165;
// readout 안에서 캐릭터 **밖**의 높이. 글자 배율에 따라 커지는 '글자 몫'을 따로 들고 있는다.
//   paddingBottom 20 + 과목명 30 (+ 뽀모도로면 세트배지 34 + 세트도트 21)
//   (+ 카운트다운이면 '목표 HH:MM:SS' 한 줄) + 타이머 줄
// ⚠️ 타이머는 **독립된 줄**이므로 그 높이가 예산에 들어가야 한다. 타이머 줄 높이는 지정 크기가
//    정해지기 **전에** 필요해 순환하므로, 상한(52pt × 배율)으로 잡는다 — 보수적이라 캐릭터가
//    조금 작아질 뿐 겹치지는 않는다.
// 화면이 쓰는 행높이 비율과 같은 값 — 두 곳이 갈리면 예산이 어긋난다.
export const TIMER_LINE_RATIO = 1.08;
export const PLAIN_BASE = 50; // paddingBottom 20 + 과목명 30
export const POMODORO_EXTRA = 55; // 세트배지 34 + 세트도트 21
// ⚠️ 카운트다운은 '목표 HH:MM:SS' 줄을 계속 그린다 — 라벨 한 줄(15pt) + marginTop 4.
//    이걸 빼면 작은 화면에서 캐릭터가 남은 높이를 다 먹어 리드아웃이 가용 높이를 넘는다(codex 리뷰).
export const GOAL_EXTRA = 22; // lineH(15)=18 + marginTop 4
function readoutChrome(fontScale: number, withBadges: boolean, withGoal: boolean) {
  const timerLine = T.text.timer.fontSize * Math.max(fontScale, 1) * TIMER_LINE_RATIO;
  return {
    total: PLAIN_BASE + (withBadges ? POMODORO_EXTRA : 0) + (withGoal ? GOAL_EXTRA : 0) + timerLine,
    // 과목명 22 + (뽀모도로면 배지·도트의 글자 몫 ≈ 33) + (카운트다운이면 목표 라벨 18).
    // 타이머 몫은 위 total이 이미 배율을 먹었다.
    text: 22 + (withBadges ? 33 : 0) + (withGoal ? 18 : 0),
  };
}

export interface ReadoutLayout {
  /** 페이저 캐릭터 한 변(pt). 캡처 스냅샷 해상도이기도 하다. */
  charSize: number;
  /** 타이머 지정 fontSize(pt). 시스템 배율은 여기에 **곱해져서** 그려진다. */
  timerFontSize: number;
}

/**
 * @param availableH 안전 영역(노치·홈 인디케이터)을 뺀 실제 가용 높이
 * @param availableW 화면 폭 — 타이머 폭의 상한을 정한다
 * @param fontScale  시스템 글자 배율 (`useWindowDimensions().fontScale`)
 * @param withBadges 뽀모도로인가 — 세트배지·세트도트가 그려지므로 예산에 넣는다
 * @param withGoal   카운트다운인가 — '목표 HH:MM:SS' 줄이 그려지므로 예산에 넣는다
 */
export function focusReadoutLayout(
  availableH: number,
  availableW: number,
  fontScale: number,
  withBadges = false,
  withGoal = false,
): ReadoutLayout {
  const chrome = readoutChrome(fontScale, withBadges, withGoal);
  // 배율이 1보다 작아도 예산을 늘려 잡지 않는다 — 작은 글자로 얻은 여유는 그냥 여백으로 둔다.
  const grow = Math.max(fontScale, 1) - 1;
  const budgetH = Math.max(0, availableH - (CHROME_FRAME + chrome.total + chrome.text * grow));
  const fit = Math.min(1, Math.max(MIN_FIT, budgetH / BASE_CHAR));

  // **화면 폭**이라는 제약이 남는다. 이 화면의 유일한 핵심 정보인 숫자가 화면을 넘어 말줄임되면
  // 접근성 크기를 쓰는 사용자가 그걸 못 읽는다(codex 리뷰). 그래서 지정 크기를 폭에 맞춰 낮춘다.
  // 사용자의 확대를 되돌리는 게 아니다: 배율은 그대로 곱해지므로 그려지는 크기는 여전히 기본보다
  // 크고, 배율 1에서는 계산값이 기본값보다 커서 아무것도 바뀌지 않는다.
  const maxTextW = Math.max(0, availableW - H_MARGIN);
  const widthFitted = Math.floor(maxTextW / (Math.max(fontScale, 0.1) * TIMER_W_PER_PT));
  return {
    // ⚠️ **예산을 넘겨서까지 하한(MIN_FIT)을 지키지 않는다.** 접근성 배율이 극단이면
    //    (SE 647pt · 배율 3.1 뽀모도로) 프레임·확대된 글자·타이머가 이미 약 560pt를 먹어
    //    캐릭터 몫이 약 87pt뿐인데, 하한이 142pt를 강제하면 합계가 가용 높이를 넘겨
    //    리드아웃이 페이저를 밀어내고 캐릭터·도트가 겹친다(codex 리뷰).
    //    하한은 "여유가 있을 때 너무 쪼그라들지 말라"는 뜻이지 "없는 공간을 만들어 내라"가
    //    아니다. 남은 예산이 곧 상한이다.
    //    대가: 이 극단 조합에서는 캡처 PNG 해상도도 같이 낮아진다. 겹침보다는 낫다.
    charSize: Math.floor(Math.min(BASE_CHAR * fit, Math.max(0, budgetH))),
    timerFontSize: Math.max(1, Math.min(T.text.timer.fontSize, widthFitted)),
  };
}

/**
 * 이 배치가 세로로 **실제로 쓰는** 높이. 테스트가 검증 합계를 손으로 다시 쓰다가 항을 빠뜨리는
 * 걸 막으려고 계산 주체를 여기 하나로 둔다 — 실제로 `CHROME_FRAME`과 글자 몫이 빠져서 55pt
 * 초과를 통과시킨 적이 있다(codex 리뷰).
 */
export function readoutUsedHeight(
  layout: ReadoutLayout,
  fontScale: number,
  withBadges = false,
  withGoal = false,
): number {
  const chrome = readoutChrome(fontScale, withBadges, withGoal);
  const grow = Math.max(fontScale, 1) - 1;
  return CHROME_FRAME + chrome.total + chrome.text * grow + layout.charSize;
}
