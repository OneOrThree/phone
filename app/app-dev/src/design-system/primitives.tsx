import { TextInput, Text } from '@/design-system/typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useRef, useEffect, PropsWithChildren, createContext, useContext } from 'react';
import {
  Animated,
  Pressable,
  View,
  StyleSheet,
  Image,
  StyleProp,
  ViewStyle,
  AccessibilityInfo,
  Platform,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { cat, assets } from '@/constants/assets';
import { C, componentTokens, semanticTokens } from '@/design-system/tokens';
export { C } from '@/design-system/tokens';
export const MotionContext = createContext(false);
export const S = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.cream },
  content: { padding: 20, paddingBottom: 60, gap: 16 },
  h1: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '800',
    color: C.ink,
    letterSpacing: -0.7,
  },
  h2: { fontSize: 21, lineHeight: 29, fontWeight: '800', color: C.ink },
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
  input: {
    borderWidth: componentTokens.input.borderWidth,
    borderColor: componentTokens.input.border,
    borderRadius: componentTokens.input.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: componentTokens.input.background,
    fontSize: 16,
    color: componentTokens.input.foreground,
    minHeight: componentTokens.input.minHeight,
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
  menu: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: C.paper,
    borderWidth: 1.5,
    borderColor: C.brown,
    borderRadius: 20,
  },
  scene: { width: '100%', height: 240, borderRadius: 22 },
  avatar: {
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: C.brown,
    backgroundColor: C.sky,
  },
  tabs: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
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
export function H({ children, large = false }: { children: React.ReactNode; large?: boolean }) {
  return (
    <Text accessibilityRole="header" style={large ? S.h1 : S.h2}>
      {children}
    </Text>
  );
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
export function Avatar({ color = 'black', size = 54 }: { color?: string; size?: number }) {
  return (
    <Image
      source={cat(color)}
      style={[S.avatar, { width: size, height: size }]}
      resizeMode="contain"
      accessibilityLabel="고양이 프로필"
    />
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder = '',
  numeric = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: 7 }}>
      <T small>{label}</T>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        keyboardType={numeric ? 'number-pad' : 'default'}
        multiline={multiline}
        style={[S.input, multiline && { minHeight: 100, textAlignVertical: 'top' }]}
      />
    </View>
  );
}
export function Progress({ value, label }: { value: number | null; label?: string }) {
  return (
    <View
      accessible
      accessibilityLabel={(label || '달성률') + ' ' + (value === null ? '확인 필요' : value + '%')}
      style={{ gap: 6 }}
    >
      <View
        style={{
          height: 8,
          backgroundColor: `${C.brown}2B`,
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {value !== null && (
          <View
            style={{
              width: `${Math.max(0, Math.min(100, value))}%`,
              height: 8,
              backgroundColor: componentTokens.progress.fill,
              borderRadius: 10,
            }}
          />
        )}
      </View>
    </View>
  );
}
export function Art({ path, height = 150 }: { path: string; height?: number }) {
  return <Image source={assets[path]} style={{ width: '100%', height }} resizeMode="contain" />;
}
export function Menu({
  title,
  subtitle,
  art,
  onPress,
}: {
  title: string;
  subtitle?: string;
  art?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [S.menu, { opacity: pressed ? 0.7 : 1 }]}
    >
      {art && <Image source={assets[art]} style={{ width: 54, height: 54 }} resizeMode="contain" />}
      <View style={{ flex: 1 }}>
        <H>{title}</H>
        <T small>{subtitle}</T>
      </View>
      <T>›</T>
    </Pressable>
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={S.tabs}>
      {items.map((item) => (
        <Button
          key={item}
          title={item}
          secondary={item !== value}
          onPress={() => onChange(item)}
          small
        />
      ))}
    </View>
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
