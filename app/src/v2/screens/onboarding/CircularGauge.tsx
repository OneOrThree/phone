import type { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

// 원형 게이지 — svg 트랙 + 진행 아크. 가운데 children(수치) 표시. (시안 viewBox 120, r 52 기준)
const R = 52;
const CIRC = 2 * Math.PI * R;

interface Props {
  size: number;
  progress: number; // 0..1
  trackColor: string;
  progressColor: string;
  strokeWidth?: number;
  children?: ReactNode;
}

export default function CircularGauge({
  size,
  progress,
  trackColor,
  progressColor,
  strokeWidth = 13,
  children,
}: Props) {
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Circle cx={60} cy={60} r={R} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <Circle
          cx={60}
          cy={60}
          r={R}
          fill="none"
          stroke={progressColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - p)}
          transform="rotate(-90 60 60)"
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, s.center]}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
