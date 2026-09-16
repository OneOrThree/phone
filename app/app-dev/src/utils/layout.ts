import { useWindowDimensions } from 'react-native';
import { useScreenInsets } from '@/design-system/primitives';

export function useAppLayout() {
  const { width, height } = useWindowDimensions();
  const insets = useScreenInsets();
  const tablet = Math.min(width, height) >= 600;
  const landscape = width > height;
  const compact = landscape && !tablet;
  const contentWidth = Math.min(tablet ? 880 : 720, width - insets.left - insets.right);
  return {
    width,
    height,
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
