import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

export function RouteTransitionShield({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <Pressable
      testID="route-transition-shield"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="box-only"
      onPress={() => {}}
      style={[StyleSheet.absoluteFill, { zIndex: 10 }]}
    />
  );
}
