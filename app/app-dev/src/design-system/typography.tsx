import React, { forwardRef, useContext } from 'react';
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
// 굵은 글자(제목·버튼)는 시스템 글꼴로 둔다 — 고운돋움은 Regular(400) 한 두께뿐이라 굵게가 안 되기 때문.
// 이름은 네이티브 'System'(WorldViews 등 기존 코드가 쓰는 값), 웹은 종전 기본 글꼴 스택이다.
const SYSTEM_FONT =
  Platform.OS === 'web'
    ? '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
    : 'System';
function isBoldWeight(weight: TextStyle['fontWeight']): boolean {
  if (weight === 'bold') return true;
  const n = typeof weight === 'number' ? weight : Number(weight);
  return Number.isFinite(n) && n >= 700;
}

// RN 은 중첩 Text 가 부모 fontFamily 를 상속한다. 리프에서는 부모 글꼴을 알 수 없어, 호출부가 글꼴을
// 직접 지정한 Text(그림 장면의 고운돋움 등)는 그 글꼴을 Context 로 자손에게 전해 "명시 글꼴 맥락"을 만든다.
// - 명시 맥락 안: 굵은 글자까지 그 글꼴을 그대로 잇는다(장면은 굵어도 고운돋움, DESIGN §5.1).
// - 명시 맥락 밖(기본 본문): 굵은 글자는 시스템 글꼴로 OS 가 굵게, 그 밖은 고운돋움.
// 이렇게 해야 본문 고운돋움 안의 굵은 글자(HomeChatLog 이름)는 시스템으로, 장면 고운돋움 안의 굵은
// 숫자(마을회관 배지)는 고운돋움으로 — 두 중첩이 서로 반대로 올바르게 풀린다(GROMO-2639).
const FontFamilyContext = React.createContext<string | undefined>(undefined);
function resolveFamily(flat: TextStyle, inherited: string | undefined): string {
  if (flat.fontFamily) return String(flat.fontFamily); // 호출부가 직접 지정(장면 등)
  if (inherited) return inherited; // 명시 글꼴 조상 아래 — 굵어도 그 글꼴 유지
  return isBoldWeight(flat.fontWeight) ? SYSTEM_FONT : BODY_FONT;
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
    const inherited = useContext(FontFamilyContext);
    const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
    const family = resolveFamily(flat, inherited);
    const node = (
      <NativeText
        ref={ref}
        lineBreakStrategyIOS="hangul-word"
        {...props}
        style={[{ fontFamily: family }, style, useTypeStyle(flat, tabletScale)]}
      />
    );
    // 호출부가 글꼴을 직접 지정한 Text 만 자손에게 그 글꼴을 물려준다(명시 맥락). 기본 본문 맥락은 바꾸지 않는다.
    return flat.fontFamily ? (
      <FontFamilyContext.Provider value={family}>{node}</FontFamilyContext.Provider>
    ) : (
      node
    );
  },
);
export const TextInput = forwardRef<NativeTextInput, TextInputProps & { tabletScale?: number }>(
  ({ style, tabletScale, ...props }, ref) => {
    const inherited = useContext(FontFamilyContext);
    const flat = (StyleSheet.flatten(style as StyleProp<TextStyle>) || {}) as TextStyle;
    const family = resolveFamily(flat, inherited);
    return (
      <NativeTextInput
        ref={ref}
        {...props}
        style={[{ fontFamily: family }, style, useTypeStyle(flat, tabletScale)]}
      />
    );
  },
);
