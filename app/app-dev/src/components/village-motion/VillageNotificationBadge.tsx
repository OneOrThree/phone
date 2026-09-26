import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from '@/design-system/typography';
import { semanticTokens } from '@/design-system/tokens';

export const VILLAGE_NOTIFICATION_BADGE_RATIO = 0.72;

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
  const badgeScale = scale * VILLAGE_NOTIFICATION_BADGE_RATIO;
  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      accessibilityLabel={accessibilityLabel}
      pointerEvents="none"
      style={[
        styles.badge,
        {
          width: 25 * badgeScale,
          height: 25 * badgeScale,
          borderRadius: 13 * badgeScale,
        },
        style,
      ]}
    >
      <Text style={[styles.text, { fontSize: 17 * badgeScale, lineHeight: 20 * badgeScale }]}>
        !
      </Text>
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
