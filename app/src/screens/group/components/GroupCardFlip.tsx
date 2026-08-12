import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { M } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';

interface Props {
  groupId: string;
  minHeight: number;
  flipped: boolean;
  front: ReactNode;
  back: ReactNode;
  onTransitioningChange?: (transitioning: boolean) => void;
  onTransitionComplete?: (face: 'front' | 'back', groupId: string) => void;
  skipTransition?: boolean;
}

/** 같은 카드 rect 안에서 두 face를 유지하고 flip/cross-fade만 전환한다. */
export function GroupCardFlip({
  groupId,
  minHeight,
  flipped,
  front,
  back,
  onTransitioningChange,
  onTransitionComplete,
  skipTransition = false,
}: Props) {
  const motion = useMotion();
  const progress = useSharedValue(flipped ? 1 : 0);
  const previousFlippedRef = useRef(flipped);
  const transitionGenerationRef = useRef(0);
  const completedGenerationRef = useRef(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  // prop이 바뀐 첫 commit부터 layout effect가 state를 올리기 전까지도 입력을 잠근다.
  const transitionRequested = previousFlippedRef.current !== flipped;
  const inputLocked = transitioning || (transitionRequested && !skipTransition);
  // Y축 perspective는 가까워지는 모서리를 원래 face rect보다 크게 투영한다. 3D 전환 중에만
  // 카드의 기존 라운드 rect로 잘라 헤더를 침범하지 않게 한다. 정지 상태와 Reduce Motion의
  // cross-fade에는 clipping을 걸지 않아 앞면 shadow와 두 면의 기존 surface를 그대로 보존한다.
  const clipProjectedFace = inputLocked && !motion.reduce;

  const finishTransition = useCallback(
    (generation: number, face: 'front' | 'back') => {
      if (
        transitionGenerationRef.current !== generation ||
        completedGenerationRef.current === generation
      )
        return;
      completedGenerationRef.current = generation;
      if (fallbackTimerRef.current !== null) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      setTransitioning(false);
      onTransitioningChange?.(false);
      onTransitionComplete?.(face, groupId);
    },
    [groupId, onTransitionComplete, onTransitioningChange],
  );

  useLayoutEffect(() => {
    if (!transitionRequested) return;
    previousFlippedRef.current = flipped;
    const generation = ++transitionGenerationRef.current;
    const targetFace = flipped ? 'back' : 'front';
    if (skipTransition) {
      completedGenerationRef.current = generation;
      if (fallbackTimerRef.current !== null) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      setTransitioning(false);
      onTransitioningChange?.(false);
      progress.value = flipped ? 1 : 0;
      return;
    }
    setTransitioning(true);
    onTransitioningChange?.(true);
    const duration = motion.reduce ? 150 : 290;
    // Reanimated 완료 콜백이 정본이다. UI runtime이 취소/해제되는 비정상 경로에서도 입력이
    // 영구 잠기지 않도록 같은 duration의 JS fallback을 둔다(generation으로 stale 해제 차단).
    fallbackTimerRef.current = setTimeout(() => finishTransition(generation, targetFace), duration);
    progress.value = withTiming(
      flipped ? 1 : 0,
      {
        duration,
        easing: M.curve.standard.fn,
        // Reduce Motion 여부는 useMotion이 단일 진실이고, true일 때도 짧은 cross-fade는 유지한다.
        reduceMotion: M.never,
      },
      (finished) => {
        if (finished) runOnJS(finishTransition)(generation, targetFace);
      },
    );
  }, [
    finishTransition,
    flipped,
    motion.reduce,
    onTransitioningChange,
    progress,
    skipTransition,
    transitionRequested,
  ]);

  useLayoutEffect(
    () => () => {
      transitionGenerationRef.current++;
      if (fallbackTimerRef.current !== null) clearTimeout(fallbackTimerRef.current);
      onTransitioningChange?.(false);
    },
    [onTransitioningChange],
  );

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
    <View
      style={[s.shell, { minHeight }, clipProjectedFace && s.projectedFaceClip]}
      testID={`group.card.flipShell.${groupId}`}
    >
      <Animated.View
        style={[s.face, frontStyle]}
        pointerEvents={!inputLocked && !flipped ? 'auto' : 'none'}
        accessibilityElementsHidden={inputLocked || flipped}
        importantForAccessibility={inputLocked || flipped ? 'no-hide-descendants' : 'auto'}
        testID={`group.card.flipFront.${groupId}`}
      >
        {front}
      </Animated.View>
      <Animated.View
        style={[s.face, backStyle]}
        pointerEvents={!inputLocked && flipped ? 'auto' : 'none'}
        accessibilityElementsHidden={inputLocked || !flipped}
        importantForAccessibility={!inputLocked && flipped ? 'auto' : 'no-hide-descendants'}
        testID={`group.card.flipBack.${groupId}`}
      >
        {back}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  shell: { position: 'relative' },
  projectedFaceClip: {
    borderRadius: 28,
    overflow: 'hidden',
  },
  face: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backfaceVisibility: 'hidden',
  },
});
