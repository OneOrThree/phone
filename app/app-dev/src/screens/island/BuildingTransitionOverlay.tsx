import React, { useLayoutEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useAppLayout } from '@/utils/layout';
import { semanticTokens } from '@/design-system/tokens';
import {
  BUILDING_TRANSITION_EASING,
  BUILDING_TRANSITION_DURATION_MS,
  type BuildingTransitionState,
} from '@/services/buildingTransition';

type Props = {
  state: BuildingTransitionState;
  reduceMotion: boolean;
  origin: { x: number; y: number };
  delayMs?: number;
};

/** 공통 전환 막. 확대 애니메이션 동안 건물별 화면의 초기 로딩 UI가 먼저 드러나지 않게 가린다. */
export function BuildingTransitionOverlay({ state, reduceMotion, origin, delayMs = 0 }: Props) {
  const layout = useAppLayout();
  const progress = useRef(new Animated.Value(0)).current;
  const visible = state.phase !== 'idle';
  const diameter = Math.hypot(layout.width, layout.height) * 2;

  useLayoutEffect(() => {
    progress.stopAnimation();
    const returning = state.direction === 'return';
    progress.setValue(returning ? 1 : 0);
    if (!visible || reduceMotion) return;
    const timing = Animated.timing(progress, {
      toValue: returning ? 0 : 1,
      duration: BUILDING_TRANSITION_DURATION_MS,
      easing:
        BUILDING_TRANSITION_EASING === 'cubic-in-out' ? Easing.inOut(Easing.cubic) : Easing.linear,
      useNativeDriver: true,
    });
    const animation =
      !returning && delayMs > 0 ? Animated.sequence([Animated.delay(delayMs), timing]) : timing;
    animation.start();
    return () => animation.stop();
  }, [delayMs, progress, reduceMotion, state.generation, visible]);

  if (!visible || reduceMotion) return null;
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.015, 1] });
  return (
    <View
      testID="building-transition-overlay"
      pointerEvents="box-only"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', inset: 0, zIndex: 10000, overflow: 'hidden' }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          width: diameter,
          height: diameter,
          left: origin.x - diameter / 2,
          top: origin.y - diameter / 2,
          borderRadius: diameter / 2,
          backgroundColor: semanticTokens.color.canvas,
          transform: [{ scale }],
        }}
      />
    </View>
  );
}
