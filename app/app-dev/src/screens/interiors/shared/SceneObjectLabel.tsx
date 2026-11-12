import { componentTokens } from '@/design-system/tokens';
import React from 'react';
import { View } from 'react-native';
import { Text, boardFont } from './typography';

const label = componentTokens.interiorObjectLabel;

// 글자 한 칸을 1em으로 잡아 번역·큰 글자에서도 이름표가 터치 영역 안에 들어가게 한다.
export function sceneObjectLabelSize(
  text: string,
  scale: number,
  fontScale: number,
  maxWidth: number,
) {
  const textWidth = Array.from(text).length * label.fontSize * scale * fontScale;
  const inset = 2 * (label.paddingHorizontal + label.borderWidth);
  const width = Math.min(maxWidth, textWidth + inset);
  const lines = Math.max(1, Math.ceil(textWidth / Math.max(1, width - inset) - 1e-6));
  return {
    width,
    height:
      lines * label.fontSize * label.lineHeight * scale * fontScale +
      2 * (label.paddingVertical + label.borderWidth),
  };
}

export function SceneObjectLabel({
  children,
  scale = 1,
  maxWidth,
}: {
  children: string;
  scale?: number;
  maxWidth?: number;
}) {
  return (
    <View
      pointerEvents="none"
      style={{
        maxWidth,
        paddingVertical: label.paddingVertical,
        paddingHorizontal: label.paddingHorizontal,
        borderRadius: label.radius,
        borderWidth: label.borderWidth,
        borderColor: label.border,
        backgroundColor: label.background,
      }}
    >
      <Text
        allowFontScaling
        style={[
          boardFont(label.fontSize * scale, label.lineHeight, '700'),
          { textAlign: 'center' },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}
