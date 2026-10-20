import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { art } from '@/constants/art';
import { componentTokens } from '@/design-system/tokens';

export function FocusEmoteBubble({ emote }: { emote: string }) {
  const token = componentTokens.focusEmoteBubble;
  return (
    <View
      testID="focus-emote-bubble"
      pointerEvents="none"
      style={{ alignSelf: 'center', width: token.width, height: token.height }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 52 54" style={StyleSheet.absoluteFill}>
        <Path
          d="M15 2 H37 Q50 2 50 15 V29 Q50 42 37 42 H31 L24 51 L21 42 H15 Q2 42 2 29 V15 Q2 2 15 2 Z"
          fill={token.background}
          stroke={token.outline}
          strokeWidth={token.stroke}
          strokeLinejoin="round"
        />
      </Svg>
      <Image
        source={art[`emote/${emote}`]}
        style={{
          position: 'absolute',
          left: token.imageLeft,
          top: token.imageTop,
          width: token.imageSize,
          height: token.imageSize,
        }}
      />
    </View>
  );
}
