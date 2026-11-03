import { Btn, C, Txt, art } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { IslandPopup } from '@/screens/island/IslandSheet';
import { GuideBox } from '@/screens/island/NpcGuide';
import { useAppLayout } from '@/utils/layout';
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import {
  Svg,
  Circle as SvgCircle,
  Defs as SvgDefs,
  LinearGradient as SvgLinearGradient,
  Path as SvgPath,
  Polygon as SvgPolygon,
  Rect as SvgRect,
  Stop as SvgStop,
} from 'react-native-svg';

const focusBlockingIntroStyles = StyleSheet.create({
  characterStage: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  character: {
    width: '100%',
    height: '100%',
  },
  appLogo: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: componentTokens.focusBlockingIntro.logoRadius,
    borderWidth: semanticTokens.stroke.strong,
    borderColor: C.brown,
    backgroundColor: C.paper,
    boxShadow: componentTokens.focusBlockingIntro.logoShadow,
  },
  title: { paddingRight: semanticTokens.size.tapMin },
  guide: { position: 'relative' },
});

function InstagramLogo() {
  return (
    <Svg width="68%" height="68%" viewBox="0 0 48 48">
      <SvgDefs>
        <SvgLinearGradient id="instagram-gradient" x1="4" y1="44" x2="44" y2="4">
          <SvgStop offset="0" stopColor="#FFD600" />
          <SvgStop offset="0.48" stopColor="#FF0169" />
          <SvgStop offset="1" stopColor="#D300C5" />
        </SvgLinearGradient>
      </SvgDefs>
      <SvgRect width="48" height="48" rx="12" fill="url(#instagram-gradient)" />
      <SvgRect
        x="11"
        y="11"
        width="26"
        height="26"
        rx="8"
        fill="none"
        stroke="#FFF"
        strokeWidth="3.5"
      />
      <SvgCircle cx="24" cy="24" r="6.5" fill="none" stroke="#FFF" strokeWidth="3.5" />
      <SvgCircle cx="33" cy="15" r="2.2" fill="#FFF" />
    </Svg>
  );
}

function YouTubeLogo() {
  return (
    <Svg width="72%" height="72%" viewBox="0 0 48 48">
      <SvgRect x="3" y="9" width="42" height="30" rx="9" fill="#FF0033" />
      <SvgPolygon points="20,17 33,24 20,31" fill="#FFF" />
    </Svg>
  );
}

const TIKTOK_PATH =
  'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z';

function TikTokLogo() {
  return (
    <Svg width="66%" height="66%" viewBox="-2 -2 28 28">
      <SvgPath d={TIKTOK_PATH} fill="#25F4EE" transform="translate(-0.65 0.55)" />
      <SvgPath d={TIKTOK_PATH} fill="#FE2C55" transform="translate(0.65 0)" />
      <SvgPath d={TIKTOK_PATH} fill="#121212" />
    </Svg>
  );
}

function FloatingAppLogo({
  testID,
  size,
  style,
  children,
}: {
  testID: string;
  size: number;
  style: any;
  children: React.ReactNode;
}) {
  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[focusBlockingIntroStyles.appLogo, { width: size, height: size }, style]}
    >
      {children}
    </View>
  );
}

export function FocusBlockingIntro({
  e,
}: {
  e: {
    onClose: () => void;
    onLater: () => void;
    onAllow: () => void;
    busy?: boolean;
  };
}) {
  const layout = useAppLayout();
  const characterSize = Math.min(
    layout.compact ? 160 : 288,
    layout.width - semanticTokens.spacing.page * 2,
    layout.height * 0.34,
  );
  const logoSize = layout.compact ? 42 : 56;
  return (
    <IslandPopup onClose={e.onClose}>
      <Txt kind="h17" accessibilityRole="header" style={focusBlockingIntroStyles.title}>
        {t('settings.permissions.focusBlockingIntro.title')}
      </Txt>
      <View
        style={[
          focusBlockingIntroStyles.characterStage,
          { minHeight: Math.max(characterSize, layout.height * (layout.compact ? 0.3 : 0.4)) },
        ]}
      >
        <FloatingAppLogo
          testID="focus-blocking-logo-instagram"
          size={logoSize}
          style={{ left: 4, top: '12%', transform: [{ rotate: '-8deg' }] }}
        >
          <InstagramLogo />
        </FloatingAppLogo>
        <FloatingAppLogo
          testID="focus-blocking-logo-youtube"
          size={logoSize}
          style={{ right: 2, top: '24%', transform: [{ rotate: '7deg' }] }}
        >
          <YouTubeLogo />
        </FloatingAppLogo>
        <FloatingAppLogo
          testID="focus-blocking-logo-tiktok"
          size={logoSize}
          style={{ left: 20, bottom: '10%', transform: [{ rotate: '-5deg' }] }}
        >
          <TikTokLogo />
        </FloatingAppLogo>
        <Image
          testID="focus-blocking-character"
          source={art['cat/black/phone']}
          accessible={false}
          resizeMode="contain"
          style={[
            focusBlockingIntroStyles.character,
            { width: characterSize, height: characterSize },
          ]}
        />
      </View>
      <GuideBox
        character={null}
        text={t('settings.permissions.focusBlockingIntro.dialogue')}
        style={focusBlockingIntroStyles.guide}
        onSkip={e.onLater}
        skipTitle={t('settings.permissions.focusBlockingIntro.later')}
      >
        <Btn
          small
          title={
            e.busy
              ? t('settings.permissions.gate.requesting')
              : t('settings.permissions.focusBlockingIntro.allow')
          }
          disabled={e.busy}
          onPress={e.onAllow}
        />
      </GuideBox>
    </IslandPopup>
  );
}
