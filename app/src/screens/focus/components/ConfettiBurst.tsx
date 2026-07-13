import { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { T } from '@/constants/theme';

// 종이폭죽 오버레이(GROMO-667) — 주간 스트릭 완성 연출. 조각들이 화면 상단에서 흩날리며
// 떨어진다. 라이브러리 없이 reanimated CSS 키프레임으로 1회 재생 — 터치는 통과시키고,
// 재생이 끝난 조각은 화면 밖(fillMode both)에 머문다(언마운트는 부모가 담당).
const PALETTE = [T.accent, T.greenDeep, T.blue, T.accentDeep, T.sand];
const PIECE_COUNT = 40;

interface Piece {
  left: number; // 시작 가로 위치(%)
  size: number;
  color: string;
  duration: number;
  delay: number;
  sway: number; // 낙하 중 좌우 이동(px)
  spin: number; // 총 회전량(deg)
}

// 조각 파라미터는 마운트 시 1회 생성 — 재렌더에도 궤적이 바뀌지 않게 useMemo로 고정
function makePieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }, (_, i) => ({
    left: 3 + Math.random() * 94,
    size: 7 + Math.random() * 5,
    color: PALETTE[i % PALETTE.length],
    duration: 1500 + Math.random() * 1100,
    delay: Math.random() * 350,
    sway: (Math.random() - 0.5) * 140,
    spin: 360 + Math.random() * 720,
  }));
}

// 조각 공통 애니메이션 속성 — 렌더 밖 상수(no-inline-styles 회피, 매 렌더 재생성 방지)
const pieceAnimBase = {
  animationTimingFunction: 'ease-in',
  animationFillMode: 'both',
} as const;

export function ConfettiBurst() {
  const { height } = useWindowDimensions();
  const pieces = useMemo(makePieces, []);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            s.piece,
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 1.6,
              backgroundColor: p.color,
            },
            {
              animationName: {
                from: {
                  transform: [{ translateY: 0 }, { translateX: 0 }, { rotate: '0deg' }],
                  opacity: 1,
                },
                to: {
                  transform: [
                    { translateY: height + 40 },
                    { translateX: p.sway },
                    { rotate: `${p.spin}deg` },
                  ],
                  opacity: 0.8,
                },
              },
              animationDuration: `${p.duration}ms`,
              animationDelay: `${p.delay}ms`,
            },
            pieceAnimBase,
          ]}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  piece: { position: 'absolute', top: -16, borderRadius: 2 },
});
