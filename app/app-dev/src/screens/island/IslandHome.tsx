import { Text } from '@/design-system/typography';
import { useIslandCamera } from '@/hooks/useIslandCamera';
import { islandBaseScale } from '@/utils/island-camera';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import Svg, {
  Image as SvgImage,
  Defs,
  Mask,
  Rect,
  LinearGradient,
  RadialGradient,
  Stop,
  Pattern,
  G,
  Use,
  ClipPath,
} from 'react-native-svg';
import { View, Image, Pressable, Animated, Easing } from 'react-native';
import {
  State,
  Building,
  Route,
  currentIsland,
  todayFocusSeconds,
  buildingNames,
  costs,
} from '@/services/model';
import { assets } from '@/constants/assets';
import { C, T, Button, Progress, useScreenInsets } from '@/design-system/primitives';
import { semanticTokens } from '@/design-system/tokens';
import { IslandDecor } from '@/screens/cosmetics/Cosmetics';
import {
  CatSprite,
  catFrameBox,
  CatMotionInput,
  interactiveMotionDurationMs,
} from '@/components/CatSprite';
import {
  Point,
  nodes,
  walkPath,
  distance,
  touchDestination,
  nearestPoint,
  isWalkable,
} from '@/utils/island-path';

const pathDistance = (pts: readonly Point[]) => {
  let sum = 0;
  for (let idx = 1; idx < pts.length; idx++) {
    sum += Math.hypot(pts[idx].x - pts[idx - 1].x, pts[idx].y - pts[idx - 1].y);
  }
  return sum;
};

export const islandPositions: Record<string, Point> = {};
export function growthStage(bs: Building[]) {
  return bs.includes('shop')
    ? '05-final-shop'
    : bs.includes('tower') && bs.includes('mail')
      ? '04-observatory-and-mailbox'
      : bs.includes('tower')
        ? '03a-observatory-first'
        : bs.includes('mail')
          ? '03b-mailbox-first'
          : bs.includes('board')
            ? '02-notice-board'
            : bs.includes('hall')
              ? '01-village-hall'
              : '00-start';
}
export function IslandHome({
  state,
  go,
  build,
  request,
  showHud = true,
  showActions = true,
  motion,
}: {
  state: State;
  go: (r: Route) => void;
  build: (b: Building) => void;
  request?: Route | null;
  showHud?: boolean;
  showActions?: boolean;
  motion?: CatMotionInput;
}) {
  const insets = useScreenInsets();
  const island = currentIsland(state),
    bs = island.buildings,
    todaySeconds = todayFocusSeconds(state, island.id);
  const [size, setSize] = useState({ w: 390, h: 740 }),
    [walking, setWalking] = useState(false),
    [left, setLeft] = useState(false),
    [destination, setDestination] = useState<Point | null>(null),
    [interactiveMotion, setInteractiveMotion] = useState<
      'tilt' | 'stretch' | 'groom' | 'yawn' | null
    >(null);
  const tiltTimer = useRef<NodeJS.Timeout | null>(null);
  const tapCountRef = useRef(0);
  const tapResetTimer = useRef<NodeJS.Timeout | null>(null);

  const triggerMotion = (m: 'tilt' | 'stretch' | 'groom' | 'yawn', faceLeft?: boolean) => {
    if (tiltTimer.current) clearTimeout(tiltTimer.current);
    if (faceLeft !== undefined) setLeft(faceLeft);
    setInteractiveMotion(m);
    const duration = interactiveMotionDurationMs(m);
    tiltTimer.current = setTimeout(() => {
      setInteractiveMotion(null);
    }, duration);
  };
  const triggerTilt = () => triggerMotion('tilt');
  const transitionTimer = useRef<NodeJS.Timeout | null>(null);

  const navigateWithTilt = (targetRoute: Route) => {
    triggerTilt();
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    const delay = state.settings.reduceMotion ? 0 : 520;
    if (delay) {
      transitionTimer.current = setTimeout(() => {
        go(targetRoute);
      }, delay);
    } else {
      go(targetRoute);
    }
  };

  const hitExtentRef = useRef(120);

  const handleCatPress = (e: any) => {
    if (walking) return;
    const hitExtent = hitExtentRef.current;
    const nativeX = e?.nativeEvent?.locationX ?? hitExtent / 2;
    const isTouchLeft = nativeX < hitExtent / 2;
    setLeft(isTouchLeft);

    if (tapResetTimer.current) clearTimeout(tapResetTimer.current);
    const count = tapCountRef.current % 4;
    tapCountRef.current++;
    tapResetTimer.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 4000);

    const motionCycle: ('tilt' | 'stretch' | 'groom' | 'yawn')[] = isTouchLeft
      ? ['tilt', 'groom', 'stretch', 'yawn']
      : ['stretch', 'tilt', 'yawn', 'groom'];

    triggerMotion(motionCycle[count]);
  };

  useEffect(() => {
    return () => {
      if (tiltTimer.current) clearTimeout(tiltTimer.current);
      if (tapResetTimer.current) clearTimeout(tapResetTimer.current);
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    };
  }, []);
  const pos = useRef(nearestPoint(islandPositions[island.id] || { x: 442, y: 980 }, bs)),
    xy = useRef(new Animated.ValueXY(pos.current)).current,
    token = useRef(0);
  const scale = islandBaseScale(size.w, size.h),
    mapW = 1024 * scale,
    mapH = 1536 * scale;
  const camera = useIslandCamera(size);
  const activeMotion = motion ?? (walking ? 'walking' : (interactiveMotion ?? 'idle'));
  const catBox = catFrameBox(state.color, activeMotion, 140 * scale);
  const currentCameraScale = camera.scale ?? camera.camera.scale;
  const currentZoom = Math.max(0.1, currentCameraScale / scale);
  const minHitExtent = Math.ceil(semanticTokens.size.tapMin / currentZoom);
  const hitExtent = Math.max(catBox.extent, minHitExtent);
  hitExtentRef.current = hitExtent;
  const renderScale = useRef(new Animated.Value(scale)).current;
  const catTransform = useMemo(
    () => [
      { translateX: Animated.multiply(xy.x, renderScale) },
      { translateY: Animated.multiply(xy.y, renderScale) },
    ],
    [xy, renderScale],
  );
  useEffect(() => {
    renderScale.setValue(scale);
  }, [scale, renderScale]);
  const stopAtCurrent = (done: (point: Point) => void) => {
    let x: number | undefined, y: number | undefined;
    const finish = () => {
      if (x !== undefined && y !== undefined) done(nearestPoint({ x, y }, bs));
    };
    // ValueXY.stopAnimation reads its JS cache synchronously. Read both native
    // axes explicitly; never persist a pair assembled from separate frame events.
    xy.x.stopAnimation((v) => {
      x = v;
      finish();
    });
    xy.y.stopAnimation((v) => {
      y = v;
      finish();
    });
  };
  useEffect(() => {
    const restored = nearestPoint(islandPositions[island.id] || pos.current, bs);
    xy.setValue(restored);
    pos.current = restored;
    islandPositions[island.id] = restored;
    return () => {
      token.current++;
      stopAtCurrent((point) => {
        islandPositions[island.id] = point;
      });
    };
  }, [island.id]);
  const walk = (dest: Point, _label = '', route?: Route) => {
    if (tiltTimer.current) clearTimeout(tiltTimer.current);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    setInteractiveMotion(null);
    const run = ++token.current;
    // Read the native presentation position when interrupting. A JS listener can
    // be one frame behind on iPad, which used to pull the cat backwards on retap.
    stopAtCurrent((current) => {
      if (run !== token.current) return;
      pos.current = current;
      xy.setValue(current);
      const path = walkPath(current, dest, bs);
      if (path.length < 2) {
        setWalking(false);
        setDestination(null);
        return;
      }
      setDestination(path[path.length - 1]);
      setWalking(true);
      let i = 1;
      const next = () => {
        if (run !== token.current) return;
        if (i >= path.length) {
          setWalking(false);
          setDestination(null);
          if (route) {
            if (['board', 'mail', 'quest', 'hall', 'shop', 'tower', 'focusSetup'].includes(route)) {
              navigateWithTilt(route);
            } else {
              go(route);
            }
          } else if (pathDistance(path) >= 180) {
            triggerMotion('stretch');
          }
          return;
        }
        const start = path[i - 1],
          p = path[i++],
          d = distance(start, p);
        if (!isWalkable(p, bs)) {
          xy.setValue(nearestPoint(start, bs));
          setWalking(false);
          setDestination(null);
          return;
        }
        if (Math.abs(p.x - start.x) > 3) setLeft(p.x < start.x);
        Animated.timing(xy, {
          toValue: p,
          duration: state.settings.reduceMotion ? 1 : Math.max(40, (d / 190) * 1000),
          easing: Easing.linear,
          // Keep cat and camera transforms on the same coordinate update path.
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (finished && run === token.current) {
            pos.current = p;
            islandPositions[island.id] = p;
            xy.setValue(p);
            next();
          }
        });
      };
      next();
    });
  };
  const enter = (r: Route) => {
    const key =
      (
        {
          focusSetup: 'dock',
          focus: 'dock',
          boat: 'dock',
          wardrobe: 'dock',
          rest: 'fire',
          sound: 'gram',
        } as Record<string, string>
      )[r] || r;
    walk(
      nodes[key] || nodes.low,
      (
        {
          boat: '내 배',
          focusSetup: '부두',
          focus: '부두',
          rest: '모닥불',
          sound: '꽃나팔 방송기',
        } as Record<string, string>
      )[r] || buildingNames[r as Building],
      r,
    );
  };
  useEffect(() => {
    if (request) enter(request);
  }, [request]);
  const facilities: {
    id: Building;
    route: Route;
    x: number;
    y: number;
    w: number;
    h: number;
  }[] = [
    { id: 'hall', route: 'hall', x: 235, y: 220, w: 320, h: 320 },
    { id: 'board', route: 'board', x: 206, y: 535, w: 195, h: 195 },
    { id: 'tower', route: 'tower', x: 672, y: 250, w: 225, h: 300 },
    { id: 'mail', route: 'mail', x: 343, y: 1025, w: 110, h: 120 },
    { id: 'shop', route: 'shop', x: 610, y: 734, w: 300, h: 300 },
  ];
  const next = bs.includes('hall') ? 'board' : 'hall';
  return (
    <View
      testID="island-world"
      style={{ flex: 1, backgroundColor: C.sky, overflow: 'hidden' }}
      onLayout={(e) =>
        setSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      <View
        ref={camera.viewport}
        testID="island-camera"
        {...camera.handlers}
        onLayout={camera.measure}
        style={{ position: 'absolute', inset: 0, touchAction: 'none' } as any}
      >
        <Pressable
          testID="island-ground"
          accessibilityLabel="섬 산책하기"
          onPress={(e) => {
            if (!camera.canTap()) return;
            camera.tapPoint(e.nativeEvent.pageX, e.nativeEvent.pageY, (point) => {
              const p = touchDestination(point, bs);
              if (p) walk(p);
            });
          }}
          style={{ position: 'absolute', inset: 0 }}
        />
        <Animated.View
          pointerEvents="box-none"
          testID="island-camera-transform"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: mapW,
            height: mapH,
            transformOrigin: [0, 0, 0],
            transform: [
              { translateX: camera.offset.x },
              { translateY: camera.offset.y },
              { scale: camera.zoom },
            ],
          }}
        >
          <Svg
            pointerEvents="none"
            width={8192 * scale}
            height={9120 * scale}
            viewBox="0 0 8192 9120"
            style={{
              position: 'absolute',
              left: (-768 - 2048) * scale,
              top: -3040 * scale,
            }}
          >
            <Defs>
              <ClipPath id="waterCrop">
                <Rect x={-1} y={-1} width={1026} height={762} />
              </ClipPath>
              <G id="waterTile" clipPath="url(#waterCrop)">
                <SvgImage
                  href={assets['backgrounds/fishing/day.png']}
                  x={-1}
                  y={-240}
                  width={1026}
                  height={1536}
                />
              </G>
              <Pattern id="waterPattern" width={2048} height={1520} patternUnits="userSpaceOnUse">
                <Use href="#waterTile" />
                <G transform="translate(2048 0) scale(-1 1)">
                  <Use href="#waterTile" />
                </G>
                <G transform="translate(0 1520) scale(1 -1)">
                  <Use href="#waterTile" />
                </G>
                <G transform="translate(2048 1520) scale(-1 -1)">
                  <Use href="#waterTile" />
                </G>
              </Pattern>
            </Defs>
            <Rect width={8192} height={9120} fill="url(#waterPattern)" />
          </Svg>
          <Svg
            pointerEvents="none"
            width={2560 * scale}
            height={mapH}
            style={{ position: 'absolute', left: -768 * scale, top: 0 }}
            viewBox="0 0 2560 1536"
          >
            <Defs>
              <LinearGradient id="edgeY" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0" stopColor="white" stopOpacity={0} />
                <Stop offset="1" stopColor="white" />
              </LinearGradient>
              <LinearGradient id="edgeX" x1="0%" y1="0%" x2="100%" y2="0%">
                <Stop offset="0" stopColor="white" stopOpacity={0} />
                <Stop offset="1" stopColor="white" />
              </LinearGradient>
              <RadialGradient id="edgeCorner" cx="100%" cy="100%" rx="100%" ry="100%">
                <Stop offset="0" stopColor="white" />
                <Stop offset="1" stopColor="white" stopOpacity={0} />
              </RadialGradient>
              {/* A single alpha mask: nested SVG masks disappear on iOS. */}
              <Mask
                id="fade"
                x={0}
                y={0}
                width={2560}
                height={1536}
                maskUnits="userSpaceOnUse"
                maskContentUnits="userSpaceOnUse"
                maskType="alpha"
              >
                <Rect x={110} y={110} width={2340} height={1316} fill="white" />
                <Rect x={110} width={2340} height={110} fill="url(#edgeY)" />
                <G transform="translate(0 1536) scale(1 -1)">
                  <Rect x={110} width={2340} height={110} fill="url(#edgeY)" />
                </G>
                <Rect y={110} width={110} height={1316} fill="url(#edgeX)" />
                <G transform="translate(2560 0) scale(-1 1)">
                  <Rect y={110} width={110} height={1316} fill="url(#edgeX)" />
                </G>
                {[
                  '',
                  'translate(2560 0) scale(-1 1)',
                  'translate(0 1536) scale(1 -1)',
                  'translate(2560 1536) scale(-1 -1)',
                ].map((transform) => (
                  <G key={transform} transform={transform || undefined}>
                    <Rect width={110} height={110} fill="url(#edgeCorner)" />
                  </G>
                ))}
              </Mask>
            </Defs>
            <SvgImage
              href={assets[`backgrounds/island/growth/${growthStage(bs)}/day.png`]}
              width={2560}
              height={1536}
              mask="url(#fade)"
            />
          </Svg>
          <IslandDecor island={island} width={mapW} height={mapH} />
          {facilities
            .filter((f) => bs.includes(f.id))
            .map((f) => (
              <Pressable
                testID={'facility-' + f.id}
                key={f.id}
                accessibilityRole="button"
                accessibilityLabel={buildingNames[f.id]}
                onPress={() => camera.canTap() && enter(f.route)}
                style={({ pressed }) => ({
                  position: 'absolute',
                  left: f.x * scale,
                  top: f.y * scale,
                  width: f.w * scale,
                  height: Math.max(44, f.h * scale),
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  opacity: pressed ? 0.65 : 1,
                })}
              ></Pressable>
            ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="모닥불"
            onPress={() => camera.canTap() && enter('rest')}
            style={{
              position: 'absolute',
              left: 450 * scale,
              top: 725 * scale,
              width: 150 * scale,
              height: 125 * scale,
              justifyContent: 'flex-end',
              alignItems: 'center',
            }}
          ></Pressable>
          {bs.includes('gram') && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="꽃나팔 방송기"
              onPress={() => camera.canTap() && enter('sound')}
              style={{
                position: 'absolute',
                left: 590 * scale,
                top: 850 * scale,
                width: 120 * scale,
                height: 120 * scale,
              }}
            >
              <Image
                source={assets['props/music-player/day.png']}
                style={{ width: '100%', height: '100%' }}
              />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="내 배"
            onPress={() => camera.canTap() && enter('boat')}
            style={{
              position: 'absolute',
              left: 200 * scale,
              top: 1130 * scale,
              width: 200 * scale,
              height: 180 * scale,
              justifyContent: 'flex-end',
              alignItems: 'center',
            }}
          ></Pressable>
          {destination && (
            <View
              pointerEvents="none"
              testID="walk-destination"
              style={{
                position: 'absolute',
                left: (destination.x - 32) * scale,
                top: (destination.y - 12) * scale,
                width: 64 * scale,
                height: 24 * scale,
                borderRadius: 32 * scale,
                borderWidth: 2,
                borderColor: '#FFFDF5E6',
                backgroundColor: '#FFAAC54D',
              }}
            />
          )}
          <Animated.View
            pointerEvents="box-none"
            testID={walking ? 'cat-walking' : 'cat-arrived'}
            // Explicit paint bounds keep the sprite visible after native remounts.
            collapsable={false}
            style={{
              position: 'absolute',
              left: -hitExtent / 2,
              top: -catBox.y - (hitExtent - catBox.extent) / 2,
              width: hitExtent,
              height: hitExtent,
              transform: catTransform,
              zIndex: 30,
            }}
          >
            <Pressable
              testID="island-cat-actor"
              accessibilityRole="button"
              accessibilityLabel="내 고양이"
              onPress={handleCatPress}
              style={{
                width: hitExtent,
                height: hitExtent,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  left: hitExtent / 2 - catBox.x,
                  top: (hitExtent - catBox.extent) / 2,
                  width: catBox.extent,
                  height: catBox.extent,
                }}
              >
                <CatSprite
                  testID="island-cat-sprite"
                  anchored={false}
                  color={state.color}
                  motion={activeMotion}
                  size={140 * scale}
                  left={left}
                  reduce={state.settings.reduceMotion}
                  onFinish={interactiveMotion ? () => setInteractiveMotion(null) : undefined}
                />
              </View>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </View>
      {showHud && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 20 + insets.left,
            right: 20 + insets.right,
            top: 12 + insets.top,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View
            pointerEvents="none"
            style={{
              backgroundColor: '#FFFDFA99',
              borderRadius: 999,
              paddingHorizontal: 14,
              paddingVertical: 6,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 18,
              minWidth: 210,
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontSize: 12, color: C.muted }}>오늘 집중</Text>
            <Text
              style={{
                fontSize: 22,
                fontWeight: '700',
                fontVariant: ['tabular-nums'],
                color: C.ink,
              }}
            >
              {Math.floor(todaySeconds / 3600)
                .toString()
                .padStart(2, '0')}
              :
              {Math.floor((todaySeconds / 60) % 60)
                .toString()
                .padStart(2, '0')}
              :
              {Math.floor(todaySeconds % 60)
                .toString()
                .padStart(2, '0')}
            </Text>
          </View>
        </View>
      )}
      {showActions && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            bottom: 12 + insets.bottom,
            left: 20 + insets.left,
            right: 20 + insets.right,
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          {!bs.includes('board') && (
            <View
              style={{
                // v2: 가로에서도 왼쪽 아래(집중 시작 버튼과 같은 줄), 폭 300
                width: Math.min(
                  size.w > size.h ? 300 : 330,
                  (size.w - insets.left - insets.right - 40) * 0.58,
                ),
                marginBottom: 8,
                alignSelf: 'flex-end',
                backgroundColor: '#FFFDFAF5',
                borderRadius: 20,
                padding: 12,
                gap: 8,
                borderWidth: 1.5,
                borderColor: C.brown,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink }}>
                  {next === 'hall' ? '마을회관 짓기' : '게시판 짓기'}
                </Text>
                <T small>
                  {island.contribution}/{costs[next]} 마리
                </T>
              </View>
              <Progress value={Math.min(100, (island.contribution / costs[next]) * 100)} />
              {island.contribution >= costs[next] ? (
                <Button small title={buildingNames[next] + ' 짓기'} onPress={() => build(next)} />
              ) : null}
            </View>
          )}
          <View style={{ marginLeft: 'auto' }}>
            <Button
              round
              title={state.session ? '집중 이어가기' : '집중 시작'}
              onPress={() =>
                enter(
                  state.session
                    ? state.session.status === 'paused'
                      ? 'rest'
                      : 'focus'
                    : 'focusSetup',
                )
              }
            />
          </View>
        </View>
      )}
    </View>
  );
}
