import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// CSS ease (cubic-bezier(.25,.1,.25,1))
export const ease = Easing.bezier(0.25, 0.1, 0.25, 1);

export const easeInOut = Easing.bezier(0.42, 0, 0.58, 1);

// CSS transition: 목표값이 바뀌면 duration 동안 따라간다 (동작 줄이기면 즉시)
export function useEased(target: number, duration: number, reduceMotion: boolean) {
  const v = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    if (reduceMotion || duration === 0) v.setValue(target);
    else
      Animated.timing(v, {
        toValue: target,
        duration,
        easing: ease,
        useNativeDriver: false,
      }).start();
    return () => v.stopAnimation();
  }, [target, duration, reduceMotion, v]);
  return v;
}

// @keyframes 한 번 재생: key가 바뀔 때마다 0→1 (key 0은 재생하지 않음)
export function useKeyframe(key: number, duration: number, reduceMotion: boolean) {
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion || key === 0) return;
    t.setValue(0);
    Animated.timing(t, {
      toValue: 1,
      duration,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    return () => t.stopAnimation();
  }, [key, duration, reduceMotion, t]);
  return t;
}

// @keyframes object-react .42s ease: 45%에서 scale(1.025) rotate(-.5deg)
export function reactStyle(t: Animated.Value) {
  const at = (outputRange: any[]) =>
    t.interpolate({ inputRange: [0, 0.45, 1], outputRange, easing: ease });
  return { transform: [{ scale: at([1, 1.025, 1]) }, { rotate: at(['0deg', '-0.5deg', '0deg']) }] };
}

// .artifact.reacting: @keyframes object-react .42s ease (45%에서 scale 1.025 · rotate -.5deg, 키프레임 구간마다 ease)
export function useReact(reduceMotion: boolean, rotate = '0deg'): [any, () => void] {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => () => t.stopAnimation(), [t, reduceMotion]);
  const run = () => {
    if (reduceMotion) return;
    t.setValue(0);
    Animated.sequence([
      Animated.timing(t, { toValue: 0.45, duration: 189, easing: ease, useNativeDriver: false }),
      Animated.timing(t, { toValue: 1, duration: 231, easing: ease, useNativeDriver: false }),
    ]).start();
  };
  if (reduceMotion) return [rotate === '0deg' ? undefined : [{ rotate }], run];
  const at = (outputRange: any[]) => t.interpolate({ inputRange: [0, 0.45, 1], outputRange });
  return [[{ scale: at([1, 1.025, 1]) }, { rotate: at([rotate, '-0.5deg', rotate]) }], run];
}
