import { Platform } from 'react-native';
import { buildOptions } from '../assets';
import { BODY_FONT, INK, lh, webOnly } from '../shared/styles';

// ───────────── 마을회관 ─────────────

// 마을회관 기능 화면: hall-desk · building-models · village-ledger · building-blueprint · island-management
// 수치는 원본 style.css에 .screen-hall(딸기 소다 키트) 규칙까지 겹친 계산값이다.

export const HALL_OUTLINE = '#8B6956';

export const BG = '#FFF7EB';

export const SURFACE = '#FFFDFA';

export const PRIMARY = '#FFA6BC';

export const HALL_SKY = '#ADE1F8';

export const MUTED = '#665348';

export const PAPER_INK = '#3e352e';
// .island-management-view 글자색
export const PLAN_INK = '#f7fcff';
// .building-blueprint-view 글자색

export type Option = (typeof buildOptions)[number];

type Weight = '400' | '700' | '800' | '850' | '900';

export type Tab = 'info' | 'residents' | 'requests';

// View는 글꼴을 물려주지 않으니 글자마다 크기·줄높이(px)·굵기·색·글꼴을 모두 준다.
// 줄높이는 CSS 값(글자 크기 × 배수)을 lh()로 넘긴다.
// 굵기 850: Gowun은 어느 굵기든 가짜 굵게로 같지만, Gowun에 없는 기호(× ↗ ‹)를 그리는 대체 글꼴은 굵기마다 모양이 달라 그대로 준다
export const hallFont = (
  fontSize: number,
  lineHeight: number,
  fontWeight: Weight = '400',
  color = INK,
  fontFamily = BODY_FONT,
) => ({
  fontFamily,
  fontSize,
  lineHeight: lh(lineHeight),
  fontWeight: (fontWeight === '850' && Platform.OS !== 'web' ? '800' : fontWeight) as any,
  color,
});

export const nowrap = () => webOnly({ whiteSpace: 'nowrap' });
