import { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type CSSAnimationProperties,
  type SharedValue,
} from 'react-native-reanimated';
import { useMotion } from '@/hooks/useMotion';
import { M } from '@/constants/motion';
import { T } from '@/constants/theme';

// 종이폭죽 오버레이(GROMO-667) — 모달 등장 직후 위에서 흩뿌려진다. obstacle(모달 카드)을
// 장애물로 취급: 카드 위로 떨어진 조각은 윗변에 쌓이고, 가장자리에 걸친 조각은 옆으로
// 미끄러져 화면 밖까지, 카드 밖 조각은 그대로 바닥까지 낙하한다. 쌓인 조각은 기울임
// (중력 센서 x)에 밀리다가 카드 가장자리를 넘으면 떨어진다 — 시뮬레이터는 센서가 없어
// 기울임 효과는 실기기에서만 보인다. 라이브러리 없이 reanimated로만 구현.
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
  kind: 'pile' | 'through'; // pile = 카드 윗변에 쌓임(기울임 반응 대상)
  left: number;
  base: { width: number; height: number; backgroundColor: string };
  anim: CSSAnimationProperties;
  finalX: number; // 낙하 종료 시점의 x(시작 + 흔들림) — 기울임 낙하 판정 기준
  factor: number; // 공통 미끄러짐 오프셋에 곱하는 배율 — 조각마다 달라 모래처럼 흩어진다
}

// 조각 공통 애니메이션 속성 — 렌더 밖 상수(no-inline-styles 회피, 매 렌더 재생성 방지)
const pieceAnimBase = {
  animationTimingFunction: 'ease-in',
  animationFillMode: 'both',
} as const;

// 쌓인 조각 — 공통 미끄러짐 오프셋(slide, 기울임 적분값)에 배율을 곱해 밀리고,
// 카드 가장자리를 넘는 순간 낙하한다. 기울이는 동안 오프셋이 계속 커지므로
// 충분히 기울이고 있으면 가운데 조각까지 전부 우수수 흘러내린다.
function TiltPiece({
  spec,
  slide,
  cardLeft,
  cardRight,
  screenH,
}: {
  spec: PieceSpec;
  slide: SharedValue<number>;
  cardLeft: number;
  cardRight: number;
  screenH: number;
}) {
  const fallen = useSharedValue(0); // 0=쌓여 있음, 1=가장자리를 넘어 낙하 시작
  const fallY = useSharedValue(0);
  // 낙하 트리거는 reaction에서 — useAnimatedStyle 안에서 공유값을 쓰는 건 문서상 UB(평가 루프
  // 가능)라 스타일 훅은 읽기 전용으로 유지한다(PR 227 리뷰).
  useAnimatedReaction(
    () => slide.value * spec.factor,
    (shift) => {
      if (fallen.value === 0) {
        const x = spec.finalX + shift;
        if (x < cardLeft - 4 || x > cardRight + 4) {
          fallen.value = 1;
          // reduceMotion: M.never — 이 컴포넌트는 reduce가 꺼져 있을 때만 마운트되지만,
          // reanimated 기본값(정적 System 플래그)은 '켠 채 시작했다 끈' 사용자에게 여전히
          // 걸린다. 그러면 조각이 떨어지지 않고 그 자리에 멈춘다.
          fallY.value = withTiming(screenH, {
            duration: 900,
            easing: Easing.in(Easing.quad),
            reduceMotion: M.never,
          });
        }
      }
    },
  );
  const tiltStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slide.value * spec.factor }, { translateY: fallY.value }],
  }));
  return (
    <Animated.View style={[s.piece, { left: spec.left }, tiltStyle]}>
      <Animated.View style={[s.pieceBody, spec.base, spec.anim]} />
    </Animated.View>
  );
}

// 시스템 '동작 줄이기'(정책 D7) — 44조각 × 3레이어가 도는 건 명백한 위반이라 파티클을 그리지
// 않는다. ⚠️ 사라지는 건 파티클뿐이다: 축하 모달·햅틱·문구·수치는 호출부에 그대로 남는다.
// 사용자가 끈 것은 움직임이지 보상이 아니다.
//
// ⚠️ 게이트가 **바깥 컴포넌트**에 있는 이유: 훅은 조건부로 호출할 수 없으므로 같은 컴포넌트
//    안에서 `if (reduce) return null` 을 하면 useAnimatedSensor의 네이티브 중력 구독이 이미
//    걸린 뒤다. 파티클이 하나도 안 보이는 동안에도 사용자가 모달을 닫을 때까지 센서가 계속
//    돈다(codex 리뷰). 안쪽 컴포넌트를 아예 마운트하지 않아야 구독 자체가 생기지 않는다.
//    재생 도중 설정이 켜져도 안쪽이 언마운트되며 구독이 함께 해제된다.
export function ConfettiBurst({ obstacle }: Props) {
  const { reduce } = useMotion();
  if (reduce) return null;
  return <ConfettiBurstInner obstacle={obstacle} />;
}

function ConfettiBurstInner({ obstacle }: Props) {
  const { width: W, height: H } = useWindowDimensions();
  // 기울임 감지 — 컨페티가 떠 있는 동안만 구독(언마운트 시 자동 해제)
  const gravity = useAnimatedSensor(SensorType.GRAVITY);
  // 미끄러짐 물리 — 매 프레임 중력 x를 적분(가속→속도→변위)해 공통 오프셋을 만든다.
  // 비례식(기울기×상수)은 가운데 조각이 가장자리에 못 미쳐 멈추는 문제가 있어 적분으로 교체.
  // |g|<0.8(≈5°)은 정지 마찰로 취급해 속도를 감쇠 — 살짝 기울임엔 흐르지 않는다.
  const slide = useSharedValue(0);
  const slideVel = useSharedValue(0);
  // 이 컴포넌트는 '동작 줄이기'가 꺼져 있을 때만 마운트되므로 프레임 콜백을 조건부로 끌 필요가
  // 없다 — 켜지는 순간 통째로 언마운트된다.
  useFrameCallback((frame) => {
    const dt = Math.min((frame.timeSincePreviousFrame ?? 16) / 1000, 0.05);
    const g = gravity.sensor.value.x;
    if (Math.abs(g) < 0.8) {
      slideVel.value *= 0.8;
    } else {
      slideVel.value = (slideVel.value + g * 260 * dt) * 0.995;
    }
    slide.value += slideVel.value * dt;
  });

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
      const factor = 0.6 + Math.random() * 0.8;
      const base = {
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
        // 카드 윗변에 쌓임 — 살짝 눌렸다가 안착해 그대로 머문다(이후 기울임 반응)
        const landY = obstacle.y - pieceH + 16 + (Math.random() * 8 - 2);
        const settle = `${(Math.random() - 0.5) * 80}deg`;
        return {
          kind: 'pile',
          left: startX,
          base,
          finalX,
          factor,
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
          kind: 'through',
          left: startX,
          base,
          finalX,
          factor,
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
        kind: 'through',
        left: startX,
        base,
        finalX,
        factor,
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
      {pieces.map((p, i) =>
        p.kind === 'pile' && obstacle ? (
          <TiltPiece
            key={i}
            spec={p}
            slide={slide}
            cardLeft={obstacle.x}
            cardRight={obstacle.x + obstacle.width}
            screenH={H}
          />
        ) : (
          <Animated.View key={i} style={[s.piece, s.pieceBody, { left: p.left }, p.base, p.anim]} />
        ),
      )}
    </View>
  );
}

const s = StyleSheet.create({
  piece: { position: 'absolute', top: -16 },
  pieceBody: { borderRadius: 2 },
});
