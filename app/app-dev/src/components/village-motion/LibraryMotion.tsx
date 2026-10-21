import React, { memo, useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { VillageNotificationBadge } from './VillageNotificationBadge';
import { frameSteps, playMotion } from '../catMotion';
import { MotionFrameImage, VillageThemeTint, type MotionStep } from './VillageThemeTint';

export type LibraryMotionState = 'normal' | 'new-quest' | 'new-reading';

const frames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/library/frame-0.png'),
  require('@/assets/village-world/motion/library/frame-1.png'),
  require('@/assets/village-world/motion/library/frame-2.png'),
  require('@/assets/village-world/motion/library/frame-3.png'),
];
// 밤 프레임은 낮 frame-0~3 과 크기·발밑 기준점이 같다(night-frame-0 은 정본 밤 레이어 crop).
const nightFrames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/library/night-frame-0.png'),
  require('@/assets/village-world/motion/library/night-frame-1.png'),
  require('@/assets/village-world/motion/library/night-frame-2.png'),
  require('@/assets/village-world/motion/library/night-frame-3.png'),
];
const frameDurationMs = 120;
// 진입 중이면 마지막 프레임(열린 문)에 머물고, 아니면 한 바퀴 뒤 닫힌 0번으로 돌아온다.
const openSteps = frameSteps([0, 1, 2, 3], frameDurationMs);
const closeSteps: readonly MotionStep[] = [...openSteps, [0, frameDurationMs]];

/** 도서관 문 에셋을 한 번 재생한다. 좌표와 크기는 배치하는 부모가 결정한다. */
export const LibraryMotion = memo(function LibraryMotionView({
  trigger = 0,
  entryActive = false,
  state = 'normal',
  indicatorScale = 1,
  reduceMotion = false,
  night = false,
  showFrames = true,
  themed = false,
  style,
  testID = 'library-motion',
}: {
  trigger?: number;
  entryActive?: boolean;
  state?: LibraryMotionState;
  indicatorScale?: number;
  reduceMotion?: boolean;
  /** 밤 마을이면 같은 모션을 밤 프레임으로 재생한다. */
  night?: boolean;
  showFrames?: boolean;
  /** 건물 테마가 적용되면 현재 프레임 위에 테마 착색을 덧입힌다. */
  themed?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const lastTrigger = useRef(trigger);
  const elapsed = useRef(new Animated.Value(0)).current;
  const steps = entryActive ? openSteps : closeSteps;

  // 재생 효과보다 먼저 둔다. 같은 커밋에서 재생이 시작되면 0번으로 되돌린 뒤 재생한다.
  useEffect(() => {
    if (!entryActive) elapsed.setValue(0);
  }, [elapsed, entryActive]);

  useEffect(() => {
    if (trigger < lastTrigger.current || trigger === 0) {
      lastTrigger.current = trigger;
      elapsed.setValue(0);
      return;
    }
    if (reduceMotion || !showFrames) {
      elapsed.setValue(0);
      if (trigger > lastTrigger.current) lastTrigger.current = trigger;
      return;
    }
    if (trigger <= lastTrigger.current) return;
    lastTrigger.current = trigger;

    const animation = playMotion(elapsed, frames.length * frameDurationMs, false);
    // 의존값이 바뀌면 지금 프레임에서 멈춘다(예전 타이머 정리와 같다).
    return () => animation.stop();
  }, [elapsed, entryActive, reduceMotion, showFrames, trigger]);

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
        (night ? nightFrames : frames).map((source, index) => (
          <MotionFrameImage
            key={index}
            elapsed={elapsed}
            steps={steps}
            index={index}
            testID={`library-motion-frame-${index}`}
            source={source}
            style={styles.frame}
          />
        ))}
      {showFrames && themed && (
        <VillageThemeTint
          sources={night ? nightFrames : frames}
          elapsed={elapsed}
          steps={steps}
          testID="library-motion-theme-tint"
        />
      )}
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
});
