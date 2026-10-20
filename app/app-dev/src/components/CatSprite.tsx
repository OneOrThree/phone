import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Image, View, type ImageSourcePropType } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { assets, cat } from '@/constants/assets';
import {
  CAT_IDLE_ATLASES,
  CAT_IDLE_ATLAS_FRAMES,
  CAT_IDLE_ATLAS_SIZES,
} from '@/constants/cat-idle-atlases';
import metrics from '@/constants/motion-metrics.json';
import { Color } from '@/services/model';
import {
  CAT_FRAME_SEQUENCES,
  CatFrameMotion,
  CatIdleBehavior,
  CatKeyPose,
  CatMotionInput,
  catFrameDelay,
  catKeyPoses,
  catSequenceLength,
  nextIdleBehavior,
  normalizeCatMotion,
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

/** 균일 간격 동작의 [셀, 유지 ms] 시간표. 렌더마다 새 배열이 생기지 않게 모듈에서 한 번 만든다. */
const UNIFORM_STEPS = {} as Record<CatFrameMotion, readonly CatKeyPose[]>;
for (const motion of Object.keys(CAT_FRAME_SEQUENCES) as CatFrameMotion[]) {
  UNIFORM_STEPS[motion] = CAT_FRAME_SEQUENCES[motion].map((cell) => [cell, catFrameDelay(motion)]);
}

const motionCycleMs = (motion: CatFrameMotion) => catSequenceLength(motion) * catFrameDelay(motion);
const posesMs = (poses: readonly CatKeyPose[]) => poses.reduce((sum, [, hold]) => sum + hold, 0);

/** 경과 ms 에 보일 셀. 반복이면 주기로 되감고, 아니면 마지막 셀에 머문다. */
function timelineCell(steps: readonly CatKeyPose[], loop: boolean, elapsedMs: number): number {
  'worklet';
  // 타이머와 같은 ms 경계에서 셀을 바꾼다(부동소수 오차로 경계 직전 셀이 남지 않게 반올림).
  let t = Math.round(elapsedMs);
  if (loop) {
    let total = 0;
    for (const [, hold] of steps) total += hold;
    t %= total;
  }
  for (const [cell, hold] of steps) {
    if (t < hold) return cell;
    t -= hold;
  }
  return steps[steps.length - 1][0];
}

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
  // 재생 중인 시간표 이름과 경과 ms. 셀 전환은 UI 스레드가 이 두 값으로 고르고 React 는 다시 그리지 않는다.
  const playing = useSharedValue('');
  const elapsed = useSharedValue(0);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    // 첫 셀(0번)에 멈춘다. 다른 시간표 이름이면 모든 레이어가 첫 셀을 보인다.
    const still = () => {
      cancelAnimation(elapsed);
      playing.value = '';
    };
    // key 시간표를 durationMs 만큼 UI 스레드에서 재생한다. 한 번 재생이면 끝날 때만 JS 로 onEnd 를 부른다.
    const play = (key: string, durationMs: number, repeat: boolean, onEnd?: () => void) => {
      const end = () => {
        if (!cancelled) onEnd?.();
      };
      const timing = withTiming(
        durationMs,
        { duration: durationMs, easing: Easing.linear },
        (finished) => {
          if (finished && onEnd) scheduleOnRN(end);
        },
      );
      playing.value = key;
      elapsed.value = 0;
      elapsed.value = repeat ? withRepeat(timing, -1) : timing;
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
        play(behavior, motionCycleMs(behavior), false, () => rest(playIdle));
      };
      timer = setTimeout(playIdle, IDLE_REST_DELAY_MS);
    } else if (normalized === 'blink') {
      const playBlink = () => {
        if (cancelled) return;
        play('blink', motionCycleMs('blink'), false, () => rest(playBlink));
      };
      timer = setTimeout(playBlink, IDLE_REST_DELAY_MS);
    } else {
      const animatedMotion = normalized as CatFrameMotion;
      const cycleMs = motionCycleMs(animatedMotion);
      const isInteractive =
        animatedMotion === 'tilt' ||
        animatedMotion === 'stretch' ||
        animatedMotion === 'groom' ||
        animatedMotion === 'yawn';
      const targetCycles = isInteractive
        ? (INTERACTIVE_MOTION_CYCLES[animatedMotion as keyof typeof INTERACTIVE_MOTION_CYCLES] ?? 1)
        : animatedMotion === 'cast'
          ? 1
          : undefined;
      if (targetCycles === undefined) {
        play(animatedMotion, cycleMs, true);
      } else {
        // 동작 프레임을 다 돌면 시간표가 0번(중립) 셀에 닿는다.
        play(animatedMotion, cycleMs * targetCycles, false, () => {
          // 중립 프레임(0번)을 한 프레임 지연 시간 동안 노출한 뒤 onFinish를 호출한다.
          if (onFinishRef.current) {
            timer = setTimeout(() => {
              if (cancelled) return;
              onFinishRef.current?.();
            }, catFrameDelay(animatedMotion));
            return;
          }
          // 완료 콜백이 없으면 cast 는 중립 프레임에 멈추고, 상호작용 동작은 이어서 반복한다.
          if (animatedMotion !== 'cast') play(animatedMotion, cycleMs, true);
        });
      }
    }

    return () => {
      cancelled = true;
      clearTimer();
      cancelAnimation(elapsed);
    };
  }, [color, normalized, paused, generation, keyed, replayKey, playing, elapsed]);

  return {
    playing,
    elapsed,
    effectiveMotion: normalized === 'idle' ? idleBehavior : normalized,
  };
}

/** 한 셀을 미리 깔아 두고, 시간표가 그 셀을 가리킬 때만 UI 스레드에서 보이게 한다. */
function CatFrameLayer({
  cell,
  playKey,
  steps,
  loop,
  playing,
  elapsed,
  source,
  imageStyle,
  viewportStyle,
  testID,
}: {
  cell: number;
  playKey: string;
  steps: readonly CatKeyPose[];
  loop: boolean;
  playing: SharedValue<string>;
  elapsed: SharedValue<number>;
  source: ImageSourcePropType;
  imageStyle: object;
  viewportStyle?: object;
  testID?: string;
}) {
  const visible = useAnimatedStyle(() => {
    // 다른 시간표가 재생 중이거나 멈춰 있으면 첫 셀을 보인다(동작 전환 직후에도 빈 화면이 없다).
    const shown =
      playing.value === playKey ? timelineCell(steps, loop, elapsed.value) : steps[0][0];
    return { opacity: shown === cell ? 1 : 0 };
  });
  const image = (
    <Reanimated.Image
      testID={testID}
      source={source}
      style={[imageStyle, visible]}
      resizeMode="stretch"
    />
  );
  if (!viewportStyle) return image;
  return (
    <View style={{ position: 'absolute', ...viewportStyle, overflow: 'hidden' }}>{image}</View>
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
  testID?: string;
}) {
  const [appState, setAppState] = useState(AppState.currentState);
  const paused = reduce || reduceMotion || appState === 'background' || appState === 'inactive';
  const { playing, elapsed, effectiveMotion } = useCatPlayback(
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
  // 재생 훅과 같은 시간표: 키 포즈(focus 반복·reel 한 번) 또는 catMotion 의 균일 간격 반복.
  const poses = keyPoses ? catKeyPoses(frameMotion) : undefined;
  const playKey = poses ? `key:${frameMotion}` : frameMotion;
  const steps = poses ?? UNIFORM_STEPS[frameMotion];
  const loop = !poses || frameMotion === 'focus';
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
          playKey={playKey}
          steps={steps}
          loop={loop}
          playing={playing}
          elapsed={elapsed}
          testID={testID ? `${testID}-frame-${cell}` : undefined}
          {...frameVisual(cell)}
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
