import React, { useContext, useEffect, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { MotionContext } from '@/design-system/primitives';
import { semanticTokens } from '@/design-system/tokens';

export type VillageHallState = 'normal' | 'arrival' | 'new-record' | 'weekly-goal';

const frames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/hall/frame-0.png'),
  require('@/assets/village-world/motion/hall/frame-1.png'),
  require('@/assets/village-world/motion/hall/frame-2.png'),
  require('@/assets/village-world/motion/hall/frame-3.png'),
];
const doorSequence = [0, 1, 2, 3, 2, 1] as const;
const frameDuration = 180;

/** 시청의 문 프레임 모션과 기록/주간 목표 강조를 표시한다. */
export function VillageHallMotion({
  state = 'normal',
  highlighted = false,
  tooltip,
  reduceMotion = false,
  generation = 0,
  style,
  testID = 'village-hall-motion',
}: {
  state?: VillageHallState;
  highlighted?: boolean;
  tooltip?: ReactNode;
  reduceMotion?: boolean;
  generation?: number;
  style?: ViewStyle;
  testID?: string;
}) {
  const motionDisabled = useContext(MotionContext) || reduceMotion;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (motionDisabled || state === 'normal') return;
    let sequenceIndex = 0;
    const timer = setInterval(() => {
      sequenceIndex = (sequenceIndex + 1) % doorSequence.length;
      setFrame(doorSequence[sequenceIndex]);
    }, frameDuration);
    return () => clearInterval(timer);
  }, [generation, motionDisabled, state]);

  return (
    <View testID={testID} style={[styles.root, style]}>
      {frames.map((source, index) => (
        <Image
          key={index}
          testID={`village-hall-frame-${index}`}
          source={source}
          resizeMode="stretch"
          style={[styles.frame, frame === index ? styles.visible : styles.hidden]}
        />
      ))}
      {highlighted && (
        <View pointerEvents="none" testID="village-hall-highlight" style={styles.highlight} />
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
  visible: { opacity: 1 },
  hidden: { opacity: 0 },
  highlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderColor: semanticTokens.color.primary,
    borderWidth: 2,
    borderRadius: semanticTokens.radius.preview,
  },
  tooltip: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: '100%',
    maxWidth: '100%',
    paddingHorizontal: semanticTokens.spacing.control,
    paddingVertical: 8,
    backgroundColor: semanticTokens.color.surface,
    borderColor: semanticTokens.color.outline,
    borderWidth: 1.5,
    borderRadius: semanticTokens.radius.control,
  },
});
