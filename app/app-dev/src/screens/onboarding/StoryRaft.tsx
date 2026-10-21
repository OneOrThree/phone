import React, { useContext, useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens } from '@/design-system/tokens';
import { colorName, colors, type Color } from '@/services/model';
import { seaLoaf } from '@/screens/sea/seaAssets';
import { t } from '@/i18n';

const lying = {
  black: require('@/assets/ota/onboarding/lying-black.png'),
  white: require('@/assets/ota/onboarding/lying-white.png'),
  calico: require('@/assets/ota/onboarding/lying-calico.png'),
};
export const storyCats: Record<Color, number> = {
  black: require('@/assets/ota/onboarding/cat-black.png'),
  ginger: require('@/assets/ota/onboarding/cat-ginger.png'),
  cream: require('@/assets/ota/onboarding/cat-cream.png'),
  gray: require('@/assets/ota/onboarding/cat-gray.png'),
  white: require('@/assets/ota/onboarding/cat-white.png'),
  calico: require('@/assets/ota/onboarding/cat-calico.png'),
};
export const storyIslands = [
  require('@/assets/ota/onboarding/island-houses-0.png'),
  require('@/assets/ota/onboarding/island-houses-1.png'),
  require('@/assets/ota/onboarding/island-houses-3.png'),
  require('@/assets/ota/onboarding/island-houses-5.png'),
];
// 목록 API는 건물 단계를 주지 않으므로 진행도를 추정하지 않고 승인 v5의 공통 삽화를 사용한다.
export const storyIslandArt = storyIslands[1];
const tokens = componentTokens.onboarding;
export function StoryRaft({
  color,
  pose,
  width,
}: {
  color: Color;
  pose: 'sleep' | 'sit' | 'scope';
  width: number;
}) {
  const reduce = useContext(MotionContext);
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) {
      bob.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: -tokens.bobDistance,
          duration: tokens.bobDuration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: tokens.bobDuration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [bob, reduce]);
  const composite =
    pose === 'sleep' && color in lying
      ? lying[color as keyof typeof lying]
      : pose === 'scope' && color === 'black'
        ? require('@/assets/ota/onboarding/scope-black.png')
        : null;
  const height = width * 0.79;
  return (
    <Animated.View
      testID={`story-raft-${color}-${pose}`}
      accessible
      accessibilityLabel={t('onboardingStory.raftA11y', {
        color: colorName(colors.indexOf(color)),
      })}
      style={{ width, height, transform: [{ translateY: bob }] }}
    >
      {composite ? (
        <Image
          source={composite}
          resizeMode="contain"
          // 네이티브 Image는 원본 치수를 기본값으로 넣으므로 absoluteFill만으로는 축소되지 않는다.
          style={[StyleSheet.absoluteFill, { width, height }]}
        />
      ) : (
        <>
          <Image
            source={require('@/assets/ota/onboarding/raft.png')}
            resizeMode="contain"
            style={[StyleSheet.absoluteFill, { width, height }]}
          />
          <View
            style={{
              position: 'absolute',
              left: width * 0.21,
              top: pose === 'sleep' ? height * 0.05 : -height * 0.16,
            }}
          >
            {pose === 'sleep' ? (
              <Image
                source={seaLoaf[color]}
                style={{ width: width * 0.51, height: width * 0.51 }}
                resizeMode="contain"
              />
            ) : (
              <Image
                source={storyCats[color]}
                resizeMode="contain"
                style={{ width: width * 0.48, height: width * 0.48 }}
              />
            )}
          </View>
        </>
      )}
    </Animated.View>
  );
}
