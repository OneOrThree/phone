import React, { memo, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { VillageNotificationBadge } from './VillageNotificationBadge';

export type LibraryMotionState = 'normal' | 'new-quest' | 'new-reading';

const frames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/library/frame-0.png'),
  require('@/assets/village-world/motion/library/frame-1.png'),
  require('@/assets/village-world/motion/library/frame-2.png'),
  require('@/assets/village-world/motion/library/frame-3.png'),
];
const frameDurationMs = 120;

/** 도서관 문 에셋을 한 번 재생한다. 좌표와 크기는 배치하는 부모가 결정한다. */
export const LibraryMotion = memo(function LibraryMotionView({
  trigger = 0,
  entryActive = false,
  state = 'normal',
  indicatorScale = 1,
  reduceMotion = false,
  showFrames = true,
  style,
  testID = 'library-motion',
}: {
  trigger?: number;
  entryActive?: boolean;
  state?: LibraryMotionState;
  indicatorScale?: number;
  reduceMotion?: boolean;
  showFrames?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const [frame, setFrame] = useState(0);
  const lastTrigger = useRef(trigger);

  useEffect(() => {
    if (trigger < lastTrigger.current || trigger === 0) {
      lastTrigger.current = trigger;
      setFrame(0);
      return;
    }
    if (reduceMotion || !showFrames) {
      setFrame(0);
      if (trigger > lastTrigger.current) lastTrigger.current = trigger;
      return;
    }
    if (trigger <= lastTrigger.current) return;
    lastTrigger.current = trigger;

    const timers: ReturnType<typeof setTimeout>[] = [];
    frames.forEach((_, index) => {
      timers.push(setTimeout(() => setFrame(index), index * frameDurationMs));
    });
    if (!entryActive) timers.push(setTimeout(() => setFrame(0), frames.length * frameDurationMs));
    return () => timers.forEach(clearTimeout);
  }, [entryActive, reduceMotion, showFrames, trigger]);

  useEffect(() => {
    if (!entryActive) setFrame(0);
  }, [entryActive]);

  const stateLabel =
    state === 'new-quest' ? '새 퀘스트' : state === 'new-reading' ? '새 읽을거리' : null;

  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      pointerEvents="none"
      style={[styles.fill, style]}
    >
      {showFrames &&
        frames.map((source, index) => (
          <Image
            key={index}
            testID={`library-motion-frame-${index}`}
            source={source}
            resizeMode="stretch"
            style={[styles.frame, frame === index ? styles.visible : styles.hidden]}
          />
        ))}
      {stateLabel && (
        <VillageNotificationBadge
          testID="library-motion-indicator"
          accessibilityLabel={`${stateLabel}이 있습니다`}
          scale={indicatorScale}
          style={{ top: -4 * indicatorScale, left: 75 * indicatorScale }}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  visible: { opacity: 1 },
  hidden: { opacity: 0 },
});
