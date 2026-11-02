import { useContext } from 'react';
import { Animated, View, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Text } from '@/design-system/typography';
import { componentTokens as c, semanticTokens as s } from '@/design-system/tokens';
import { FishingHudTransform, hms } from './FishingIsland';

/** 위치는 섬을 따르되 글자·칸 너비는 확대 배율과 관계없이 같은 크기를 유지한다. */
export function FishingFocusHud({
  subject,
  seconds,
  size,
  sizeY,
  textStyle,
}: {
  subject: string;
  seconds: number;
  size: number;
  sizeY: number;
  textStyle?: StyleProp<TextStyle>;
}) {
  const ui = c.focusIslandHud;
  const transform = useContext(FishingHudTransform);
  const width = (size / (transform?.zoom ?? 1)) * ui.widthRatio;
  return (
    <View
      testID="fishing-focus-hud"
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: size * ui.anchorX - width / 2,
        top: sizeY * ui.anchorY,
        width,
      }}
    >
      <Animated.View
        testID="fishing-focus-hud-content"
        style={{
          alignItems: 'center',
          gap: ui.contentGap,
          transformOrigin: 'center top',
          transform: transform ? [{ scale: transform.inverseScale }] : undefined,
        }}
      >
        <Text numberOfLines={1} style={[textStyle, styles.subject]}>
          {subject}
        </Text>
        <Text style={[textStyle, styles.time]}>{hms(seconds)}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  subject: {
    fontSize: s.typography.body,
    lineHeight: c.focusIslandHud.subjectLineHeight,
    fontWeight: s.typography.extraBold,
    textAlign: 'center',
    maxWidth: '100%',
  },
  time: {
    fontSize: s.typography.display,
    lineHeight: c.focusIslandHud.timerLineHeight,
    fontWeight: s.typography.extraBold,
    letterSpacing: c.focusIslandHud.timerLetterSpacing,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
});
