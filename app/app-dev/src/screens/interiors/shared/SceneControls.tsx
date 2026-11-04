import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { easeInOut } from './motion';
import { BODY_FONT, exact, lh } from './styles';
import { Text } from './typography';

export const hotspotAt: Record<string, [string, string]> = {
  'building-models': ['47%', '45%'],
  'village-ledger': ['47%', '45%'],
  'building-blueprint': ['47%', '45%'],
  'island-ranking': ['48%', '49%'],
  'old-map': ['48%', '49%'],
  'mail-home': ['49%', '45%'],
  'friend-mail': ['49%', '45%'],
  tryon: ['47%', '48%'],
  counter: ['47%', '48%'],
  themes: ['47%', '48%'],
  records: ['48%', '51%'],
  player: ['48%', '51%'],
  catalog: ['48%', '51%'],
};

// @keyframes hotspot 1.8s ease-in-out infinite: 50%에서 scale 1.06, 바깥 링 6px→11px
// 웹은 원본과 같은 CSS 애니메이션을 그대로 건다 (그림자 문자열은 Animated 보간으로 적용되지 않는다)
const hotspotPulse =
  Platform.OS === 'web'
    ? StyleSheet.create({
        pulse: {
          animationKeyframes: [
            {
              '50%': {
                boxShadow: '0 0 0 2px #fff9,0 0 0 11px #f4a7bb1c',
                transform: 'scale(1.06)',
              },
            },
          ],
          animationDuration: '1.8s',
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
        } as any,
      }).pulse
    : null;

export function Hotspot({
  at,
  label,
  reduceMotion,
  onPress,
}: {
  at: [string, string];
  label: string;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion || Platform.OS === 'web') return;
    // 네이티브는 크기만 뛴다 (키프레임 구간마다 ease-in-out)
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 900, easing: easeInOut, useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 900, easing: easeInOut, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, t]);
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          zIndex: 5,
          left: at[0] as any,
          top: at[1] as any,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: exact('#fffc'),
          boxShadow: '0 0 0 2px #fff9,0 0 0 6px #f4a7bb55',
        },
        reduceMotion
          ? null
          : Platform.OS === 'web'
            ? hotspotPulse
            : {
                transform: [
                  { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
                ],
              },
      ]}
    >
      <Pressable
        testID="scene-hotspot"
        accessibilityLabel={label}
        onPress={onPress}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      >
        <View
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            top: 10,
            bottom: 10,
            borderRadius: 8,
            backgroundColor: '#f4a7bb',
          }}
        />
      </Pressable>
    </Animated.View>
  );
}

// @keyframes toast 1.7s ease both: 0% 투명·아래 18px → 15~75% 보임 → 100% 투명·위 8px
export function Toast({ message, serial }: { message: string; serial: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    t.setValue(0);
    Animated.timing(t, {
      toValue: 1,
      duration: 1700,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [serial, t]);
  return (
    <Animated.View
      testID="scene-toast"
      style={{
        position: 'absolute',
        zIndex: 30,
        left: '50%',
        bottom: 28,
        maxWidth: '80%',
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderWidth: 1.5,
        borderColor: '#69503e',
        borderRadius: 99,
        backgroundColor: '#fff8e9',
        boxShadow: '0 3px 8px #34221842',
        pointerEvents: 'none',
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateX: '-50%' },
          {
            translateY: t.interpolate({
              inputRange: [0, 0.15, 0.75, 1],
              outputRange: [18, 0, 0, -8],
            }),
          },
        ],
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: BODY_FONT,
          fontSize: 8,
          lineHeight: lh(12.8),
          fontWeight: '800',
          color: '#4a3931',
        }}
      >
        {message}
      </Text>
    </Animated.View>
  );
}
