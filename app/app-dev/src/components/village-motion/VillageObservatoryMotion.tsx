import React, { useContext, useEffect, useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { MotionContext } from '@/design-system/primitives';

export type ObservatoryRankState = 'normal' | 'rank-updated' | 'rank-changed';
export type ObservatoryDayNight = 'day' | 'night';

const frames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/observatory/frame-0.png'),
  require('@/assets/village-world/motion/observatory/frame-1.png'),
  require('@/assets/village-world/motion/observatory/frame-2.png'),
  require('@/assets/village-world/motion/observatory/frame-3.png'),
];
const sequence = [0, 1, 2, 3] as const;
const frameDuration = 220;

/** 전망대 진입 시 4프레임 모션을 한 번 재생하고 닫힌 기본 프레임으로 돌아간다. */
export function VillageObservatoryMotion({
  rankState = 'normal',
  dayNight = 'day',
  generation = 0,
  showFrames = true,
  reduceMotion = false,
  style,
  testID = 'village-observatory-motion',
}: {
  rankState?: ObservatoryRankState;
  dayNight?: ObservatoryDayNight;
  generation?: number;
  showFrames?: boolean;
  reduceMotion?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const motionDisabled = useContext(MotionContext) || reduceMotion;
  const [frame, setFrame] = useState(0);
  const rankLabel =
    rankState === 'rank-updated'
      ? '주간 순위가 갱신되었습니다'
      : rankState === 'rank-changed'
        ? '주간 순위가 변동되었습니다'
        : undefined;

  useEffect(() => {
    setFrame(0);
    if (motionDisabled || generation === 0) return;
    const timers = sequence
      .slice(1)
      .map((nextFrame, index) =>
        setTimeout(() => setFrame(nextFrame), (index + 1) * frameDuration),
      );
    timers.push(setTimeout(() => setFrame(0), sequence.length * frameDuration));
    return () => timers.forEach(clearTimeout);
  }, [dayNight, generation, motionDisabled]);

  return (
    <View
      testID={testID}
      accessibilityLabel={`전망대, ${dayNight === 'day' ? '낮' : '밤'}${rankLabel ? `, ${rankLabel}` : ''}`}
      style={[styles.root, style]}
    >
      {showFrames &&
        frames.map((source, index) => (
          <Image
            key={index}
            testID={`village-observatory-frame-${index}`}
            source={source}
            resizeMode="stretch"
            style={[styles.frame, frame === index ? styles.visible : styles.hidden]}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', position: 'relative' },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  visible: { opacity: 1 },
  hidden: { opacity: 0 },
});
