import { Text as TypeText } from '@/design-system/typography';
import React from 'react';
import { BODY_FONT, INK, lh, webOnly } from './styles';

// 건물 안 장면은 시안 크기로 그린 뒤 통째로 키우므로 태블릿 글자 배율은 끄고, 공용 글자의 한국어 줄바꿈 기본값만 받는다
export const Text = (props: React.ComponentProps<typeof TypeText>) => (
  <TypeText tabletScale={1} {...props} />
);

// 원본 CSS의 font 값 (크기 · 줄높이 배수). View는 글꼴을 물려주지 않아 글자마다 지정한다.
// 줄높이는 lh()로 1/64px 내림: 크롬 원본과 같은 줄 높이가 된다 (중첩 Text는 px가 그대로 물려지므로 크기가 다르면 따로 준다)
export const boardFont = (
  size: number,
  lineHeight: number,
  weight: '400' | '700' | '800' = '400',
  color = INK,
  family = BODY_FONT,
): any => ({
  fontFamily: family,
  fontSize: size,
  lineHeight: lh(size * lineHeight),
  fontWeight: weight,
  color,
  ...webOnly({ whiteSpace: 'normal' }),
});

// 본문 글꼴 스택 한 벌 (font-size · line-height 배수)
export const obsFont = (
  fontSize: number,
  factor: number,
  color: string = INK,
  fontWeight: '400' | '700' | '800' | '900' = '400',
) => ({ fontFamily: BODY_FONT, fontSize, lineHeight: lh(fontSize * factor), color, fontWeight });
