import React, { useContext, useEffect } from 'react';
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

export type ObservatoryRankState = 'normal' | 'rank-updated' | 'rank-changed';
export type ObservatoryDayNight = 'day' | 'night';

const frames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/observatory/frame-0.png'),
  require('@/assets/village-world/motion/observatory/frame-1.png'),
  require('@/assets/village-world/motion/observatory/frame-2.png'),
  require('@/assets/village-world/motion/observatory/frame-3.png'),
];
// 밤 프레임은 낮 frame-0~3 과 크기·발밑 기준점이 같다(night-frame-0 은 정본 밤 레이어 crop).
const nightFrames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/observatory/night-frame-0.png'),
  require('@/assets/village-world/motion/observatory/night-frame-1.png'),
  require('@/assets/village-world/motion/observatory/night-frame-2.png'),
  require('@/assets/village-world/motion/observatory/night-frame-3.png'),
];
const sequence = [0, 1, 2, 3] as const;
const frameDuration = 220;

/** 전망대 진입 시 4프레임 모션을 한 번 재생하고 닫힌 기본 프레임으로 돌아간다. */
export function VillageObservatoryMotion({
  rankState = 'normal',
  dayNight = 'day',
  generation = 0,
  showFrames = true,
  themed = false,
  reduceMotion = false,
  night = false,
  style,
  testID = 'village-observatory-motion',
}: {
  rankState?: ObservatoryRankState;
  dayNight?: ObservatoryDayNight;
  generation?: number;
  showFrames?: boolean;
  /** 건물 테마가 적용되면 현재 프레임 위에 테마 착색을 덧입힌다. */
  themed?: boolean;
  reduceMotion?: boolean;
  /** 밤 마을이면 같은 모션을 밤 프레임으로 재생한다. */
  night?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const motionDisabled = useContext(MotionContext) || reduceMotion;
  const elapsed = useSharedValue(0);
  // 한 번 재생이 끝나면 경과가 한 바퀴에 닿아 닫힌 0번으로 돌아온다.
  const frame = useDerivedValue<number>(
    () => sequence[motionTick(elapsed.value, frameDuration) % sequence.length],
  );
  const rankLabel =
    rankState === 'rank-updated'
      ? '주간 순위가 갱신되었습니다'
      : rankState === 'rank-changed'
        ? '주간 순위가 변동되었습니다'
        : undefined;

  useEffect(() => {
    if (motionDisabled || generation === 0) return;
    playMotion(elapsed, sequence.length * frameDuration, false);
    return () => stopMotion(elapsed);
  }, [dayNight, elapsed, generation, motionDisabled]);

  return (
    <View
      testID={testID}
      // 장식 레이어다. 상태 안내는 실제 건물 버튼 라벨 하나에만 둔다.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      accessibilityLabel={`전망대, ${dayNight === 'day' ? '낮' : '밤'}${rankLabel ? `, ${rankLabel}` : ''}`}
      style={[styles.root, style]}
    >
      {showFrames &&
        (night ? nightFrames : frames).map((source, index) => (
          <MotionFrameImage
            key={index}
            frame={frame}
            index={index}
            testID={`village-observatory-frame-${index}`}
            source={source}
            style={styles.frame}
          />
        ))}
      {showFrames && themed && (
        <VillageThemeTint
          sources={night ? nightFrames : frames}
          frame={frame}
          testID="village-observatory-theme-tint"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', position: 'relative' },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
});
