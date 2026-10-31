import React, { forwardRef } from 'react';
import {
  Platform,
  Text as NativeText,
  TextInput as NativeTextInput,
  TextProps,
  TextInputProps,
  TextStyle,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

// 앱 기본 본문 글꼴은 고운돋움이다(GROMO-2639). 네이티브는 app.config.js 의 expo-font 플러그인으로,
// 웹은 App 의 useGowunFont() 로 불러온다. 웹 스택 뒤쪽은 고운돋움에 없는 특수기호용 대체 글꼴이다.
// (같은 글꼴 이름이 screens/island/sceneKit 의 GOWUN·GOWUN_WEB 에도 있다 — 그림 장면 화면이 직접 쓴다.)
const BODY_FONT =
  Platform.OS === 'web'
    ? 'Gowun, "Apple SD Gothic Neo", sans-serif'
    : Platform.OS === 'ios'
      ? 'Gowun Dodum'
      : 'Gowun';
// 고운돋움은 Regular(400) 한 두께뿐이라 굵게가 안 된다. 그래서 제목·버튼처럼 굵기로 위계를 주는
// 글자(fontWeight ≥ 700)에는 기본 글꼴을 입히지 않고 시스템 글꼴로 둬 OS 가 굵게 그리게 한다.
function isBoldWeight(weight: TextStyle['fontWeight']): boolean {
  if (weight === 'bold') return true;
  const n = typeof weight === 'number' ? weight : Number(weight);
  return Number.isFinite(n) && n >= 700;
}
// 호출부가 fontFamily 를 직접 준 글자(그림 장면의 고운돋움 지정 등)는 그대로 둔다.
function bodyFontBase(flat: TextStyle): TextStyle | undefined {
  return flat.fontFamily || isBoldWeight(flat.fontWeight) ? undefined : { fontFamily: BODY_FONT };
}

// Keep device typography separate from OS accessibility font scaling.
// Explicit overrides are for components whose tablet type is already sized.
function useTypeStyle(flat: TextStyle, tabletScale?: number) {
  const { width, height } = useWindowDimensions();
  const scale = Math.min(width, height) >= 600 ? (tabletScale ?? 1.25) : 1;
  return scale === 1
    ? undefined
    : {
        ...(typeof flat.fontSize === 'number' ? { fontSize: flat.fontSize * scale } : {}),
        ...(typeof flat.lineHeight === 'number' ? { lineHeight: flat.lineHeight * scale } : {}),
      };
}
// iOS 는 한국어를 글자 단위로 줄바꿈해 「시/작해」처럼 단어 중간에서 꺾는다 — 단어 단위를 기본값으로 두고 호출부가 주면 그 값을 쓴다
export const Text = forwardRef<NativeText, TextProps & { tabletScale?: number }>(
  ({ style, tabletScale, ...props }, ref) => {
    const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
    return (
      <NativeText
        ref={ref}
        lineBreakStrategyIOS="hangul-word"
        {...props}
        style={[bodyFontBase(flat), style, useTypeStyle(flat, tabletScale)]}
      />
    );
  },
);
export const TextInput = forwardRef<NativeTextInput, TextInputProps & { tabletScale?: number }>(
  ({ style, tabletScale, ...props }, ref) => {
    const flat = (StyleSheet.flatten(style as StyleProp<TextStyle>) || {}) as TextStyle;
    return (
      <NativeTextInput
        ref={ref}
        {...props}
        style={[bodyFontBase(flat), style, useTypeStyle(flat, tabletScale)]}
      />
    );
  },
);
