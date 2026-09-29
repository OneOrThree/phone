import { Text } from '@/design-system/typography';
import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Image,
  ImageBackground,
  PanResponder,
  Animated,
  Pressable,
  Easing,
} from 'react-native';
import { useAppLayout } from '@/utils/layout';
import { art } from '@/constants/art';
import { assets } from '@/constants/assets';
import { CatSprite } from '@/components/CatSprite';
import Svg, { Path, Ellipse } from 'react-native-svg';
import { C, T } from '@/design-system/primitives';
import { State, sessionSeconds, currentIsland, Color, SECONDS_PER_FISH } from '@/services/model';
import { catchAssetPath } from '@/screens/focus/catchAssets';
export const clock = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(n % 60)
    .toString()
    .padStart(2, '0')}`;
export function FishingBoat({
  color,
  hull,
  seconds,
  emote,
  name,
  subject,
  mine,
  reduce,
}: {
  color: Color;
  hull: string;
  seconds: number;
  emote: string | null;
  name: string;
  subject: string;
  mine: boolean;
  reduce: boolean;
}) {
  const boatScale = 154 / 1024;
  const seat = ({ raft: [479, 712] } as Record<string, number[]>)[hull];
  const count = Math.floor(seconds / SECONDS_PER_FISH),
    last = useRef(count),
    [caught, setCaught] = useState(count),
    [phase, setPhase] = useState(false),
    flight = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (count <= last.current) {
      last.current = count;
      setCaught(count);
      setPhase(false);
      return;
    }
    last.current = count;
    if (reduce) {
      setCaught(count);
      setPhase(false);
      return;
    }
    setPhase(true);
    flight.setValue(0);
    Animated.timing(flight, {
      toValue: 1,
      duration: 1450,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
    const a = setTimeout(() => setCaught(count), 1450),
      b = setTimeout(() => setPhase(false), 1900);
    return () => {
      flight.stopAnimation();
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [count, flight, reduce]);
  return (
    <View style={{ width: 154, height: 170, alignItems: 'center' }}>
      <Image
        source={assets[`boats/${hull}/layers/back-day.png`]}
        style={{ position: 'absolute', width: 154, height: 154, bottom: -9 }}
        resizeMode="contain"
      />
      <View
        style={{
          position: 'absolute',
          width: 406 * boatScale,
          height: 406 * boatScale,
          top: 25 + (seat[1] - 406) * boatScale,
          left: (seat[0] - 203) * boatScale,
        }}
      >
        <CatSprite
          color={color}
          motion={phase ? 'reel' : 'focus'}
          size={406 * boatScale}
          reduce={reduce}
          anchored={false}
          testID="fishing-boat-cat"
        />
      </View>
      <Image
        source={assets[`boats/${hull}/layers/front-day.png`]}
        style={{ position: 'absolute', width: 154, height: 154, bottom: -9 }}
        resizeMode="contain"
      />
      <View
        testID="fishing-rod"
        style={{
          position: 'absolute',
          left: (seat[0] + 3) * boatScale,
          top: 25 + (seat[1] - 366) * boatScale,
          width: 293 * boatScale,
          height: 325 * boatScale,
          transform: [{ rotate: phase ? '-11deg' : '0deg' }],
        }}
      >
        <Image
          source={assets['props/fishing/fishing-rod.png']}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
      <Svg
        pointerEvents="none"
        width={154}
        height={170}
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <Path
          d={`M${(seat[0] + 3 + 280) * boatScale} ${25 + (seat[1] - 366 + 20) * boatScale} Q145 105 143 142`}
          fill="none"
          stroke="#725B4D"
          strokeWidth={0.8}
        />
        <Ellipse cx={143} cy={146} rx={7} ry={2} fill="none" stroke="#FFFDFA" strokeWidth={1} />
        <Ellipse
          cx={143}
          cy={141}
          rx={2}
          ry={4}
          fill="#FFA6BC"
          stroke="#8B6956"
          strokeWidth={0.6}
        />
      </Svg>
      {caught > 0 && (
        <Image
          source={assets[catchAssetPath(caught)]}
          resizeMode="contain"
          style={{
            position: 'absolute',
            width: 64,
            height: 64,
            bottom: 12,
            left: 36,
          }}
        />
      )}
      {phase && (
        <Animated.Image
          source={assets['props/fishing/catch/single.png']}
          style={{
            position: 'absolute',
            width: 24,
            height: 24,
            left: 0,
            top: 0,
            opacity: flight.interpolate({
              inputRange: [0, 0.99, 1],
              outputRange: [1, 1, 0],
            }),
            transform: [
              {
                translateX: flight.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [153, 120, 58],
                }),
              },
              {
                translateY: flight.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [120, 54, 135],
                }),
              },
              {
                rotate: flight.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['-20deg', '40deg'],
                }),
              },
            ],
          }}
        />
      )}
      {emote && (
        <View
          style={{
            position: 'absolute',
            left: 45,
            top: 25,
            width: 50,
            height: 48,
            borderRadius: 14,
            backgroundColor: C.paper,
            borderWidth: 1.5,
            borderColor: C.brown,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* 이모티콘 고르는 칸과 같은 작은 v2 이미지를 쓴다 (원본 큰 PNG는 말풍선에서 비어 보였음) */}
          <Image source={art['emote/' + emote]} style={{ width: 34, height: 34 }} />
          <View
            style={{
              position: 'absolute',
              bottom: -5,
              left: 12,
              width: 10,
              height: 10,
              backgroundColor: C.paper,
              borderRightWidth: 1.5,
              borderBottomWidth: 1.5,
              borderColor: C.brown,
              transform: [{ rotate: '45deg' }],
            }}
          />
        </View>
      )}
    </View>
  );
}
export function FocusSea({ state, emote }: { state: State; emote: string | null }) {
  const layout = useAppLayout();
  const [zoom, setZoom] = useState(1),
    [size, setSize] = useState({ w: 390, h: 740 }),
    [now, setNow] = useState(Date.now()),
    zoomRef = useRef(1),
    initial = useRef({ distance: 0, zoom: 1 });
  const z = (n: number) => {
    const v = Math.max(1, Math.min(2, n));
    zoomRef.current = v;
    setZoom(v);
  };
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
        onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
        onPanResponderGrant: (e) => {
          const t = e.nativeEvent.touches;
          if (t.length === 2)
            initial.current = {
              distance: Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY),
              zoom: zoomRef.current,
            };
        },
        onPanResponderMove: (e) => {
          const t = e.nativeEvent.touches;
          if (t.length === 2 && initial.current.distance)
            z(
              (initial.current.zoom *
                Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY)) /
                initial.current.distance,
            );
        },
        onPanResponderRelease: () => {
          initial.current.distance = 0;
        },
      }),
    [],
  );
  const seconds = sessionSeconds(state.session, now),
    peers = currentIsland(state).members.filter((m) => m.focusing),
    people = [
      {
        id: 'me',
        name: state.name,
        color: state.color,
        subject: state.session?.subject || '집중',
        seconds,
      },
      ...peers,
    ];
  return (
    <View
      testID="fishing-sea"
      onLayout={(e) =>
        setSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
      style={{ flex: 1, overflow: 'hidden', touchAction: 'none' } as any}
      {...pan.panHandlers}
    >
      <Image
        source={assets['backgrounds/fishing/day.png']}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
        resizeMode="cover"
      />
      {people.map((p, i) => {
        if (i > 0 && zoom > 1.6) return null;
        const x = layout.landscape
            ? zoom > 1.6
              ? 0.5
              : (people.length === 3 ? [0.5, 0.23, 0.77] : [0.38, 0.16, 0.62, 0.84])[i % 4]
            : i === 0
              ? 0.5
              : i % 2
                ? 0.24
                : 0.76,
          y = layout.landscape
            ? zoom > 1.6
              ? 0.49
              : 0.54
            : i === 0
              ? 0.58
              : 0.32 + Math.floor((i - 1) / 2) * 0.2;
        const own = i === 0,
          labelY = own ? (zoom > 1.6 ? 0.432 : 0.517) : 0.265 + Math.floor((i - 1) / 2) * 0.2,
          nameY = own ? (zoom > 1.6 ? 0.762 : 0.673) : 0.407 + Math.floor((i - 1) / 2) * 0.2;
        const factor =
          (own ? zoom * 0.93 : 0.86) * (layout.compact ? 0.78 : layout.tablet ? 1.3 : 1);
        const adaptive = layout.tablet || layout.landscape;
        return (
          <React.Fragment key={p.id}>
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: size.w * x - 77,
                top: size.h * y - 75,
                transform: [{ scale: factor }],
              }}
            >
              <FishingBoat
                {...p}
                hull="raft"
                emote={own ? emote : null}
                mine={own}
                reduce={state.settings.reduceMotion}
              />
            </View>
            {!(own && emote) && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: adaptive ? size.h * y - 75 * factor : size.h * labelY,
                  left: size.w * x - 92,
                  width: 184,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: C.ink,
                    backgroundColor: '#FFFDFAC9',
                    borderRadius: 999,
                    paddingHorizontal: 9,
                    paddingVertical: 4,
                  }}
                >
                  {p.subject} · {clock(p.seconds)}
                </Text>
              </View>
            )}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: adaptive ? size.h * y + 82 * factor : size.h * nameY,
                left: size.w * x - 55,
                width: 110,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: C.ink,
                  backgroundColor: '#FFFDFAC9',
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                {p.name}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}
