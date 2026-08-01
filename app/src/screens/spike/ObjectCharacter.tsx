import { useEffect, useMemo } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { T } from '@/constants/theme';

// 오브젝트 캐릭터 렌더러(스파이크) — 누끼 이미지 위/아래에 만화 팔·다리·눈을 얹는다.
// AI 없이 전부 코드로 그린다: 팔다리는 react-native-svg 곡선, 눈은 원 2개.
// 레이어 순서 = 팔다리(뒤) → 오브젝트 이미지 → 눈(앞). 팔다리 시작점이 이미지에 가려져
// "물건에 팔다리가 달린" 것처럼 보인다.

const ARM = 36; // 좌우 팔이 차지하는 여백(스테이지 폭 = 오브젝트 폭 + ARM*2)
const LEG = 54; // 오브젝트 아래 다리 길이
const STROKE = 7; // 팔다리 굵기

interface Props {
  uri: string;
  aspect: number; // 오브젝트 가로/세로 비율 (width / height)
  maxWidth: number;
  maxHeight: number;
}

export function ObjectCharacter({ uri, aspect, maxWidth, maxHeight }: Props) {
  // 숨쉬기 — 위아래로 살짝 늘었다 줄었다. 스파이크라 애니메이션은 이거 하나만.
  const breath = useSharedValue(0);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [breath]);

  // 발이 바닥에 붙어 있도록 원점을 아래 가운데로 두고 세로로만 늘린다.
  const breathStyle = useAnimatedStyle(() => ({
    transformOrigin: '50% 100%',
    transform: [{ scaleY: 1 + 0.025 * breath.value }, { scaleX: 1 - 0.012 * breath.value }],
  }));

  const geo = useMemo(() => {
    // 오브젝트를 팔다리 여백을 뺀 박스 안에 비율 유지로 맞춘다.
    const boxW = Math.max(80, maxWidth - ARM * 2);
    const boxH = Math.max(80, maxHeight - LEG);
    const safeAspect = aspect > 0 ? aspect : 1;
    let objW = boxW;
    let objH = objW / safeAspect;
    if (objH > boxH) {
      objH = boxH;
      objW = objH * safeAspect;
    }
    const stageW = objW + ARM * 2;
    const stageH = objH + LEG;

    // 팔 — 오브젝트 몸통 중간보다 약간 아래에서 바깥으로 뻗는다.
    const armY = objH * 0.58;
    const handY = armY - 8;
    const handLX = ARM * 0.34;
    const handRX = stageW - handLX;
    const leftArm = `M ${ARM + 10} ${armY} Q ${ARM - 10} ${armY + 16} ${handLX} ${handY}`;
    const rightArm = `M ${stageW - ARM - 10} ${armY} Q ${stageW - ARM + 10} ${armY + 16} ${handRX} ${handY}`;

    // 다리 — 바운딩 박스 하단에서 시작해 바깥으로 살짝 벌어지고 끝에 발이 붙는다.
    const legTop = objH - 10;
    const legLX = ARM + objW * 0.34;
    const legRX = ARM + objW * 0.66;
    const footY = stageH - 9;
    const leftLeg = `M ${legLX} ${legTop} Q ${legLX - 8} ${(legTop + footY) / 2} ${legLX - 10} ${footY}`;
    const rightLeg = `M ${legRX} ${legTop} Q ${legRX + 8} ${(legTop + footY) / 2} ${legRX + 10} ${footY}`;

    // 눈 — 상단 1/3 지점, 좌우 대칭.
    const eyeY = objH * 0.34;
    const eyeR = Math.max(9, Math.min(16, objW * 0.075));
    const eyeLX = ARM + objW * 0.37;
    const eyeRX = ARM + objW * 0.63;
    const mouthY = eyeY + eyeR * 2.1;
    const mouth = `M ${ARM + objW * 0.44} ${mouthY} Q ${ARM + objW * 0.5} ${mouthY + 9} ${ARM + objW * 0.56} ${mouthY}`;

    return {
      objW,
      objH,
      stageW,
      stageH,
      leftArm,
      rightArm,
      handLX,
      handRX,
      handY,
      leftLeg,
      rightLeg,
      legLX,
      legRX,
      footY,
      eyeY,
      eyeR,
      eyeLX,
      eyeRX,
      mouth,
    };
  }, [aspect, maxWidth, maxHeight]);

  const stageStyle = useMemo(
    () => ({ width: geo.stageW, height: geo.stageH }),
    [geo.stageW, geo.stageH],
  );
  const imageStyle = useMemo(
    () => ({ left: ARM, top: 0, width: geo.objW, height: geo.objH }),
    [geo.objW, geo.objH],
  );

  return (
    <Animated.View style={[stageStyle, breathStyle]}>
      {/* 뒤 레이어 — 팔·다리 */}
      <Svg style={StyleSheet.absoluteFill} width={geo.stageW} height={geo.stageH}>
        <Path
          d={geo.leftArm}
          stroke={T.ink}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={geo.rightArm}
          stroke={T.ink}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
        />
        <Circle cx={geo.handLX} cy={geo.handY} r={STROKE} fill={T.ink} />
        <Circle cx={geo.handRX} cy={geo.handY} r={STROKE} fill={T.ink} />
        <Path
          d={geo.leftLeg}
          stroke={T.ink}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={geo.rightLeg}
          stroke={T.ink}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
        />
        <Ellipse cx={geo.legLX - 12} cy={geo.footY + 2} rx={14} ry={6} fill={T.ink} />
        <Ellipse cx={geo.legRX + 12} cy={geo.footY + 2} rx={14} ry={6} fill={T.ink} />
      </Svg>

      {/* 오브젝트 — 누끼 PNG(또는 폴백 원본) */}
      <Image source={{ uri }} style={[s.object, imageStyle]} resizeMode="contain" />

      {/* 앞 레이어 — 눈·입 */}
      <Svg style={StyleSheet.absoluteFill} width={geo.stageW} height={geo.stageH}>
        <Circle
          cx={geo.eyeLX}
          cy={geo.eyeY}
          r={geo.eyeR}
          fill={T.white}
          stroke={T.ink}
          strokeWidth={2}
        />
        <Circle
          cx={geo.eyeRX}
          cy={geo.eyeY}
          r={geo.eyeR}
          fill={T.white}
          stroke={T.ink}
          strokeWidth={2}
        />
        <Circle cx={geo.eyeLX + 2} cy={geo.eyeY + 1} r={geo.eyeR * 0.45} fill={T.ink} />
        <Circle cx={geo.eyeRX + 2} cy={geo.eyeY + 1} r={geo.eyeR * 0.45} fill={T.ink} />
        <Path d={geo.mouth} stroke={T.ink} strokeWidth={3} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  object: { position: 'absolute' },
});
