import { StyleSheet, type ColorValue } from 'react-native';
import { cubicBezier } from 'react-native-reanimated';
import { LiquidGlassView, isLiquidGlassSupported } from '@callstack/liquid-glass';
import { T, withAlpha } from '@/constants/theme';

// GROMO-848 리퀴드 글래스 선택 연출 공통 모듈 — 탭바·집중 플로우 선택 UI가 공유한다.
// (원래 screens/focus/components 소속이었으나 탭바도 쓰게 되어 전역 승격)
// iOS 26+(Xcode 26 빌드 + iOS 26 기기)는 네이티브 리퀴드 글래스, 미지원은 틴트 유리 폴백.
// ⚠️ @callstack/liquid-glass는 네이티브 모듈 — 이 JS를 구 바이너리에 OTA로 내보내면 크래시.

export { isLiquidGlassSupported };

export const SLIDE_MS = 350;

export const glassSlide = {
  transitionProperty: ['transform', 'opacity'] as ('transform' | 'opacity')[],
  transitionDuration: SLIDE_MS,
  // 탭바(1.56)보다 오버슛을 낮춘 커브 — 세로 이동 거리가 길어 같은 값이면 과하게 튄다
  transitionTimingFunction: cubicBezier(0.3, 1.15, 0.5, 1), // 슉 미끄러지고 아주 살짝 넘쳤다 안착
} as const;

// 폴백 알약 질감(미지원 기기) — 틴트 유리 + 옅은 포인트색 테두리.
// (탭바식 흰 테두리는 흰 카드 위를 미끄러질 때 흰 줄로 도드라져 제거)
export const glassPill = {
  backgroundColor: withAlpha(T.accent, 0.12),
  borderWidth: 1,
  borderColor: withAlpha(T.accent, 0.35),
} as const;

// 네이티브 유리 알약 채움 — 지원 시에만 그린다. 미지원이면 null을 반환하므로
// 호출부는 래퍼에 glassPill 폴백 스타일을 조건부로 유지해야 한다.
export function GlassPillFill({
  borderRadius,
  tintColor = withAlpha(T.accent, 0.15),
}: {
  borderRadius: number;
  tintColor?: ColorValue;
}) {
  if (!isLiquidGlassSupported) return null;
  return (
    <LiquidGlassView
      effect="clear"
      colorScheme="light"
      tintColor={tintColor}
      style={[StyleSheet.absoluteFill, { borderRadius }]}
    />
  );
}
