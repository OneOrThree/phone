import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { semanticTokens } from '@/design-system/tokens';

export function RouteTransitionShield({
  visible,
  coverLoading = false,
}: {
  visible: boolean;
  coverLoading?: boolean;
}) {
  if (!visible) return null;

  return (
    <Pressable
      testID="route-transition-shield"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="box-only"
      onPress={() => {}}
      style={[
        StyleSheet.absoluteFill,
        {
          zIndex: 10,
          backgroundColor: coverLoading ? semanticTokens.color.canvas : 'transparent',
        },
      ]}
    />
  );
}
