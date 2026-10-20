import React from 'react';
import {
  StyleSheet,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { componentTokens } from '@/design-system/tokens';

/*
 * 건물 모션 프레임은 모두 겹쳐 두고 UI 스레드에서 현재 프레임 하나만 보이게 한다.
 * 경과 시간(ms)을 Reanimated 로 흘리고 프레임 번호는 그 값에서 계산하므로 프레임마다 React 가 다시 그리지 않는다.
 */

/** 경과 ms 를 frameMs 간격 tick 으로 바꾼다. 타이머와 같은 ms 경계에서 넘어가도록 부동소수 오차를 반올림한다. */
export function motionTick(elapsedMs: number, frameMs: number): number {
  'worklet';
  return Math.floor(Math.round(elapsedMs) / frameMs);
}

/** elapsed 를 0 부터 durationMs 까지 UI 스레드에서 흘린다. loop 면 끝에서 0 으로 돌아가 반복한다. */
export function playMotion(elapsed: SharedValue<number>, durationMs: number, loop: boolean) {
  const timing = withTiming(durationMs, { duration: durationMs, easing: Easing.linear });
  elapsed.value = 0;
  elapsed.value = loop ? withRepeat(timing, -1) : timing;
}

/** 재생을 멈추고 경과 0(첫 프레임)으로 돌린다. */
export function stopMotion(elapsed: SharedValue<number>) {
  cancelAnimation(elapsed);
  elapsed.value = 0;
}

/** 겹쳐 둔 프레임 한 장. frame 이 index 일 때만 visibleOpacity 로 보인다. */
export function MotionFrameImage({
  frame,
  index,
  source,
  style,
  visibleOpacity = 1,
  testID,
}: {
  frame: DerivedValue<number>;
  index: number;
  source: ImageSourcePropType;
  style: StyleProp<ImageStyle>;
  visibleOpacity?: number;
  testID?: string;
}) {
  const visible = useAnimatedStyle(() => ({
    opacity: frame.value === index ? visibleOpacity : 0,
  }));
  return (
    <Animated.Image testID={testID} source={source} resizeMode="stretch" style={[style, visible]} />
  );
}

/**
 * 건물 테마 착색을 현재 모션 프레임의 알파 모양 그대로 덧입힌다.
 * 정적 테마 레이어 대신 이 레이어를 쓰면 진입·유휴 모션 어느 쪽에서도 닫힌 모습의 잔상이 남지 않는다.
 * 프레임마다 착색 레이어를 겹쳐 두고 현재 프레임의 것만 보인다(`${testID}-${프레임 번호}`).
 */
export function VillageThemeTint({
  sources,
  frame,
  testID,
}: {
  sources: readonly ImageSourcePropType[];
  frame: DerivedValue<number>;
  testID?: string;
}) {
  return sources.map((source, index) => (
    <MotionFrameImage
      key={index}
      frame={frame}
      index={index}
      source={source}
      style={styles.tint}
      visibleOpacity={componentTokens.villageBuildingThemeTint.opacity}
      testID={testID ? `${testID}-${index}` : undefined}
    />
  ));
}

const styles = StyleSheet.create({
  tint: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    tintColor: componentTokens.villageBuildingThemeTint.color,
  },
});
