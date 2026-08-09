import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { M } from '@/constants/motion';
import { T } from '@/constants/theme';
import { useMotion } from '@/hooks/useMotion';

// 원형 진행 링 — 카운트다운·뽀모도로처럼 '남은 양'을 한 눈에 보여주는 자리 (GROMO-1381).
//
// 구현은 SVG `Circle` + `strokeDashoffset`이다. 링 둘레만큼의 파선을 하나 그려 두고 그 시작
// 오프셋만 움직이면, 매 프레임 path를 다시 만들지 않고도 호가 자란다. 같은 기법을 통계 화면의
// `CategoryDonut`이 정적으로 쓰고 있고(그쪽은 애니메이션 없음), 여기선 오프셋을 shared value로
// 들고 `useAnimatedProps`로 UI 스레드에서 갱신한다.
//
// ⚠️ 진행률 갱신은 imperative 경로다. `m.timing`은 **JS 스레드 전용**이라 useEffect 안에서만
//    호출하고, `useAnimatedProps` 워클릿 안에서는 절대 부르지 않는다.
// ⚠️ useEffect 의존성에 `m`(=reduce가 바뀌면 새 객체)을 포함시킨다. 재생 도중 '동작 줄이기'가
//    켜졌을 때 링이 중간 각도로 굳는 것을 막는다.
//
// ⚠️ 첫 마운트에는 애니메이션이 없다 — 현재 값 그대로 그린다. 카운트다운은 "이미 진행 중인
//    상태"로 화면에 들어오는 경우가 많아, 매번 0에서 채워 올리면 남은 시간을 잘못 읽게 된다.
//
// `children`은 링 **가운데에 절대 위치로 겹친다**(카운트다운 숫자용). 링과 같은 정사각형
// 컨테이너 안에 얹으므로 링 크기를 바꿔도 중앙 정렬이 유지된다.

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ProgressRingProps {
  /** 링 바깥 지름(pt). 컨테이너도 이 크기의 정사각형이 된다. */
  size: number;
  /** 링 두께(pt). 반지름은 `(size - stroke) / 2`라 두께를 키워도 링이 잘리지 않는다. */
  stroke: number;
  /** 진행률 0~1. 범위 밖 값은 클램프된다. */
  progress: number;
  color: string;
  trackColor?: string;
  testID?: string;
  /** 링 가운데에 겹칠 내용(카운트다운 숫자 등). */
  children?: ReactNode;
}

export function ProgressRing({
  size,
  stroke,
  progress,
  color,
  trackColor = T.track,
  testID,
  children,
}: ProgressRingProps) {
  const m = useMotion();
  const half = size / 2;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
  // 채워진 만큼 파선을 앞으로 당긴다 — progress 1이면 오프셋 0(꽉 참), 0이면 둘레 전체(빈 링).
  const target = circumference * (1 - clamped);

  const offset = useSharedValue(target);

  useEffect(() => {
    offset.value = m.timing(target, {
      duration: M.dur.base,
      easing: M.curve.standard.fn,
    });
  }, [m, offset, target]);

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
      style={[s.wrap, { width: size, height: size }]}
    >
      <Svg width={size} height={size}>
        <Circle cx={half} cy={half} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={half}
          cy={half}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          // 끝을 둥글게 — 시간이 '흘러가는' 느낌은 각진 끝보다 둥근 캡이 낫다.
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          // 12시 방향에서 시작해 시계 방향으로 (SVG 기본 시작점은 3시)
          transform={`rotate(-90 ${half} ${half})`}
        />
      </Svg>
      {children ? <View style={s.center}>{children}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  // 링 위에 겹치되 터치는 통과시킬 필요가 없어(숫자만 얹는다) pointerEvents는 기본값을 쓴다.
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
