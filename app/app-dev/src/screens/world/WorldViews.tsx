import { Text } from '@/design-system/typography';
import { t } from '@/i18n';
import { useAppLayout } from '@/utils/layout';
import { RestGroup } from '@/screens/focus/RestGroup';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Image,
  Animated,
  AppState,
  Easing,
  Pressable,
  type AppStateStatus,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFonts } from 'expo-font';
import { State, currentIsland } from '@/services/model';
import { assets, cat } from '@/constants/assets';
import { componentTokens } from '@/design-system/tokens';
import { C, T, H, Button, useScreenInsets } from '@/design-system/primitives';
import { CatSprite } from '@/components/CatSprite';
import { PolicyLinks } from '@/components/PolicyLink';
import { growthStage } from '@/screens/island/IslandHome';
// Geometry, colors, layers and timing follow preview/motion/sailing.html.
function SeaDrift({
  children,
  width,
  duration,
  phase = 0,
  style,
}: {
  children: React.ReactNode;
  width: number;
  duration: number;
  phase?: number;
  style?: any;
}) {
  const offset = useRef(new Animated.Value(phase)).current;
  useEffect(() => {
    const animation = Animated.sequence([
      Animated.timing(offset, {
        toValue: 1,
        duration: duration * (1 - phase),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(offset, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(offset, {
            toValue: 1,
            duration,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ]),
      ),
    ]);
    animation.start();
    return () => animation.stop();
  }, []);
  return (
    <Animated.View
      style={[
        style,
        {
          transform: [
            {
              translateX: offset.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -width],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
// 움직임 줄이기: 구름·물결을 시안(v2 항해 화면, sailing.html 3.03초 프레임)과 같은 자리에 멈춘다
const FROZEN_MS = 3030;
function FrozenDrift({
  children,
  width,
  duration,
  phase = 0,
  style,
}: {
  children: React.ReactNode;
  width: number;
  duration: number;
  phase?: number;
  style?: any;
}) {
  return (
    <View
      style={[
        style,
        { transform: [{ translateX: -width * ((phase + FROZEN_MS / duration) % 1) }] },
      ]}
    >
      {children}
    </View>
  );
}
// 뗏목 출항(GROMO-2362) — 검토실 doc/animation-lab-2026-10-19 scenes-rest-raft.js voyage·hull·raftCat·wake 를 옮긴다.
// sec 는 LAB 초. 상수는 LAB 숫자 그대로(12초 주기 wave), LAB 0–6.3초를 Sailing duration 에 비례로 압축하되
// 출항 준비·정박 잔흔들림은 실시간 고정 길이로 빼고(압축하면 1.9초에서 6.4Hz 로 떤다) 항해가 남는 시간을 갖는다.
// 모든 값은 진행값 x(0→1) 하나의 보간이라 프레임마다 JS 가 돌지 않는다.
const LAB_END = 6.3;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};
const wave = (sec: number, cycles: number, offset = 0) =>
  Math.sin((Math.PI * 2 * cycles * sec) / 12 + offset);
const mod1 = (n: number) => ((n % 1) + 1) % 1;
// 실시간 초: 출항 준비(뒤로 살짝 빠지는 예비 동작) · 정박 잔흔들림(2.2Hz, 감쇠 5/s, 끝에서 0 으로 접힌다)
const PREP_S = 0.4,
  SETTLE_S = 0.6,
  SETTLE_HZ = 2.2,
  SETTLE_DECAY = 5;
// r 은 실시간 초, total 은 duration 초. 짧은 duration 이면 고정 구간을 전체의 60% 안으로 줄인다
function voyage(r: number, total: number) {
  const fit = Math.min(1, (total * 0.6) / (PREP_S + SETTLE_S)),
    prep = PREP_S * fit,
    settleS = SETTLE_S * fit,
    p = clamp01((r - prep) / (total - prep - settleS)),
    tau = r - (total - settleS);
  // 속도는 LAB 항해(4초에 300px) 기준으로 정규화 — 항적 세기·고양이 기울기가 duration 과 무관하다
  const velocity = 6 * p * (1 - p) * 75;
  return {
    // LAB x = 330 + progression*300 → 이동 구간 가운데(480)를 0 으로 둔다
    x: smooth(p) * 300 - 150 + (r < prep ? -Math.sin((Math.PI * r) / prep) * 9 : 0),
    speed: clamp01(Math.abs(velocity) / 110),
    velocity,
    settle:
      tau > 0
        ? Math.sin(2 * Math.PI * SETTLE_HZ * tau) *
          Math.exp(-SETTLE_DECAY * tau) *
          (1 - tau / settleS)
        : 0,
  };
}
// ponytail: 256구간 선형 보간 — 7초에서도 잔흔들림 한 주기 16점. 더 매끈해야 하면 STEPS 만 올린다
const STEPS = 256;
const VOYAGE_INPUT = Array.from({ length: STEPS + 1 }, (_, i) => i / STEPS);
const WAKE_COUNT = 8;
const WAKE_STERN_SHIFT = 300 - (230 - 32 / 2);
export function voyageTable(totalSec: number) {
  totalSec = Math.max(0.05, totalSec); // 0 이면 voyage 가 0/0 → NaN
  const empty = () => [] as number[];
  const tr = {
    x: empty(),
    bob: empty(),
    roll: empty(),
    lag: empty(),
    breathX: empty(),
    breathY: empty(),
    lantern: empty(),
    wake: Array.from({ length: WAKE_COUNT }, () => ({
      o: empty(),
      x: empty(),
      y: empty(),
      len: empty(),
    })),
    ring: Array.from({ length: 3 }, () => ({ o: empty(), sx: empty(), sy: empty() })),
  };
  for (const u of VOYAGE_INPUT) {
    const sec = u * LAB_END,
      v = voyage(u * totalSec, totalSec),
      breath = wave(sec, 3, 1.1),
      strength = clamp01(v.speed * 1.15);
    tr.x.push(v.x);
    tr.bob.push(wave(sec, 4) * 3 + wave(sec, 3, 1) * 1.5);
    tr.roll.push(wave(sec, 3) * 0.009 + wave(sec, 4, 0.7) * 0.004 + v.settle * 0.025);
    tr.lag.push((-v.velocity / 110) * 0.026 + v.settle * 0.025);
    tr.breathX.push(1 - breath * 0.003);
    tr.breathY.push(1 + breath * 0.007);
    tr.lantern.push(wave(sec, 3, 0.8) * 0.035 + v.settle * 0.05);
    tr.wake.forEach((w, i) => {
      const age = mod1(sec / 3 + i / WAKE_COUNT);
      w.o.push(Math.sin(Math.PI * age) * 0.35 * strength);
      // LAB 원본은 앞 끝이 −214~−264 라 선미 뒤 판(front-day, 이 줄에서 −277~−298 까지 불투명)에 대부분 가린다.
      // 길이·투명도 식은 그대로 두고 age 0 의 앞 끝(−230+32/2)을 선미 끝 −300 에 맞춰 86 만큼 뒤로 민다
      w.x.push(-(230 + WAKE_STERN_SHIFT + age * 145 * strength));
      w.y.push(62 + (i % 3) * 25 + age * 12); // LAB y 503+… − 선체 기준 441
      w.len.push(32 + age * 190 * strength);
    });
    tr.ring.forEach((r, i) => {
      const a = mod1(sec / 4 + i / 3);
      r.o.push(Math.sin(Math.PI * a) * 0.18);
      r.sx.push((250 + a * 90) / 340);
      r.sy.push((36 + a * 15) / 51);
    });
  }
  return tr;
}
const rad = (a: number[]) => a.map((v) => `${v}rad`);
const scaled = (a: number[], k: number, plus = 0) => a.map((v) => v * k + plus);
export function Sailing({
  state,
  destination,
  onArrive,
  duration = 7000,
  from = t('focusFlow.common.ourIsland'),
}: {
  state: State;
  destination: string;
  onArrive: () => void;
  duration?: number;
  from?: string;
}) {
  const layout = useAppLayout();
  const [fontsLoaded] = useFonts({
    GromoSailing: require('@/assets/fonts/gowun-dodum.ttf'),
  });
  const snap = useRef({
    color: state.color,
    hull: 'raft',
  }).current;
  const x = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(390),
    callback = useRef(onArrive);
  callback.current = onArrive;
  const reduced = state.settings.reduceMotion,
    land = layout.compact;
  // 백그라운드·비활성(제어 센터 등)에서는 진행을 멈추고, 돌아오면 남은 시간만 이어 간다(FireMotion 과 같은 판정)
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription?.remove();
  }, []);
  const paused = appState === 'background' || appState === 'inactive';
  const elapsed = useRef(0),
    arrived = useRef(false);
  useEffect(() => {
    elapsed.current = 0;
    arrived.current = false;
  }, [duration, reduced]);
  useEffect(() => {
    if (paused) return;
    // 진행값 x 는 늘 0→1 선형(시간 그 자체). 움직임 줄이기는 x 를 화면에 쓰지 않아 배가 가운데 멈춘 채
    // 같은 시간 동안 "이동 중..."을 보여준 뒤 도착한다
    const done = elapsed.current,
      began = Date.now();
    x.setValue(done / Math.max(1, duration)); // duration 0 이어도 NaN 이 되지 않게
    const animation = Animated.timing(x, {
      toValue: 1,
      duration: Math.max(0, duration - done),
      easing: Easing.linear,
      useNativeDriver: true,
    });
    // 다 온 뒤 background→active 면 남은 0ms timing 이 곧장 finished 로 끝난다 — 도착은 한 번만 알린다
    animation.start(({ finished }) => {
      if (!finished || arrived.current) return;
      arrived.current = true;
      callback.current();
    });
    return () => {
      animation.stop();
      elapsed.current = Math.min(duration, done + Date.now() - began);
    };
  }, [x, duration, reduced, paused]);
  // 가로 폰은 v2 L/sail 합성과 같이 배 300px · 수평선(49%)에 걸침
  const size = land
      ? Math.min(300, layout.height * 0.75)
      : Math.min(width * 0.8, layout.height * 0.68, 600),
    sc = size / 1024,
    cs = 310 * sc;
  const spec = (
    {
      raft: { seat: [470, 672], lantern: [755, 565, 100, 130] },
    } as Record<string, { seat: number[]; lantern: number[] }>
  )[snap.hull];
  const font = fontsLoaded ? 'GromoSailing' : undefined;
  const Drift = reduced ? FrozenDrift : SeaDrift,
    stillLand = reduced && land;
  // LAB 뗏목 600px 은 원본 928px(48~976) — LAB 1px = 928/600 원본 px
  const k = (928 / 600) * sc;
  // 기준점 = 이동 구간 가운데(LAB 480, 움직임 줄이기 정지점). LAB 처럼 화면 가운데에 두되, 정박(+150 LAB)한
  // 뗏목 오른쪽 끝(원본 976)이 화면 밖으로 나가지 않게 당긴다 — 세로 폰은 시안 프레임 위치와 같아진다
  const parkX = Math.min((width - size) / 2, width - 8 - 976 * sc - 150 * k);
  const motion = useMemo(() => {
    if (reduced) return null;
    const VOYAGE = voyageTable(duration / 1000);
    const at = (out: number[] | string[]) =>
      x.interpolate({ inputRange: VOYAGE_INPUT, outputRange: out as any });
    // 회전 기준: 뗏목은 원본 (512, 640)(LAB 선체 원점), 고양이는 발 앵커(시트), 등불은 위 가운데(매단 점)
    const hullPivot = 128 * sc,
      catPivotX = (cs * 74) / 512,
      catPivotY = (cs * 204) / 512,
      lanternPivot = -65 * sc;
    return {
      x: at(scaled(VOYAGE.x, k, parkX)),
      hull: [
        { translateY: at(scaled(VOYAGE.bob, k)) },
        { translateY: hullPivot },
        { rotate: at(rad(VOYAGE.roll)) },
        { translateY: -hullPivot },
      ],
      cat: [
        { translateX: catPivotX },
        { translateY: catPivotY },
        { rotate: at(rad(VOYAGE.lag)) },
        { scaleX: at(VOYAGE.breathX) },
        { scaleY: at(VOYAGE.breathY) },
        { translateX: -catPivotX },
        { translateY: -catPivotY },
      ],
      lantern: [
        { translateY: lanternPivot },
        { rotate: at(rad(VOYAGE.lantern)) },
        { translateY: -lanternPivot },
      ],
      wake: VOYAGE.wake.map((w) => ({
        opacity: at(w.o),
        transform: [
          { translateX: at(scaled(w.x, k)) },
          { translateY: at(scaled(w.y, k)) },
          { scaleX: at(w.len.map((v) => v / 222)) },
        ],
      })),
      ring: VOYAGE.ring.map((r) => ({
        opacity: at(r.o),
        transform: [{ scaleX: at(r.sx) }, { scaleY: at(r.sy) }],
      })),
    };
  }, [x, reduced, k, parkX, sc, cs, duration]);
  return (
    <View
      style={{ flex: 1, backgroundColor: '#f0f2df', overflow: 'hidden' }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: '51%',
        }}
      >
        {(stillLand
          ? [
              { top: '23.5%', left: '78%', w: 96, ms: 0, phase: 0, opacity: 1 },
              { top: '58.8%', left: '16%', w: 80, ms: 0, phase: 0, opacity: 1 },
            ]
          : [
              {
                top: '19%',
                left: '88%',
                w: 96,
                ms: 26000,
                phase: 0,
                opacity: 0.85,
              },
              {
                top: '69%',
                left: '115%',
                w: 80,
                ms: 32000,
                phase: 13 / 32,
                opacity: 0.55,
              },
            ]
        ).map((c, i) => (
          <Drift
            key={i}
            width={stillLand ? 0 : 660}
            duration={c.ms || 1}
            phase={c.phase}
            style={
              {
                position: 'absolute',
                top: c.top,
                left: c.left,
                width: c.w,
                height: 15,
                opacity: c.opacity,
              } as any
            }
          >
            <View
              style={{
                width: c.w,
                height: 15,
                borderRadius: 50,
                backgroundColor: '#fffdf3',
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: 15,
                bottom: 2,
                width: 40,
                height: 24,
                borderRadius: 50,
                backgroundColor: '#fffdf3',
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: 38,
                bottom: 2,
                width: 50,
                height: 31,
                borderRadius: 50,
                backgroundColor: '#fffdf3',
              }}
            />
          </Drift>
        ))}
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: '49%',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#a0cccd',
          borderTopWidth: 3,
          borderTopColor: '#e1ebdc70',
          overflow: 'hidden',
        }}
      >
        {(stillLand
          ? []
          : [
              { w: 80, top: '25%', ms: 4800, phase: 0 },
              { w: 125, top: '48%', ms: 5500, phase: 1500 / 5500 },
              { w: 48, top: '73%', ms: 4000, phase: 0.75 },
              { w: 72, top: '10%', ms: 6000, phase: 1 / 3 },
            ]
        ).map((l, i) => (
          <Drift
            key={i}
            width={620}
            duration={l.ms}
            phase={l.phase}
            style={
              {
                position: 'absolute',
                left: '115%',
                top: l.top,
                opacity: 0.55,
              } as any
            }
          >
            <Svg width={l.w} height={8} viewBox={`0 0 ${l.w} 8`}>
              <Path
                d={`M0 7 Q${l.w / 2} -4 ${l.w} 7`}
                fill="none"
                stroke="#eaf5e6"
                strokeWidth={2}
              />
            </Svg>
          </Drift>
        ))}
      </View>
      <View
        pointerEvents="none"
        style={{
          // v2 .fi-transit-copy: 세로 20.4%+5px · 가로 30px
          position: 'absolute',
          top: land ? 30 : layout.height * 0.204 + 5,
          left: '7%',
          right: '7%',
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: font,
            fontSize: 16,
            lineHeight: 25.6,
            letterSpacing: -0.15,
            color: '#354737',
            textAlign: 'center',
          }}
        >
          {/* 화살표는 시안처럼 기본 글꼴(고운돋움 화살표보다 좁다) */}
          {from} <Text style={{ fontFamily: 'System' }}>→</Text> {destination}
        </Text>
        <Text
          style={{
            fontFamily: font,
            fontSize: 24,
            lineHeight: 38.4,
            letterSpacing: -0.15,
            marginTop: land ? 2 : 5,
            color: '#354737',
          }}
        >
          {t('focusFlow.travel.inTransit')}
        </Text>
      </View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: land ? layout.height * 0.49 - size * 0.52 : '32%',
          width: size,
          height: size,
          // 출항 준비 → 가속·항해 → 감속·정박(LAB voyage). 움직임 줄이기는 정박 기준점에 멈춘다
          transform: [{ translateX: motion ? motion.x : parkX }],
        }}
      >
        {/* 항적·수면 고리는 선체 흔들림을 따르지 않고 뗏목 위치만 따른다(LAB wake) */}
        {motion?.ring.map((r, i) => (
          <Animated.View
            key={`ring${i}`}
            style={[
              {
                position: 'absolute',
                left: 512 * sc - 341 * k,
                top: 640 * sc + 104 * k - 52 * k,
              },
              r,
            ]}
          >
            <Svg width={682 * k} height={104 * k}>
              <Path
                d={`M${681 * k} ${52 * k}A${340 * k} ${51 * k} 0 0 1 ${k} ${52 * k}`}
                fill="none"
                stroke={componentTokens.sailing.ripple}
                strokeWidth={1.5 * k}
              />
            </Svg>
          </Animated.View>
        ))}
        {motion?.wake.map((w, i) => (
          <Animated.View
            key={`wake${i}`}
            style={[
              {
                position: 'absolute',
                left: 512 * sc - 111 * k,
                top: 640 * sc - 1.1 * k,
                width: 222 * k,
                height: 2.2 * k,
                borderRadius: componentTokens.sailing.wakeRadius,
                backgroundColor: componentTokens.sailing.wake,
              },
              w,
            ]}
          />
        ))}
        <Animated.View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            transform: motion?.hull ?? [],
          }}
        >
          <Image
            source={assets[`boats/${snap.hull}/sailing/back-day.png`]}
            style={{ position: 'absolute', width: size, height: size }}
          />
          <Animated.Image
            source={cat(snap.color, 'side')}
            style={{
              position: 'absolute',
              width: cs,
              height: cs,
              left: spec.seat[0] * sc - (cs * 330) / 512,
              top: spec.seat[1] * sc - (cs * 460) / 512,
              transform: motion?.cat ?? [],
            }}
          />
          <Image
            source={assets[`boats/${snap.hull}/sailing/front-day.png`]}
            style={{ position: 'absolute', width: size, height: size }}
          />
          <Animated.Image
            source={assets['props/boat-lantern/day.png']}
            style={{
              position: 'absolute',
              left: spec.lantern[0] * sc,
              top: spec.lantern[1] * sc,
              width: spec.lantern[2] * sc,
              height: spec.lantern[3] * sc,
              transform: motion?.lantern ?? [],
            }}
          />
        </Animated.View>
        {!motion && (
          // 움직임 줄이기: 정적 항적(LAB 도 enhanced 가 아닐 때만 그린다)
          <Svg
            width={size}
            height={size}
            viewBox="0 0 1024 1024"
            style={{ position: 'absolute', overflow: 'visible', opacity: 0.8 }}
          >
            <Path
              d={
                stillLand
                  ? 'M-130 897H80M-240 921H38M-70 946H165'
                  : 'M-130 897H80M-240 921H38M-70 946H165M930 881Q978 868 998 887'
              }
              fill="none"
              stroke="#eaf5e6"
              strokeWidth={6}
              strokeLinecap="round"
            />
          </Svg>
        )}
      </Animated.View>
    </View>
  );
}
export function RestWorld({
  state,
  travel,
  resume,
  home,
}: {
  state: State;
  travel: boolean;
  resume: () => void;
  home: () => void;
}) {
  const insets = useScreenInsets();
  const [phase, setPhase] = useState(travel ? 'sail' : 'read'),
    [size, setSize] = useState({ w: 390, h: 740 });
  const snap = useRef({
    color: state.color,
    buildings: currentIsland(state).buildings,
  }).current;
  const p = useRef(new Animated.ValueXY({ x: 313, y: 1135 })).current,
    z = useRef(new Animated.Value(travel ? 1 : 1.9)).current;
  useEffect(() => {
    if (phase !== 'walk') return;
    const pts = [
      { x: 390, y: 1090 },
      { x: 445, y: 988 },
      { x: 540, y: 950 },
      { x: 542, y: 869 },
      { x: 480, y: 825 },
      { x: 450, y: 825 },
    ];
    const chain = Animated.sequence(
      pts.map((q) =>
        Animated.timing(p, {
          toValue: q,
          duration: state.settings.reduceMotion ? 1 : 4000 / pts.length,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ),
    );
    chain.start(({ finished }) => {
      if (finished) {
        setPhase('read');
        Animated.timing(z, {
          toValue: 1.9,
          duration: state.settings.reduceMotion ? 1 : 900,
          useNativeDriver: true,
        }).start();
      }
    });
    return () => chain.stop();
  }, [phase]);
  if (phase === 'sail')
    return (
      <Sailing
        state={state}
        from="바다"
        destination="우리 섬"
        duration={2100}
        onArrive={() => setPhase('walk')}
      />
    );
  if (phase === 'read') return <RestGroup state={state} resume={resume} home={home} />;
  const scale = size.w / 820,
    mapW = 1024 * scale,
    mapH = 1536 * scale,
    cx = 520 * scale,
    cy = 850 * scale;
  return (
    <View
      style={{ flex: 1, backgroundColor: C.sky, overflow: 'hidden' }}
      onLayout={(e) =>
        setSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      <Animated.View
        style={{
          position: 'absolute',
          left: size.w / 2 - cx,
          top: size.h * 0.47 - cy,
          width: mapW,
          height: mapH,
          transformOrigin: `${cx}px ${cy}px`,
          transform: [{ scale: z }],
        }}
      >
        <Image
          source={assets[`backgrounds/island/growth/${growthStage(snap.buildings)}/day.png`]}
          style={{
            position: 'absolute',
            left: -768 * scale,
            width: 2560 * scale,
            height: mapH,
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            left: phase === 'read' ? 450 * scale : 0,
            top: 0,
            transform:
              phase === 'read'
                ? []
                : [
                    { translateX: Animated.multiply(p.x, scale) },
                    { translateY: Animated.multiply(p.y, scale) },
                  ],
          }}
        >
          <CatSprite
            color={snap.color}
            motion="walking"
            size={126 * scale}
            left
            reduce={state.settings.reduceMotion}
          />
        </Animated.View>
      </Animated.View>
      <View
        style={{
          position: 'absolute',
          top: 22 + insets.top,
          left: 24,
          right: 24,
          alignItems: 'center',
          gap: 9,
        }}
      >
        <View
          style={{
            backgroundColor: C.paper,
            paddingHorizontal: 18,
            paddingVertical: 7,
            borderRadius: 20,
          }}
        >
          <T small>모닥불 · 잠깐의 쉼</T>
        </View>
        <H large>모닥불로 가는 길</H>
      </View>
      <View
        style={{
          position: 'absolute',
          bottom: 24 + insets.bottom,
          left: 24,
          right: 24,
          gap: 13,
        }}
      >
        <Button
          fill
          title={state.session ? '집중 이어가기' : '섬으로 돌아가기'}
          onPress={state.session ? resume : home}
        />
      </View>
    </View>
  );
}
export function SceneHero({
  art,
  title,
  subtitle,
  tint = C.sky,
  height = 180,
}: {
  art: string;
  title: string;
  subtitle?: string;
  tint?: string;
  height?: number;
}) {
  return (
    <View
      style={{
        minHeight: height,
        borderRadius: 28,
        backgroundColor: tint,
        padding: 22,
        overflow: 'hidden',
        justifyContent: 'flex-end',
        borderWidth: 1.5,
        borderColor: C.brown,
      }}
    >
      <View
        style={{
          position: 'absolute',
          right: -26,
          top: -42,
          width: 180,
          height: 180,
          borderRadius: 90,
          backgroundColor: '#FFFFFF55',
        }}
      />
      <Text
        style={{
          position: 'absolute',
          left: 22,
          top: 20,
          color: C.paper,
          fontSize: 28,
        }}
      >
        ✦
      </Text>
      <Image
        source={assets[art]}
        style={{
          position: 'absolute',
          right: 3,
          top: -1,
          width: 160,
          height: 160,
        }}
        resizeMode="contain"
      />
      <View style={{ maxWidth: '66%', gap: 6 }}>
        <H>{title}</H>
        {subtitle && <T small>{subtitle}</T>}
      </View>
    </View>
  );
}
export function Welcome({
  start,
  terms,
  toggle,
}: {
  start: () => void;
  terms: boolean;
  toggle: () => void;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: C.cream }}>
      <View
        style={{
          flex: 1,
          overflow: 'hidden',
          backgroundColor: C.sky,
          borderBottomLeftRadius: 48,
          borderBottomRightRadius: 48,
        }}
      >
        <Image
          source={assets['backgrounds/island/growth/00-start/day.png']}
          resizeMode="cover"
          style={{ width: '100%', height: '100%' }}
        />
        <View style={{ position: 'absolute', top: 24, left: 27 }}>
          <Text
            style={{
              fontSize: 42,
              fontWeight: '900',
              color: C.paper,
              letterSpacing: 1,
            }}
          >
            GROMO
          </Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.paper }}>
            오늘의 집중이 자라는 곳
          </Text>
        </View>
        <Image
          source={cat('black', 'idle')}
          style={{
            position: 'absolute',
            width: 150,
            height: 150,
            bottom: 0,
            right: 16,
          }}
        />
      </View>
      <View style={{ padding: 26, gap: 15 }}>
        <H large>{'조금씩 집중하고,\n함께 자라요.'}</H>
        <T>나의 작은 배에서 시작하는 집중 습관.</T>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: terms }}
          onPress={toggle}
          style={{
            flexDirection: 'row',
            gap: 9,
            alignItems: 'center',
            minHeight: 40,
          }}
        >
          <Text style={{ fontSize: 22, color: C.brown }}>{terms ? '☑' : '☐'}</Text>
          <T small>이용약관과 개인정보처리방침에 동의해요.</T>
        </Pressable>
        <PolicyLinks textStyle={{ fontSize: 13, color: C.brown }} />
        <Button fill title="GROMO 시작하기" disabled={!terms} onPress={start} />
      </View>
    </View>
  );
}
