import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  StyleSheet,
  View,
  type AppStateStatus,
  type ImageSourcePropType,
  type ViewStyle,
} from 'react-native';
import { frameSteps, playMotion } from '../catMotion';
import { MotionFrameImage } from './VillageThemeTint';

export type FireMotionMode = 'day' | 'evening';

const flameFrames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/fire/frame-0.png'),
  require('@/assets/village-world/motion/fire/frame-1.png'),
  require('@/assets/village-world/motion/fire/frame-2.png'),
  require('@/assets/village-world/motion/fire/frame-3.png'),
];
const smokeFrames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/fire-smoke/frame-0.png'),
  require('@/assets/village-world/motion/fire-smoke/frame-1.png'),
  require('@/assets/village-world/motion/fire-smoke/frame-2.png'),
  require('@/assets/village-world/motion/fire-smoke/frame-3.png'),
];
const flameSequence = [1, 2, 3, 2] as const;
const smokeSequence = [0, 1, 2, 3, 2, 1] as const;
const smokeSteps = frameSteps(smokeSequence, 360);
const flameSteps = frameSteps(flameSequence, 155);

/** 모닥불 프레임. 부모의 레이아웃과 확대 배율을 그대로 채운다(기준 상자 비율 116:77). */
export const FireMotion = memo(function FireMotionView({
  mode = 'evening',
  residentCount = null,
  reduceMotion = false,
  style,
  testID = 'fire-motion',
}: {
  mode?: FireMotionMode;
  residentCount?: number | null;
  reduceMotion?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const elapsed = useRef(new Animated.Value(0)).current;
  const paused = reduceMotion || appState === 'background' || appState === 'inactive';
  const frames = mode === 'day' ? smokeFrames : flameFrames;
  // 시간표 첫 칸(경과 0)이 정지 프레임이다(낮 0번 연기, 저녁 1번 불꽃).
  const steps = mode === 'day' ? smokeSteps : flameSteps;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (paused) {
      elapsed.setValue(0);
      return;
    }
    const animation = playMotion(elapsed, steps.length * steps[0][1], true);
    return () => animation.stop();
  }, [elapsed, paused, steps]);

  const residentLabel =
    residentCount == null
      ? ''
      : residentCount <= 0
        ? '주민 없음'
        : residentCount === 1
          ? '주민 1명'
          : `주민 ${residentCount}명`;
  const modeLabel = mode === 'day' ? '낮, 연기' : '저녁, 불꽃';

  return (
    <View
      testID={testID}
      // 장식 레이어다. 상태 안내는 실제 건물 버튼 라벨 하나에만 둔다.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      accessibilityLabel={`모닥불, ${modeLabel}${residentLabel ? `, ${residentLabel}` : ''}`}
      pointerEvents="none"
      style={[styles.fill, style]}
    >
      {frames.map((source, index) => (
        <MotionFrameImage
          key={index}
          elapsed={elapsed}
          steps={steps}
          index={index}
          testID={`fire-motion-frame-${mode}-${index}`}
          source={source}
          style={styles.frame}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%', aspectRatio: 116 / 77 },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
});
