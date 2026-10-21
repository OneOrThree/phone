/**
 * 낚시섬 집중·낚아올리기 연출. 움직임 검토실(doc/animation-lab-2026-10-19/scenes-focus-fishing.js)
 * 「집중」·「낚시」 장면의 식과 상수를 그대로 옮긴다(intensity 1, particles 1).
 *
 * - 모든 변환은 Animated native driver 로 돌린다. 프레임마다 React 상태를 바꾸지 않는다.
 * - 연출은 보상·집중 시간·상태를 만들지 않는다. 낚아올리기 창(2초)은 FishingActor 의 상태 타이머가 정한다.
 * - 동작 줄이기·백그라운드·덮인 화면(inert)에서는 루프를 멈추고 정지 한 장면을 둔다.
 * - LAB 은 고양이 원본 512px 를 390px 로 그린다. 앱에서는 LAB px × (고양이 크기 a / 390)로 옮긴다.
 */
import React, { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, Image, View } from 'react-native';
import { assets } from '@/constants/assets';
import { componentTokens } from '@/design-system/tokens';
import { REEL_LAB_END_S, REEL_LAB_START_S, REEL_WINDOW_MS } from '@/components/catMotion';
import type { CatPoseTransform } from '@/components/CatSprite';

const TAU = Math.PI * 2;
const tokens = componentTokens.fishingScene;
export const LAB_CAT_PX = 390;
const FOCUS_LOOP_S = 12;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (x: number) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
const segment = (t: number, a: number, b: number) => smooth((t - a) / (b - a));

/** 덮인 화면(모달·결과·황금 컷신)에서는 false. FishingIsland 가 inert 로 내려 준다. */
export const FishingSceneActive = createContext(true);

// ---- LAB 식 (scenes-focus-fishing.js) ----

/** poseAt(): 4초 호흡. sx = 1 - breath*.45, sy = 1 + breath. */
export const labBreath = (t: number) => Math.sin((t * TAU) / 4) * 0.01;
/** focusState(): 12초 미세 회전(rad). */
export const labMicro = (t: number) => Math.sin((t * TAU) / 12) * 0.012;

/** fishingEnhancedState(): lean·castSettle·pull·recoil 회전과 poseSettle 눌림. */
export function labReelPose(tt: number) {
  const wind = segment(tt, 0.55, 1.15),
    release = segment(tt, 1.15, 1.72);
  const lean = -0.085 * wind * (1 - release);
  const castSettle =
    tt >= 1.72 ? Math.sin((tt - 1.72) * 12) * Math.exp(-(tt - 1.72) * 6) * 0.027 : 0;
  const pull = segment(tt, 5.5, 6.1) * (1 - segment(tt, 7.4, 8.4));
  const recoil = tt > 7.55 ? Math.sin((tt - 7.55) * 11) * Math.exp(-(tt - 7.55) * 3.6) * 0.026 : 0;
  let poseSettle = 0;
  for (const at of [5.5, 6.15, 6.72, 7.1, 7.58, 8.35]) {
    const age = tt - at;
    if (age > -0.13 && age < 0) poseSettle -= Math.sin(((age + 0.13) / 0.13) * Math.PI) * 0.01;
    if (age >= 0 && age < 0.3)
      poseSettle += Math.sin((age / 0.3) * Math.PI) * Math.exp(-age * 6) * 0.014;
  }
  return {
    rotation: lean - 0.055 * pull + castSettle + recoil,
    squash: wind * (1 - release) * 0.018 + poseSettle,
  };
}

/** splash(): n번째 물방울(LAB px). age 는 물보라 시작 뒤 초. */
export function labSplashDrop(n: number, age: number, power = 1.2) {
  const angle = -Math.PI + 0.2 + n * 0.31,
    speed = (45 + (n % 3) * 22) * power;
  return {
    angle,
    x: Math.cos(angle) * speed * age,
    y: Math.sin(angle) * speed * age + age * age * 95,
    alpha: clamp(1 - age / 0.9) * 0.85,
  };
}

/** float(): i번째 물결 고리 진행(0~1). 2초에 한 바퀴, 고리 3개가 1/3씩 어긋난다. */
export const labRing = (t: number, i: number, rings = 3) => (t * 0.5 + i / rings) % 1;
/** backdrop(): n번째 물빛 반짝임 투명도. 6초 주기. */
export const labGlint = (t: number, n: number) =>
  0.1 + (0.12 * (1 + Math.sin((t * TAU) / 6 + n * 1.4))) / 2;

// ---- Animated 도우미 ----

/** fn 을 from~to 구간에서 steps 개로 잘라 선형 보간한다(native driver 가 그대로 돈다). */
function sampled(
  value: Animated.Value,
  from: number,
  to: number,
  steps: number,
  fn: (t: number) => number,
) {
  const inputRange: number[] = [],
    outputRange: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps;
    inputRange.push(t);
    outputRange.push(fn(t));
  }
  return value.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
}

const toRad = (value: Animated.AnimatedInterpolation<number> | Animated.AnimatedAddition<number>) =>
  value.interpolate({ inputRange: [-1, 1], outputRange: ['-1rad', '1rad'] });

/** 동작 줄이기가 아니고, 덮이지 않았고, 앱이 앞에 있을 때만 true. */
function useRunning(active: boolean) {
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    // 테스트 환경의 AppState 목은 구독 객체 없이 돌아올 수 있다.
    return () => subscription?.remove();
  }, []);
  return active && appState === 'active';
}

/**
 * 0 → loopSeconds 를 실제 시간으로 반복하는 시계(LAB 의 t).
 * 동작 줄이기·덮임(active=false)이면 0(정지 장면)으로 돌리고, 앱 상태만으로 멈출 때(iOS inactive 는 화면이 보인다)는 값을 두고 다시 돌 때만 0 부터 시작한다.
 */
function useLoopClock(loopSeconds: number, running: boolean, active: boolean) {
  const clock = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) clock.setValue(0);
    if (!running) return;
    clock.setValue(0);
    const loop = Animated.loop(
      Animated.timing(clock, {
        toValue: loopSeconds,
        duration: loopSeconds * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [clock, loopSeconds, running, active]);
  return clock;
}

// ---- 고양이 몸 ----

/**
 * 집중 중 호흡·미세 회전과, 낚아올리기 2초 동안 LAB 5.5~8.35초 몸 변환(pull·recoil·poseSettle)을 돌려준다.
 * catching 이 켜지거나 nonce(낚아올리기 사건)가 바뀔 때마다 처음부터 한 번 재생하고,
 * 꺼지거나 화면이 멈추면 바로 끊는다(완료 콜백 없음). running 은 덮이지 않고 앱이 앞에 있는지다.
 */
export function useFishingPose({
  active,
  catching,
  nonce = 0,
}: {
  active: boolean;
  catching: boolean;
  nonce?: number;
}) {
  const running = useRunning(active);
  const clock = useLoopClock(FOCUS_LOOP_S, running, active);
  const reel = useRef(new Animated.Value(REEL_LAB_START_S)).current;
  useEffect(() => {
    // 앱 상태만으로 멈출 때(catching 중 inactive)는 값을 둔다. 끝났거나 덮이면 시작 자세로.
    if (!catching || !active) reel.setValue(REEL_LAB_START_S);
    if (!catching || !running) return;
    reel.setValue(REEL_LAB_START_S);
    const run = Animated.timing(reel, {
      toValue: REEL_LAB_END_S,
      duration: REEL_WINDOW_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [catching, running, active, reel, nonce]);
  const pose = useMemo(() => {
    const breath = (fn: (b: number) => number) =>
      sampled(clock, 0, FOCUS_LOOP_S, 48, (t) => fn(labBreath(t)));
    const reelPose = (fn: (p: ReturnType<typeof labReelPose>) => number) =>
      sampled(reel, REEL_LAB_START_S, REEL_LAB_END_S, 114, (t) => fn(labReelPose(t)));
    const rotation = Animated.add(
      sampled(clock, 0, FOCUS_LOOP_S, 48, labMicro),
      reelPose((p) => p.rotation),
    );
    const body: CatPoseTransform = [
      { rotate: toRad(rotation) },
      {
        scaleX: Animated.add(
          breath((b) => 1 - b * 0.45),
          reelPose((p) => p.squash),
        ),
      },
      {
        scaleY: Animated.add(
          breath((b) => 1 + b),
          reelPose((p) => -p.squash),
        ),
      },
    ];
    return { body, reel };
  }, [clock, reel]);
  return { ...pose, running };
}

// ---- 낚아올리기: 물보라·물고기 ----

const SPLASH_AT = 6.1; // splash(… tt - 6.1 …, power 1.2)
const SPLASH_END = SPLASH_AT + 1.15;
const FISH_FROM = 6.1;
const FISH_TO = 7.55;

/**
 * 낚아올리기 물보라(찌 자리 왼쪽 17px)와 물고기 포물선(높이 260px)을 reel 시계(LAB 초)로 그린다.
 * 황금 물고기 진행 중에는 FishingActor 가 이 컴포넌트를 그리지 않는다.
 */
export function FishingCatchMotion({
  reel,
  bob,
  home,
  k,
  face,
}: {
  reel: Animated.Value;
  bob: { x: number; y: number };
  home: { x: number; y: number } | null;
  k: number;
  face: number;
}) {
  const nodes = useMemo(() => {
    const at = (fn: (age: number) => number) =>
      sampled(reel, SPLASH_AT, SPLASH_END, 23, (t) => fn(t - SPLASH_AT));
    // 물보라가 없는 시간에는 0, 있는 동안 1.
    const gate = reel.interpolate({
      inputRange: [SPLASH_AT - 0.001, SPLASH_AT, SPLASH_END, SPLASH_END + 0.001],
      outputRange: [0, 1, 1, 0],
      extrapolate: 'clamp',
    });
    const origin = { x: bob.x - 17 * k * face, y: bob.y };
    const dropW = Math.max(1.5, 4.8 * k),
      dropH = Math.max(1.5, 8.6 * k);
    const drops = Array.from({ length: 10 }, (_, n) => {
      const { angle } = labSplashDrop(n, 0);
      return {
        key: n,
        style: {
          position: 'absolute' as const,
          left: origin.x - dropW / 2,
          top: origin.y - dropH / 2,
          width: dropW,
          height: dropH,
          borderRadius: tokens.radius,
          backgroundColor: tokens.splashDrop,
          opacity: Animated.multiply(
            gate,
            at((age) => labSplashDrop(n, age).alpha),
          ),
          transform: [
            { translateX: at((age) => labSplashDrop(n, age).x * k * face) },
            { translateY: at((age) => labSplashDrop(n, age).y * k) },
            // ellipse(x, y, 2.4, 4.3, angle): 왼쪽을 보면 각도도 좌우로 뒤집는다.
            { rotate: `${face < 0 ? Math.PI - angle : angle}rad` },
          ],
        },
      };
    });
    const ringRx = 15 + 57 * 1.15,
      ringRy = 5 + 18 * 1.15;
    const ring = {
      position: 'absolute' as const,
      left: origin.x - ringRx * k,
      top: origin.y + 5 * k - ringRy * k,
      width: ringRx * 2 * k,
      height: ringRy * 2 * k,
      borderRadius: tokens.radius,
      borderWidth: Math.max(1, 2 * k),
      borderColor: tokens.splashRing,
      opacity: Animated.multiply(
        gate,
        at((age) => clamp(1 - age) * 0.75),
      ),
      transform: [
        { scaleX: at((age) => (15 + age * 57) / ringRx) },
        { scaleY: at((age) => (5 + age * 18) / ringRy) },
      ],
    };
    // fish(): 원본 single.png 의 물고기 부분(75,184,355,239)을 98×66 으로 그린다.
    const fishScale = (98 / 355) * k,
      fishSize = 512 * fishScale,
      fishCenter = { x: (75 + 355 / 2) * fishScale, y: (184 + 239 / 2) * fishScale };
    const fish = home && {
      position: 'absolute' as const,
      left: -fishCenter.x,
      top: -fishCenter.y,
      width: fishSize,
      height: fishSize,
      transformOrigin: [fishCenter.x, fishCenter.y, 0],
      opacity: reel.interpolate({
        inputRange: [FISH_FROM - 0.001, FISH_FROM, FISH_TO, FISH_TO + 0.001],
        outputRange: [0, 1, 1, 0],
        extrapolate: 'clamp',
      }),
      transform: (() => {
        const start = { x: bob.x - 57 * k * face, y: bob.y + Math.sin(6.1 * 19) * 3 * k };
        const p = (t: number) => clamp((t - FISH_FROM) / (FISH_TO - FISH_FROM));
        const along = (fn: (q: number) => number) =>
          sampled(reel, FISH_FROM, FISH_TO, 30, (t) => fn(p(t)));
        return [
          { translateX: along((q) => start.x + (home.x - start.x) * q) },
          {
            translateY: along(
              (q) => start.y + (home.y - start.y) * q - Math.sin(Math.PI * q) * 260 * k,
            ),
          },
          { scaleX: face < 0 ? -1 : 1 },
          {
            rotate: toRad(
              along((q) => -0.48 + q * 0.4 + Math.sin(q * Math.PI * 6) * 0.09 * (1 - q)),
            ),
          },
        ];
      })(),
    };
    return { drops, ring, fish };
  }, [reel, bob.x, bob.y, home, k, face]);
  return (
    <View
      testID="fishing-catch-motion"
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      <Animated.View style={nodes.ring} />
      {nodes.drops.map((drop) => (
        <Animated.View key={drop.key} style={drop.style} />
      ))}
      {nodes.fish && (
        <Animated.View style={nodes.fish}>
          <Image
            source={assets['props/fishing/catch/single.png']}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
          />
        </Animated.View>
      )}
    </View>
  );
}

// ---- 찌 주변: 물결 고리·물빛 반짝임 ----

type FloatSpot = { key: string; x: number; y: number; face: number; k: number };

/**
 * 찌마다 물결 고리 3개와 물빛 반짝임 6개. 시계 하나를 모든 찌가 같이 쓴다.
 * 반짝임 위치는 LAB 화면 좌표(찌에서 왼쪽 위)라서 앱에서는 찌 바깥쪽(고양이 반대편)으로 뒤집어 둔다.
 */
export function FishingFloatMotion({ spots, active }: { spots: FloatSpot[]; active: boolean }) {
  const running = useRunning(active);
  const clock = useLoopClock(FOCUS_LOOP_S, running, active);
  const rings = useMemo(
    () =>
      [0, 1, 2].map((i) => {
        const p = (t: number) => labRing(t, i);
        // 톱니(2초마다 0으로 돌아감)는 꺾이는 순간을 0.001초 간격 두 점으로 넣는다.
        const inputRange: number[] = [0],
          outputRange: number[] = [p(0)];
        for (let wrap = 2 * (1 - i / 3); wrap < FOCUS_LOOP_S; wrap += 2) {
          inputRange.push(wrap - 0.001, wrap);
          outputRange.push(1, 0);
        }
        inputRange.push(FOCUS_LOOP_S);
        outputRange.push(p(FOCUS_LOOP_S - 1e-9));
        // 정지(동작 줄이기) 장면은 LAB 처럼 고리를 i/3 진행에 고정한다.
        return running
          ? clock.interpolate({ inputRange, outputRange, extrapolate: 'clamp' })
          : new Animated.Value(i / 3);
      }),
    [clock, running],
  );
  const glints = useMemo(
    () =>
      Array.from({ length: 6 }, (_, n) =>
        running ? sampled(clock, 0, FOCUS_LOOP_S, 48, (t) => labGlint(t, n)) : null,
      ),
    [clock, running],
  );
  return (
    <>
      {spots.map((spot) => {
        const { k } = spot;
        return (
          <View
            key={spot.key}
            pointerEvents="none"
            style={{ position: 'absolute', left: spot.x, top: spot.y, zIndex: 3 }}
          >
            {rings.map((p, i) => (
              <Animated.View
                key={i}
                style={{
                  position: 'absolute',
                  left: -48 * k,
                  top: 8 * k - 14 * k,
                  width: 96 * k,
                  height: 28 * k,
                  borderRadius: tokens.radius,
                  borderWidth: Math.max(1, 1.8 * k),
                  borderColor: tokens.floatRing,
                  opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0.48, 0] }),
                  transform: [
                    { scaleX: p.interpolate({ inputRange: [0, 1], outputRange: [13 / 48, 1] }) },
                    { scaleY: p.interpolate({ inputRange: [0, 1], outputRange: [4 / 14, 1] }) },
                  ],
                }}
              />
            ))}
            {glints.map((alpha, n) =>
              alpha ? (
                <Animated.View
                  key={`g${n}`}
                  style={{
                    position: 'absolute',
                    left: -spot.face * (420 + ((n * 61) % 300) - 746) * k - 15 * k,
                    top: (230 + ((n * 29) % 86) - 301) * k - 1.5 * k,
                    width: 30 * k,
                    height: Math.max(2, 3 * k),
                    borderTopWidth: Math.max(1, 2 * k),
                    borderColor: tokens.glint,
                    borderRadius: tokens.radius,
                    opacity: alpha,
                  }}
                />
              ) : null,
            )}
          </View>
        );
      })}
    </>
  );
}
