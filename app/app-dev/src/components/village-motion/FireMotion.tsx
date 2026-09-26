import React, { memo, useContext, useEffect, useState } from 'react';
import {
  AppState,
  StyleSheet,
  View,
  type AppStateStatus,
  type ImageSourcePropType,
  type ViewStyle,
} from 'react-native';
import Svg, { ClipPath, Defs, G, Image as SvgImage, Path } from 'react-native-svg';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { MotionContext } from '@/design-system/primitives';

export type FireMotionMode = 'day' | 'evening';

const flameFrames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/fire/frame-1.png'),
  require('@/assets/village-world/motion/fire/frame-2.png'),
  require('@/assets/village-world/motion/fire/frame-3.png'),
];
const smokeFrames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/fire-smoke-core/frame-0.png'),
  require('@/assets/village-world/motion/fire-smoke-core/frame-1.png'),
  require('@/assets/village-world/motion/fire-smoke-core/frame-2.png'),
  require('@/assets/village-world/motion/fire-smoke-core/frame-3.png'),
];
const flameSequence = [0, 1, 2, 1] as const;
const smokeSequence = [0, 1, 2, 3, 2, 1] as const;
const quietFlameSequence = [0, 1, 0, 1] as const;
const groupFlameSequence = [0, 1, 2, 1, 2, 1] as const;
const quietSmokeSequence = [0, 0, 1, 0] as const;
const groupSmokeSequence = [0, 1, 2, 3, 2, 1, 2, 1] as const;
// 배경 base에 원본 돌 테두리·장작이 이미 그려져 있다. 밤 불꽃은 중앙 코어만 클립하고,
// 낮은 연기만 분리한 투명 PNG를 써서 장작/돌 프레임이 중복되지 않게 한다.
const flameCorePath =
  'M165 16 C154 34 133 53 126 78 C116 111 137 137 165 140 C193 137 214 111 204 78 C197 53 176 34 165 16 Z';
// 정적 불꽃의 좁은 실루엣만 덮어 밤 모션 PNG의 투명부에서 불꽃이 이중 노출되지 않게 한다.
const nightFlameOffPath =
  'M171 16 C159 15 157 35 160 51 C151 50 150 31 141 32 C138 46 142 57 130 69 C106 82 99 103 105 125 C117 153 145 170 176 179 C204 173 229 152 237 129 C245 105 240 85 218 69 C211 58 217 47 211 37 C205 46 204 56 196 62 C191 55 195 41 187 32 C183 45 185 57 176 62 C168 49 182 27 171 16 Z';

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
  const [frame, setFrame] = useState(0);
  const motionDisabled = useContext(MotionContext) || reduceMotion;
  const paused = motionDisabled || appState !== 'active';
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
  const stillFrame = 0;
  const quietFlame = mode === 'evening' && residentGroup === 'empty';
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
          <ClipPath id="fire-motion-core">
            <Path testID="fire-motion-core-path" d={flameCorePath} />
          </ClipPath>
          <ClipPath id="fire-motion-quiet-core">
            <G transform="translate(165 78) scale(0.68) translate(-165 -78)">
              <Path testID="fire-motion-quiet-core-path" d={flameCorePath} />
            </G>
          </ClipPath>
        </Defs>
        {mode === 'evening' && (
          <Path
            testID="fire-motion-night-off-core"
            d={nightFlameOffPath}
            fill={componentTokens.villageMotion.fireOffCore}
          />
        )}
        {frames.map((source, index) => (
          <SvgImage
            key={index}
            testID={`fire-motion-frame-${mode}-${index}`}
            href={source as number}
            x={quietFlame ? 55 : 0}
            y={quietFlame ? 26 : 0}
            width={quietFlame ? 220 : 330}
            height={quietFlame ? 147 : 220}
            preserveAspectRatio="none"
            clipPath={
              quietFlame
                ? 'url(#fire-motion-quiet-core)'
                : mode === 'evening'
                  ? 'url(#fire-motion-core)'
                  : undefined
            }
            opacity={frame === index ? (quietFlame ? 0.52 : 1) : 0}
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
