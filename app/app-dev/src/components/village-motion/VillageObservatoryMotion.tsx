import React, { useContext, useEffect, useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { MotionContext } from '@/design-system/primitives';
import { Text } from '@/design-system/typography';
import { semanticTokens } from '@/design-system/tokens';

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

/** 전망대 망원경의 4프레임 줌/조리개 idle 모션과 랭킹 상태를 표시한다. */
export function VillageObservatoryMotion({
  rankState = 'normal',
  dayNight = 'day',
  reduceMotion = false,
  style,
  testID = 'village-observatory-motion',
}: {
  rankState?: ObservatoryRankState;
  dayNight?: ObservatoryDayNight;
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
    if (motionDisabled) return;
    let sequenceIndex = 0;
    const timer = setInterval(() => {
      sequenceIndex = (sequenceIndex + 1) % sequence.length;
      setFrame(sequence[sequenceIndex]);
    }, frameDuration);
    return () => clearInterval(timer);
  }, [dayNight, motionDisabled]);

  return (
    <View
      testID={testID}
      accessibilityLabel={`전망대, ${dayNight === 'day' ? '낮' : '밤'}${rankLabel ? `, ${rankLabel}` : ''}`}
      style={[styles.root, style]}
    >
      {frames.map((source, index) => (
        <Image
          key={index}
          testID={`village-observatory-frame-${index}`}
          source={source}
          resizeMode="stretch"
          style={[styles.frame, frame === index ? styles.visible : styles.hidden]}
        />
      ))}
      {rankLabel && (
        <View testID="village-observatory-rank-indicator" style={styles.badge}>
          <Text style={styles.badgeText}>↑</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', position: 'relative' },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  visible: { opacity: 1 },
  hidden: { opacity: 0 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: semanticTokens.color.accent,
    borderColor: semanticTokens.color.outline,
    borderWidth: 1.5,
    borderRadius: semanticTokens.radius.full,
  },
  badgeText: { color: semanticTokens.color.text, fontSize: 15, fontWeight: '800', lineHeight: 18 },
});
