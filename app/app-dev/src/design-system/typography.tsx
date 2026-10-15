import React, { forwardRef } from 'react';
import {
  Text as NativeText,
  TextInput as NativeTextInput,
  TextProps,
  TextInputProps,
  TextStyle,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

// Keep device typography separate from OS accessibility font scaling.
// Explicit overrides are for components whose tablet type is already sized.
function useTypeStyle(style: StyleProp<TextStyle>, tabletScale?: number) {
  const { width, height } = useWindowDimensions();
  const scale = Math.min(width, height) >= 600 ? (tabletScale ?? 1.25) : 1;
  const flat = StyleSheet.flatten(style) || {};
  return scale === 1
    ? undefined
    : {
        ...(typeof flat.fontSize === 'number' ? { fontSize: flat.fontSize * scale } : {}),
        ...(typeof flat.lineHeight === 'number' ? { lineHeight: flat.lineHeight * scale } : {}),
      };
}
export const Text = forwardRef<NativeText, TextProps & { tabletScale?: number }>(
  ({ style, tabletScale, ...props }, ref) => (
    <NativeText ref={ref} {...props} style={[style, useTypeStyle(style, tabletScale)]} />
  ),
);
export const TextInput = forwardRef<NativeTextInput, TextInputProps & { tabletScale?: number }>(
  ({ style, tabletScale, ...props }, ref) => (
    <NativeTextInput ref={ref} {...props} style={[style, useTypeStyle(style, tabletScale)]} />
  ),
);
