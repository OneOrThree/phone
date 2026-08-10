// 집중 세션(세로)의 '캐릭터 + 진행 링' 세로 예산 계산 (GROMO-1381).
//
// 화면 모듈에서 떼어 낸 **순수 함수**다. FocusSessionScreen을 import 하면 서비스·컨텍스트 체인이
// 통째로 딸려와 jest에서 못 돌리는데, 여기 로직은 기기·글자 배율 조합마다 못을 박아야 하는
// 산수라서 따로 둔다.
//
// ── 왜 계산이 필요한가 ────────────────────────────────────────────────────────────────
// 링과 캐릭터를 각각 고정 크기로 두면 667pt 기기(SE·8)에서 둘의 합(460)이 남는 공간(약 371)을
// 넘어 캐릭터가 링·페이지 도트와 겹친다. 게다가 Text의 allowFontScaling 기본값 때문에 시스템
// '글자 크기'를 키운 사용자에게는 타이머가 **다시 확대**되어 고정 pt 링을 뚫고 나간다(codex 리뷰).
//
// ── 무엇을 양보시키는가 (접근성 판단) ──────────────────────────────────────────────────
// 타이머 숫자에는 maxFontSizeMultiplier를 **걸지 않는다.** 이 화면에서 사용자가 실제로 읽어야
// 하는 정보는 남은 시간 하나이고, 링은 같은 값을 한 번 더 그린 **장식**이다. 숫자를 잘라
// 링을 지키면 "글자를 키운 사용자에게만 이 화면이 예외"가 되는데, 그건 접근성 설정을 무시하는 것과
// 같다. 그래서 양보 순서를 뒤집었다:
//   ① 배율이 오르면 링이 숫자 폭에 맞춰 **커진다**
//   ② 커진 만큼 캐릭터가 줄어 값을 치른다(장식이 기능에 자리를 내준다)
//   ③ 캐릭터가 최소치도 못 받으면 **링을 포기**하고 숫자만 남긴다 — 카운트업이 이미 쓰는 배치라
//      새 레이아웃이 아니다. 진행률은 숫자로 계속 읽을 수 있으므로 정보 손실이 없다.

import { T } from '@/constants/theme';

/** 링 두께. 얇게 두는 이유는 가운데 타이머 숫자가 주인공이기 때문. */
export const RING_STROKE = 6;
/** 링 안쪽 여백 — 숫자가 획에 닿아 보이지 않을 최소치. */
const RING_PAD = 6;

const BASE_CHAR = 230;
const BASE_RING = 230;
/** 이보다 작아지면 캐릭터가 '있으나 마나'가 된다 — 그 아래로는 링을 포기한다. */
const MIN_CHAR = 120;
/** 안전 하한. 현재 지원 기기(≥667pt)·표준 배율에선 걸리지 않는다. */
const MIN_FIT = 0.62;

/**
 * 타이머 문자열의 폭 ÷ 지정 fontSize.
 * hms()는 항상 8글자(HH:MM:SS)이고 tabular-nums라 문자열 내용과 무관하게 폭이 같다.
 * 52pt에서 약 200pt를 실측해 얻은 값이다.
 */
const TIMER_W_PER_PT = 3.85;

/**
 * 리드아웃이 가로로 쓸 수 있는 폭 = 화면 폭 − 이 여백. 링 지름과 평문 타이머 폭 양쪽의 상한이다.
 * (s.readout에는 paddingHorizontal이 없어 폭을 다 쓸 수 있지만, 화면 가장자리에 글자가 닿지 않게
 *  다른 영역과 같은 좌우 여백 T.space.xxl(24)×2를 남긴다.)
 */
const H_MARGIN = 48;

/**
 * 평문(링 없음) 타이머가 폭에 못 들어갈 때를 대비한 최후 방어선. 계산은 TIMER_W_PER_PT 추정에
 * 기대는데, 실제 폰트 메트릭이 추정보다 넓으면 말줄임이 난다 — 그때 잘리는 대신 줄어들게 한다.
 * ⚠️ **링이 있는 경로에는 절대 붙이지 않는다.** 링 지름 계산이 '지정 크기대로 그려진다'는 전제
 *    위에 서 있어서, 렌더가 제멋대로 줄면 링 안이 비어 보인다(codex 리뷰).
 */
export const PLAIN_TIMER_MIN_FONT_SCALE = 0.6;

// 세로 고정 요소(실측): topBar 52(36 + paddingVertical 8×2) + dots 23(7 + 8×2)
//                     + controls 90(60 + paddingBottom 30)
const CHROME_FRAME = 165;
// readout 안에서 링/숫자 **밖**의 높이. 글자 배율에 따라 커지는 '글자 몫'을 따로 들고 있는다.
//   링 있음: paddingBottom 20 + 세트배지 34 + 과목명 30 + 세트도트 21 = 105 (글자 몫 ≈ 48)
//           (뽀모도로 = 최악. 모드가 바뀌어도 캐릭터 크기가 흔들리지 않게 이 값으로 통일한다)
//   링 없음: paddingBottom 20 + 과목명 30                             = 50  (글자 몫 ≈ 22)
const READOUT_RING = { total: 105, text: 48 };
// ⚠️ 링이 없으면 타이머가 **링 밖의 독립된 줄**이 되므로 그 높이가 예산에 들어가야 한다.
//    (링이 있을 때는 숫자가 링 안이라 별도 높이가 없다.)
//    그리고 뽀모도로는 폴백으로 내려가도 세트배지·세트도트를 계속 그린다 — 그걸 빼면
//    캐릭터를 230pt로 유지한 채 리드아웃이 페이저를 밀어내 도트·캐릭터가 겹친다(codex 리뷰).
//    타이머 줄 높이는 지정 크기가 정해지기 **전에** 필요해 순환하므로, 상한(52pt × 배율)으로
//    잡는다 — 보수적이라 캐릭터가 조금 작아질 뿐 겹치지는 않는다.
// 화면이 쓰는 행높이 비율과 같은 값 — 두 곳이 갈리면 예산이 어긋난다.
export const TIMER_LINE_RATIO = 1.08;
export const PLAIN_BASE = 50; // paddingBottom 20 + 과목명 30
export const POMODORO_EXTRA = 55; // 세트배지 34 + 세트도트 21
function plainChrome(fontScale: number, withBadges: boolean) {
  const timerLine = T.text.timer.fontSize * Math.max(fontScale, 1) * TIMER_LINE_RATIO;
  return {
    total: PLAIN_BASE + (withBadges ? POMODORO_EXTRA : 0) + timerLine,
    // 과목명 22 + (뽀모도로면 배지·도트의 글자 몫 ≈ 33). 타이머 몫은 위 total이 이미 배율을 먹었다.
    text: 22 + (withBadges ? 33 : 0),
  };
}

export interface ReadoutLayout {
  /** 링을 그릴 수 있는가. false면 숫자만 있는 배치(카운트업과 동일)로 내려간다. */
  showRing: boolean;
  /** 페이저 캐릭터 한 변(pt). 캡처 스냅샷 해상도이기도 하다. */
  charSize: number;
  /** 링 바깥 지름(pt). showRing=false면 0. */
  ringSize: number;
  /** 타이머 지정 fontSize(pt). 시스템 배율은 여기에 **곱해져서** 그려진다. */
  timerFontSize: number;
}

function solve(
  availableH: number,
  availableW: number,
  fontScale: number,
  withRing: boolean,
  withBadges: boolean,
): ReadoutLayout {
  const chrome = withRing ? READOUT_RING : plainChrome(fontScale, withBadges);
  // 배율이 1보다 작아도 예산을 늘려 잡지 않는다 — 작은 글자로 얻은 여유는 그냥 여백으로 둔다.
  const grow = Math.max(fontScale, 1) - 1;
  const budgetH = Math.max(0, availableH - (CHROME_FRAME + chrome.total + chrome.text * grow));
  const need = withRing ? BASE_CHAR + BASE_RING : BASE_CHAR;
  const fit = Math.min(1, Math.max(MIN_FIT, budgetH / need));

  if (!withRing) {
    // 링이 없어도 **화면 폭**이라는 제약은 남는다. 링을 포기한 이유가 "숫자는 지킨다"인데
    // 그 숫자가 화면을 넘어 말줄임되면 사다리의 마지막 칸이 무너진다(codex 리뷰) — 접근성
    // 크기를 쓰는 사용자가 이 화면의 유일한 핵심 정보를 못 읽게 된다.
    // 그래서 지정 크기를 폭에 맞춰 낮춘다. 사용자의 확대를 되돌리는 게 아니다: 배율은 그대로
    // 곱해지므로 **그려지는 크기는 여전히 기본(52pt)보다 크고**, 다만 8글자가 물리적으로 들어갈
    // 수 있는 최대치에서 멈춘다. 배율 1에서는 계산값이 기본값보다 커서 아무것도 바뀌지 않는다
    // (= 기존 카운트업 렌더와 바이트 단위로 동일).
    const maxTextW = Math.max(0, availableW - H_MARGIN);
    const widthFitted = Math.floor(maxTextW / (Math.max(fontScale, 0.1) * TIMER_W_PER_PT));
    return {
      showRing: false,
      charSize: Math.floor(BASE_CHAR * fit),
      ringSize: 0,
      timerFontSize: Math.max(1, Math.min(T.text.timer.fontSize, widthFitted)),
    };
  }

  const timerFontSize = Math.floor(T.text.timer.fontSize * fit);
  // 실제로 그려지는 폭 = 지정 크기 × 시스템 배율. 링은 이걸 반드시 품어야 한다.
  const renderedW = timerFontSize * fontScale * TIMER_W_PER_PT;
  const ringSize = Math.max(
    Math.floor(BASE_RING * fit),
    Math.ceil(renderedW) + 2 * RING_STROKE + 2 * RING_PAD,
  );
  // 링이 커진 만큼은 캐릭터가 낸다.
  const charSize = Math.floor(Math.min(BASE_CHAR * fit, budgetH - ringSize));
  return { showRing: true, charSize, ringSize, timerFontSize };
}

/**
 * @param availableH 안전 영역(노치·홈 인디케이터)을 뺀 실제 가용 높이
 * @param availableW 화면 폭 — 링 지름과 평문 타이머 폭의 상한을 함께 정한다
 * @param fontScale  시스템 글자 배율 (`useWindowDimensions().fontScale`)
 * @param wantRing   진행률이 정의되는 모드인가 (카운트업은 목표가 없어 false)
 * @param withBadges 뽀모도로인가 — 링을 포기해도 세트배지·세트도트는 계속 그려지므로 예산에 넣는다
 */
export function focusReadoutLayout(
  availableH: number,
  availableW: number,
  fontScale: number,
  wantRing: boolean,
  withBadges = false,
): ReadoutLayout {
  if (!wantRing) return solve(availableH, availableW, fontScale, false, withBadges);
  const ringed = solve(availableH, availableW, fontScale, true, withBadges);
  // 링 배치를 쓰려면 세로(캐릭터가 최소치 이상)와 가로(링이 화면 폭 안) 둘 다 만족해야 한다.
  // 하나라도 못 지키면 숫자만 남기는 배치로 내려간다 — 정보는 숫자에 그대로 남는다.
  const fitsV = ringed.charSize >= MIN_CHAR;
  const fitsH = ringed.ringSize <= Math.max(0, availableW - H_MARGIN);
  return fitsV && fitsH ? ringed : solve(availableH, availableW, fontScale, false, withBadges);
}
