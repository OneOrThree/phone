import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Image, View } from 'react-native';
import { assets, cat } from '@/constants/assets';
import {
  CAT_IDLE_ATLASES,
  CAT_IDLE_ATLAS_FRAMES,
  CAT_IDLE_ATLAS_SIZES,
} from '@/constants/cat-idle-atlases';
import metrics from '@/constants/motion-metrics.json';
import { Color } from '@/services/model';
import {
  CatFrameMotion,
  CatIdleBehavior,
  CatMotionInput,
  catFrameAt,
  catFrameDelay,
  catSequenceLength,
  isFrameAnimated,
  nextIdleBehavior,
  normalizeCatMotion,
  IDLE_REST_DELAY_MS,
  INTERACTIVE_MOTION_CYCLES,
  interactiveMotionDurationMs,
} from './catMotion';
export type { CatMotion, CatMotionInput } from './catMotion';
export { INTERACTIVE_MOTION_CYCLES, interactiveMotionDurationMs };

type MetricMotion = 'blink' | 'walking' | 'reading';
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

function useCatPlayback(
  motion: CatMotionInput,
  color: Color,
  paused: boolean,
  onFinish?: () => void,
  generation?: number,
) {
  const normalized = normalizeCatMotion(motion);
  const [frame, setFrame] = useState(0);
  const [idleBehavior, setIdleBehavior] = useState<CatIdleBehavior>('blink');
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const rest = (next: () => void) => {
      setIdleBehavior('blink');
      setFrame(0);
      timer = setTimeout(next, IDLE_REST_DELAY_MS);
    };

    setFrame(0);
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

    const playBlink = (next: () => void) => {
      let tick = 1;
      const advance = () => {
        if (cancelled) return;
        if (tick < catSequenceLength('blink')) {
          setFrame(tick++);
          timer = setTimeout(advance, catFrameDelay('blink'));
          return;
        }
        rest(next);
      };
      timer = setTimeout(advance, catFrameDelay('blink'));
    };

    if (normalized === 'idle') {
      let cycle = 0;
      const playIdle = () => {
        if (cancelled) return;
        const behavior = nextIdleBehavior(cycle++);
        setIdleBehavior(behavior);
        setFrame(0);
        if (behavior === 'blink') {
          playBlink(playIdle);
          return;
        }
        if (!isFrameAnimated(behavior)) {
          timer = setTimeout(() => rest(playIdle), catFrameDelay(behavior));
          return;
        }
        let tick = 1;
        const advance = () => {
          if (cancelled) return;
          if (tick < catSequenceLength(behavior)) {
            setFrame(tick++);
            timer = setTimeout(advance, catFrameDelay(behavior));
            return;
          }
          rest(playIdle);
        };
        timer = setTimeout(advance, catFrameDelay(behavior));
      };
      timer = setTimeout(playIdle, IDLE_REST_DELAY_MS);
    } else if (normalized === 'blink') {
      const play = () => {
        if (cancelled) return;
        setFrame(0);
        playBlink(play);
      };
      timer = setTimeout(play, IDLE_REST_DELAY_MS);
    } else {
      const animatedMotion = normalized as CatFrameMotion;
      const totalFrames = catSequenceLength(animatedMotion);
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
      const targetTicks = targetCycles ? totalFrames * targetCycles : undefined;
      let tick = 0;
      const advance = () => {
        if (cancelled) return;
        tick += 1;
        setFrame(tick);
        if (targetTicks !== undefined && tick >= targetTicks) {
          // 중립 프레임(0번)을 표시한 뒤, 한 프레임 지연 시간 동안 노출 후 onFinish를 호출한다.
          if (onFinishRef.current) {
            timer = setTimeout(() => {
              if (cancelled) return;
              onFinishRef.current?.();
            }, catFrameDelay(animatedMotion));
            return;
          }
          if (animatedMotion === 'cast') return;
        }
        timer = setTimeout(advance, catFrameDelay(animatedMotion));
      };
      timer = setTimeout(advance, catFrameDelay(animatedMotion));
    }

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [color, normalized, paused, generation]);

  return { frame, effectiveMotion: normalized === 'idle' ? idleBehavior : normalized };
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
  testID?: string;
}) {
  const [appState, setAppState] = useState(AppState.currentState);
  const paused = reduce || reduceMotion || appState === 'background' || appState === 'inactive';
  const { frame, effectiveMotion } = useCatPlayback(motion, color, paused, onFinish, generation);
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
    return () => subscription.remove();
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
  const displayedFrame = catFrameAt(frameMotion, frame);
  let source = cat(color, `blink/blink-frame-${catFrameAt('blink', frame)}`);
  let imageStyle: object = { width: extent, height: extent };
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
        transform: [{ scaleX: left ? -1 : 1 }],
      }}
    >
      {isReadingAtlas || isIdleAtlas ? (
        <View
          style={{
            position: 'absolute',
            ...(viewportStyle ?? { left: 0, top: 0, width: extent, height: extent }),
            overflow: 'hidden',
          }}
        >
          <Image
            testID={testID ? `${testID}-frame-${displayedFrame}` : undefined}
            source={source}
            style={imageStyle}
            resizeMode="stretch"
          />
        </View>
      ) : (
        <Image
          testID={testID ? `${testID}-frame-${displayedFrame}` : undefined}
          source={source}
          style={imageStyle}
          resizeMode="stretch"
        />
      )}
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
