/**
 * 바다 화면 움직임(GROMO-2785 표류 · GROMO-2789 망원경) — 11/06·11/07 HTML 시안을 그대로 옮겼다
 * (표류 https://claude.ai/artifact/4qUun4tBhsqZj6ZuzqhxVX, 망원경 https://claude.ai/artifact/C5wEHW6q7PK3uvJ7Q54Vwj).
 *
 * - 물(`SeaWaterMotion`·`SeaWaterTile`): 바탕 그림은 두고, 떼어 낸 밝은 물빛 줄 두 장이 반 박자 어긋나 수평선 쪽에서
 *   앞으로 밀려오며 나타났다 사라진다(투명도 sin² 라 두 장의 합이 늘 1). 그림 전체를 흔들면 어지러웠다(오스카).
 * - 하늘(`SeaSkyMotion`): 구름이 각자 속도로 오른쪽으로 흐르고, 나가면 다른 모양·높이·크기로 다시 들어온다.
 *   갈매기는 평소엔 없다가 간격마다 한 마리가 왼쪽에서 나타나 날개를 퍼덕이며 오른쪽으로 지나간다.
 * - 수면 반짝임(`SeaGlints`): 작은 빛이 여기저기 반짝였다 사라진다.
 * - 뗏목(`RaftFloat`·`RaftRipples`): 뗏목마다 다른 주기·위상으로 위아래로 뜨고 살짝 기울며, 물가에 물결 고리가 퍼진다.
 * - 섬 발치(`ShoreRipples`): 섬은 땅이라 흔들지 않고 모래톱에 물결 띠만 퍼진다(망원경).
 *
 * 그림(크기·수평선·바탕·물빛 줄)과 구름 배치는 `SeaArt`·`SkyConfig` 로 받는다 — 표류(`DRIFT_*`)와 망원경(`TELESCOPE_*`)이
 * 같은 코드로 돈다. 모두 `Animated` + `useNativeDriver` 라 JS 스레드를 쓰지 않고 OTA 로 나간다. 장면이 `useSeaRunning` 으로
 * 「동작 줄이기가 아니고 앱이 앞에 있다」를 한 번 계산해 `running` 으로 내리고, 안 보이는 페이지는 그 값을 끈다.
 * 움직이는 뷰는 작은 조각(물빛 줄·구름·갈매기·뗏목)뿐이고 바탕은 다시 그리지 않는다(티켓 2736 교훈). 보간 노드는
 * `useMemo` 로 한 번만 만든다 — 렌더마다 새로 만들면 네이티브 그래프에서 떼었다 다시 붙인다.
 */
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type ImageStyle,
} from 'react-native';
import { seaAssets } from './seaAssets';

/** 바다 원화 한 장 — 크기·수평선 위치·바탕(구름·물빛 줄을 뺀 것)·물빛 줄. cover 로 맞춘 자리를 모든 층이 같이 쓴다. */
export type SeaArt = {
  width: number;
  height: number;
  /** 수평선의 세로 위치(높이 대비 0~1) */
  horizon: number;
  base: ImageSourcePropType;
  foam: ImageSourcePropType;
};
/** 표류·항해 바다(far-sea). */
export const DRIFT_SEA_ART: SeaArt = {
  width: 1024,
  height: 1536,
  horizon: 266 / 1536,
  base: seaAssets.base,
  foam: seaAssets.foam,
};
/** 망원경 바다(telescope-sea, GROMO-2789). */
export const TELESCOPE_SEA_ART: SeaArt = {
  width: 1024,
  height: 1536,
  horizon: 545 / 1536,
  base: seaAssets.telescopeBase,
  foam: seaAssets.telescopeFoam,
};
export const SEA_ART = DRIFT_SEA_ART;

/** 원화를 화면에 cover 로 맞춘 사각형(앱 Image resizeMode="cover" 와 같다). */
export function seaCover(width: number, height: number, art: SeaArt = DRIFT_SEA_ART) {
  const scale = Math.max(width / art.width, height / art.height);
  const fw = art.width * scale,
    fh = art.height * scale;
  return { fw, fh, ox: (width - fw) / 2, oy: (height - fh) / 2 };
}

/** 동작 줄이기가 아니고 앱이 앞에 있을 때만 true — 장면이 한 번 계산해 모든 움직임에 내린다. */
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

const linear = (value: Animated.Value, toValue: number, duration: number) =>
  Animated.timing(value, { toValue, duration, easing: Easing.linear, useNativeDriver: true });

/**
 * 0 → 1 을 period 마다 반복하는 시계. phase(0~1)에서 시작해 첫 바퀴만 짧다 — CSS 의 음수 animation-delay.
 * 두 번째 바퀴부터는 `Animated.loop` 이 매 바퀴 값을 되돌린다 — 되돌리는 곳이 생성자 초기값이라 시계는 늘 0 으로 만든다.
 */
export function startPhasedLoop(value: Animated.Value, periodMs: number, phase = 0) {
  value.setValue(phase);
  const full = Animated.loop(linear(value, 1, periodMs));
  const lead = linear(value, 1, periodMs * (1 - phase));
  let stopped = false;
  lead.start(({ finished }) => {
    if (!finished || stopped) return;
    value.setValue(0);
    full.start();
  });
  return () => {
    stopped = true;
    lead.stop();
    full.stop();
  };
}

/** running 일 때만 phase 위상의 시계를 돌리고, 아니면 0(정지 장면)에 둔다. */
function useLoopClock(running: boolean, periodMs: number, phase = 0) {
  const clock = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!running) {
      clock.setValue(0);
      return;
    }
    return startPhasedLoop(clock, periodMs, phase);
  }, [clock, running, periodMs, phase]);
  return clock;
}

// CSS ease-in-out 0%→50%→100% 왕복을 코사인으로 — 시안의 bob·roll·shadow 키프레임
const swing = (t: number, from: number, to: number) =>
  from + ((to - from) * (1 - Math.cos(2 * Math.PI * t))) / 2;
// CSS ease-out(cubic-bezier(0,0,.58,1)) 근사
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);

type SceneProps = { width: number; height: number; running: boolean; testID?: string };

// ---------------------------------------------------------------- 물

const FOAM = { periodMs: 5500, amp: 1.6, swayPeriodMs: 5500 / 0.6 };

type FoamTransform = (
  | { translateX: Animated.AnimatedInterpolation<number> | Animated.AnimatedMultiplication<number> }
  | { translateY: Animated.AnimatedInterpolation<number> }
  | { scale: Animated.AnimatedInterpolation<number> }
)[];
type FoamLayer = {
  opacity: Animated.AnimatedInterpolation<number>;
  transform: FoamTransform;
  /** 좌우 반전한 타일용 — 좌우 흔들림만 부호를 뒤집어 이음매에서 양쪽 줄이 같이 움직인다 */
  mirrored: FoamTransform;
};

/**
 * 물빛 줄 두 장의 움직임(시계 둘 + 보간 노드). fh 는 cover 로 맞춘 원화 높이, scale 은 화면 폭 / 402.
 * 한 장면의 모든 타일이 같은 값을 나눠 쓴다(망원경 파노라마는 그림을 여러 장 이어 깐다).
 */
export function useSeaWater(running: boolean, fh: number, scale: number): FoamLayer[] {
  const clock = useLoopClock(running, FOAM.periodMs);
  const sway = useLoopClock(running, FOAM.swayPeriodMs);
  return useMemo(
    () =>
      [0, 1].map((i) => {
        const u = (t: number) => (t + i / 2) % 1;
        const translateX = sampled(
          sway,
          32,
          (t) => Math.sin((t + i * 0.3 * 0.6) * 2 * Math.PI) * 3 * scale * FOAM.amp,
        );
        const translateY = sampled(clock, 48, (t) => (u(t) - 0.5) * 0.016 * fh * FOAM.amp);
        const scaleBy = sampled(clock, 48, (t) => 1 + (u(t) - 0.5) * 0.022 * FOAM.amp);
        return {
          opacity: sampled(clock, 48, (t) => Math.sin(Math.PI * u(t)) ** 2),
          transform: [{ translateX }, { translateY }, { scale: scaleBy }],
          mirrored: [
            { translateX: Animated.multiply(translateX, -1) },
            { translateY },
            { scale: scaleBy },
          ],
        };
      }),
    [clock, sway, fh, scale],
  );
}

/**
 * 바다 그림 한 장 = 바탕 + 물빛 줄 두 장. 물빛 줄은 수평선을 기준점으로 커지며 다가온다 — 먼 줄은 덜, 가까운 줄은 더
 * 움직인다. 멈추면 바탕 + 첫 물빛 줄 = 원래 바다 그림이다. mirror 는 파노라마 홀수 장(좌우 반전).
 */
export const SeaWaterTile = memo(function SeaWaterTileView({
  art,
  layers,
  running,
  left,
  top,
  width,
  height,
  mirror = false,
  testID = 'sea-water-tile',
}: {
  art: SeaArt;
  layers: FoamLayer[];
  running: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  mirror?: boolean;
  testID?: string;
}) {
  const fill: ImageStyle = { position: 'absolute', left: 0, top: 0, width, height };
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.abs,
        { left, top, width, height, transform: mirror ? [{ scaleX: -1 }] : undefined },
      ]}
    >
      <Image source={art.base} style={fill} accessible={false} />
      {layers.map((layer, i) => (
        <Animated.Image
          key={i}
          testID={`${testID}-foam-${i}`}
          source={art.foam}
          accessible={false}
          style={[
            fill,
            { transformOrigin: ['50%', `${art.horizon * 100}%`, 0] },
            running
              ? { opacity: layer.opacity, transform: mirror ? layer.mirrored : layer.transform }
              : i === 0
                ? styles.shown
                : styles.hidden,
          ]}
        />
      ))}
    </View>
  );
});

/** 장면 하나를 cover 로 채우는 바다(표류·항해). width·height 는 장면 크기. */
export const SeaWaterMotion = memo(function SeaWaterMotionView({
  width,
  height,
  running,
  art = DRIFT_SEA_ART,
  testID = 'sea-water',
}: SceneProps & { art?: SeaArt }) {
  const { fw, fh, ox, oy } = seaCover(width, height, art);
  const layers = useSeaWater(running, fh, width / 402);
  return (
    <View testID={testID} pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      <SeaWaterTile
        art={art}
        layers={layers}
        running={running}
        left={ox}
        top={oy}
        width={fw}
        height={fh}
        testID={`${testID}-tile`}
      />
    </View>
  );
});

// ---------------------------------------------------------------- 하늘

/** 구름 모양 하나 — w 는 원화 폭 대비, a 는 가로/세로. */
type CloudShape = { source: ImageSourcePropType; w: number; a: number };
type Cloud = { shape: number; y: number; s: number; v: number; flip: boolean };
/** 처음 구름 — x0 는 원화 폭 대비 시작 x, orig 는 멈춘 장면에도 보이는 원화 구름. */
type InitialCloud = Cloud & { x0: number; orig: boolean };
export type SkyConfig = {
  art: SeaArt;
  shapes: CloudShape[];
  clouds: InitialCloud[];
  /** 갈매기가 나는 높이(화면 높이 대비) — base + 0~range */
  gullBand: { base: number; range: number };
  /** 멈춘 장면의 갈매기 정지 그림 자리(화면 대비). 없으면 멈추면 갈매기가 없다 */
  stillGulls?: { x: number; y: number };
};

/** 표류 하늘 — 원화 구름 둘과 그걸로 만든 납작한 구름·몽실한 구름. */
export const DRIFT_SKY: SkyConfig = {
  art: DRIFT_SEA_ART,
  shapes: [
    { source: seaAssets.clouds[0], w: 334 / 1024, a: 334 / 139 },
    { source: seaAssets.clouds[1], w: 232 / 1024, a: 232 / 78 },
    { source: seaAssets.clouds[2], w: 343 / 1024, a: 343 / 84 },
    { source: seaAssets.clouds[3], w: 213 / 1024, a: 213 / 139 },
  ],
  clouds: [
    { shape: 0, x0: 0.0449, y: 0.0352, s: 1, v: 1, flip: false, orig: true },
    { shape: 1, x0: 0.7324, y: 0.0866, s: 1, v: 0.8, flip: false, orig: true },
    { shape: 3, x0: -0.55, y: 0.02, s: 0.8, v: 0.9, flip: true, orig: false },
    { shape: 2, x0: -1.05, y: 0.105, s: 0.75, v: 0.7, flip: false, orig: false },
  ],
  gullBand: { base: 0.05, range: 0.08 },
  stillGulls: { x: 0.16, y: 0.08 },
};
/** 망원경 하늘(GROMO-2789) — 망원경 그림의 구름 셋 + 왼쪽 밖에서 기다리는 하나. 멈추면 지금처럼 갈매기가 없다. */
export const TELESCOPE_SKY: SkyConfig = {
  art: TELESCOPE_SEA_ART,
  shapes: [
    { source: seaAssets.telescopeClouds[0], w: 0.3428, a: 351 / 169 },
    { source: seaAssets.telescopeClouds[1], w: 0.1367, a: 140 / 63 },
    { source: seaAssets.telescopeClouds[2], w: 0.2637, a: 270 / 127 },
  ],
  clouds: [
    { shape: 0, x0: 0.0273, y: 0.0638, s: 1, v: 1, flip: false, orig: true },
    { shape: 1, x0: 0.5049, y: 0.2174, s: 1, v: 0.7, flip: false, orig: true },
    { shape: 2, x0: 0.709, y: 0.1738, s: 1, v: 0.85, flip: false, orig: true },
    { shape: 1, x0: -0.6, y: 0.12, s: 1.3, v: 0.8, flip: true, orig: false },
  ],
  gullBand: { base: 0.06, range: 0.16 },
};

/** 화면 한 폭을 가로지르는 데 걸리는 초(속도 1 기준). */
const CLOUD_CROSS_S = 120;
const cloudSize = (c: Cloud, shapes: CloudShape[], fw: number) => {
  const shape = shapes[c.shape];
  const w = shape.w * c.s * fw;
  return { w, h: w / shape.a };
};

const GULL = { gapMs: 12000, flyMs: 8000, flapHz: 2.6, widthPt: 32, aspect: 142 / 160 };

/**
 * 구름 + 갈매기 한 마리. 멈추면(동작 줄이기·백그라운드) 원화 구름과 정지 갈매기 그림(있으면)이 제자리에 있다.
 */
export const SeaSkyMotion = memo(function SeaSkyMotionView({
  width,
  height,
  running,
  sky = DRIFT_SKY,
  testID = 'sea-sky',
}: SceneProps & { sky?: SkyConfig }) {
  const cover = useMemo(() => seaCover(width, height, sky.art), [width, height, sky.art]);
  const scale = width / 402;
  return (
    <View testID={testID} pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      {sky.clouds.map((initial, i) => (
        <CloudDrift
          key={i}
          testID={`${testID}-cloud-${i}`}
          sky={sky}
          initial={initial}
          running={running}
          width={width}
          cover={cover}
        />
      ))}
      {running ? (
        <GullFlight
          testID={`${testID}-gull`}
          width={width}
          height={height}
          scale={scale}
          band={sky.gullBand}
        />
      ) : (
        sky.stillGulls && (
          <Image
            testID={`${testID}-gulls-still`}
            source={seaAssets.gulls}
            resizeMode="contain"
            style={[
              styles.abs,
              {
                left: width * sky.stillGulls.x,
                top: height * sky.stillGulls.y,
                width: 56 * scale,
                height: 26 * scale,
              },
            ]}
            accessible={false}
          />
        )
      )}
    </View>
  );
});

const CloudDrift = memo(function CloudDriftView({
  sky,
  initial,
  running,
  width,
  cover,
  testID,
}: {
  sky: SkyConfig;
  initial: InitialCloud;
  running: boolean;
  width: number;
  cover: { fw: number; fh: number; ox: number; oy: number };
  testID: string;
}) {
  const [cloud, setCloud] = useState<Cloud>(initial);
  const startX = cover.ox + initial.x0 * cover.fw;
  const x = useRef(new Animated.Value(startX)).current;
  // 지금 x 를 JS 에서도 안다 — 다시 돌 때 그 자리에서 이어 가고, 나가면 새 구름을 왼쪽 밖에 둔다.
  // 리스너를 달면 프레임마다 브리지를 타므로, 멈출 때 stopAnimation 으로 한 번만 받는다.
  const xNow = useRef(startX);

  useEffect(() => {
    if (!running) {
      // 멈춘 장면은 원화 구름이 원래 자리 — 흐르던 구름은 버린다
      setCloud(initial);
      xNow.current = startX;
      x.setValue(startX);
      return;
    }
    let alive = true;
    const run = (c: Cloud) => {
      const speed = (width / CLOUD_CROSS_S) * c.v; // px/s
      linear(x, width, Math.max(1, ((width - xNow.current) / speed) * 1000)).start(
        ({ finished }) => {
          if (!finished || !alive) return;
          // 다른 모양·높이·크기로, 가끔 뒤집어서 왼쪽 밖에 다시 둔다. 작을수록 멀다 → 느리고 옅게
          let shape = c.shape;
          while (shape === c.shape) shape = Math.floor(Math.random() * sky.shapes.length);
          const s = 0.65 + Math.random() * 0.45;
          const next: Cloud = { shape, s, v: 0.55 + s * 0.5, flip: Math.random() < 0.5, y: 0 };
          const { w, h } = cloudSize(next, sky.shapes, cover.fw);
          const room = sky.art.horizon - 0.012 - h / cover.fh;
          next.y = 0.012 + Math.random() * Math.max(0, room - 0.012);
          xNow.current = -w - Math.random() * width * 0.4;
          x.setValue(xNow.current);
          setCloud(next);
          run(next);
        },
      );
    };
    run(cloud);
    return () => {
      alive = false;
      x.stopAnimation((value) => {
        xNow.current = value;
      });
    };
    // 구름이 바뀔 때는 run 안에서 이어 돌린다 — cloud 를 deps 에 넣으면 같은 구름을 두 번 돌린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, width, cover.fw, cover.fh, startX, x, sky]);

  if (!running && !initial.orig) return null;
  const { w, h } = cloudSize(cloud, sky.shapes, cover.fw);
  return (
    <Animated.Image
      testID={testID}
      source={sky.shapes[cloud.shape].source}
      accessible={false}
      style={[
        styles.abs,
        running ? styles.atOrigin : { left: startX },
        {
          top: cover.oy + cloud.y * cover.fh,
          width: w,
          height: h,
          opacity: 0.75 + 0.25 * Math.min(1, cloud.s),
          transform: running ? [{ translateX: x }, { scaleX: cloud.flip ? -1 : 1 }] : [],
        },
      ]}
    />
  );
});

const GullFlight = memo(function GullFlightView({
  width,
  height,
  scale,
  band,
  testID,
}: {
  width: number;
  height: number;
  scale: number;
  band: SkyConfig['gullBand'];
  testID: string;
}) {
  const bw = GULL.widthPt * scale,
    bh = bw * GULL.aspect;
  const progress = useRef(new Animated.Value(0)).current;
  const [y0, setY0] = useState(band.base);
  // 기다림(안 보임, 왼쪽 밖) → 한 번 가로지름 → 새 높이로 다시 기다림
  useEffect(() => {
    let alive = true;
    let current: Animated.CompositeAnimation | null = null;
    const fly = () => {
      progress.setValue(0);
      setY0(band.base + Math.random() * band.range);
      current = Animated.sequence([Animated.delay(GULL.gapMs), linear(progress, 1, GULL.flyMs)]);
      current.start(({ finished }) => {
        if (finished && alive) fly();
      });
    };
    fly();
    return () => {
      alive = false;
      current?.stop();
    };
  }, [progress, band]);
  const flap = useLoopClock(true, 1000 / GULL.flapHz);
  const path = useMemo(
    () => ({
      x: progress.interpolate({ inputRange: [0, 1], outputRange: [-bw, width + bw] }),
      y: sampled(
        progress,
        48,
        (u) => y0 * height + Math.sin(u * Math.PI * 2.5) * 5 * scale - u * 0.02 * height,
      ),
    }),
    [progress, bw, width, height, scale, y0],
  );
  // 날개 위(길게 0.6)·아래(짧게). 아래일 때 몸이 1.5px 뜬다
  const wings = useMemo(
    () => ({
      up: flap.interpolate({ inputRange: [0, 0.6, 0.6001, 1], outputRange: [1, 1, 0, 0] }),
      down: flap.interpolate({ inputRange: [0, 0.6, 0.6001, 1], outputRange: [0, 0, 1, 1] }),
      lift: flap.interpolate({ inputRange: [0, 0.6, 0.6001, 1], outputRange: [0, 0, -1.5, -1.5] }),
    }),
    [flap],
  );
  return (
    <Animated.View
      testID={testID}
      style={[
        styles.abs,
        {
          width: bw,
          height: bh,
          transform: [{ translateX: path.x }, { translateY: path.y }, { translateY: wings.lift }],
        },
      ]}
    >
      <Animated.Image
        source={seaAssets.gullUp}
        style={[StyleSheet.absoluteFill, { width: bw, height: bh, opacity: wings.up }]}
        accessible={false}
      />
      <Animated.Image
        source={seaAssets.gullDown}
        style={[StyleSheet.absoluteFill, { width: bw, height: bh, opacity: wings.down }]}
        accessible={false}
      />
    </Animated.View>
  );
});

// ---------------------------------------------------------------- 수면 반짝임

const GLINT_COUNT = 8;
/** 반짝임이 뜨는 세로 구간(화면 높이 대비) — horizon 에서 멀수록(아래로) 크다. */
export type GlintZone = { horizon: number; from: number; to: number };
const DRIFT_GLINT_ZONE: GlintZone = { horizon: 0.17, from: 0.2, to: 0.98 };

/** 수평선 아래 아무 데나 빛이 반짝였다 사라진다 — 가까울수록 크다. 멈추면 아무것도 없다. */
export const SeaGlints = memo(function SeaGlintsView({
  width,
  height,
  running,
  zone = DRIFT_GLINT_ZONE,
  testID = 'sea-glints',
}: SceneProps & { zone?: GlintZone }) {
  if (!running) return null;
  return (
    <View testID={testID} pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      {Array.from({ length: GLINT_COUNT }, (_, n) => (
        <Glint key={n} n={n} width={width} height={height} zone={zone} />
      ))}
    </View>
  );
});

type Spot = { left: number; top: number; w: number; h: number; ms: number };
export const placeGlint = (width: number, height: number, zone: GlintZone): Spot => {
  const yN = zone.from + Math.random() * (zone.to - zone.from),
    depth = (yN - zone.horizon) / (1 - zone.horizon),
    w = (6 + 16 * depth) * 1.1 * (width / 402);
  return {
    left: Math.random() * width,
    top: yN * height,
    w,
    h: Math.max(1.5, w / 6),
    ms: 1200 + Math.random() * 900,
  };
};

const Glint = memo(function GlintView({
  n,
  width,
  height,
  zone,
}: {
  n: number;
  width: number;
  height: number;
  zone: GlintZone;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [spot, setSpot] = useState<Spot>(() => placeGlint(width, height, zone));
  useEffect(() => {
    let alive = true;
    let current: Animated.CompositeAnimation | null = null;
    const once = (delayMs: number) => {
      const next = placeGlint(width, height, zone);
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
  }, [n, width, height, zone, progress]);
  const fade = useMemo(
    () => ({
      opacity: progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 0] }),
      scale: progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.4, 1, 0.7] }),
    }),
    [progress],
  );
  return (
    <Animated.View
      style={[
        styles.abs,
        {
          left: spot.left,
          top: spot.top,
          width: spot.w,
          height: spot.h,
          opacity: fade.opacity,
          transform: [{ scale: fade.scale }],
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
});

// ---------------------------------------------------------------- 뗏목

/** 뗏목 i 번째의 둥실거림 주기·위상(초) — 다 같이 움직이면 기계 같아서 뗏목마다 다르다(시안 raftEl). */
export function raftRhythm(seed: number) {
  const p1 = 3.0 + ((seed * 0.37) % 1.1),
    p2 = 4.2 + ((seed * 0.53) % 1.4);
  return { p1, p2, phase1: ((seed * 1.13) % p1) / p1, phase2: ((seed * 0.71) % p2) / p2 };
}

/**
 * 뗏목 상자 안에서 그림 층을 위아래로 띄우고 살짝 기울인다. 그림자는 뗏목 뒤에서 같은 박자로 커졌다 작아진다.
 * size 는 뗏목 상자 폭(height 가 없으면 정사각형), seed 는 뗏목 번호(나는 0, 남은 1부터). amplitude 는 흔들림 배율
 * (망원경 고양이는 크고 화면에 고정이라 0.7), shadow=false 면 그림자를 두지 않는다.
 */
export const RaftFloat = memo(function RaftFloatView({
  size,
  height = size,
  seed,
  running,
  amplitude = 1,
  shadow = true,
  children,
  testID = 'raft-float',
}: {
  size: number;
  height?: number;
  seed: number;
  running: boolean;
  amplitude?: number;
  shadow?: boolean;
  children: React.ReactNode;
  testID?: string;
}) {
  const { p1, p2, phase1, phase2 } = raftRhythm(seed);
  const bob = useLoopClock(running, p1 * 1000, phase1);
  const roll = useLoopClock(running, p2 * 1000, phase2);
  const motion = useMemo(
    () => ({
      translateY: sampled(bob, 32, (t) => swing(t, -0.016, 0.018) * height * amplitude),
      rotate: deg(sampled(roll, 32, (t) => swing(t, -1.6, 1.4) * amplitude)),
      shadowScale: sampled(bob, 32, (t) => swing(t, 1.04, 0.94)),
      shadowOpacity: sampled(bob, 32, (t) => swing(t, 0.8, 1)),
    }),
    [bob, roll, height, amplitude],
  );
  return (
    <>
      {shadow && (
        <Animated.View
          testID={`${testID}-shadow`}
          style={[
            styles.shadow,
            {
              left: size * 0.14,
              width: size * 0.74,
              top: height * 0.74,
              height: height * 0.16,
              borderRadius: size * 0.37,
            },
            running
              ? { opacity: motion.shadowOpacity, transform: [{ scale: motion.shadowScale }] }
              : null,
          ]}
        />
      )}
      <Animated.View
        testID={testID}
        style={[
          StyleSheet.absoluteFill,
          running ? { transform: [{ translateY: motion.translateY }] } : null,
        ]}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.roll,
            running ? { transform: [{ rotate: motion.rotate }] } : null,
          ]}
        >
          {children}
        </Animated.View>
      </Animated.View>
    </>
  );
});

const RIPPLE = { periodMs: 2700, rings: 3 };
/** 물결 고리 자리(뗏목 상자 대비): top·width 는 [기준, 고리마다 더함], height 는 상자 높이 대비, stroke 는 폭 ÷ 값. */
export type RippleShape = {
  top: [number, number];
  width: [number, number];
  height: number;
  stroke: number;
};
/** 표류 뗏목(정사각 상자) — 물에 닿은 곳 약 76~83%. */
export const DRIFT_RIPPLES: RippleShape = {
  top: [0.76, 0.035],
  width: [0.86, 0.06],
  height: 0.16,
  stroke: 70,
};
/** 망원경 든 고양이 뗏목(600×471 그림, GROMO-2789). */
export const TELESCOPE_RIPPLES: RippleShape = {
  top: [0.78, 0.04],
  width: [0.62, 0.05],
  height: 0.2,
  stroke: 90,
};

/**
 * 뗏목이 물에 닿은 곳에서 하얀 물결 고리 셋이 차례로 퍼진다. 흔들리지 않는 물 위라 뗏목 밖(형제)에 둔다.
 * 시계는 뗏목당 하나 — 고리 j 는 1/3 씩 어긋난 진행(시안 animation-delay −j·0.9s)이다.
 */
export const RaftRipples = memo(function RaftRipplesView({
  size,
  height = size,
  seed,
  running,
  shape = DRIFT_RIPPLES,
  testID = 'raft-ripples',
}: {
  size: number;
  height?: number;
  seed: number;
  running: boolean;
  shape?: RippleShape;
  testID?: string;
}) {
  // CSS animation-delay −(seed·0.4)s → 시계 위상. 고리 사이 −j·0.9s 는 2.7s 의 j/3 이라 아래 u 에서 더한다
  const clock = useLoopClock(
    running,
    RIPPLE.periodMs,
    ((seed * 400) % RIPPLE.periodMs) / RIPPLE.periodMs,
  );
  const rings = useMemo(
    () =>
      Array.from({ length: RIPPLE.rings }, (_, j) => {
        // 톱니(u 가 1→0 으로 돌아가는 곳)는 60 단계 중 정확히 샘플 점에 떨어지고 그때 투명도가 0 이라 보이지 않는다
        const u = (t: number) => (t + j / RIPPLE.rings) % 1;
        return {
          opacity: sampled(clock, 60, (t) => {
            const p = u(t);
            return p < 0.2 ? 0.85 * easeOut(p / 0.2) : 0.85 * (1 - easeOut((p - 0.2) / 0.8));
          }),
          scaleX: sampled(clock, 60, (t) => 0.72 + (1.23 - 0.72) * easeOut(u(t))),
          scaleY: sampled(clock, 60, (t) => 0.7 + (1.15 - 0.7) * easeOut(u(t))),
        };
      }),
    [clock],
  );
  if (!running) return null;
  return (
    <>
      {rings.map((ring, j) => {
        const w = size * (shape.width[0] + j * shape.width[1]),
          h = height * shape.height;
        return (
          <Animated.View
            key={j}
            testID={`${testID}-${j}`}
            pointerEvents="none"
            style={[
              styles.ripple,
              {
                left: (size - w) / 2,
                top: height * (shape.top[0] + j * shape.top[1]),
                width: w,
                height: h,
                borderRadius: h,
                borderBottomWidth: Math.max(1, size / shape.stroke),
                opacity: ring.opacity,
                transform: [{ scaleX: ring.scaleX }, { scaleY: ring.scaleY }],
              },
            ]}
          />
        );
      })}
    </>
  );
});

// ---------------------------------------------------------------- 섬 발치

const SHORE = { periodMs: 3200, rings: 2 };

/**
 * 섬 발치 물결(GROMO-2789) — 섬은 땅이라 흔들지 않고 모래톱에 물결 띠 둘이 반 박자 어긋나 퍼진다. 섬 그림 상자
 * (width×height) 뒤에 둔다. 멈추면 아무것도 없다.
 */
/** 섬 발치 물결 시계 하나 — 장면이 만들어 모든 섬 칸이 나눠 쓴다(섬마다 루프를 돌리지 않게). */
export function useShoreClock(running: boolean) {
  return useLoopClock(running, SHORE.periodMs);
}

export const ShoreRipples = memo(function ShoreRipplesView({
  width,
  height,
  running,
  clock: shared,
  phase = 0,
  testID = 'shore-ripples',
}: SceneProps & {
  /** 장면이 나눠 주는 시계(`useShoreClock`). 없으면 제 시계를 돈다 */
  clock?: Animated.Value;
  /** 섬마다 박자를 어긋내는 위상(0~1) — 시계를 나눠 쓸 때 `index % 3 / 3` */
  phase?: number;
}) {
  const own = useLoopClock(running && !shared, SHORE.periodMs);
  const clock = shared ?? own;
  const rings = useMemo(
    () =>
      Array.from({ length: SHORE.rings }, (_, j) => {
        const u = (t: number) => (t + phase + j / SHORE.rings) % 1;
        return {
          opacity: sampled(clock, 40, (t) => {
            const p = u(t);
            return p < 0.25 ? 0.7 * easeOut(p / 0.25) : 0.7 * (1 - easeOut((p - 0.25) / 0.75));
          }),
          scaleX: sampled(clock, 40, (t) => 0.9 + (1.08 - 0.9) * easeOut(u(t))),
          scaleY: sampled(clock, 40, (t) => 0.8 + (1.1 - 0.8) * easeOut(u(t))),
        };
      }),
    [clock, phase],
  );
  if (!running) return null;
  // 시안: 126×70 상자에 118×22(아래 2px)·128×22(아래 −2px)
  const geometry = [
    { w: width * (118 / 126), bottom: height * (2 / 70) },
    { w: width * (128 / 126), bottom: -height * (2 / 70) },
  ];
  return (
    <>
      {rings.map((ring, j) => {
        const { w, bottom } = geometry[j],
          h = height * (22 / 70);
        return (
          <Animated.View
            key={j}
            testID={`${testID}-${j}`}
            pointerEvents="none"
            style={[
              styles.ripple,
              styles.shore,
              {
                left: (width - w) / 2,
                bottom,
                width: w,
                height: h,
                borderRadius: h,
                opacity: ring.opacity,
                transform: [{ scaleX: ring.scaleX }, { scaleY: ring.scaleY }],
              },
            ]}
          />
        );
      })}
    </>
  );
});

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  atOrigin: { left: 0 },
  shown: { opacity: 1 },
  hidden: { opacity: 0 },
  shore: { borderBottomWidth: 2 },
  roll: { transformOrigin: ['50%', '80%', 0] },
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
});
