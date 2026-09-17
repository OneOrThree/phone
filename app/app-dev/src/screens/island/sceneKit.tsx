import React from 'react';
import { Platform } from 'react-native';
import { useFonts } from 'expo-font';
import { Text } from '@/design-system/typography';
import { hoursMinutes } from '@/services/model';

// 도서관·마을회관 v2 장면이 같이 쓰는 글자·스타일 도구
export const INK = '#493B39';
export const BROWN = '#8B6956';
// 웹은 Gowun에 없는 기호가 시안과 같은 대체 글꼴로 그려지게 글꼴 스택째 넘긴다
const GOWUN_WEB = 'Gowun, "Apple SD Gothic Neo", sans-serif';
export function useGowun() {
  const [loaded] = useFonts({ Gowun: require('@/assets/fonts/gowun-dodum.ttf') });
  return Platform.OS === 'web' ? GOWUN_WEB : loaded ? 'Gowun' : undefined;
}
// 그림자 필터·CSS 그라데이션·줄바꿈 규칙은 웹에서만 시안대로 그린다
export const web = (style: object) => (Platform.OS === 'web' ? (style as any) : null);
// 책·카드처럼 크기가 고정된 장면 안 글자라 태블릿에서도 키우지 않는다
export function T({ style, ...p }: any) {
  return <Text tabletScale={1} {...p} style={[{ color: INK, letterSpacing: -0.15 }, style]} />;
}
// RN 웹 Image는 크기를 안 주면 원본 크기로 그리므로 폭·높이를 꼭 채운다
export const fill = {
  position: 'absolute' as const,
  left: 0,
  top: 0,
  width: '100%' as const,
  height: '100%' as const,
};
// 시안은 세로 위 52·가로 좌우 52짜리 안전영역을 기준으로 그렸다. 그보다 넓은 기기(노치·다이내믹
// 아일랜드)에서는 넘치는 만큼만 화면 가장자리 요소를 밀어 시안 좌표(402×874·874×402)는 그대로 둔다
export const safeOffset = (L: {
  landscape: boolean;
  insets: { top: number; left: number; right: number };
}) => ({
  top: Math.max(0, L.insets.top - (L.landscape ? 0 : 52)),
  left: Math.max(0, L.insets.left - 52),
  right: Math.max(0, L.insets.right - 52),
});
// 시안 표기: 1시간 미만 "M분", 정각은 "N시간", 그 외 "N시간 M분"
export const hm = (seconds: number) => hoursMinutes(seconds).replace(/ 0분$/, '');
