import { GOWUN, useGowunFont } from '@/screens/island/sceneKit';
import { Asset } from 'expo-asset';
import { ImageSourcePropType, Platform } from 'react-native';

// 원본 body 글꼴 스택. 웹에서는 Gowun에 없는 기호가 원본과 같은 대체 글꼴로 그려지게 스택째 넘긴다
export const BODY_FONT =
  Platform.OS === 'web'
    ? "Gowun,-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif"
    : GOWUN;

export { GOWUN };

export const INK = '#493b39';

export const OUTLINE = '#7d5f4d';

// CSS 그라데이션 문자열: 웹은 background-image, 네이티브는 RN 0.76+의 experimental_backgroundImage
export const gradient = (css: string): any =>
  Platform.OS === 'web' ? { backgroundImage: css } : { experimental_backgroundImage: css };

// 웹 전용 CSS (backdrop-filter 등). 네이티브에서는 무시한다
export const webOnly = (style: Record<string, unknown>): any =>
  Platform.OS === 'web' ? style : null;

// react-native-web은 반투명 색의 알파를 소수 둘째 자리로 반올림해 원본과 1단계 어긋난다.
// var() 로 감싸면 색 문자열을 그대로 CSS에 넘긴다 (변수는 없으니 뒤의 색이 쓰인다)
export const exact = (color: string): string =>
  Platform.OS === 'web' ? `var(--exact,${color})` : color;

// CSS text-shadow 한 겹 (x y 색). 웹은 문자열 그대로, 네이티브는 textShadow* 로 푼다
export const textShadow = (x: number, y: number, color: string): any =>
  Platform.OS === 'web'
    ? { textShadow: `${x}px ${y}px ${color}` }
    : { textShadowColor: color, textShadowOffset: { width: x, height: y }, textShadowRadius: 0 };

// 웹에서 원본 CSS와 같은 방식으로 그림을 깔 때 쓰는 주소
export const assetUri = (source: ImageSourcePropType) =>
  typeof source === 'object' && !Array.isArray(source) && source.uri
    ? source.uri
    : Asset.fromModule(source as number).uri;

// 원본 크롬은 줄 높이를 1/64px 단위로 내려 잡는다. 같은 높이로 맞춰야 회전한 요소 가장자리가 어긋나지 않는다
export const lh = (px: number) => Math.floor(px * 64) / 64;

// 장면 글꼴은 고운돋움 하나다(DESIGN.md §5.1). 네이티브는 앱에 들어 있어 첫 렌더부터 불러온 상태다
export const useInteriorFonts = useGowunFont;

export const fill = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };

export const MAIL_LAND = { left: 338, right: 36 };
