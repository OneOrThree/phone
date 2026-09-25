import React, { memo, useEffect, useState } from 'react';
import {
  AppState,
  Image,
  StyleSheet,
  View,
  type AppStateStatus,
  type ImageSourcePropType,
  type ViewStyle,
} from 'react-native';

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
  const [frame, setFrame] = useState(mode === 'day' ? 0 : 1);
  const paused = reduceMotion || appState === 'background' || appState === 'inactive';
  const frames = mode === 'day' ? smokeFrames : flameFrames;
  const sequence = mode === 'day' ? smokeSequence : flameSequence;
  const frameDurationMs = mode === 'day' ? 360 : 155;
  const stillFrame = mode === 'day' ? 0 : 1;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (paused) {
      setFrame(stillFrame);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    let index = 0;
    const advance = () => {
      if (!active) return;
      setFrame(sequence[index]);
      index = (index + 1) % sequence.length;
      timer = setTimeout(advance, frameDurationMs);
    };
    advance();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [frameDurationMs, paused, sequence, stillFrame]);

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
      accessible
      accessibilityRole="image"
      accessibilityLabel={`모닥불, ${modeLabel}${residentLabel ? `, ${residentLabel}` : ''}`}
      pointerEvents="none"
      style={[styles.fill, style]}
    >
      {frames.map((source, index) => (
        <Image
          key={index}
          testID={`fire-motion-frame-${mode}-${index}`}
          source={source}
          resizeMode="stretch"
          style={[styles.frame, frame === index ? styles.visible : styles.hidden]}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%', aspectRatio: 116 / 77 },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  visible: { opacity: 1 },
  hidden: { opacity: 0 },
});
