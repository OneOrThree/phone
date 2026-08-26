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
//
// 비율 보정: 모든 치수를 폭이 아니라 **짧은 변(base = min(폭, 높이))** 기준으로 잡는다.
// 폭 기준으로만 잡으면 키보드처럼 가로로 긴 물건에서 눈이 양끝으로 벌어지고 다리가
// 몸통보다 길어져 "탁자"가 된다. 얼굴·팔다리는 몸통 두께를 따라가야 생물처럼 보인다.

const MAX_ARM = 42; // 팔이 차지할 수 있는 좌우 최대 여백
const MAX_LEG = 60; // 오브젝트 아래 최대 다리 길이

interface Props {
  uri: string;
  aspect: number; // 오브젝트 가로/세로 비율 (width / height)
  maxWidth: number;
  maxHeight: number;
  // 오브젝트 이미지 디코드 완료 콜백 — 상위가 이 시점 전 저장(captureRef)을 막는 데 쓴다.
  onLoad?: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 짧은 변 기준 치수 — 팔다리 길이·선 굵기는 몸통 두께에 비례한다.
function limbMetrics(objW: number, objH: number) {
  const base = Math.min(objW, objH);
  return {
    base,
    stroke: clamp(base * 0.05, 4, 8),
    armLen: clamp(base * 0.3, 18, MAX_ARM),
    legLen: clamp(base * 0.4, 26, MAX_LEG),
  };
}

export function ObjectCharacter({ uri, aspect, maxWidth, maxHeight, onLoad }: Props) {
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
    const safeAspect = aspect > 0 ? aspect : 1;

    // 비율 유지로 주어진 박스에 맞춘다.
    const fit = (availW: number, availH: number) => {
      const boxW = Math.max(60, availW);
      const boxH = Math.max(60, availH);
      let w = boxW;
      let h = w / safeAspect;
      if (h > boxH) {
        h = boxH;
        w = h * safeAspect;
      }
      return { w, h };
    };

    // 오브젝트 크기 ↔ 팔다리 길이가 서로를 참조한다(팔다리가 짧아지면 오브젝트가 커지고,
    // 오브젝트가 커지면 팔다리도 길어진다). 여백을 **줄이는 방향으로만** 갱신해
    // `무대 = 오브젝트 + 여백 ≤ 화면`이 항상 성립하게 만든다.
    let armLen = MAX_ARM;
    let legLen = MAX_LEG;
    let obj = fit(maxWidth - armLen * 2, maxHeight - legLen);
    for (let i = 0; i < 2; i += 1) {
      const m = limbMetrics(obj.w, obj.h);
      const nextArm = Math.min(armLen, m.armLen);
      const nextLeg = Math.min(legLen, m.legLen);
      if (nextArm === armLen && nextLeg === legLen) break;
      armLen = nextArm;
      legLen = nextLeg;
      obj = fit(maxWidth - armLen * 2, maxHeight - legLen);
    }
    const objW = obj.w;
    const objH = obj.h;
    const { base, stroke } = limbMetrics(objW, objH);

    const stageW = objW + armLen * 2;
    const stageH = objH + legLen;
    const centerX = armLen + objW / 2;

    // 팔 — 몸통 중간보다 약간 아래에서 바깥으로 뻗는다. 처짐·들림도 팔 길이에 비례.
    const armY = objH * 0.58;
    const droop = armLen * 0.45;
    const handY = armY - armLen * 0.22;
    const handLX = armLen * 0.34;
    const handRX = stageW - handLX;
    const inset = stroke * 1.4; // 시작점을 몸통 안쪽에 넣어 접합부를 이미지로 가린다
    const leftArm = `M ${armLen + inset} ${armY} Q ${armLen - armLen * 0.28} ${armY + droop} ${handLX} ${handY}`;
    const rightArm = `M ${stageW - armLen - inset} ${armY} Q ${stageW - armLen + armLen * 0.28} ${armY + droop} ${handRX} ${handY}`;

    // 다리 — 기본은 폭의 0.34(정사각·세로 물건은 기존 배치 그대로).
    // 가로로 긴 물건에서만 base*1.6 상한이 걸려 다리가 양끝으로 벌어지는 걸 막는다.
    // 하한은 두 다리가 겹치지 않을 최소치만.
    const legSpan = clamp(objW * 0.34, stroke * 4, base * 1.6);
    const legLX = centerX - legSpan / 2;
    const legRX = centerX + legSpan / 2;
    const legTop = objH - stroke * 1.4;
    // 발(타원)이 무대 아래로 잘리지 않도록 발 크기에서 역산한 높이에 놓는다.
    const footRX = clamp(legLen * 0.3, 8, 16);
    const footY = stageH - footRX * 0.45 - 2;
    const legBow = legLen * 0.18;
    const leftLeg = `M ${legLX} ${legTop} Q ${legLX - legBow} ${(legTop + footY) / 2} ${legLX - legBow * 1.2} ${footY}`;
    const rightLeg = `M ${legRX} ${legTop} Q ${legRX + legBow} ${(legTop + footY) / 2} ${legRX + legBow * 1.2} ${footY}`;

    // 얼굴 — 눈 크기는 짧은 변 기준, 간격은 눈 크기 기준으로 상·하한을 건다.
    // 정사각에 가까우면 기존 배치(0.37/0.63)와 거의 같고, 납작할수록 가운데로 모인다.
    // 극단적으로 납작한 물건(폭:높이 8:1 이상)에서도 눈·입이 몸통을 넘지 않도록
    // 하한(7)보다 높이 제약(objH*0.18)을 우선한다.
    const eyeR = Math.min(clamp(base * 0.11, 7, 18), objH * 0.18);
    const eyeSpan = clamp(objW * 0.26, eyeR * 2.4, eyeR * 4.2);
    const eyeLX = centerX - eyeSpan / 2;
    const eyeRX = centerX + eyeSpan / 2;
    // 눈·입이 몸통 밖으로 새지 않도록 세로 위치를 몸통 안에 가둔다.
    const eyeY = clamp(objH * 0.34, eyeR + stroke, objH - eyeR * 3.2);
    const mouthY = eyeY + eyeR * 2.2;
    const mouthHalf = eyeR * 0.8;
    const mouth = `M ${centerX - mouthHalf} ${mouthY} Q ${centerX} ${mouthY + eyeR * 0.7} ${centerX + mouthHalf} ${mouthY}`;

    return {
      objW,
      objH,
      stageW,
      stageH,
      armLen,
      stroke,
      leftArm,
      rightArm,
      handLX,
      handRX,
      handY,
      leftLeg,
      rightLeg,
      legLX,
      legRX,
      legBow,
      footY,
      footRX,
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
    () => ({ left: geo.armLen, top: 0, width: geo.objW, height: geo.objH }),
    [geo.armLen, geo.objW, geo.objH],
  );

  return (
    <Animated.View style={[stageStyle, breathStyle]}>
      {/* 뒤 레이어 — 팔·다리 */}
      <Svg style={StyleSheet.absoluteFill} width={geo.stageW} height={geo.stageH}>
        <Path
          d={geo.leftArm}
          stroke={T.ink}
          strokeWidth={geo.stroke}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={geo.rightArm}
          stroke={T.ink}
          strokeWidth={geo.stroke}
          strokeLinecap="round"
          fill="none"
        />
        <Circle cx={geo.handLX} cy={geo.handY} r={geo.stroke} fill={T.ink} />
        <Circle cx={geo.handRX} cy={geo.handY} r={geo.stroke} fill={T.ink} />
        <Path
          d={geo.leftLeg}
          stroke={T.ink}
          strokeWidth={geo.stroke}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={geo.rightLeg}
          stroke={T.ink}
          strokeWidth={geo.stroke}
          strokeLinecap="round"
          fill="none"
        />
        <Ellipse
          cx={geo.legLX - geo.legBow * 1.2 - geo.footRX * 0.2}
          cy={geo.footY}
          rx={geo.footRX}
          ry={geo.footRX * 0.45}
          fill={T.ink}
        />
        <Ellipse
          cx={geo.legRX + geo.legBow * 1.2 + geo.footRX * 0.2}
          cy={geo.footY}
          rx={geo.footRX}
          ry={geo.footRX * 0.45}
          fill={T.ink}
        />
      </Svg>

      {/* 오브젝트 — 누끼 PNG(또는 폴백 원본) */}
      <Image source={{ uri }} style={[s.object, imageStyle]} resizeMode="contain" onLoad={onLoad} />

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
        <Path
          d={geo.mouth}
          stroke={T.ink}
          strokeWidth={Math.max(2, geo.stroke * 0.45)}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  object: { position: 'absolute' },
});
