import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { M } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';

interface Props {
  groupId: string;
  minHeight: number;
  flipped: boolean;
  front: ReactNode;
  back: ReactNode;
}

/** 같은 카드 rect 안에서 두 face를 유지하고 flip/cross-fade만 전환한다. */
export function GroupCardFlip({ groupId, minHeight, flipped, front, back }: Props) {
  const motion = useMotion();
  const progress = useSharedValue(flipped ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(flipped ? 1 : 0, {
      duration: motion.reduce ? 150 : 290,
      easing: M.curve.standard.fn,
      // Reduce Motion 여부는 useMotion이 단일 진실이고, true일 때도 짧은 cross-fade는 유지한다.
      reduceMotion: M.never,
    });
  }, [flipped, motion.reduce, progress]);

  const frontStyle = useAnimatedStyle(() =>
    motion.reduce
      ? { opacity: 1 - progress.value }
      : {
          opacity: 1,
          transform: [{ perspective: 1000 }, { rotateY: `${progress.value * 180}deg` }],
        },
  );
  const backStyle = useAnimatedStyle(() =>
    motion.reduce
      ? { opacity: progress.value }
      : {
          opacity: 1,
          transform: [{ perspective: 1000 }, { rotateY: `${180 + progress.value * 180}deg` }],
        },
  );

  return (
    <View style={{ minHeight }} testID={`group.card.flipShell.${groupId}`}>
      <Animated.View
        style={[s.face, frontStyle]}
        pointerEvents={flipped ? 'none' : 'auto'}
        accessibilityElementsHidden={flipped}
        importantForAccessibility={flipped ? 'no-hide-descendants' : 'auto'}
        testID={`group.card.flipFront.${groupId}`}
      >
        {front}
      </Animated.View>
      <Animated.View
        style={[s.face, backStyle]}
        pointerEvents={flipped ? 'auto' : 'none'}
        accessibilityElementsHidden={!flipped}
        importantForAccessibility={flipped ? 'auto' : 'no-hide-descendants'}
        testID={`group.card.flipBack.${groupId}`}
      >
        {back}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  face: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backfaceVisibility: 'hidden',
  },
});
