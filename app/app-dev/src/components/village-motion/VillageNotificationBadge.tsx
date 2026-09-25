import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from '@/design-system/typography';
import { semanticTokens } from '@/design-system/tokens';

export function VillageNotificationBadge({
  accessibilityLabel,
  scale = 1,
  style,
  testID = 'village-notification-badge',
}: {
  accessibilityLabel: string;
  scale?: number;
  style?: ViewStyle;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel}
      pointerEvents="none"
      style={[
        styles.badge,
        { width: 25 * scale, height: 25 * scale, borderRadius: 13 * scale },
        style,
      ]}
    >
      <Text style={[styles.text, { fontSize: 17 * scale, lineHeight: 20 * scale }]}>!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: semanticTokens.color.accent,
    borderColor: semanticTokens.color.outline,
    borderWidth: 1.5,
  },
  text: {
    color: semanticTokens.color.text,
    fontWeight: '800',
    textAlign: 'center',
  },
});
