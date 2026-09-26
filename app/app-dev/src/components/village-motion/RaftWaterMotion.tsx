import React, { memo, useEffect, useRef } from 'react';
import { Animated, AppState, Easing, Image, StyleSheet, View, type ViewStyle } from 'react-native';
import { assets } from '@/constants/assets';

export const RaftWaterMotion = memo(function RaftWaterMotionView({
  reduceMotion = false,
  dayNight = 'day',
  style,
  testID = 'raft-water-motion',
}: {
  reduceMotion?: boolean;
  dayNight?: 'day' | 'night';
  style?: ViewStyle;
  testID?: string;
}) {
  const drift = useRef(new Animated.Value(0)).current;
  // 월드가 전달하는 컨테이너 폭은 카메라 배율을 반영하므로 내부 물결도 같은 배율을 쓴다.
  const scale = typeof style?.width === 'number' ? style.width / 210 : 1;
  const scaleY = typeof style?.height === 'number' ? style.height / 92 : scale;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 1350,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 1350,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const update = () => {
      loop.stop();
      if (!reduceMotion && AppState.currentState === 'active') loop.start();
      else drift.setValue(0);
    };
    update();
    const subscription = AppState.addEventListener('change', update);
    return () => {
      loop.stop();
      subscription.remove();
    };
  }, [drift, reduceMotion]);

  const animatedStyle = {
    opacity: drift.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0.78] }),
    transform: [
      { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 2 * scale] }) },
      { scaleX: drift.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.08] }) },
    ],
  };

  return (
    <View testID={testID} pointerEvents="none" style={[styles.fill, styles.clip, style]}>
      <Image
        testID={`${testID}-raft-back`}
        source={assets[`boats/raft/layers/back-${dayNight}.png`]}
        resizeMode="stretch"
        style={{
          position: 'absolute',
          left: -48 * scale,
          top: -307 * scaleY,
          width: 1024 * scale,
          height: 1024 * scaleY,
        }}
      />
      <Animated.View
        testID={`${testID}-left`}
        style={[
          styles.ripple,
          styles.left,
          {
            top: 45 * scale,
            width: 44 * scale,
            height: 12 * scale,
            borderBottomWidth: 2 * scale,
          },
          animatedStyle,
        ]}
      />
      <Animated.View
        testID={`${testID}-right`}
        style={[
          styles.ripple,
          styles.right,
          {
            top: 35 * scale,
            width: 46 * scale,
            height: 12 * scale,
            borderBottomWidth: 2 * scale,
          },
          animatedStyle,
        ]}
      />
      <Animated.View
        testID={`${testID}-bottom`}
        style={[
          styles.ripple,
          styles.bottom,
          {
            left: 70 * scale,
            width: 70 * scale,
            height: 12 * scale,
            borderBottomWidth: 2 * scale,
          },
          animatedStyle,
        ]}
      />
      <Image
        testID={`${testID}-raft-front`}
        source={assets[`boats/raft/layers/front-${dayNight}.png`]}
        resizeMode="stretch"
        style={{
          position: 'absolute',
          left: -48 * scale,
          top: -307 * scaleY,
          width: 1024 * scale,
          height: 1024 * scaleY,
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { position: 'absolute' },
  clip: { overflow: 'hidden' },
  ripple: {
    position: 'absolute',
    borderBottomColor: 'rgba(225, 251, 255, 0.92)',
    borderRadius: 999,
  },
  left: { left: 0 },
  right: { right: 0 },
  bottom: { bottom: 0 },
});
