import React, { useMemo } from 'react';
import {
  Animated,
  StyleSheet,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
} from 'react-native';
import { componentTokens } from '@/design-system/tokens';
import { frameOpacityRange, type CatKeyPose } from '../catMotion';

/*
 * 건물 모션 프레임은 모두 겹쳐 두고 현재 프레임 하나만 보이게 한다.
 * 경과 시간(ms)을 네이티브 드라이버(Animated, catMotion 의 playMotion)로 흘리고 각 프레임의 opacity 는
 * 그 값의 계단 함수라서 프레임마다 JS·React 가 깨지 않는다.
 */

/** [프레임 번호, 유지 ms] 시간표(catMotion 의 frameSteps·playMotion 으로 만들고 재생한다). 경과가 끝을 넘으면 마지막 프레임에 머문다. */
export type MotionStep = CatKeyPose;

/** 겹쳐 둔 프레임 한 장. 경과 값이 steps 에서 index 차례일 때만 visibleOpacity 로 보인다. */
export function MotionFrameImage({
  elapsed,
  steps,
  index,
  source,
  style,
  visibleOpacity = 1,
  testID,
}: {
  elapsed: Animated.Value;
  steps: readonly MotionStep[];
  index: number;
  source: ImageSourcePropType;
  style: StyleProp<ImageStyle>;
  visibleOpacity?: number;
  testID?: string;
}) {
  const opacity = useMemo(() => {
    const { inputRange, outputRange } = frameOpacityRange(steps, index);
    return elapsed.interpolate({
      inputRange,
      outputRange: outputRange.map((shown) => shown * visibleOpacity),
      extrapolate: 'clamp',
    });
  }, [elapsed, steps, index, visibleOpacity]);
  return (
    <Animated.Image
      testID={testID}
      source={source}
      resizeMode="stretch"
      style={[style, { opacity }]}
    />
  );
}

/**
 * 건물 테마 착색을 현재 모션 프레임의 알파 모양 그대로 덧입힌다.
 * 정적 테마 레이어 대신 이 레이어를 쓰면 진입·유휴 모션 어느 쪽에서도 닫힌 모습의 잔상이 남지 않는다.
 * 프레임마다 착색 레이어를 겹쳐 두고 현재 프레임의 것만 보인다(`${testID}-${프레임 번호}`).
 */
export function VillageThemeTint({
  sources,
  elapsed,
  steps,
  testID,
}: {
  sources: readonly ImageSourcePropType[];
  elapsed: Animated.Value;
  steps: readonly MotionStep[];
  testID?: string;
}) {
  return sources.map((source, index) => (
    <MotionFrameImage
      key={index}
      elapsed={elapsed}
      steps={steps}
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
