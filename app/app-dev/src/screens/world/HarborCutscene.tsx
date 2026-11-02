import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Image,
  PixelRatio,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { cat, assets } from '@/constants/assets';
import { CatOutfitLayers, type Outfit } from '@/components/CatOutfitLayers';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens as c, primitiveTokens as p } from '@/design-system/tokens';
import type { Color } from '@/services/model';
import {
  HARBOR_STEPS,
  harborFrame,
  harborScenePose,
  harborDuration,
  harborCamera,
  harborOceanBounds,
  type HarborDirection,
} from './harborMotion';
import { PelicanDeliveryArt } from './PelicanDeliveryArt';
import { seaLoaf } from '@/screens/sea/seaAssets';

const OCEAN = require('@/assets/ota/harbor/ocean-camera.jpg');
const HARBOR = require('@/assets/ota/harbor/island-dock.png');
const D = c.harborCutscene;
const REQUIRED_IMAGES = ['ocean', 'harbor', 'raft-back', 'raft-front', 'cat'];

type Props = {
  direction: HarborDirection;
  color: Color;
  outfit?: Outfit;
  accessibilityLabel: string;
  onFinish: () => void;
  testID?: string;
  /** 검토 화면에서 원본 영상과 시작·일시정지를 맞춘다. 앱에서는 자동 재생한다. */
  paused?: boolean;
  onReady?: () => void;
};

/** 출항·접안 공통 장면. 배경·섬·배·고양이를 따로 그려 화면 비율과 털색을 영상에서 분리한다. */
export function HarborCutscene({
  direction,
  color,
  outfit,
  accessibilityLabel,
  onFinish,
  testID = 'harbor-cutscene',
  paused,
  onReady,
}: Props) {
  const reduced = useContext(MotionContext);
  const finished = useRef(false);
  const callback = useRef(onFinish);
  callback.current = onFinish;
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    callback.current();
  }, []);
  return reduced ? (
    <Skipped finish={finish} />
  ) : (
    <Playing
      direction={direction}
      color={color}
      outfit={outfit}
      accessibilityLabel={accessibilityLabel}
      onFinish={finish}
      testID={testID}
      paused={paused}
      onReady={onReady}
    />
  );
}

function Skipped({ finish }: { finish: () => void }) {
  useEffect(finish, [finish]);
  return null;
}

function Playing({
  color,
  outfit,
  direction,
  accessibilityLabel,
  onFinish,
  testID,
  paused: controlledPause = false,
  onReady,
}: Props) {
  const look = useRef({ color, outfit }).current;
  const window = useWindowDimensions();
  const [box, setBox] = useState({ width: window.width, height: window.height });
  const frame = harborFrame(box.width, box.height, direction);
  const duration = harborDuration(direction);
  const progress = useRef(new Animated.Value(0)).current;
  const elapsed = useRef(0);
  const [appState, setAppState] = useState(AppState.currentState);
  const appPaused = appState === 'background' || appState === 'inactive';
  const paused = appPaused || controlledPause;
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const required =
    direction === 'pelican-mail'
      ? [
          'ocean',
          'raft-back',
          'raft-front',
          'cat',
          'bird-up',
          'bird-down',
          'bird-rest',
          'book',
          'book-depth',
        ]
      : direction === 'abandon'
        ? [...REQUIRED_IMAGES.filter((name) => name !== 'harbor'), 'cat-rest']
        : REQUIRED_IMAGES;
  const ready = required.every((name) => loaded.has(name));
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  useEffect(() => {
    if (ready) readyCallback.current?.();
  }, [ready]);
  const loadedImage = (name: string) => () =>
    setLoaded((before) => (before.has(name) ? before : new Set([...before, name])));
  useEffect(() => {
    const listener = AppState.addEventListener('change', setAppState);
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!ready || paused) return;
    let cancelled = false;
    const started = Date.now();
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(0, duration - elapsed.current),
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start(({ finished }) => {
      if (!cancelled && finished) onFinish();
    });
    return () => {
      cancelled = true;
      animation.stop();
      elapsed.current = Math.min(duration, elapsed.current + Date.now() - started);
    };
  }, [progress, paused, ready, onFinish, duration]);
  // 원화 로딩이 실패하거나 멈춰도 이동을 붙잡지 않는다. 비활성 시간은 대기에 넣지 않는다.
  const loadWait = useRef(0);
  useEffect(() => {
    if (ready || appPaused) return;
    const started = Date.now();
    const timer = setTimeout(onFinish, Math.max(0, D.loadTimeout - loadWait.current));
    return () => {
      clearTimeout(timer);
      loadWait.current += Date.now() - started;
    };
  }, [ready, appPaused, onFinish]);

  const motion = useMemo(() => {
    const scene = harborFrame(box.width, box.height, direction);
    const samples = HARBOR_STEPS.map((step) => harborScenePose(scene, step, direction));
    const camera = HARBOR_STEPS.map((step) => harborCamera(scene, step, direction));
    const cameraAt = (key: keyof (typeof camera)[number]) =>
      progress.interpolate({
        inputRange: HARBOR_STEPS,
        outputRange: camera.map((sample) => sample[key]),
      });
    const at = (key: keyof (typeof samples)[number]) =>
      progress.interpolate({ inputRange: HARBOR_STEPS, outputRange: samples.map((s) => s[key]) });
    return {
      camera: [
        { translateX: cameraAt('x') },
        { translateY: cameraAt('y') },
        { scale: cameraAt('zoom') },
      ],
      ocean: harborOceanBounds(scene, direction),
      harbor: [
        { translateX: at('harborDrawX') },
        { translateY: at('harborDrawY') },
        { scale: at('harborScale') },
      ],
      raft: [{ translateX: at('raftX') }, { translateY: at('raftY') }],
      roll: progress.interpolate({
        inputRange: HARBOR_STEPS,
        outputRange: samples.map((s) => `${s.raftRoll}deg`),
      }),
      cat: [{ translateX: at('catX') }, { translateY: at('catY') }],
      body: [{ scaleX: at('catScaleX') }, { scaleY: at('catScaleY') }],
      shadow: [
        { translateX: at('catX') },
        { translateY: at('shadowY') },
        { scale: at('shadowScale') },
      ],
      shadowOpacity: at('shadowOpacity'),
      wakeOpacity: at('wakeOpacity'),
      awake:
        direction === 'abandon'
          ? progress.interpolate({ inputRange: [0, 0.5, 0.78, 1], outputRange: [1, 1, 0, 0] })
          : 1,
      resting: progress.interpolate({ inputRange: [0, 0.5, 0.78, 1], outputRange: [0, 0, 1, 1] }),
    };
  }, [progress, box.width, box.height, direction]);
  const raftBox = {
    position: 'absolute' as const,
    left: -frame.raftSize * D.raftAnchorX,
    top: -frame.raftSize * D.raftAnchorY,
    width: frame.raftSize,
    height: frame.raftSize,
  };
  // 클로즈업 최대 배율까지 포함해 바다 원화의 픽셀 밀도를 확보한다.
  const tile = Math.floor(
    Math.min(D.oceanTileSize, D.oceanSourceSize / PixelRatio.get()) / D.camera.maxZoom,
  );
  const oceanLeft = Math.floor(motion.ocean.left / tile) * tile - tile;
  const oceanTop = Math.floor(motion.ocean.top / tile) * tile - tile;
  const oceanCols = Math.ceil((motion.ocean.right - oceanLeft) / tile) + 1;
  const oceanRows = Math.ceil((motion.ocean.bottom - oceanTop) / tile) + 1;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="assertive"
      accessibilityViewIsModal
      pointerEvents="auto"
      style={styles.scene}
      onLayout={({ nativeEvent: { layout } }) => {
        if (layout.width > 0 && layout.height > 0)
          setBox((before) =>
            before.width === layout.width && before.height === layout.height ? before : layout,
          );
      }}
    >
      <Animated.View
        testID="harbor-camera"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { transform: motion.camera }]}
      >
        <Animated.View
          testID="harbor-ocean"
          pointerEvents="none"
          style={[
            { position: 'absolute', top: oceanTop, left: oceanLeft },
            {
              width: oceanCols * tile,
              height: oceanRows * tile,
              transform: [
                { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 12] }) },
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -16] }) },
              ],
            },
          ]}
        >
          {Array.from({ length: oceanRows }, (_, row) =>
            Array.from({ length: oceanCols }, (_, col) => (
              <Image
                key={`${row}-${col}`}
                testID={`harbor-ocean-${row}-${col}`}
                source={OCEAN}
                accessible={false}
                onLoad={row === 1 && col === 1 ? loadedImage('ocean') : undefined}
                onError={onFinish}
                style={{
                  position: 'absolute',
                  // 카메라 배율의 소수점 반올림으로 생기는 픽셀 틈을 겹쳐 덮는다.
                  left: col * tile - D.oceanTileOverlap / 2,
                  top: row * tile - D.oceanTileOverlap / 2,
                  width: tile + D.oceanTileOverlap,
                  height: tile + D.oceanTileOverlap,
                  // 맞닿은 변의 그림을 같게 해 넓은 화면에서도 바다 이음매를 숨긴다.
                  transform: [{ scaleX: col % 2 ? -1 : 1 }, { scaleY: row % 2 ? -1 : 1 }],
                }}
              />
            )),
          )}
        </Animated.View>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]}>
          {(direction === 'departure' || direction === 'arrival') && (
            <Animated.Image
              source={HARBOR}
              testID="harbor-island"
              accessible={false}
              onLoad={loadedImage('harbor')}
              onError={onFinish}
              style={[
                styles.origin,
                {
                  width: frame.size,
                  height: frame.size,
                  transform: motion.harbor,
                },
              ]}
            />
          )}
          <Animated.View style={[styles.origin, { transform: motion.raft }]}>
            <Animated.View
              style={[
                styles.wake,
                {
                  left: -frame.raftSize * 0.5,
                  top: frame.raftSize * 0.04,
                  width: frame.raftSize,
                  height: frame.raftSize * 0.32,
                  opacity: motion.wakeOpacity,
                  transform: [{ rotate: '-18deg' }],
                },
              ]}
            />
            <Animated.Image
              source={
                assets[
                  direction === 'pelican-mail'
                    ? 'boats/raft/day.png'
                    : 'boats/raft/layers/back-day.png'
                ]
              }
              testID="harbor-raft-back"
              accessible={false}
              onLoad={loadedImage('raft-back')}
              onError={onFinish}
              style={[raftBox, { transform: [{ rotate: motion.roll }] }]}
            />
          </Animated.View>
          <Animated.View
            style={[styles.origin, { transform: motion.shadow, opacity: motion.shadowOpacity }]}
          >
            <View
              style={[
                styles.shadow,
                {
                  left: -frame.catSize * 0.25,
                  top: -frame.catSize * 0.035,
                  width: frame.catSize * 0.5,
                  height: frame.catSize * 0.12,
                },
              ]}
            />
          </Animated.View>
          <Animated.View style={[styles.origin, { transform: motion.cat }]}>
            <Animated.View
              style={{
                position: 'absolute',
                width: frame.catSize,
                height: frame.catSize,
                left: -frame.catSize / 2,
                top: -frame.catSize * D.catFootY,
                transform: motion.body,
              }}
            >
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: motion.awake }]}>
                <Image
                  source={cat(look.color, 'idle')}
                  testID="harbor-cat"
                  accessible={false}
                  onLoad={loadedImage('cat')}
                  onError={onFinish}
                  style={{ width: frame.catSize, height: frame.catSize }}
                />
                {look.outfit && (
                  <CatOutfitLayers
                    outfit={look.outfit}
                    pose={{ color: look.color, still: 'idle', size: frame.catSize }}
                  />
                )}
              </Animated.View>
              {direction === 'abandon' && (
                <Animated.View style={[StyleSheet.absoluteFill, { opacity: motion.resting }]}>
                  <Image
                    source={seaLoaf[look.color]}
                    testID="harbor-cat-rest"
                    accessible={false}
                    onLoad={loadedImage('cat-rest')}
                    onError={onFinish}
                    style={{ width: frame.catSize, height: frame.catSize }}
                  />
                  {look.outfit && (
                    <CatOutfitLayers
                      outfit={look.outfit}
                      pose={{ color: look.color, still: 'loaf', size: frame.catSize }}
                    />
                  )}
                </Animated.View>
              )}
            </Animated.View>
          </Animated.View>
          {direction === 'pelican-mail' && (
            <PelicanDeliveryArt
              frame={frame}
              progress={progress}
              onLoaded={loadedImage}
              onError={onFinish}
            />
          )}
          <Animated.View style={[styles.origin, { transform: motion.raft }]}>
            <Animated.Image
              source={assets['boats/raft/layers/front-day.png']}
              testID="harbor-raft-front"
              accessible={false}
              onLoad={loadedImage('raft-front')}
              onError={onFinish}
              style={[raftBox, { transform: [{ rotate: motion.roll }] }]}
            />
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    zIndex: D.zIndex,
    backgroundColor: p.color.sky,
  },
  origin: { position: 'absolute', top: 0, left: 0 },
  wake: {
    position: 'absolute',
    borderWidth: D.wakeWidth,
    borderColor: c.sailing.ripple,
    borderRadius: c.sailing.wakeRadius,
  },
  shadow: {
    position: 'absolute',
    borderRadius: c.sailing.wakeRadius,
    backgroundColor: p.color.brown,
  },
});
