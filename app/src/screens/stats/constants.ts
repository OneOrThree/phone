// 통계 화면 공용 상수 — 지표 색·캘린더 팔레트·요일 라벨, 그리고 **카드 높이 상수**.
// 카드 파일들이 공유한다.
import { T } from '@/constants/theme';
import type { StatsPeriod } from '@/types/dto/stats';

// 캘린더 셀 강도 0..4 색(빈 칸 → 진한 인디고) — 주/월 캘린더(GROMO-974).
export const CAL_RAMP = T.calendarRamp;
export const FOCUS_COLOR = T.greenDeep;
// 폰 사용 지표는 경고 계열(테라코타) — 메인 액센트를 쓰면 '줄여야 할 지표'가 브랜드색으로
// 강조되는 의미 역전이 생긴다. 집중(초록)과 대비되는 시안의 색 의미 복원(GROMO-849)
export const PHONE_COLOR = T.accentAlt;
// 요일 라벨(월~일) — 잔디·목표 달성·주간 타임라인 카드 공용
export const WEEK_DAYS = ['월', '화', '수', '목', '금', '토', '일'];

// ─────────────────────────────────────────────────────────────────────────────
// 카드 높이 상수 (GROMO-1381)
//
// 첫 로딩 스켈레톤(StatsSkeleton)이 **실제 카드와 같은 높이**를 차지해야 데이터가 도착하는
// 순간 레이아웃이 튀지 않는다. 튀면 스켈레톤을 넣기 전보다 완성도가 내려간다.
// 그래서 카드 높이를 여기 한 곳에 두고 **실제 카드와 스켈레톤이 같은 상수를 읽게** 묶는다 —
// 카드 안쪽 치수(차트 높이·도넛 지름·격자 칸)를 바꾸면 스켈레톤도 자동으로 따라온다.
//
// ⚠️ 조사 결과 이 화면에 원래 있던 높이 상수는 CHART_H(120)·WTT_BODY_H(400)·DONUT_SIZE(132)
//    셋뿐이었다. 나머지는 콘텐츠가 정하는 높이라 아래처럼 **구성 요소를 더해 계측**했다.
// ⚠️ 글자 상자 높이는 근사다 — RN Text에 lineHeight를 주지 않으면 폰트 메트릭을 쓰고,
//    SF Pro는 대략 fontSize × 1.2다. ±1~2px 오차는 카드당 허용한다(스켈레톤은 자리표시자다).
// ─────────────────────────────────────────────────────────────────────────────

/** lineHeight를 지정하지 않은 Text 한 줄의 높이 근사. */
const lineH = (fontSize: number) => Math.round(fontSize * 1.2);

// ── 카드 프레임(SectionCard) ── SectionCard가 이 값들로 스타일을 만든다.
export const CARD_BORDER_W = 1;
export const CARD_RADIUS = 18;
export const CARD_PAD = T.space.lg;
/** 카드 목록의 좌우 여백 — CardOrderEditor의 콘텐츠 패딩이자 로딩 스켈레톤의 패딩 */
export const LIST_PAD_H = T.space.xl;

/**
 * 카드 **안쪽** 폭 — 화면 폭에서 목록 좌우 여백과 카드 테두리·패딩을 뺀 값.
 * 폭에서 파생되는 치수(캘린더 셀)를 실제 그리드와 같은 식으로 구하려고 뽑아 둔다.
 */
export const cardInnerWidth = (screenWidth: number) =>
  screenWidth - LIST_PAD_H * 2 - (CARD_BORDER_W + CARD_PAD) * 2;
/** 제목 줄(heading 21) + 본문과의 간격 */
export const CARD_HEAD_H = lineH(T.text.heading.fontSize) + T.space.md; // 37
/** 부제가 붙는 카드 — 제목·부제를 붙이고(xs) 본문 간격은 부제가 담당한다 */
export const CARD_HEAD_SUB_H =
  lineH(T.text.heading.fontSize) + T.space.xs + lineH(T.text.caption.fontSize) + T.space.md; // 57
/** 본문을 뺀 카드 껍데기 높이 — 테두리 2 + 상하 패딩 32 + 머리 */
const CARD_CHROME_H = CARD_BORDER_W * 2 + CARD_PAD * 2 + CARD_HEAD_H; // 71
const CARD_CHROME_SUB_H = CARD_BORDER_W * 2 + CARD_PAD * 2 + CARD_HEAD_SUB_H; // 91

// ── 본문 조각 ──
/** 히어로 숫자 한 줄(cs.bigStat = T.text.title) */
const HERO_H = lineH(T.text.title.fontSize); // 31
/** 카드 하단 안내 문구(cs.grassHint) — 위 간격 + 캡션 한 줄 */
const HINT_H = T.space.md + lineH(T.text.caption.fontSize); // 28
/** 공유하기 버튼 줄(cs.shareBtn) */
const SHARE_BTN_H = T.space.md + lineH(T.text.caption.fontSize); // 28

/** 세로축 차트 플롯 높이 — LineChart·FirstStartChart 공용(charts.tsx가 읽는다) */
export const CHART_H = 120;
/** 차트 블록 = 위 간격 + 플롯 + 가로 라벨 줄 (LineChart 한 벌의 높이) */
export const CHART_BLOCK_H = T.space.lg + CHART_H + (T.space.sm + lineH(10)); // 156
/** 첫 시작 시각 차트 본문 = 차트 + 아래 안내 문구 */
export const FIRST_START_BODY_H = CHART_BLOCK_H + HINT_H; // 184

/** 과목별 도넛 지름 — CategoryDonut이 읽는다 */
export const DONUT_SIZE = 132;
/** 도넛 블록 = 위 간격 + 링(범례는 링보다 낮다) */
export const DONUT_BLOCK_H = T.space.sm + DONUT_SIZE; // 140

/** '나 vs 평균' 막대 2세트(CompareBars) — 축 조회 중 이 높이를 예약한다 */
export const COMPARE_BARS_H =
  T.space.xs * 2 + // teaserPad
  (lineH(T.text.caption.fontSize) + T.space.xs) * 2 + // 라벨 줄 2개 40
  10 * 2 + // 트랙 2개 20
  T.space.md; // 두 세트 사이 12
// = 80

/** 비교 블록(Compare) — 축 칩 한 줄 + 막대 2세트 */
const COMPARE_H =
  T.space.lg + // s.compare marginTop
  (T.space.sm * 2 + lineH(T.text.caption.fontSize)) + // 칩 줄 32
  T.space.sm + // s.compare gap
  COMPARE_BARS_H;
// = 136

// ── 오늘 타임테이블(일) 격자 — FocusTimetableCard가 읽는다 ──
export const TT_CELL_H = 14;
export const TT_ROW_GAP = 3;
/** 오전 6시부터 24줄(한 줄 = 1시간) */
export const TT_ROWS = 24;
/** 격자 본문(범례 열 포함) — 오늘 세션 조회 중 이 높이를 예약한다 */
export const TT_BODY_BLOCK_H = T.space.lg + (TT_ROWS * TT_CELL_H + (TT_ROWS - 1) * TT_ROW_GAP); // 421
const TT_BLOCK_H = TT_BODY_BLOCK_H + SHARE_BTN_H; // 449

// ── 요일별 타임테이블(주) — WeeklyTimetableCard가 읽는다 ──
export const WTT_BODY_H = 400;
/** 요일 헤더 + 트랙 — 주간 세션 조회 중 이 높이를 예약한다(공유 버튼은 카드 몫이라 제외) */
export const WTT_BODY_BLOCK_H = T.space.sm + lineH(12) + T.space.xs + WTT_BODY_H; // 426
const WTT_BLOCK_H = WTT_BODY_BLOCK_H + SHARE_BTN_H; // 454

// ── 캘린더(주·월) ──
// 셀 비율·간격은 CalendarCard의 그리드 스타일이 그대로 읽는다. 셀 높이는 **폭에서 파생**되므로
// (flex:1 + aspectRatio) 상수로 못 박으면 큰 화면에서 어긋난다 — 430pt 기기는 셀이 57px대라
// 6행 월이면 40px 가까이 모자란다(codex 리뷰). 그래서 폭을 받아 같은 식으로 계산한다.
export const CAL_CELL_ASPECT = 40 / 46;
export const CAL_GRID_GAP = 1;
/** 캘린더 셀 한 칸의 높이 — 한 줄 7칸을 간격만큼 뺀 폭으로 나누고 비율을 되돌린다. */
export const calendarCellH = (screenWidth: number) =>
  (cardInnerWidth(screenWidth) - CAL_GRID_GAP * 6) / 7 / CAL_CELL_ASPECT;
const CAL_HEAD_H =
  lineH(T.text.label.fontSize) +
  lineH(11) + // ‹ 라벨 › 줄 31
  (T.space.xs + lineH(12) + T.space.md) + // 총 집중 줄 30
  (lineH(10) + T.space.xs); // 요일 헤더 16
const calendarBlockH = (rows: number, screenWidth: number) =>
  CAL_HEAD_H + rows * calendarCellH(screenWidth) + (rows - 1) * CAL_GRID_GAP;

// ── 목표 달성 스탬프(일) — GoalCards가 읽는다 ──
export const STAMP_ICON_SIZE = 44;
export const STAMP_BLOCK_H =
  1.5 * 2 + // 테두리
  T.space.lg * 2 + // 상하 패딩
  STAMP_ICON_SIZE +
  T.space.sm +
  lineH(T.text.label.fontSize) + // 제목
  2 +
  lineH(T.text.caption.fontSize); // 부제
// = 123

// ── 합격자 레이더 티저 — PasserCompareChart가 읽는다 ──
export const RADAR_SIZE = 210;
const PASSER_BLOCK_H = T.space.xs * 2 + RADAR_SIZE + (T.space.md + lineH(11)); // 243

/** 전 대비 행 2개(DeltaRow) */
const DELTA_BLOCK_H = (T.space.sm * 2 + lineH(T.text.subtitle.fontSize)) * 2; // 78

/** 최장 연속 집중 — 히어로 + 안내 문구. 세션 조회 중에도 이 높이를 예약한다 */
export const LONGEST_BODY_H = HERO_H + HINT_H; // 59

/**
 * 첫 로딩 스켈레톤이 그릴 카드 목록(탭별 기본 순서 + 높이).
 *
 * ⚠️ 순서·구성은 `StatsScreen`의 `cards.push(...)` 순서와 같아야 한다. 저장된 순서
 *    (AsyncStorage)는 아직 로드되기 전이라 기본 순서로 그리는 게 맞다.
 * 동시 표시 개수는 일 7장 / 주·월 9장 — 저사양 기기 프레임 예산상 상한 12장 이내다.
 *
 * @param calendarRows 목표 달성 카드가 그릴 캘린더 행 수. 주는 항상 1이지만 **월은 달마다
 *   5행이거나 6행**이다(1일 요일 + 말일에 따라. 예: 2026-08은 앞 빈칸 5 + 31일 = 6행).
 *   호출부가 `calendarRowCount(period, 0)`(format.ts)로 구해 넘긴다 — 실제 그리드와 같은 식을
 *   써야 도착 순간 한 행이 갑자기 늘어나지 않는다.
 *   여기서 직접 구하지 않는 이유는 format.ts가 이미 이 모듈을 import하고 있어서다(순환 참조 회피).
 * @param screenWidth 화면 폭. 캘린더 셀 높이가 폭에서 파생되므로(aspectRatio) 반드시 실제
 *   값(useWindowDimensions)을 넘긴다 — 고정값으로 두면 큰 화면에서 카드가 짧아진다.
 */
export function skeletonCards({
  period,
  calendarRows,
  screenWidth,
}: {
  period: StatsPeriod;
  calendarRows: number;
  screenWidth: number;
}): { key: string; height: number }[] {
  const cards: { key: string; height: number }[] = [
    { key: 'total', height: CARD_CHROME_H + HERO_H + COMPARE_H },
    {
      key: 'goalAchieve',
      height:
        period === 'DAY'
          ? CARD_CHROME_H + STAMP_BLOCK_H
          : CARD_CHROME_H + calendarBlockH(calendarRows, screenWidth),
    },
    { key: 'category', height: CARD_CHROME_H + DONUT_BLOCK_H },
  ];
  if (period === 'DAY') {
    cards.push({ key: 'timetable', height: CARD_CHROME_H + TT_BLOCK_H });
  }
  if (period === 'MONTH') {
    cards.push({ key: 'monthWeeklyFocus', height: CARD_CHROME_H + HERO_H + CHART_BLOCK_H });
    cards.push({ key: 'monthWeeklyPhone', height: CARD_CHROME_SUB_H + HERO_H + CHART_BLOCK_H });
  }
  if (period === 'WEEK') {
    cards.push({ key: 'weekdayFocus', height: CARD_CHROME_H + HERO_H + CHART_BLOCK_H });
    cards.push({ key: 'weekdayPhone', height: CARD_CHROME_SUB_H + HERO_H + CHART_BLOCK_H });
  }
  if (period !== 'DAY') {
    cards.push({
      key: 'firstStart',
      height: period === 'WEEK' ? CARD_CHROME_H + WTT_BLOCK_H : CARD_CHROME_H + FIRST_START_BODY_H,
    });
  }
  cards.push({ key: 'longest', height: CARD_CHROME_H + LONGEST_BODY_H });
  cards.push({ key: 'passer', height: CARD_CHROME_H + PASSER_BLOCK_H });
  cards.push({ key: 'delta', height: CARD_CHROME_H + DELTA_BLOCK_H });
  return cards;
}
