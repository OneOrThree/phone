import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Image,
  View,
  type ImageSourcePropType,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { cat } from '@/constants/assets';
import metrics from '@/constants/motion-metrics.json';
import type { Color } from '@/services/model';

// GROMO-2361 모닥불 휴식 장면 움직임. 숫자는 움직임 검토실(doc/animation-lab-2026-10-19/scenes-rest-raft.js)
// rest()·restCatOnly() 를 그대로 옮겼다(강도 1·입자 1). 검토실 좌표는 960×720 캔버스이고 배경 1024 를
// (0,-120,960,960)에 그렸으므로, 배경 좌표 = 캔버스 x·(y+120) × 1024/960.
// 시계는 Animated.Value 하나(0→12초 반복, 네이티브 드라이버)이고 모든 값은 interpolate 로 뽑는다 — 프레임마다
// setState 를 하지 않는다. 연출은 보상·집중 시간·서버 상태를 만들지 않는다.

const LOOP = 12;
const TAU = Math.PI * 2;
const wave = (t: number, cycles: number, offset = 0) =>
  Math.sin((TAU * cycles * t) / LOOP + offset);
const smooth = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

const flames: Record<1 | 2 | 3, ImageSourcePropType> = {
  1: require('@/assets/village-world/motion/fire/frame-1.png'),
  2: require('@/assets/village-world/motion/fire/frame-2.png'),
  3: require('@/assets/village-world/motion/fire/frame-3.png'),
};
const smoke = require('@/assets/village-world/motion/fire-smoke/frame-1.png');
const firePit = require('@/assets/village-world/fire.png');
const FLAME_SEQUENCE = [1, 2, 3, 2] as const;

/** 멤버별 고정 자세(재영님 N1 「사람마다 다르게」): 식별자 문자열 해시가 짝수면 식빵, 홀수면 책 읽기. */
export function restPose(id: string): 'loaf' | 'read' {
  // FNV-1a + 끝 섞기 — h*31+c 의 최하위 비트는 문자 코드 패리티 합이라 비슷한 id 끼리 자세가 쏠렸다
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  return h & 1 ? 'read' : 'loaf';
}

/** 12초 휴식 시계. 동작 줄이기·백그라운드·비활성이면 돌지 않고, 언마운트하면 멈춘다. */
export function useRestClock(still: boolean) {
  const t = useRef(new Animated.Value(0)).current;
  const [appState, setAppState] = useState(AppState.currentState);
  const paused = still || appState === 'background' || appState === 'inactive';
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    // 멈출 때는 값을 두고(iOS inactive 는 화면이 보여 0 자세로 튀면 안 된다), 다시 돌 때만 0 부터
    if (paused) return;
    t.setValue(0);
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: LOOP,
        duration: LOOP * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [paused, t]);
  return t;
}

type Clock = Pick<Animated.Value, 'interpolate'>;
// 한 주기를 step 초 간격으로 표본해 선형 보간한다(네이티브 드라이버는 interpolate 만 계산할 수 있다).
function curve(input: Clock, period: number, step: number, f: (x: number) => number, unit = '') {
  const n = Math.round(period / step);
  const inputRange = Array.from({ length: n + 1 }, (_, i) => (i * period) / n);
  const values = inputRange.map(f);
  // 각도는 'rad' 문자열, 나머지는 숫자 — 스타일 자리에 그대로 넣는다
  return input.interpolate<any>({
    inputRange,
    outputRange: unit ? values.map((v) => `${v}${unit}`) : values,
  });
}
// t 를 offset 초만큼 밀고 period 초로 접은 시계 — 불티·연기의 개별 위상
const phased = (t: Animated.Value, offset: number, period: number) =>
  Animated.modulo(Animated.add(t, offset), period);

type Placement = { x0: number; y0: number; s: number };
// 배경 이미지와 같은 자리에 깐 1024 배경 좌표계 상자. 안에서는 검토실 캔버스 좌표를 K 배로 그린다.
const sceneBox = ({ x0, y0, s }: Placement): ViewStyle => ({
  position: 'absolute',
  left: -x0 * s,
  top: -y0 * s,
  width: 1024 * s,
  height: 1024 * s,
});
const unit = (s: number) => (s * 1024) / 960;

function Glow({
  id,
  cx,
  cy,
  r,
  color,
  colorAlpha,
  alpha,
  K,
  scale,
}: {
  id: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  colorAlpha: number;
  alpha: number;
  K: number;
  scale?: any;
}) {
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: (cx - r) * K,
        top: (cy + 120 - r) * K,
        width: 2 * r * K,
        height: 2 * r * K,
        opacity: alpha,
        transform: scale ? [{ scale }] : [],
      }}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={colorAlpha} />
            <Stop offset="1" stopColor="rgb(255,181,78)" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/** 고양이 아래 층: 불빛 맥동 + 배경에 구워진 정지 불꽃을 돌·장작(fire.png)으로 덮는다(불꽃 이중 표시 방지). */
export function RestCampfireBack({
  t,
  still,
  ...at
}: Placement & { t: Animated.Value; still: boolean }) {
  const K = unit(at.s);
  const pulse = useMemo(
    () =>
      still ? undefined : curve(t, LOOP, 0.05, (x) => 1 + 0.045 * wave(x, 5) + 0.025 * wave(x, 13)),
    [t, still],
  );
  return (
    <View pointerEvents="none" testID="rest-campfire-back" style={sceneBox(at)}>
      <Glow
        id="restGlowBack"
        cx={466}
        cy={444}
        r={255}
        color="rgb(255,190,70)"
        colorAlpha={0.35}
        alpha={0.35}
        K={K}
        scale={pulse}
      />
      {/* 덮개는 배경(1024) 좌표로 둔다. 검토실 값(302,320,330,220)은 구워진 돌 테두리보다 1.5배 커서 버렸다.
          PIL 실측: 배경 돌 테두리 bbox (365,525)-(604,677) → fire.png(330×220, 돌이 가장자리까지 참)를
          폭 240·비율 유지(160)로 아래 끝을 맞춘다. 구워진 불꽃 중 덮개 위로 남는 끝(493~529, 495~517)은
          움직이는 불꽃이 덮는다. */}
      <Image
        source={firePit}
        accessible={false}
        style={{
          position: 'absolute',
          left: 365 * at.s,
          top: 517 * at.s,
          width: 240 * at.s,
          height: 160 * at.s,
        }}
      />
    </View>
  );
}

/** 고양이 위 층: 불꽃 한 겹(150ms 교차·휨·늘임), 연기 3, 불티 11, 아래로 번지는 불빛. */
export function RestCampfireFront({
  t,
  still,
  ...at
}: Placement & { t: Animated.Value; still: boolean }) {
  const K = unit(at.s);
  const anim = useMemo(() => {
    if (still) return null;
    // 검토실 상수 그대로는 앱 화면에서 과하게 흔들려(재영님 10-20 시뮬레이터 검토) 폭을 40%로 줄였다.
    const FLAME_AMOUNT = 0.4;
    const bendOf = (x: number) => (wave(x, 7) * 0.028 + wave(x, 19, 0.7) * 0.012) * FLAME_AMOUNT;
    const stretchOf = (x: number) => 1 + (wave(x, 8) * 0.045 + wave(x, 17) * 0.018) * FLAME_AMOUNT;
    const flicker = Animated.modulo(t, 1.2);
    // 프레임 f 의 불투명도 = 현재 칸(1-blend) + 다음 칸(blend) 몫. 칸당 300ms, 1.2초(4칸) 주기는 12초를 정확히 10번 채운다.
    const weight = (f: number) =>
      curve(flicker, 1.2, 0.01, (u) => {
        const tick = u / 0.3,
          index = Math.floor(tick) % 4,
          blend = smooth(tick % 1);
        return (
          (FLAME_SEQUENCE[index] === f ? 1 - blend : 0) +
          (FLAME_SEQUENCE[(index + 1) % 4] === f ? blend : 0)
        );
      });
    return {
      bend: curve(t, LOOP, 0.05, bendOf, 'rad'),
      scaleX: curve(t, LOOP, 0.05, (x) => 1 - (stretchOf(x) - 1) * 0.32),
      scaleY: curve(t, LOOP, 0.05, stretchOf),
      weights: { 1: weight(1), 2: weight(2), 3: weight(3) } as Record<1 | 2 | 3, any>,
      smoke: [0, 1, 2].map((i) => {
        const age = phased(t, (6 * i) / 3, 6),
          f = (g: (a: number) => number) => curve(age, 6, 0.05, (u) => g(u / 6));
        return {
          opacity: f((a) => Math.sin(Math.PI * a) * 0.075),
          x: f((a) => (473 + Math.sin(a * 3 + i) * 17) * K),
          y: f((a) => (337 - a * 108 + 120) * K),
          sx: f((a) => 1 + a * 0.5),
          sy: f((a) => 1 + a * 0.6),
        };
      }),
      sparks: Array.from({ length: 11 }, (_, i) => {
        const width = 1.2 + (i % 2),
          age = phased(t, 3 * i * 0.381966, 3),
          f = (g: (a: number) => number) => curve(age, 3, 0.05, (u) => g(u / 3));
        return {
          width,
          color: i % 3 ? '#ffcf73' : '#fff0b2',
          opacity: f((a) => Math.sin(Math.PI * a) * 0.65),
          x: f((a) => (466 + Math.sin(i * 2.41) * 19 + Math.sin(a * 3.2 + i) * 18 - width / 2) * K),
          y: f((a) => (423 - a * (118 + (i % 4) * 17) + 120) * K),
          // 선 길이 4+life*2 (기준 높이 6)
          sy: f((a) => (4 + Math.sin(Math.PI * a) * 2) / 6),
        };
      }),
    };
  }, [t, still, K]);
  const fx = (116 / 100) * K,
    fy = (149 / 122) * K,
    mx = (86 / 170) * K,
    my = (62 / 122) * K;
  return (
    <View pointerEvents="none" testID="rest-campfire-front" style={sceneBox(at)}>
      <Animated.View
        style={{
          position: 'absolute',
          left: 466 * K,
          top: (446 + 120) * K,
          width: 0,
          height: 0,
          overflow: 'visible',
          transform: anim
            ? [{ rotate: anim.bend }, { scaleX: anim.scaleX }, { scaleY: anim.scaleY }]
            : [],
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: -58 * K,
            top: -149 * K,
            width: 116 * K,
            height: 149 * K,
            overflow: 'hidden',
          }}
        >
          {([1, 2, 3] as const).map((f) => (
            <Animated.Image
              key={f}
              source={flames[f]}
              accessible={false}
              style={{
                position: 'absolute',
                left: -120 * fx,
                top: -60 * fy,
                width: 330 * fx,
                height: 220 * fy,
                opacity: anim ? anim.weights[f] : f === FLAME_SEQUENCE[0] ? 1 : 0,
              }}
            />
          ))}
        </View>
      </Animated.View>
      {anim?.smoke.map((m, i) => (
        <Animated.View
          key={`smoke-${i}`}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            overflow: 'visible',
            opacity: m.opacity,
            transform: [
              { translateX: m.x },
              { translateY: m.y },
              { scaleX: m.sx },
              { scaleY: m.sy },
            ],
          }}
        >
          <View
            style={{
              position: 'absolute',
              left: -43 * K,
              top: -63 * K,
              width: 86 * K,
              height: 62 * K,
              overflow: 'hidden',
            }}
          >
            <Image
              source={smoke}
              accessible={false}
              style={{
                position: 'absolute',
                left: -80 * mx,
                top: -55 * my,
                width: 330 * mx,
                height: 220 * my,
              }}
            />
          </View>
        </Animated.View>
      ))}
      {anim?.sparks.map((p, i) => (
        <Animated.View
          key={`spark-${i}`}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: p.width * K,
            height: 6 * K,
            borderRadius: p.width * K,
            backgroundColor: p.color,
            opacity: p.opacity,
            transform: [{ translateX: p.x }, { translateY: p.y }, { scaleY: p.sy }],
          }}
        />
      ))}
      <Glow
        id="restGlowFront"
        cx={467}
        cy={490}
        r={195}
        color="rgb(255,193,100)"
        colorAlpha={0.3}
        alpha={0.07}
        K={K}
      />
    </View>
  );
}

// 읽기 6셀 아틀라스: 3.4초·9.4초에 220ms 간격으로 한 번 넘기고(1.32초) 나머지는 0번 셀에 머문다.
const PAGE = (() => {
  const inputRange = [0],
    outputRange = [0];
  for (const start of [3.4, 9.4])
    for (let k = 1; k <= 6; k++) {
      const at = start + k * 0.22;
      inputRange.push(at - 0.001, at);
      outputRange.push(k - 1, k === 6 ? 0 : k);
    }
  inputRange.push(LOOP);
  outputRange.push(0);
  return { inputRange, outputRange };
})();

// 호흡·미세 회전은 시계 t 만 입력이라 모든 고양이가 같은 노드를 쓴다(고양이 수만큼 interpolate 를 만들지 않는다)
const breathCache = new WeakMap<Animated.Value, { scaleX: any; scaleY: any; rotate: any }>();
function breathOf(t: Animated.Value) {
  let b = breathCache.get(t);
  if (!b) {
    const breath = (x: number) => wave(x, 3, 0.7);
    b = {
      scaleX: curve(t, LOOP, 0.05, (v) => 1 - breath(v) * 0.005),
      scaleY: curve(t, LOOP, 0.05, (v) => 1 + breath(v) * 0.012),
      rotate: curve(t, LOOP, 0.05, (v) => wave(v, 2, 0.2) * 0.006, 'rad'),
    };
    breathCache.set(t, b);
  }
  return b;
}

/** 자리 하나의 고양이. 발(512 중 256,464)을 고정하고 호흡, 읽기는 미세 회전 + 책장 넘김을 더한다. */
export function RestCat({
  t,
  still,
  pose,
  color,
  loafSource,
  x,
  top,
  n,
  flip,
  testID,
}: {
  t: Animated.Value;
  still: boolean;
  pose: 'loaf' | 'read';
  color: Color;
  loafSource: ImageSourcePropType;
  x: number;
  top: number;
  n: number;
  flip: boolean;
  testID?: string;
}) {
  const extent = n * metrics[color].reading.scale;
  const anim = useMemo(() => {
    if (still) return null;
    return {
      ...breathOf(t),
      page: t.interpolate({
        inputRange: PAGE.inputRange,
        outputRange: PAGE.outputRange.map((v) => -v * extent),
      }),
    };
  }, [t, still, extent]);
  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - n / 2,
        top,
        width: n,
        height: n,
        overflow: 'visible',
        transformOrigin: [n / 2, (n * 464) / 512, 0],
        transform: anim
          ? [
              { scaleX: anim.scaleX },
              { scaleY: anim.scaleY },
              ...(pose === 'read' ? [{ rotate: anim.rotate }] : []),
            ]
          : [],
      }}
    >
      {pose === 'loaf' ? (
        <Image
          source={loafSource}
          // 오른쪽 자리는 불을 보게 좌우 반전
          style={{ width: n, height: n, transform: [{ scaleX: flip ? -1 : 1 }] }}
        />
      ) : (
        // 책 읽기도 식빵과 같이 오른쪽 자리에서 반전한다. 셀 가운데(512 중 256)가 발 x 라 가운데 기준 반전은 발 앵커를 옮기지 않는다.
        <View
          style={{
            position: 'absolute',
            left: n / 2 - (extent * 256) / 512,
            top: (n * 464) / 512 - (extent * 464) / 512,
            width: extent,
            height: extent,
            overflow: 'hidden',
            transform: [{ scaleX: flip ? -1 : 1 }],
          }}
        >
          <Animated.Image
            source={cat(color, 'reading/atlas')}
            resizeMode="stretch"
            style={{
              width: extent * 6,
              height: extent,
              transform: [{ translateX: anim ? anim.page : 0 }],
            }}
          />
        </View>
      )}
    </Animated.View>
  );
}
