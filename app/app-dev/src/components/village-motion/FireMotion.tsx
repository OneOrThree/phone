import React, { memo, useContext, useEffect, useState } from 'react';
import {
  AppState,
  StyleSheet,
  View,
  type AppStateStatus,
  type ImageSourcePropType,
  type ViewStyle,
} from 'react-native';
import Svg, { ClipPath, Defs, Image as SvgImage, Path } from 'react-native-svg';
import { semanticTokens } from '@/design-system/tokens';
import { MotionContext } from '@/design-system/primitives';

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
const unlitFireSource = require('@/assets/village-world/fire.png') as ImageSourcePropType;
const flameSequence = [1, 2, 3, 2] as const;
const smokeSequence = [0, 1, 2, 3, 2, 1] as const;
const quietFlameSequence = [1, 1, 2, 1] as const;
const groupFlameSequence = [1, 2, 3, 2, 3, 2] as const;
const quietSmokeSequence = [0, 0, 1, 0] as const;
const groupSmokeSequence = [0, 1, 2, 3, 2, 1, 2, 1] as const;
// 배경 base에 원본 돌 테두리·장작이 이미 그려져 있다. 프레임 전체 타일 대신
// 중앙 불꽃/연기 코어만 클립해 정적 화덕과 다른 모양의 돌이 겹치지 않게 한다.
const flameCorePath =
  'M165 16 C154 34 133 53 126 78 C116 111 137 137 165 140 C193 137 214 111 204 78 C197 53 176 34 165 16 Z';
const smokeCorePath =
  'M165 26 C156 39 151 51 154 62 C140 68 137 85 151 94 C141 105 148 122 163 124 C177 125 185 112 177 101 C194 93 194 76 180 67 C181 52 174 38 165 26 Z';
// 낮 base의 정적 불꽃은 이 장작 코어 전체 안쪽에 들어온다. 불 없는 원본 화덕의
// 장작 부분으로 먼저 덮어 정적 불꽃이 smoke 프레임 밖으로 새지 않게 하고, 돌 테두리는 보존한다.
const dayLogCorePath =
  'M165 12 C145 18 127 34 112 54 C98 72 98 111 113 133 C127 154 146 169 165 173 C184 169 203 154 217 133 C232 111 232 72 218 54 C203 34 185 18 165 12 Z';

/** 모닥불 코어만 부모의 레이아웃과 확대 배율로 표시한다(기준 상자 비율 100:71). */
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
  const motionDisabled = useContext(MotionContext) || reduceMotion;
  const paused = motionDisabled || appState === 'background' || appState === 'inactive';
  const frames = mode === 'day' ? smokeFrames : flameFrames;
  const residentGroup =
    residentCount == null
      ? 'unknown'
      : residentCount <= 0
        ? 'empty'
        : residentCount < 3
          ? 'small'
          : 'large';
  const sequence =
    mode === 'day'
      ? residentGroup === 'empty'
        ? quietSmokeSequence
        : residentGroup === 'large'
          ? groupSmokeSequence
          : smokeSequence
      : residentGroup === 'empty'
        ? quietFlameSequence
        : residentGroup === 'large'
          ? groupFlameSequence
          : flameSequence;
  const baseFrameDurationMs = mode === 'day' ? 360 : 155;
  const frameDurationMs =
    residentGroup === 'empty'
      ? baseFrameDurationMs * 1.35
      : residentGroup === 'large'
        ? baseFrameDurationMs * 0.85
        : baseFrameDurationMs;
  const stillFrame = mode === 'day' ? 0 : 1;
  const glowOpacity =
    residentCount == null
      ? 0.22
      : residentCount <= 0
        ? 0.08
        : Math.min(0.4, 0.16 + residentCount * 0.035);

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
      // 프레임은 정적 화덕 전체를 대체한다. 컨테이너 투명도를 낮추면 투명 영역 아래의
      // 정적 불꽃이 비쳐 이중으로 보이므로, 주민 수에 따른 약화는 glowOpacity에만 적용한다.
      style={[styles.fill, style]}
    >
      {mode === 'evening' && (
        <View
          testID="fire-motion-glow"
          pointerEvents="none"
          style={[styles.glow, { opacity: glowOpacity }]}
        />
      )}
      <Svg
        testID="fire-motion-frames"
        width="100%"
        height="100%"
        viewBox="0 0 330 220"
        preserveAspectRatio="none"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <ClipPath id="fire-motion-day-log-core">
            <Path testID="fire-motion-day-log-core-path" d={dayLogCorePath} />
          </ClipPath>
          <ClipPath id="fire-motion-core">
            <Path
              testID="fire-motion-core-path"
              d={mode === 'day' ? smokeCorePath : flameCorePath}
            />
          </ClipPath>
        </Defs>
        {mode === 'day' && (
          <SvgImage
            testID="fire-motion-day-log-cover"
            href={unlitFireSource as number}
            x={0}
            y={0}
            width={330}
            height={220}
            preserveAspectRatio="none"
            clipPath="url(#fire-motion-day-log-core)"
          />
        )}
        {frames.map((source, index) => (
          <SvgImage
            key={index}
            testID={`fire-motion-frame-${mode}-${index}`}
            href={source as number}
            x={0}
            y={0}
            width={330}
            height={220}
            preserveAspectRatio="none"
            clipPath="url(#fire-motion-core)"
            opacity={frame === index ? 1 : 0}
          />
        ))}
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%', aspectRatio: 100 / 71 },
  glow: {
    position: 'absolute',
    top: '18%',
    left: '17%',
    width: '66%',
    height: '66%',
    borderRadius: semanticTokens.radius.full,
    backgroundColor: semanticTokens.color.accent,
  },
});
