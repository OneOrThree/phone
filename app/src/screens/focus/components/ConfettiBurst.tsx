import { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { type CSSAnimationProperties } from 'react-native-reanimated';
import { T } from '@/constants/theme';

// 종이폭죽 오버레이(GROMO-667) — 모달 등장 직후 위에서 흩뿌려진다. obstacle(모달 카드)을
// 장애물로 취급: 카드 위로 떨어진 조각은 윗변에 쌓이고, 가장자리에 걸친 조각은 옆으로
// 미끄러져 화면 밖까지, 카드 밖 조각은 그대로 바닥까지 낙하한다. 라이브러리 없이
// reanimated CSS 키프레임 1회 재생(터치 통과, 종료 상태 유지는 fillMode both).
const PALETTE = [T.accent, T.greenDeep, T.blue, T.accentDeep, T.sand];
const PIECE_COUNT = 44;
const BASE_DELAY = 250; // 모달 페이드 인(fade)이 끝난 직후 시작

export interface ConfettiObstacle {
  x: number; // 카드 좌상단 x (오버레이 좌표)
  y: number; // 카드 상단 y
  width: number;
}

interface Props {
  obstacle?: ConfettiObstacle | null;
}

// 조각 하나의 정적 스타일 + 키프레임 — 분기별 리터럴이 유니언으로 넓혀지지 않게 타입을 고정
interface PieceSpec {
  base: { left: number; width: number; height: number; backgroundColor: string };
  anim: CSSAnimationProperties;
}

// 조각 공통 애니메이션 속성 — 렌더 밖 상수(no-inline-styles 회피, 매 렌더 재생성 방지)
const pieceAnimBase = {
  animationTimingFunction: 'ease-in',
  animationFillMode: 'both',
} as const;

export function ConfettiBurst({ obstacle }: Props) {
  const { width: W, height: H } = useWindowDimensions();

  // 조각 파라미터·궤적은 1회 생성(useMemo) — 최종 낙하 x가 카드 폭 안이면 '쌓임',
  // 카드 가장자리 14% 구간이면 '미끄러짐', 밖이면 '통과 낙하'로 분기한다.
  const pieces = useMemo(() => {
    return Array.from({ length: PIECE_COUNT }, (_, i): PieceSpec => {
      const size = 7 + Math.random() * 5;
      const pieceH = size * 1.6;
      const startX = 8 + Math.random() * (W - 16);
      const sway = (Math.random() - 0.5) * 120;
      const finalX = startX + sway;
      const spin = 360 + Math.random() * 720;
      const duration = 1500 + Math.random() * 1000;
      const delay = BASE_DELAY + Math.random() * 350;
      const base = {
        left: startX,
        width: size,
        height: pieceH,
        backgroundColor: PALETTE[i % PALETTE.length],
      };

      const edgeZone = obstacle ? obstacle.width * 0.14 : 0;
      const onCard =
        obstacle != null && finalX > obstacle.x && finalX < obstacle.x + obstacle.width;
      const nearLeft = onCard && obstacle != null && finalX < obstacle.x + edgeZone;
      const nearRight =
        onCard && obstacle != null && finalX > obstacle.x + obstacle.width - edgeZone;

      if (obstacle && onCard && !nearLeft && !nearRight) {
        // 카드 윗변에 쌓임 — 살짝 눌렸다가 안착해 그대로 머문다
        const landY = obstacle.y - pieceH + 16 + (Math.random() * 8 - 2);
        const settle = `${(Math.random() - 0.5) * 80}deg`;
        return {
          base,
          anim: {
            animationName: {
              from: { transform: [{ translateY: 0 }, { translateX: 0 }, { rotate: '0deg' }] },
              '85%': {
                transform: [{ translateY: landY + 5 }, { translateX: sway }, { rotate: settle }],
              },
              to: { transform: [{ translateY: landY }, { translateX: sway }, { rotate: settle }] },
            },
            animationDuration: `${duration}ms`,
            animationDelay: `${delay}ms`,
            ...pieceAnimBase,
          },
        };
      }

      if (obstacle && (nearLeft || nearRight)) {
        // 가장자리에 걸침 — 윗변에 닿았다가 옆으로 미끄러져 화면 밖까지 낙하
        const landY = obstacle.y - pieceH + 16;
        const dir = nearLeft ? -1 : 1;
        const push = dir * (edgeZone + 30 + Math.random() * 40);
        return {
          base,
          anim: {
            animationName: {
              from: { transform: [{ translateY: 0 }, { translateX: 0 }, { rotate: '0deg' }] },
              '50%': {
                transform: [
                  { translateY: landY },
                  { translateX: sway },
                  { rotate: `${spin * 0.5}deg` },
                ],
              },
              '65%': {
                transform: [
                  { translateY: landY + 24 },
                  { translateX: sway + push * 0.6 },
                  { rotate: `${spin * 0.65}deg` },
                ],
              },
              to: {
                transform: [
                  { translateY: H + 40 },
                  { translateX: sway + push },
                  { rotate: `${spin}deg` },
                ],
              },
            },
            animationDuration: `${duration + 500}ms`,
            animationDelay: `${delay}ms`,
            ...pieceAnimBase,
          },
        };
      }

      // 카드 밖 — 바닥까지 그대로 낙하
      return {
        base,
        anim: {
          animationName: {
            from: { transform: [{ translateY: 0 }, { translateX: 0 }, { rotate: '0deg' }] },
            to: {
              transform: [{ translateY: H + 40 }, { translateX: sway }, { rotate: `${spin}deg` }],
            },
          },
          animationDuration: `${duration}ms`,
          animationDelay: `${delay}ms`,
          ...pieceAnimBase,
        },
      };
    });
  }, [W, H, obstacle]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => (
        <Animated.View key={i} style={[s.piece, p.base, p.anim]} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  piece: { position: 'absolute', top: -16, borderRadius: 2 },
});
