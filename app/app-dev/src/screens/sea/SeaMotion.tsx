/**
 * 바다 화면 움직임(GROMO-2785) — 11/06 HTML 시안(https://claude.ai/artifact/4qUun4tBhsqZj6ZuzqhxVX)을 그대로 옮겼다.
 *
 * - 물(`SeaWaterMotion`): 바탕 그림은 두고, 떼어 낸 밝은 물빛 줄 두 장이 반 박자 어긋나 수평선 쪽에서 앞으로 밀려오며
 *   나타났다 사라진다(투명도 sin² 라 두 장의 합이 늘 1). 그림 전체를 흔들면 어지러웠다(오스카).
 * - 하늘(`SeaSkyMotion`): 구름 네 모양이 각자 속도로 오른쪽으로 흐르고, 나가면 다른 모양·높이·크기로 다시 들어온다.
 *   갈매기는 평소엔 없다가 간격마다 한 마리가 왼쪽에서 나타나 날개를 퍼덕이며 오른쪽으로 지나간다.
 * - 수면 반짝임(`SeaGlints`): 작은 빛이 여기저기 반짝였다 사라진다.
 * - 뗏목(`RaftFloat`·`RaftRipples`): 뗏목마다 다른 주기·위상으로 위아래로 뜨고 살짝 기울며, 물가에 물결 고리가 퍼진다.
 *
 * 모두 `Animated` + `useNativeDriver` 라 JS 스레드를 쓰지 않고 OTA 로 나간다. 동작 줄이기·백그라운드·안 보이는 페이지에서는
 * 멈춘다(`useSeaRunning`). 움직이는 뷰는 작은 조각(물빛 줄·구름·갈매기·뗏목)뿐이고 바탕은 다시 그리지 않는다(티켓 2736 교훈).
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Image, StyleSheet, View, type ImageStyle } from 'react-native';
import { seaAssets } from './seaAssets';

/** 바다 원화(far-sea) 크기와 수평선 위치 — cover 로 맞춘 자리를 모든 층이 같이 쓴다. */
export const SEA_ART = { width: 1024, height: 1536, horizon: 266 / 1536 };

/** 원화를 화면에 cover 로 맞춘 사각형(앱 Image resizeMode="cover" 와 같다). */
export function seaCover(width: number, height: number) {
  const scale = Math.max(width / SEA_ART.width, height / SEA_ART.height);
  const fw = SEA_ART.width * scale,
    fh = SEA_ART.height * scale;
  return { fw, fh, ox: (width - fw) / 2, oy: (height - fh) / 2 };
}

/** 동작 줄이기가 아니고 앱이 앞에 있을 때만 true — 움직임은 전부 이 값으로 켜고 끈다. */
export function useSeaRunning(reduceMotion: boolean) {
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    // 테스트 환경의 AppState 목은 구독 객체 없이 돌아올 수 있다.
    return () => subscription?.remove();
  }, []);
  return !reduceMotion && appState === 'active';
}

/** fn 을 0~1 구간에서 steps 개로 잘라 선형 보간한다(native driver 가 그대로 돈다). */
function sampled(value: Animated.Value, steps: number, fn: (t: number) => number) {
  const inputRange: number[] = [],
    outputRange: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    inputRange.push(t);
    outputRange.push(fn(t));
  }
  return value.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
}

const deg = (value: Animated.AnimatedInterpolation<number>) =>
  value.interpolate({ inputRange: [-10, 10], outputRange: ['-10deg', '10deg'] });

/** 0 → 1 을 period 초마다 반복하는 시계. phase(0~1)에서 시작해 첫 바퀴만 짧다 — CSS 의 음수 animation-delay. */
function startPhasedLoop(value: Animated.Value, periodMs: number, phase = 0) {
  value.setValue(phase);
  const full = Animated.loop(
    Animated.timing(value, {
      toValue: 1,
      duration: periodMs,
      easing: Easing.linear,
      useNativeDriver: true,
    }),
  );
  const lead = Animated.timing(value, {
    toValue: 1,
    duration: periodMs * (1 - phase),
    easing: Easing.linear,
    useNativeDriver: true,
  });
  let stopped = false;
  lead.start(({ finished }) => {
    if (finished && !stopped) full.start();
  });
  return () => {
    stopped = true;
    lead.stop();
    full.stop();
  };
}

/** running 일 때만 phase 위상의 시계를 돌리고, 아니면 still(정지 장면 값)에 둔다. */
function useLoopClock(running: boolean, periodMs: number, phase = 0, still = 0) {
  const clock = useRef(new Animated.Value(still)).current;
  useEffect(() => {
    if (!running) {
      clock.setValue(still);
      return;
    }
    return startPhasedLoop(clock, periodMs, phase);
  }, [clock, running, periodMs, phase, still]);
  return clock;
}

// CSS ease-in-out 0%→50%→100% 왕복을 코사인으로 — 시안의 bob·roll·shadow 키프레임
const swing = (t: number, from: number, to: number) =>
  from + ((to - from) * (1 - Math.cos(2 * Math.PI * t))) / 2;
// CSS ease-out(cubic-bezier(0,0,.58,1)) 근사
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);

// ---------------------------------------------------------------- 물

const FOAM = { periodMs: 5500, amp: 1.6, swayPeriodMs: 5500 / 0.6 };

/**
 * 바다 바탕 + 물빛 줄 두 장. width·height 는 장면 크기(cover 로 원화를 맞춘다).
 * 물빛 줄은 수평선을 기준점으로 커지며 다가온다 — 먼 줄은 덜, 가까운 줄은 더 움직인다.
 */
export const SeaWaterMotion = memo(function SeaWaterMotionView({
  width,
  height,
  reduceMotion = false,
  testID = 'sea-water',
}: {
  width: number;
  height: number;
  reduceMotion?: boolean;
  testID?: string;
}) {
  const running = useSeaRunning(reduceMotion);
  const { fw, fh, ox, oy } = seaCover(width, height);
  const scale = width / 402;
  const clock = useLoopClock(running, FOAM.periodMs);
  const sway = useLoopClock(running, FOAM.swayPeriodMs);
  const rect: ImageStyle = { position: 'absolute', left: ox, top: oy, width: fw, height: fh };
  const layers = [0, 1].map((i) => {
    const u = (t: number) => (t + i / 2) % 1;
    return {
      opacity: running ? sampled(clock, 48, (t) => Math.sin(Math.PI * u(t)) ** 2) : i === 0 ? 1 : 0,
      translateY: sampled(clock, 48, (t) => (u(t) - 0.5) * 0.016 * fh * FOAM.amp),
      scale: sampled(clock, 48, (t) => 1 + (u(t) - 0.5) * 0.022 * FOAM.amp),
      translateX: sampled(
        sway,
        32,
        (t) => Math.sin((t + i * 0.3 * 0.6) * 2 * Math.PI) * 3 * scale * FOAM.amp,
      ),
    };
  });
  return (
    <View testID={testID} pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      <Image source={seaAssets.base} style={rect} accessible={false} />
      {layers.map((layer, i) => (
        <Animated.Image
          key={i}
          testID={`${testID}-foam-${i}`}
          source={seaAssets.foam}
          accessible={false}
          style={[
            rect,
            {
              transformOrigin: ['50%', `${SEA_ART.horizon * 100}%`, 0],
              opacity: layer.opacity,
              transform: running
                ? [
                    { translateX: layer.translateX },
                    { translateY: layer.translateY },
                    { scale: layer.scale },
                  ]
                : [],
            },
          ]}
        />
      ))}
    </View>
  );
});

// ---------------------------------------------------------------- 하늘

/** 구름 모양 넷 — 원화 두 개와 그걸로 만든 납작한 구름·몽실한 구름. w 는 원화 폭(1024) 대비, a 는 가로/세로. */
const CLOUD_SHAPES = [
  { source: seaAssets.clouds[0], w: 334 / 1024, a: 334 / 139 },
  { source: seaAssets.clouds[1], w: 232 / 1024, a: 232 / 78 },
  { source: seaAssets.clouds[2], w: 343 / 1024, a: 343 / 84 },
  { source: seaAssets.clouds[3], w: 213 / 1024, a: 213 / 139 },
];
/** 화면 한 폭을 가로지르는 데 걸리는 초(속도 1 기준). */
const CLOUD_CROSS_S = 120;
type Cloud = { shape: number; y: number; s: number; v: number; flip: boolean; orig: boolean };
/** 처음 구름: 원화 자리 둘 + 왼쪽 밖에서 기다리는 둘. x0 는 원화 폭 대비 시작 x. */
const INITIAL_CLOUDS: (Cloud & { x0: number })[] = [
  { shape: 0, x0: 0.0449, y: 0.0352, s: 1, v: 1, flip: false, orig: true },
  { shape: 1, x0: 0.7324, y: 0.0866, s: 1, v: 0.8, flip: false, orig: true },
  { shape: 3, x0: -0.55, y: 0.02, s: 0.8, v: 0.9, flip: true, orig: false },
  { shape: 2, x0: -1.05, y: 0.105, s: 0.75, v: 0.7, flip: false, orig: false },
];
const cloudSize = (c: Cloud, fw: number) => {
  const shape = CLOUD_SHAPES[c.shape];
  const w = shape.w * c.s * fw;
  return { w, h: w / shape.a };
};

const GULL = { gapMs: 12000, flyMs: 8000, flapHz: 2.6, widthPt: 32, aspect: 142 / 160 };

/**
 * 구름 넷 + 갈매기 한 마리. 멈추면(동작 줄이기·백그라운드) 원화 구름 둘과 지금 앱의 갈매기 정지 그림이 제자리에 있다.
 */
export const SeaSkyMotion = memo(function SeaSkyMotionView({
  width,
  height,
  reduceMotion = false,
  testID = 'sea-sky',
}: {
  width: number;
  height: number;
  reduceMotion?: boolean;
  testID?: string;
}) {
  const running = useSeaRunning(reduceMotion);
  const { fw, fh, ox, oy } = seaCover(width, height);
  const scale = width / 402;
  return (
    <View testID={testID} pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      {INITIAL_CLOUDS.map((initial, i) => (
        <CloudDrift
          key={i}
          testID={`${testID}-cloud-${i}`}
          initial={initial}
          running={running}
          width={width}
          cover={{ fw, fh, ox, oy }}
        />
      ))}
      {running ? (
        <GullFlight testID={`${testID}-gull`} width={width} height={height} scale={scale} />
      ) : (
        <Image
          testID={`${testID}-gulls-still`}
          source={seaAssets.gulls}
          resizeMode="contain"
          style={[
            styles.abs,
            {
              left: width * 0.16,
              top: height * 0.08,
              width: 56 * scale,
              height: 26 * scale,
            },
          ]}
          accessible={false}
        />
      )}
    </View>
  );
});

function CloudDrift({
  initial,
  running,
  width,
  cover,
  testID,
}: {
  initial: Cloud & { x0: number };
  running: boolean;
  width: number;
  cover: { fw: number; fh: number; ox: number; oy: number };
  testID: string;
}) {
  const [cloud, setCloud] = useState<Cloud>(initial);
  const x = useRef(new Animated.Value(cover.ox + initial.x0 * cover.fw)).current;
  // 지금 x 를 JS 에서도 안다 — 다시 돌 때 그 자리에서 이어 가고, 나가면 새 구름을 왼쪽 밖에 둔다
  const xNow = useRef(cover.ox + initial.x0 * cover.fw);
  useEffect(() => {
    const id = x.addListener(({ value }) => {
      xNow.current = value;
    });
    return () => x.removeListener(id);
  }, [x]);

  useEffect(() => {
    if (!running) return;
    let current: Animated.CompositeAnimation | null = null;
    let alive = true;
    const run = (c: Cloud) => {
      const from = xNow.current;
      const speed = (width / CLOUD_CROSS_S) * c.v; // px/s
      current = Animated.timing(x, {
        toValue: width,
        duration: Math.max(1, ((width - from) / speed) * 1000),
        easing: Easing.linear,
        useNativeDriver: true,
      });
      current.start(({ finished }) => {
        if (!finished || !alive) return;
        // 다른 모양·높이·크기로, 가끔 뒤집어서 왼쪽 밖에 다시 둔다. 작을수록 멀다 → 느리고 옅게
        let shape = c.shape;
        while (shape === c.shape) shape = Math.floor(Math.random() * CLOUD_SHAPES.length);
        const s = 0.65 + Math.random() * 0.45;
        const next: Cloud = {
          shape,
          s,
          v: 0.55 + s * 0.5,
          flip: Math.random() < 0.5,
          orig: false,
          y: 0,
        };
        const { h } = cloudSize(next, cover.fw);
        const room = SEA_ART.horizon - 0.012 - h / cover.fh;
        next.y = 0.012 + Math.random() * Math.max(0, room - 0.012);
        const { w: nw } = cloudSize(next, cover.fw);
        xNow.current = -nw - Math.random() * width * 0.4;
        x.setValue(xNow.current);
        setCloud(next);
        run(next);
      });
    };
    run(cloud);
    return () => {
      alive = false;
      current?.stop();
    };
    // 구름이 바뀔 때는 run 안에서 이어 돌린다 — cloud 를 deps 에 넣으면 같은 구름을 두 번 돌린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, width, cover.fw, cover.fh, x]);

  // 멈추면 원화 구름만 원래 자리에
  if (!running && !cloud.orig) return null;
  const { w, h } = cloudSize(cloud, cover.fw);
  const left = running ? 0 : cover.ox + initial.x0 * cover.fw;
  return (
    <Animated.Image
      testID={testID}
      source={CLOUD_SHAPES[cloud.shape].source}
      accessible={false}
      style={[
        styles.abs,
        {
          left,
          top: cover.oy + cloud.y * cover.fh,
          width: w,
          height: h,
          opacity: 0.75 + 0.25 * Math.min(1, cloud.s),
          transform: running ? [{ translateX: x }, { scaleX: cloud.flip ? -1 : 1 }] : [],
        },
      ]}
    />
  );
}

function GullFlight({
  width,
  height,
  scale,
  testID,
}: {
  width: number;
  height: number;
  scale: number;
  testID: string;
}) {
  const bw = GULL.widthPt * scale,
    bh = bw * GULL.aspect;
  const progress = useRef(new Animated.Value(0)).current;
  const [y0, setY0] = useState(0.08);
  // 기다림(안 보임, 왼쪽 밖) → 한 번 가로지름 → 새 높이로 다시 기다림
  useEffect(() => {
    let alive = true;
    let current: Animated.CompositeAnimation | null = null;
    const fly = () => {
      progress.setValue(0);
      setY0(0.05 + Math.random() * 0.08);
      current = Animated.sequence([
        Animated.delay(GULL.gapMs),
        Animated.timing(progress, {
          toValue: 1,
          duration: GULL.flyMs,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]);
      current.start(({ finished }) => {
        if (finished && alive) fly();
      });
    };
    fly();
    return () => {
      alive = false;
      current?.stop();
    };
  }, [progress]);
  const flap = useLoopClock(true, 1000 / GULL.flapHz);
  const x = progress.interpolate({ inputRange: [0, 1], outputRange: [-bw, width + bw] });
  const y = sampled(
    progress,
    48,
    (u) => y0 * height + Math.sin(u * Math.PI * 2.5) * 5 * scale - u * 0.02 * height,
  );
  // 날개 위(길게 0.6)·아래(짧게). 아래일 때 몸이 1.5px 뜬다
  const up = flap.interpolate({ inputRange: [0, 0.6, 0.6001, 1], outputRange: [1, 1, 0, 0] });
  const down = flap.interpolate({ inputRange: [0, 0.6, 0.6001, 1], outputRange: [0, 0, 1, 1] });
  const lift = flap.interpolate({
    inputRange: [0, 0.6, 0.6001, 1],
    outputRange: [0, 0, -1.5, -1.5],
  });
  return (
    <Animated.View
      testID={testID}
      style={[
        styles.abs,
        {
          width: bw,
          height: bh,
          transform: [{ translateX: x }, { translateY: y }, { translateY: lift }],
        },
      ]}
    >
      <Animated.Image
        source={seaAssets.gullUp}
        style={[StyleSheet.absoluteFill, { width: bw, height: bh, opacity: up }]}
        accessible={false}
      />
      <Animated.Image
        source={seaAssets.gullDown}
        style={[StyleSheet.absoluteFill, { width: bw, height: bh, opacity: down }]}
        accessible={false}
      />
    </Animated.View>
  );
}

// ---------------------------------------------------------------- 수면 반짝임

const GLINT_COUNT = 8;

/** 수평선 아래 아무 데나 빛이 반짝였다 사라진다 — 가까울수록 크다. 멈추면 아무것도 없다. */
export const SeaGlints = memo(function SeaGlintsView({
  width,
  height,
  reduceMotion = false,
  testID = 'sea-glints',
}: {
  width: number;
  height: number;
  reduceMotion?: boolean;
  testID?: string;
}) {
  const running = useSeaRunning(reduceMotion);
  if (!running) return null;
  return (
    <View testID={testID} pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      {Array.from({ length: GLINT_COUNT }, (_, n) => (
        <Glint key={n} n={n} width={width} height={height} />
      ))}
    </View>
  );
});

function Glint({ n, width, height }: { n: number; width: number; height: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  const place = useCallback(() => {
    const yN = 0.2 + Math.random() * 0.78,
      depth = (yN - 0.17) / 0.83,
      w = (6 + 16 * depth) * 1.1 * (width / 402);
    return {
      left: Math.random() * width,
      top: yN * height,
      w,
      h: Math.max(1.5, w / 6),
      ms: 1200 + Math.random() * 900,
    };
  }, [width, height]);
  const [spot, setSpot] = useState(place);
  useEffect(() => {
    let alive = true;
    let current: Animated.CompositeAnimation | null = null;
    const once = (delayMs: number) => {
      const next = place();
      setSpot(next);
      progress.setValue(0);
      current = Animated.sequence([
        Animated.delay(delayMs),
        Animated.timing(progress, {
          toValue: 1,
          duration: next.ms,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]);
      current.start(({ finished }) => {
        if (finished && alive) once(Math.random() * 400);
      });
    };
    // 처음엔 시간차를 두고 하나씩 켜진다
    once((n * 1650) / GLINT_COUNT);
    return () => {
      alive = false;
      current?.stop();
    };
  }, [n, place, progress]);
  const opacity = progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 0] });
  const scale = progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.4, 1, 0.7] });
  return (
    <Animated.View
      style={[
        styles.abs,
        {
          left: spot.left,
          top: spot.top,
          width: spot.w,
          height: spot.h,
          opacity,
          transform: [{ scale }],
        },
      ]}
    >
      <View style={[styles.glint, { width: spot.w, height: spot.h, borderRadius: spot.h }]} />
      <View
        style={[
          styles.glintBar,
          { left: spot.w / 2 - 1, top: spot.h / 2 - spot.h * 1.5, height: spot.h * 3 },
        ]}
      />
    </Animated.View>
  );
}

// ---------------------------------------------------------------- 뗏목

/** 뗏목 i 번째의 둥실거림 주기·위상(초) — 다 같이 움직이면 기계 같아서 뗏목마다 다르다(시안 raftEl). */
export function raftRhythm(seed: number) {
  const p1 = 3.0 + ((seed * 0.37) % 1.1),
    p2 = 4.2 + ((seed * 0.53) % 1.4);
  return { p1, p2, phase1: ((seed * 1.13) % p1) / p1, phase2: ((seed * 0.71) % p2) / p2 };
}

/**
 * 뗏목 상자 안에서 그림 층을 위아래로 띄우고 살짝 기울인다. 그림자는 뗏목 뒤에서 같은 박자로 커졌다 작아진다.
 * size 는 뗏목 상자 한 변, seed 는 뗏목 번호(나는 0, 남은 1부터).
 */
export function RaftFloat({
  size,
  seed,
  reduceMotion = false,
  children,
  testID = 'raft-float',
}: {
  size: number;
  seed: number;
  reduceMotion?: boolean;
  children: React.ReactNode;
  testID?: string;
}) {
  const running = useSeaRunning(reduceMotion);
  const { p1, p2, phase1, phase2 } = raftRhythm(seed);
  const bob = useLoopClock(running, p1 * 1000, phase1);
  const roll = useLoopClock(running, p2 * 1000, phase2);
  const translateY = sampled(bob, 32, (t) => swing(t, -0.016, 0.018) * size);
  const rotate = deg(sampled(roll, 32, (t) => swing(t, -1.6, 1.4)));
  const shadowScale = sampled(bob, 32, (t) => swing(t, 1.04, 0.94));
  const shadowOpacity = sampled(bob, 32, (t) => swing(t, 0.8, 1));
  return (
    <>
      <Animated.View
        testID={`${testID}-shadow`}
        style={[
          styles.shadow,
          {
            left: size * 0.14,
            width: size * 0.74,
            top: size * 0.74,
            height: size * 0.16,
            borderRadius: size * 0.37,
          },
          running ? { opacity: shadowOpacity, transform: [{ scale: shadowScale }] } : null,
        ]}
      />
      <Animated.View
        testID={testID}
        style={[StyleSheet.absoluteFill, running ? { transform: [{ translateY }] } : null]}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transformOrigin: ['50%', '80%', 0] },
            running ? { transform: [{ rotate }] } : null,
          ]}
        >
          {children}
        </Animated.View>
      </Animated.View>
    </>
  );
}

const RIPPLE_PERIOD_MS = 2700;

/** 뗏목이 물에 닿은 곳(약 76~83%)에서 하얀 물결 고리 셋이 차례로 퍼진다. 흔들리지 않는 물 위라 뗏목 밖(형제)에 둔다. */
export function RaftRipples({
  size,
  seed,
  reduceMotion = false,
  testID = 'raft-ripples',
}: {
  size: number;
  seed: number;
  reduceMotion?: boolean;
  testID?: string;
}) {
  const running = useSeaRunning(reduceMotion);
  if (!running) return null;
  return (
    <>
      {[0, 1, 2].map((j) => (
        <Ripple key={j} j={j} seed={seed} size={size} testID={`${testID}-${j}`} />
      ))}
    </>
  );
}

function Ripple({
  j,
  seed,
  size,
  testID,
}: {
  j: number;
  seed: number;
  size: number;
  testID: string;
}) {
  // CSS animation-delay -(j·0.9 + seed·0.4)s → 시계 위상
  const delay = j * 0.9 + seed * 0.4;
  const clock = useLoopClock(
    true,
    RIPPLE_PERIOD_MS,
    ((delay * 1000) % RIPPLE_PERIOD_MS) / RIPPLE_PERIOD_MS,
  );
  const opacity = sampled(clock, 40, (p) =>
    p < 0.2 ? 0.85 * easeOut(p / 0.2) : 0.85 * (1 - easeOut((p - 0.2) / 0.8)),
  );
  const scaleX = sampled(clock, 20, (p) => 0.72 + (1.23 - 0.72) * easeOut(p));
  const scaleY = sampled(clock, 20, (p) => 0.7 + (1.15 - 0.7) * easeOut(p));
  const w = size * (0.86 + j * 0.06),
    h = size * 0.16;
  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.ripple,
        {
          left: (size - w) / 2,
          top: size * (0.76 + j * 0.035),
          width: w,
          height: h,
          borderRadius: h,
          borderBottomWidth: Math.max(1, size / 70),
          opacity,
          transform: [{ scaleX }, { scaleY }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  shadow: { position: 'absolute', backgroundColor: 'rgba(0, 70, 90, 0.22)' },
  // 잘라내지 않는 뷰의 테두리는 iOS 가 그림으로 그려 프레임마다 다시 만든다 — 안쪽을 잘라 Core Animation 테두리로(티켓 2736)
  ripple: {
    position: 'absolute',
    borderBottomColor: 'rgba(235, 252, 255, 0.9)',
    overflow: 'hidden',
  },
  glint: { position: 'absolute', left: 0, top: 0, backgroundColor: 'rgba(255, 255, 255, 0.85)' },
  glintBar: {
    position: 'absolute',
    width: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  abs: { position: 'absolute' },
});
