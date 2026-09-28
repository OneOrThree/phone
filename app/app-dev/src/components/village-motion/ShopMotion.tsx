import React, { memo, useContext, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { MotionContext } from '@/design-system/primitives';
import { VillageThemeTint } from './VillageThemeTint';

export type ShopMotionState = 'normal' | 'new-product' | 'purchasable';

const frames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/shop/frame-0.png'),
  require('@/assets/village-world/motion/shop/frame-1.png'),
  require('@/assets/village-world/motion/shop/frame-2.png'),
  require('@/assets/village-world/motion/shop/frame-3.png'),
];

const frameDurationMs = 230;
const idleIntervalMs = 20_000;

/** 상점 아트 전용 애니메이션. 실제 섬 좌표와 확대 배율은 부모가 전달한다. */
export const ShopMotion = memo(function ShopMotionView({
  state = 'normal',
  trigger = 0,
  entryActive = false,
  reduceMotion = false,
  showFrames = true,
  themed = false,
  style,
  testID = 'shop-motion',
}: {
  state?: ShopMotionState;
  trigger?: number;
  entryActive?: boolean;
  reduceMotion?: boolean;
  showFrames?: boolean;
  /** 건물 테마가 적용되면 현재 프레임 위에 테마 착색을 덧입힌다. */
  themed?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const motionDisabled = useContext(MotionContext) || reduceMotion;
  const [frame, setFrame] = useState(0);
  const lastTrigger = useRef(trigger);

  useEffect(() => {
    if (motionDisabled || !showFrames || !entryActive || trigger <= lastTrigger.current) return;
    lastTrigger.current = trigger;
    const timers = frames
      .slice(1)
      .map((_, index) => setTimeout(() => setFrame(index + 1), (index + 1) * 150));
    return () => timers.forEach(clearTimeout);
  }, [entryActive, motionDisabled, showFrames, trigger]);

  useEffect(() => {
    if (!entryActive) setFrame(0);
  }, [entryActive]);

  useEffect(() => {
    if (motionDisabled || !showFrames || entryActive) {
      setFrame(0);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    let mounted = true;
    const run = () => {
      if (!mounted) return;
      setFrame(0);
      let nextFrame = 1;
      const advance = () => {
        if (!mounted) return;
        setFrame(nextFrame);
        nextFrame += 1;
        if (nextFrame < frames.length) {
          timer = setTimeout(advance, frameDurationMs);
        } else {
          // 20초는 애니메이션이 끝난 시점부터 다음 시작까지의 대기 시간이다.
          timer = setTimeout(run, idleIntervalMs);
        }
      };
      timer = setTimeout(advance, frameDurationMs);
    };

    timer = setTimeout(run, idleIntervalMs);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [entryActive, motionDisabled, showFrames]);

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
        frames.map((source, index) => (
          <Image
            key={index}
            testID={`shop-motion-frame-${index}`}
            source={source}
            resizeMode="stretch"
            style={[styles.frame, frame === index ? styles.visible : styles.hidden]}
          />
        ))}
      {showFrames && themed && (
        <VillageThemeTint source={frames[frame]} testID="shop-motion-theme-tint" />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  visible: { opacity: 1 },
  hidden: { opacity: 0 },
});
