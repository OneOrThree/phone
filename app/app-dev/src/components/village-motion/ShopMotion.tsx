import React, { memo, useContext, useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { MotionContext } from '@/design-system/primitives';
import { frameSteps, playMotion } from '../catMotion';
import { MotionFrameImage, VillageThemeTint } from './VillageThemeTint';

export type ShopMotionState = 'normal' | 'new-product' | 'purchasable';

const frames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/shop/frame-0.png'),
  require('@/assets/village-world/motion/shop/frame-1.png'),
  require('@/assets/village-world/motion/shop/frame-2.png'),
  require('@/assets/village-world/motion/shop/frame-3.png'),
];
// 밤 프레임은 낮 frame-0~3 과 크기·발밑 기준점이 같다(night-frame-0 은 정본 밤 레이어 crop).
const nightFrames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/shop/night-frame-0.png'),
  require('@/assets/village-world/motion/shop/night-frame-1.png'),
  require('@/assets/village-world/motion/shop/night-frame-2.png'),
  require('@/assets/village-world/motion/shop/night-frame-3.png'),
];

const frameDurationMs = 230;
const entryFrameDurationMs = 150;
const idleIntervalMs = 20_000;
// 진입은 150ms, 유휴는 230ms 간격으로 문을 열고 마지막 프레임에 머문다.
const entrySteps = frameSteps([0, 1, 2, 3], entryFrameDurationMs);
const idleSteps = frameSteps([0, 1, 2, 3], frameDurationMs);

/** 상점 아트 전용 애니메이션. 실제 섬 좌표와 확대 배율은 부모가 전달한다. */
export const ShopMotion = memo(function ShopMotionView({
  state = 'normal',
  trigger = 0,
  entryActive = false,
  reduceMotion = false,
  night = false,
  showFrames = true,
  themed = false,
  style,
  testID = 'shop-motion',
}: {
  state?: ShopMotionState;
  trigger?: number;
  entryActive?: boolean;
  reduceMotion?: boolean;
  /** 밤 마을이면 같은 모션을 밤 프레임으로 재생한다. */
  night?: boolean;
  showFrames?: boolean;
  /** 건물 테마가 적용되면 현재 프레임 위에 테마 착색을 덧입힌다. */
  themed?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const motionDisabled = useContext(MotionContext) || reduceMotion;
  const lastTrigger = useRef(trigger);
  const elapsed = useRef(new Animated.Value(0)).current;
  const steps = entryActive ? entrySteps : idleSteps;

  // 0번으로 되돌리는 효과를 재생 효과보다 먼저 둔다. 같은 커밋에서 진입 재생이 시작되면 되돌린 뒤 재생한다.
  useEffect(() => {
    if (!entryActive) elapsed.setValue(0);
  }, [elapsed, entryActive]);

  useEffect(() => {
    if (motionDisabled || !showFrames || entryActive) {
      elapsed.setValue(0);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    let animation: Animated.CompositeAnimation | undefined;
    const openMs = (frames.length - 1) * frameDurationMs;
    const run = () => {
      animation = playMotion(elapsed, openMs, false);
      // 20초는 애니메이션이 끝난 시점부터 다음 시작까지의 대기 시간이다.
      timer = setTimeout(run, openMs + idleIntervalMs);
    };

    timer = setTimeout(run, idleIntervalMs);
    return () => {
      clearTimeout(timer);
      animation?.stop();
    };
  }, [elapsed, entryActive, motionDisabled, showFrames]);

  useEffect(() => {
    if (motionDisabled || !showFrames || !entryActive || trigger <= lastTrigger.current) return;
    lastTrigger.current = trigger;
    const animation = playMotion(elapsed, (frames.length - 1) * entryFrameDurationMs, false);
    return () => animation.stop();
  }, [elapsed, entryActive, motionDisabled, showFrames, trigger]);

  const stateLabel =
    state === 'new-product' ? '새 상품' : state === 'purchasable' ? '구매 가능' : null;

  return (
    <View
      testID={testID}
      // 장식 레이어다. 상태 안내는 실제 건물 버튼 라벨 하나에만 둔다.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      accessibilityLabel={stateLabel ? `상점, ${stateLabel}` : '상점'}
      pointerEvents="none"
      style={[styles.fill, style]}
    >
      {showFrames &&
        (night ? nightFrames : frames).map((source, index) => (
          <MotionFrameImage
            key={index}
            elapsed={elapsed}
            steps={steps}
            index={index}
            testID={`shop-motion-frame-${index}`}
            source={source}
            style={styles.frame}
          />
        ))}
      {showFrames && themed && (
        <VillageThemeTint
          sources={night ? nightFrames : frames}
          elapsed={elapsed}
          steps={steps}
          testID="shop-motion-theme-tint"
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
});
