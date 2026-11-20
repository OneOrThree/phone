import { Text } from '@/design-system/typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useRef, createContext, useContext } from 'react';
import {
  Animated,
  Pressable,
  View,
  StyleSheet,
  StyleProp,
  ViewStyle,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { C, componentTokens, semanticTokens } from '@/design-system/tokens';
export { C } from '@/design-system/tokens';
export const MotionContext = createContext(false);
export const S = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.cream },
  content: { padding: 20, paddingBottom: 60, gap: 16 },
  body: { fontSize: 15, lineHeight: 23, color: C.ink },
  small: { fontSize: 12, lineHeight: 19, color: C.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  card: {
    backgroundColor: C.paper,
    borderWidth: componentTokens.card.borderWidth,
    borderColor: componentTokens.card.border,
    borderRadius: componentTokens.card.radius,
    padding: componentTokens.card.padding,
    gap: componentTokens.card.gap,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: componentTokens.badge.default.background,
    borderWidth: componentTokens.badge.borderWidth,
    borderColor: componentTokens.badge.default.border,
    borderRadius: componentTokens.badge.radius,
    alignSelf: 'flex-start',
  },
  divider: {
    height: componentTokens.divider.width,
    backgroundColor: componentTokens.divider.color,
    marginVertical: 8,
  },
  scene: { width: '100%', height: 240, borderRadius: 22 },
});
export function T({
  children,
  small = false,
  style,
}: {
  children: React.ReactNode;
  small?: boolean;
  style?: any;
}) {
  return <Text style={[small ? S.small : S.body, style]}>{children}</Text>;
}
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[S.card, style]}>{children}</View>;
}
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  id,
  small = false,
  reduce = false,
  fill = false,
  round = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  id?: string;
  small?: boolean;
  reduce?: boolean;
  fill?: boolean;
  round?: boolean;
}) {
  const motionOff = useContext(MotionContext) || reduce;
  const windowSize = useWindowDimensions();
  const roundSize = Math.min(windowSize.width, windowSize.height) >= 600 ? 110 : 88;
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View
      style={{
        transform: [{ scale }],
        alignSelf: fill ? 'stretch' : 'flex-start',
        maxWidth: '100%',
      }}
    >
      <Pressable
        testID={id}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPressIn={() => {
          if (!motionOff)
            Animated.spring(scale, {
              toValue: 0.97,
              useNativeDriver: true,
              speed: 35,
              bounciness: 0,
            }).start();
        }}
        onPressOut={() =>
          motionOff
            ? scale.setValue(1)
            : Animated.spring(scale, {
                toValue: 1,
                useNativeDriver: true,
                speed: 30,
                bounciness: 4,
              }).start()
        }
        onPress={onPress}
        style={{
          ...(round
            ? {
                width: roundSize,
                height: roundSize,
                alignItems: 'center' as const,
                justifyContent: 'center' as const,
              }
            : {}),
          paddingHorizontal: round ? 8 : small ? 12 : 18,
          paddingVertical: small ? 9 : 12,
          minHeight: semanticTokens.size.tapMin,
          borderWidth: componentTokens.button.borderWidth,
          borderColor: C.brown,
          borderRadius: componentTokens.button.radius,
          backgroundColor: secondary
            ? componentTokens.button.secondaryBackground
            : componentTokens.button.background,
          opacity: disabled ? componentTokens.button.disabledOpacity : 1,
          boxShadow: disabled ? 'none' : '0px 3px 0px ' + C.brown,
        }}
      >
        <Text
          style={{
            textAlign: 'center',
            fontSize: small ? 13 : 15,
            fontWeight: '700',
            color: C.ink,
          }}
        >
          {title}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
export function useScreenInsets() {
  const native = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const gallery =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('review');
  return gallery
    ? Math.min(width, height) >= 600
      ? { top: 24, bottom: 20, left: 0, right: 0 }
      : width > height
        ? // 시안 기기 목업: 다이내믹 아일랜드가 왼쪽, 오른쪽 인셋 없음
          { top: 0, bottom: 21, left: 52, right: 0 }
        : { top: 52, bottom: 32, left: 0, right: 0 }
    : native;
}
