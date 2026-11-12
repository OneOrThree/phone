import { useWindowDimensions } from 'react-native';
import { useScreenInsets } from '@/design-system/primitives';

export function useAppLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useScreenInsets();
  const tablet = Math.min(width, height) >= 600;
  const landscape = width > height;
  const compact = landscape && !tablet;
  const contentWidth = Math.min(tablet ? 880 : 720, width - insets.left - insets.right);
  return {
    width,
    height,
    // Android 는 글자 크기 1.3 을 1.2999… 처럼 넘겨 「≥ 1.3」 큰 글자 판정이 빠진다(GROMO-2888) — 소수 둘째 자리로 맞춘다
    fontScale: Math.round(fontScale * 100) / 100,
    insets,
    tablet,
    landscape,
    compact,
    contentWidth,
    gutter: Math.max(20 + insets.left, (width - contentWidth) / 2 + 20),
    floatingWidth: Math.min(560, width - insets.left - insets.right - 40),
    // v2 가로 모달도 560(집중 준비). 확인창은 App에서 400으로 더 좁힌다
    modalWidth: Math.min(560, width - insets.left - insets.right - 40),
  };
}
