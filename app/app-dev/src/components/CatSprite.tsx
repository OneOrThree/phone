import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Image, View, type ImageSourcePropType } from 'react-native';
import { assets, cat } from '@/constants/assets';
import {
  CAT_IDLE_ATLASES,
  CAT_IDLE_ATLAS_FRAMES,
  CAT_IDLE_ATLAS_SIZES,
} from '@/constants/cat-idle-atlases';
import metrics from '@/constants/motion-metrics.json';
import { Color } from '@/services/model';
import { CatOutfitLayers, type Outfit } from './CatOutfitLayers';
import {
  CAT_FRAME_SEQUENCES,
  CatFrameMotion,
  CatIdleBehavior,
  CatKeyPose,
  CatMotionInput,
  catFrameDelay,
  catKeyPoses,
  catSequenceLength,
  frameOpacityRange,
  frameSteps,
  nextIdleBehavior,
  normalizeCatMotion,
  playMotion,
  IDLE_REST_DELAY_MS,
  INTERACTIVE_MOTION_CYCLES,
  interactiveMotionDurationMs,
} from './catMotion';
export type { CatMotion, CatMotionInput } from './catMotion';
export { INTERACTIVE_MOTION_CYCLES, interactiveMotionDurationMs };

type MetricMotion = 'blink' | 'walking' | 'reading';
type AnimatedNumber = Animated.Value | Animated.AnimatedInterpolation<number>;
export type CatPoseTransform = readonly (
  | { rotate: Animated.AnimatedInterpolation<string> }
  | { scaleX: AnimatedNumber }
  | { scaleY: AnimatedNumber }
)[];
type MotionMetric = { scale: number; footAnchor: readonly number[] };

function metricFor(color: Color, motion: CatMotionInput): MotionMetric {
  const normalized = normalizeCatMotion(motion);
  const metricMotion: MetricMotion =
    normalized === 'walk' ? 'walking' : normalized === 'read' ? 'reading' : 'blink';
  const metric = metrics[color][metricMotion] as unknown as MotionMetric;
  return metric;
}

/** 부모의 좌표를 고양이 발바닥 기준으로 맞추기 위한 그리기 영역이다. */
export function catFrameBox(color: Color, motion: CatMotionInput, size: number) {
  const metric = metricFor(color, motion);
  const extent = size * metric.scale;
  return {
    extent,
    x: (extent * metric.footAnchor[0]) / 512,
    y: (extent * metric.footAnchor[1]) / 512,
  };
}

/** 한 번 재생하고 끝나는 동작의 사이클 수(cast·상호작용). 반복 동작이면 undefined. */
function oneShotCycles(motion: CatFrameMotion): number | undefined {
  if (motion === 'cast') return 1;
  return motion in INTERACTIVE_MOTION_CYCLES
    ? INTERACTIVE_MOTION_CYCLES[motion as keyof typeof INTERACTIVE_MOTION_CYCLES]
    : undefined;
}

// 동작별 [셀, 유지 ms] 시간표. 렌더마다 새 배열이 생기지 않게 모듈에서 한 번 만든다.
// CYCLE_STEPS 는 한 바퀴(반복·idle 동작), ONE_SHOT_STEPS 는 사이클 수만큼 잇고 끝에 중립 0번 칸을 둔다.
const CYCLE_STEPS = {} as Record<CatFrameMotion, readonly CatKeyPose[]>;
const ONE_SHOT_STEPS = {} as Record<CatFrameMotion, readonly CatKeyPose[]>;
for (const motion of Object.keys(CAT_FRAME_SEQUENCES) as CatFrameMotion[]) {
  const cycle = frameSteps(CAT_FRAME_SEQUENCES[motion], catFrameDelay(motion));
  CYCLE_STEPS[motion] = cycle;
  ONE_SHOT_STEPS[motion] = [
    ...Array.from({ length: oneShotCycles(motion) ?? 1 }, () => cycle).flat(),
    [0, catFrameDelay(motion)],
  ];
}

const motionCycleMs = (motion: CatFrameMotion) => catSequenceLength(motion) * catFrameDelay(motion);
const posesMs = (poses: readonly CatKeyPose[]) => poses.reduce((sum, [, hold]) => sum + hold, 0);

/** 재생 한 번: 시간표 이름과 그 재생의 경과 ms 값. 값은 네이티브 드라이버가 흘리고 JS 는 프레임마다 깨지 않는다. */
type CatRun = { key: string; value: Animated.Value };

function useCatPlayback(
  motion: CatMotionInput,
  color: Color,
  paused: boolean,
  onFinish?: () => void,
  generation?: number,
  keyed = false,
  replayKey?: number,
) {
  const normalized = normalizeCatMotion(motion);
  const [idleBehavior, setIdleBehavior] = useState<CatIdleBehavior>('blink');
  // 재생마다 한 번만 바뀐다. 그 사이 셀 전환은 네이티브 드라이버가 경과 값으로 하고 React 는 다시 그리지 않는다.
  const [run, setRun] = useState<CatRun | null>(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    let animation: Animated.CompositeAnimation | undefined;
    let runToken: object | undefined;
    const stopRun = () => {
      runToken = undefined;
      animation?.stop();
      animation = undefined;
    };
    // 첫 셀(0번)에 멈춘다. 재생이 없으면 모든 레이어가 첫 셀을 보인다.
    const still = () => {
      stopRun();
      setRun(null);
    };
    // key 시간표를 durationMs 만큼 네이티브 드라이버로 재생한다. 한 번 재생이면 끝날 때만 JS 로 onEnd 를 부른다.
    const play = (key: string, durationMs: number, repeat: boolean, onEnd?: () => void) => {
      stopRun();
      const token = {};
      runToken = token;
      const value = new Animated.Value(0);
      setRun({ key, value });
      const started = playMotion(value, durationMs, repeat, ({ finished }) => {
        if (finished && !cancelled && runToken === token) onEnd?.();
      });
      // onEnd 가 곧바로 다음 재생을 시작했으면 그 재생을 남긴다.
      if (runToken === token) animation = started;
    };
    const rest = (next: () => void) => {
      setIdleBehavior('blink');
      still();
      timer = setTimeout(next, IDLE_REST_DELAY_MS);
    };

    still();
    setIdleBehavior('blink');
    if (paused) {
      if (onFinishRef.current && normalized === 'cast') {
        // Reduce Motion·백그라운드에서는 시각 재생 없이 one-shot을 완료한다.
        timer = setTimeout(() => {
          if (cancelled) return;
          onFinishRef.current?.();
        }, 0);
      }
      if (
        onFinishRef.current &&
        (normalized === 'tilt' ||
          normalized === 'stretch' ||
          normalized === 'groom' ||
          normalized === 'yawn')
      ) {
        timer = setTimeout(() => {
          if (cancelled) return;
          onFinishRef.current?.();
        }, 500);
      }
      return clearTimer;
    }

    const keyPoses = keyed ? catKeyPoses(normalized) : undefined;
    if (keyPoses) {
      // 키 시점에만 셀을 바꾼다. focus 는 12초 반복, reel 은 한 번 재생 후 마지막 셀을 유지한다(완료 콜백 없음).
      play(`key:${normalized}`, posesMs(keyPoses), normalized === 'focus');
    } else if (normalized === 'idle') {
      let cycle = 0;
      const playIdle = () => {
        if (cancelled) return;
        const behavior = nextIdleBehavior(cycle++);
        setIdleBehavior(behavior);
        play(`idle:${behavior}`, motionCycleMs(behavior), false, () => rest(playIdle));
      };
      timer = setTimeout(playIdle, IDLE_REST_DELAY_MS);
    } else if (normalized === 'blink') {
      const playBlink = () => {
        if (cancelled) return;
        play('idle:blink', motionCycleMs('blink'), false, () => rest(playBlink));
      };
      timer = setTimeout(playBlink, IDLE_REST_DELAY_MS);
    } else {
      const animatedMotion = normalized as CatFrameMotion;
      const cycleMs = motionCycleMs(animatedMotion);
      const targetCycles = oneShotCycles(animatedMotion);
      if (targetCycles === undefined) {
        play(animatedMotion, cycleMs, true);
      } else {
        // 동작 프레임을 다 돌면 시간표가 끝의 0번(중립) 칸에 닿는다.
        const key = `once:${animatedMotion}`;
        play(key, cycleMs * targetCycles, false, () => {
          // 중립 프레임(0번)을 한 프레임 지연 시간 동안 노출한 뒤 onFinish를 호출한다.
          if (onFinishRef.current) {
            timer = setTimeout(() => {
              if (cancelled) return;
              onFinishRef.current?.();
            }, catFrameDelay(animatedMotion));
            return;
          }
          // 완료 콜백이 없으면 cast 는 중립 프레임에 멈추고, 상호작용 동작은 이어서 반복한다.
          if (animatedMotion !== 'cast') play(key, cycleMs, true);
        });
      }
    }

    return () => {
      cancelled = true;
      clearTimer();
      stopRun();
    };
  }, [color, normalized, paused, generation, keyed, replayKey]);

  return { run, effectiveMotion: normalized === 'idle' ? idleBehavior : normalized };
}

/** 재생 경과 값이 이 셀 차례일 때만 1인 opacity(계단 함수). 값이 없으면(멈춤·다른 시간표 재생 중) 첫 셀만 보인다. */
function useCellOpacity(
  value: Animated.Value | undefined,
  steps: readonly CatKeyPose[],
  cell: number,
) {
  return useMemo(
    () =>
      value
        ? value.interpolate({ ...frameOpacityRange(steps, cell), extrapolate: 'clamp' })
        : cell === steps[0][0]
          ? 1
          : 0,
    [value, steps, cell],
  );
}

/** 한 셀을 미리 깔아 두고, 재생 경과 값이 그 셀 차례일 때만 보이게 한다(opacity 계단 함수). */
function CatFrameLayer({
  cell,
  steps,
  value,
  source,
  imageStyle,
  viewportStyle,
  testID,
}: {
  cell: number;
  steps: readonly CatKeyPose[];
  /** 이 시간표의 재생 값. 없으면(멈춤·다른 시간표 재생 중) 첫 셀을 보인다(동작 전환 직후에도 빈 화면이 없다). */
  value?: Animated.Value;
  source: ImageSourcePropType;
  imageStyle: object;
  viewportStyle?: object;
  testID?: string;
}) {
  const opacity = useCellOpacity(value, steps, cell);
  const image = (
    <Animated.Image
      testID={testID}
      source={source}
      style={[imageStyle, { opacity }]}
      resizeMode="stretch"
    />
  );
  if (!viewportStyle) return image;
  return (
    <View style={{ position: 'absolute', ...viewportStyle, overflow: 'hidden' }}>{image}</View>
  );
}

/**
 * 장착 그림(GROMO-2382)도 셀마다 그 셀 프레임으로 깔고 고양이 셀과 같은 opacity 계단을 건다 — 프레임 전환에 React 를 깨우지 않는다.
 * ponytail: 셀 수만큼(걷기 6) Skia 캔버스가 뜬다. 여러 고양이가 옷을 입은 화면이 무거우면 보이는 셀 하나만 그리는 방식을 찾는다.
 */
function CatOutfitCell({
  cell,
  steps,
  value,
  outfit,
  pose,
  testID,
}: {
  cell: number;
  steps: readonly CatKeyPose[];
  value?: Animated.Value;
  outfit: Outfit;
  pose: { color: Color; motion: string; size: number };
  testID?: string;
}) {
  const opacity = useCellOpacity(value, steps, cell);
  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: pose.size,
        height: pose.size,
        opacity,
      }}
    >
      <CatOutfitLayers outfit={outfit} pose={{ ...pose, frame: cell }} />
    </Animated.View>
  );
}

export function CatSprite({
  color,
  motion = 'idle',
  size = 126,
  left = false,
  reduce = false,
  reduceMotion = false,
  anchored = true,
  onFinish,
  generation,
  keyPoses = false,
  replayKey,
  poseTransform,
  outfit,
  testID,
}: {
  color: Color;
  motion?: CatMotionInput;
  size?: number;
  left?: boolean;
  reduce?: boolean;
  reduceMotion?: boolean;
  anchored?: boolean;
  onFinish?: () => void;
  generation?: number;
  /** focus·reel 을 움직임 검토실 키 포즈 시간표로 재생한다(낚시섬 FishingActor 전용). */
  keyPoses?: boolean;
  /** 바뀌면 같은 동작을 처음부터 다시 재생한다. generation(완료 콜백 계약)과 별개로 낚아올리기 사건마다 올린다. */
  replayKey?: number;
  /** 발 기준점에서 몸 전체에 거는 추가 변환(호흡·기울기). 좌우 반전 안쪽에 적용돼 방향을 따라간다. */
  poseTransform?: CatPoseTransform;
  /** 장착한 머리·목(GROMO-2382) — 지금 자세·프레임에 맞춰 그린다. 검증 안 된 자세에서는 CatOutfitLayers 가 숨긴다. */
  outfit?: Outfit;
  testID?: string;
}) {
  const [appState, setAppState] = useState(AppState.currentState);
  const paused = reduce || reduceMotion || appState === 'background' || appState === 'inactive';
  const { run, effectiveMotion } = useCatPlayback(
    motion,
    color,
    paused,
    onFinish,
    generation,
    keyPoses,
    replayKey,
  );
  const isTilting = effectiveMotion === 'tilt';
  const questionAnim = useRef(new Animated.Value(0)).current;
  // idle 도중 자세 아틀라스로 바뀌어도 부모가 잡은 기존 발 기준 영역은 유지한다.
  const metric = metricFor(color, motion);
  const extent = size * metric.scale;
  const anchorX = (extent * metric.footAnchor[0]) / 512;
  const anchorY = (extent * metric.footAnchor[1]) / 512;
  const isIdleAtlas =
    effectiveMotion === 'yawn' || effectiveMotion === 'stretch' || effectiveMotion === 'groom';
  const isReadingAtlas = effectiveMotion === 'read';

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (paused) {
      questionAnim.setValue(isTilting ? 1 : 0);
      return;
    }
    if (isTilting) {
      questionAnim.setValue(0);
      Animated.spring(questionAnim, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(questionAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [isTilting, paused, questionAnim]);

  const frameMotion = effectiveMotion as CatFrameMotion;
  // 재생 훅과 같은 시간표: 키 포즈(focus 반복·reel 한 번), idle 동작 한 바퀴, 한 번 재생(cast·상호작용), 반복.
  const idle = normalizeCatMotion(motion) === 'idle' || frameMotion === 'blink';
  const poses = keyPoses ? catKeyPoses(frameMotion) : undefined;
  const oneShot = !idle && !poses && oneShotCycles(frameMotion) !== undefined;
  const playKey = poses
    ? `key:${frameMotion}`
    : idle
      ? `idle:${frameMotion}`
      : oneShot
        ? `once:${frameMotion}`
        : frameMotion;
  const steps = poses ?? (oneShot ? ONE_SHOT_STEPS : CYCLE_STEPS)[frameMotion];
  const value = run?.key === playKey ? run.value : undefined;
  const cells = [...new Set(steps.map(([cell]) => cell))];

  const frameVisual = (displayedFrame: number) => {
    let source = cat(color, `blink/blink-frame-${displayedFrame}`);
    // 셀마다 레이어를 겹쳐 두므로 낱장 프레임도 루트 왼쪽 위에 절대 배치한다.
    let imageStyle: object = {
      position: 'absolute',
      left: 0,
      top: 0,
      width: extent,
      height: extent,
    };
    let viewportStyle: object | undefined;

    if (effectiveMotion === 'walk') {
      source = cat(color, `walking/walking-frame-${displayedFrame}`);
    } else if (effectiveMotion === 'tilt') {
      source = cat(color, `tilt/tilt-frame-${displayedFrame}`);
    } else if (effectiveMotion === 'focus') {
      source = cat(color, `fishing/fishing-frame-${displayedFrame}`);
    } else if (effectiveMotion === 'cast') {
      source = cat(color, `fishing/cast-frame-${displayedFrame}`);
    } else if (effectiveMotion === 'reel') {
      source = cat(color, `fishing/reel-frame-${displayedFrame}`);
    } else if (isReadingAtlas) {
      source = cat(color, 'reading/atlas');
      imageStyle = {
        width: extent * 6,
        height: extent,
        left: -displayedFrame * extent,
      };
      viewportStyle = { left: 0, top: 0, width: extent, height: extent };
    } else if (isIdleAtlas) {
      const row = effectiveMotion === 'yawn' ? 0 : effectiveMotion === 'stretch' ? 1 : 2;
      const atlasFrame = CAT_IDLE_ATLAS_FRAMES[color][row * 4 + displayedFrame];
      const atlasSize = CAT_IDLE_ATLAS_SIZES[color];
      const frameWidth = extent * atlasFrame.scale;
      const frameHeight = frameWidth * (atlasFrame.rect.height / atlasFrame.rect.width);
      const sourceScale = frameWidth / atlasFrame.rect.width;
      source = CAT_IDLE_ATLASES[color];
      imageStyle = {
        width: atlasSize.width * sourceScale,
        height: atlasSize.height * sourceScale,
        left: -atlasFrame.rect.x * sourceScale,
        top: -atlasFrame.rect.y * sourceScale,
      };
      viewportStyle = {
        left: anchorX - frameWidth * atlasFrame.footAnchor.x,
        top: anchorY - frameHeight * atlasFrame.footAnchor.y,
        width: frameWidth,
        height: frameHeight,
      };
    }
    return { source, imageStyle, viewportStyle };
  };

  return (
    <Animated.View
      testID={testID}
      style={{
        position: 'absolute',
        width: extent,
        height: extent,
        left: anchored ? -anchorX : 0,
        top: anchored ? -anchorY : 0,
        overflow: 'visible',
        transformOrigin: [anchorX, anchorY, 0],
        transform: [{ scaleX: left ? -1 : 1 }, ...(poseTransform ?? [])],
      }}
    >
      {cells.map((cell) => (
        <CatFrameLayer
          key={cell}
          cell={cell}
          steps={steps}
          value={value}
          testID={testID ? `${testID}-frame-${cell}` : undefined}
          {...frameVisual(cell)}
        />
      ))}
      {outfit &&
        cells.map((cell) => (
          <CatOutfitCell
            key={cell}
            cell={cell}
            steps={steps}
            value={value}
            outfit={outfit}
            pose={{ color, motion: effectiveMotion, size: extent }}
            testID={testID ? `${testID}-outfit-${cell}` : undefined}
          />
        ))}
      {isTilting && (
        <Animated.View
          testID={testID ? `${testID}-question` : 'cat-question'}
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: extent * 0.04,
            top: -extent * 0.12,
            width: extent * 0.32,
            height: extent * 0.32,
            opacity: paused ? 1 : questionAnim,
            transform: [
              { scaleX: left ? -1 : 1 },
              {
                scale: paused
                  ? 1
                  : questionAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.35, 1],
                    }),
              },
              {
                translateY: paused
                  ? 0
                  : questionAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [6, 0],
                    }),
              },
            ],
          }}
        >
          <Image
            source={assets['ui/emotes/question.png']}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}
