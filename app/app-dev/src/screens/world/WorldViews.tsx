import { Text } from '@/design-system/typography';
import { useAppLayout } from '@/utils/layout';
import { RestGroup } from '@/screens/focus/RestGroup';
import React, { useEffect, useRef, useState } from 'react';
import { View, Image, Animated, Easing, Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFonts } from 'expo-font';
import { State, currentIsland } from '@/services/model';
import { assets, cat } from '@/constants/assets';
import { C, T, H, Button, useScreenInsets } from '@/design-system/primitives';
import { CatSprite } from '@/components/CatSprite';
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
export function Sailing({
  state,
  destination,
  onArrive,
  duration = 7000,
  from = '우리 섬',
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
  const reduced = state.settings.reduceMotion;
  useEffect(() => {
    x.setValue(reduced ? 0.47 : 0);
    const animation = Animated.timing(x, {
      toValue: reduced ? 0.47 : 1,
      duration: reduced ? 250 : duration,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) callback.current();
    });
    return () => animation.stop();
  }, [duration, reduced]);
  const size = Math.min(width * 0.8, layout.height * 0.68, 600),
    sc = size / 1024,
    cs = 310 * sc;
  const spec = (
    {
      raft: { seat: [470, 672], lantern: [755, 565, 100, 130] },
    } as Record<string, { seat: number[]; lantern: number[] }>
  )[snap.hull];
  const font = fontsLoaded ? 'GromoSailing' : undefined;
  const Drift = reduced ? View : SeaDrift;
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
        {[
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
        ].map((c, i) => (
          <Drift
            key={i}
            width={660}
            duration={c.ms}
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
        {[
          { w: 80, top: '25%', ms: 4800, phase: 0 },
          { w: 125, top: '48%', ms: 5500, phase: 1500 / 5500 },
          { w: 48, top: '73%', ms: 4000, phase: 0.75 },
          { w: 72, top: '10%', ms: 6000, phase: 1 / 3 },
        ].map((l, i) => (
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
          position: 'absolute',
          top: '21%',
          left: '7%',
          right: '7%',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Text
          style={{
            fontFamily: font,
            fontSize: 17,
            lineHeight: 25.5,
            color: '#354737',
            textAlign: 'center',
          }}
        >
          {from} → {destination}
        </Text>
        <Text
          style={{
            fontFamily: font,
            fontSize: 25,
            lineHeight: 35,
            color: '#354737',
          }}
        >
          이동중...
        </Text>
      </View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: '32%',
          width: size,
          height: size,
          transform: [
            {
              translateX: x.interpolate({
                inputRange: [0, 1],
                outputRange: [-1.1 * size, 1.5 * size],
              }),
            },
          ],
        }}
      >
        <Image
          source={assets[`boats/${snap.hull}/sailing/back-day.png`]}
          style={{ position: 'absolute', width: size, height: size }}
        />
        <Image
          source={cat(snap.color, 'side')}
          style={{
            position: 'absolute',
            width: cs,
            height: cs,
            left: spec.seat[0] * sc - (cs * 330) / 512,
            top: spec.seat[1] * sc - (cs * 460) / 512,
          }}
        />
        <Image
          source={assets[`boats/${snap.hull}/sailing/front-day.png`]}
          style={{ position: 'absolute', width: size, height: size }}
        />
        <Image
          source={assets['props/boat-lantern/day.png']}
          style={{
            position: 'absolute',
            left: spec.lantern[0] * sc,
            top: spec.lantern[1] * sc,
            width: spec.lantern[2] * sc,
            height: spec.lantern[3] * sc,
          }}
        />
        <Svg
          width={size}
          height={size}
          viewBox="0 0 1024 1024"
          style={{ position: 'absolute', overflow: 'visible', opacity: 0.8 }}
        >
          <Path
            d="M-130 897H80M-240 921H38M-70 946H165M930 881Q978 868 998 887"
            fill="none"
            stroke="#eaf5e6"
            strokeWidth={6}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
export function RestWorld({
  state,
  travel,
  resume,
  home,
  endRest,
}: {
  state: State;
  travel: boolean;
  resume: () => void;
  home: () => void;
  endRest?: () => void;
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
  if (phase === 'read')
    return <RestGroup state={state} resume={resume} home={home} endRest={endRest} />;
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
          <T small>이용약관과 개인정보 안내에 동의해요.</T>
        </Pressable>
        <Button fill title="GROMO 시작하기" disabled={!terms} onPress={start} />
      </View>
    </View>
  );
}
