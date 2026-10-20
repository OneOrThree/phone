import React, { useContext, useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { MotionContext } from '@/design-system/primitives';
import {
  MotionFrameImage,
  VillageThemeTint,
  motionTick,
  playMotion,
  stopMotion,
} from './VillageThemeTint';
import { componentTokens, semanticTokens } from '@/design-system/tokens';

export type VillageHallState = 'normal' | 'arrival' | 'new-record' | 'weekly-goal';

const frames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/hall/frame-0.png'),
  require('@/assets/village-world/motion/hall/frame-1.png'),
  require('@/assets/village-world/motion/hall/frame-2.png'),
  require('@/assets/village-world/motion/hall/frame-3.png'),
];
// 밤 프레임은 낮 frame-0~3 과 크기·발밑 기준점이 같다(night-frame-0 은 정본 밤 레이어 crop).
const nightFrames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/hall/night-frame-0.png'),
  require('@/assets/village-world/motion/hall/night-frame-1.png'),
  require('@/assets/village-world/motion/hall/night-frame-2.png'),
  require('@/assets/village-world/motion/hall/night-frame-3.png'),
];
const doorSequence = [0, 1, 2, 3, 2, 1] as const;
const frameDuration = 180;

/** 시청의 문 프레임 모션과 기록/주간 목표 강조를 표시한다. */
export function VillageHallMotion({
  state = 'normal',
  tooltip,
  reduceMotion = false,
  night = false,
  themed = false,
  generation = 0,
  style,
  testID = 'village-hall-motion',
}: {
  state?: VillageHallState;
  tooltip?: ReactNode;
  reduceMotion?: boolean;
  /** 밤 마을이면 같은 모션을 밤 프레임으로 재생한다. */
  night?: boolean;
  themed?: boolean;
  generation?: number;
  style?: ViewStyle;
  testID?: string;
}) {
  const motionDisabled = useContext(MotionContext) || reduceMotion;
  const elapsed = useSharedValue(0);
  const frame = useDerivedValue<number>(
    () => doorSequence[motionTick(elapsed.value, frameDuration) % doorSequence.length],
  );

  useEffect(() => {
    if (motionDisabled || state === 'normal') return;
    playMotion(elapsed, doorSequence.length * frameDuration, true);
    return () => stopMotion(elapsed);
  }, [elapsed, generation, motionDisabled, state]);

  return (
    <View testID={testID} style={[styles.root, style]}>
      {(night ? nightFrames : frames).map((source, index) => (
        <MotionFrameImage
          key={index}
          frame={frame}
          index={index}
          testID={`village-hall-frame-${index}`}
          source={source}
          style={styles.frame}
        />
      ))}
      {themed && (
        <VillageThemeTint
          sources={night ? nightFrames : frames}
          frame={frame}
          testID="village-hall-theme-tint"
        />
      )}
      {tooltip != null && (
        <View testID="village-hall-tooltip" style={styles.tooltip}>
          {tooltip}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', position: 'relative' },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  tooltip: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: '100%',
    maxWidth: '100%',
    paddingHorizontal: semanticTokens.spacing.control,
    paddingVertical: componentTokens.villageNotificationTooltip.paddingVertical,
    backgroundColor: semanticTokens.color.surface,
    borderColor: semanticTokens.color.outline,
    borderWidth: 1.5,
    borderRadius: semanticTokens.radius.control,
  },
});
