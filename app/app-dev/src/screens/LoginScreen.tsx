import React from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, View } from 'react-native';
import { Btn, C, Pic, Txt, k } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { PolicyLinks } from '@/components/PolicyLink';
import { AppleLogo, GoogleLogo } from '@/components/ProviderLogo';
import type { Provider } from '@/services/api/auth';
import { useAppLayout } from '@/utils/layout';

const LABEL: Record<Provider, string> = {
  kakao: '카카오로 계속하기',
  line: 'LINE으로 계속하기',
  apple: 'Apple로 계속하기',
  google: 'Google로 계속하기',
};

const KAKAO_LOGIN_ASSET = require('@/assets/login/kakao_login_medium_wide.png');
const LINE_LOGIN_ASSET = require('@/assets/login/line_login_logo_3x.png');

const BRAND_BUTTON = {
  line: {
    asset: LINE_LOGIN_ASSET,
    backgroundColor: componentTokens.loginButton.lineBackground,
    borderColor: componentTokens.loginButton.lineBackground,
    textColor: componentTokens.loginButton.lineForeground,
  },
} as const;

export interface LoginScreenProps {
  providers: Provider[];
  termsVersion?: string;
  termsAccepted: boolean;
  onTermsAcceptedChange: (accepted: boolean) => void;
  onProviderPress?: (provider: Provider) => void;
  providerBusy?: Provider | null;
  providerError?: string;
  onGuestPress?: () => void;
  guestBusy?: boolean;
  guestError?: string;
}

export function LoginScreen({
  providers,
  termsVersion = '',
  termsAccepted,
  onTermsAcceptedChange,
  onProviderPress,
  providerBusy = null,
  providerError = '',
  onGuestPress,
  guestBusy = false,
  guestError = '',
}: LoginScreenProps) {
  const layout = useAppLayout();
  const ins = layout.insets;
  const busy = providerBusy !== null || guestBusy;

  const providerButton = (provider: Provider) => {
    const loading = providerBusy === provider;
    const disabled = busy || !termsAccepted || !onProviderPress;
    const accessibilityLabel = loading ? '연결하는 중…' : LABEL[provider];

    if (provider === 'kakao') {
      return (
        <Pressable
          key={provider}
          testID="login-kakao"
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled, busy: loading }}
          disabled={disabled}
          onPress={onProviderPress ? () => onProviderPress(provider) : undefined}
          style={({ pressed }) => ({
            width: '100%',
            height: componentTokens.loginButton.height,
            borderRadius: semanticTokens.radius.full,
            overflow: 'hidden',
            opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
          })}
        >
          <Image
            source={KAKAO_LOGIN_ASSET}
            accessibilityIgnoresInvertColors
            resizeMode="stretch"
            style={{ width: '100%', height: '100%' }}
          />
          {loading && (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                inset: 0,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: semanticTokens.color.overlaySheet,
                borderRadius: semanticTokens.radius.full,
              }}
            >
              <ActivityIndicator color={semanticTokens.color.surface} />
            </View>
          )}
        </Pressable>
      );
    }

    // Apple·Google 은 한 틀로 그린다(GROMO-2215). 예전에는 Apple 이 iOS 네이티브 버튼이라 글꼴·로고 크기·배치를
    // 시스템이 정했고, Google 은 PNG 를 잘라 붙여 둘이 서로 달랐다. 높이·모서리·로고 상자·로고 위치·글꼴을 공유하고
    // 색만 브랜드별로 둔다 — 두 회사 가이드 모두 이런 직접 그린 버튼을 허용한다(Apple 은 검정 바탕·흰 로고).
    if (provider === 'google' || (provider === 'apple' && Platform.OS === 'ios')) {
      const apple = provider === 'apple';
      const tokens = componentTokens.loginButton;
      const background = apple ? tokens.appleBackground : tokens.googleBackground;
      const foreground = apple ? tokens.appleForeground : tokens.googleForeground;

      return (
        <Pressable
          key={provider}
          testID={`login-${provider}`}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled, busy: loading }}
          disabled={disabled}
          onPress={onProviderPress ? () => onProviderPress(provider) : undefined}
          style={({ pressed }) => ({
            width: '100%',
            // 고정 높이가 아니라 최소 높이 — 큰 글자 설정에서 버튼이 글자를 따라 커진다(LoginScreen.test).
            minHeight: tokens.height,
            paddingVertical: primitiveTokens.space[3],
            paddingHorizontal: tokens.logoInset * 2 + tokens.logoSize,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: semanticTokens.stroke.subtle,
            borderColor: apple ? background : tokens.googleBorder,
            borderRadius: semanticTokens.radius.full,
            backgroundColor: background,
            overflow: 'hidden',
            opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
          })}
        >
          <View
            pointerEvents="none"
            style={{
              // 위아래로 늘려 두면 버튼이 큰 글자로 커져도 로고가 세로 가운데에 남는다.
              position: 'absolute',
              left: tokens.logoInset,
              top: 0,
              bottom: 0,
              width: tokens.logoSize,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {apple ? (
              <AppleLogo size={tokens.logoSize} color={foreground} />
            ) : (
              <GoogleLogo size={tokens.logoSize} />
            )}
          </View>
          <Txt
            style={{
              color: foreground,
              fontSize: semanticTokens.typography.body,
              fontWeight: semanticTokens.typography.semibold,
            }}
          >
            {LABEL[provider]}
          </Txt>
          {loading && (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                inset: 0,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: semanticTokens.color.overlaySheet,
                borderRadius: semanticTokens.radius.full,
              }}
            >
              <ActivityIndicator color={primitiveTokens.color.white} />
            </View>
          )}
        </Pressable>
      );
    }

    if (provider === 'line') {
      const brand = BRAND_BUTTON[provider];

      return (
        <Pressable
          key={provider}
          testID={`login-${provider}`}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled, busy: loading }}
          disabled={disabled}
          onPress={onProviderPress ? () => onProviderPress(provider) : undefined}
          style={({ pressed }) => ({
            width: '100%',
            minHeight: componentTokens.loginButton.height,
            paddingVertical: primitiveTokens.space[3],
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: semanticTokens.stroke.subtle,
            borderColor: brand.borderColor,
            borderRadius: semanticTokens.radius.full,
            backgroundColor: brand.backgroundColor,
            overflow: 'hidden',
            opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
          })}
        >
          <Image
            source={brand.asset}
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            style={{
              position: 'absolute',
              left: primitiveTokens.space[3],
              width: primitiveTokens.space[8],
              height: primitiveTokens.space[8],
            }}
          />
          <Txt
            style={{
              color: brand.textColor,
              fontSize: semanticTokens.typography.body,
              fontWeight: semanticTokens.typography.semibold,
            }}
          >
            {LABEL[provider]}
          </Txt>
          {loading && (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                inset: 0,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: semanticTokens.color.overlaySheet,
                borderRadius: semanticTokens.radius.full,
              }}
            >
              <ActivityIndicator color={primitiveTokens.color.white} />
            </View>
          )}
        </Pressable>
      );
    }

    return (
      <Btn
        key={provider}
        id={`login-${provider}`}
        kind="sec"
        title={accessibilityLabel}
        disabled={disabled}
        onPress={onProviderPress ? () => onProviderPress(provider) : undefined}
      />
    );
  };

  const logo = (
    <>
      <Txt
        accessibilityRole="header"
        style={{
          color: C.paper,
          fontSize: 42,
          lineHeight: 42,
          fontWeight: '800',
          letterSpacing: 1,
          textShadowColor: semanticTokens.color.overlaySheet,
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 0,
        }}
      >
        GROMO
      </Txt>
      <Txt
        style={{
          color: C.paper,
          fontSize: 15,
          lineHeight: 22,
          fontWeight: '700',
          textShadowColor: semanticTokens.color.overlaySheet,
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 0,
        }}
      >
        오늘의 집중이 자라는 곳
      </Txt>
    </>
  );

  const actions = (
    <View style={{ gap: semanticTokens.spacing.control }}>
      <Pressable
        testID="login-terms"
        accessibilityRole="checkbox"
        accessibilityLabel={
          termsVersion ? `현재 약관 버전 ${termsVersion}에 동의합니다` : undefined
        }
        accessibilityState={{ checked: termsAccepted, disabled: busy }}
        disabled={busy}
        onPress={() => onTermsAcceptedChange(!termsAccepted)}
        style={[k.row, { minHeight: semanticTokens.size.tapMin }]}
      >
        <View
          style={{
            width: primitiveTokens.space[6],
            height: primitiveTokens.space[6],
            borderWidth: semanticTokens.stroke.strong,
            borderColor: semanticTokens.color.outline,
            borderRadius: primitiveTokens.space[2],
            backgroundColor: termsAccepted
              ? semanticTokens.color.primary
              : semanticTokens.color.surface,
          }}
        >
          {termsAccepted && <Txt style={{ textAlign: 'center' }}>✓</Txt>}
        </View>
        <Txt kind="meta" style={{ flex: 1 }}>
          {termsVersion ? `현재 약관 버전 ${termsVersion}: ` : ''}이용약관 및 개인정보처리방침에
          동의해요.
        </Txt>
      </Pressable>
      <PolicyLinks textStyle={{ fontSize: 13, color: semanticTokens.color.text }} />
      <View
        style={{
          width: '100%',
          maxWidth: 360,
          alignSelf: 'center',
          gap: primitiveTokens.space[2],
        }}
      >
        {providers.map(providerButton)}
      </View>
      {!!providerError && (
        <Txt
          kind="meta"
          accessibilityLiveRegion="polite"
          style={{ color: semanticTokens.color.danger }}
        >
          {providerError}
        </Txt>
      )}
      {!!onGuestPress && (
        <Pressable
          testID="login-guest"
          accessibilityRole="button"
          accessibilityLabel="게스트로 시작하기"
          accessibilityState={{ disabled: busy || !termsAccepted }}
          disabled={busy || !termsAccepted}
          onPress={onGuestPress}
          style={{
            minHeight: semanticTokens.size.tapMin,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: busy || !termsAccepted ? 0.45 : 1,
          }}
        >
          <Txt style={{ fontWeight: '700', textDecorationLine: 'underline' }}>
            {guestBusy ? '게스트 계정을 여는 중…' : '게스트로 시작하기'}
          </Txt>
        </Pressable>
      )}
      {!!guestError && (
        <Txt
          kind="meta"
          accessibilityLiveRegion="polite"
          style={{ color: semanticTokens.color.danger }}
        >
          {guestError}
        </Txt>
      )}
    </View>
  );

  const copy = (
    <View style={{ gap: primitiveTokens.space[2] }}>
      <Txt kind="h" style={{ fontSize: 26, lineHeight: 34, letterSpacing: -0.52 }}>
        {'조금씩 집중하고,\n함께 자라요.'}
      </Txt>
      <Txt style={{ color: C.muted }}>나의 작은 배에서 시작하는 집중 습관.</Txt>
    </View>
  );

  if (layout.compact) {
    return (
      <View style={{ flex: 1, backgroundColor: C.sky }}>
        <Pic
          id="L/welcome"
          w="100%"
          h="100%"
          cover
          style={{ position: 'absolute', left: 0, top: 0 }}
        />
        <View style={{ position: 'absolute', left: Math.max(56, ins.left + 4), top: ins.top + 22 }}>
          {logo}
        </View>
        <Pic
          id="cat/black/sitting"
          w={150}
          style={{ position: 'absolute', left: Math.max(230, ins.left + 178), bottom: 0 }}
        />
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 380 }}
          contentContainerStyle={{
            flexGrow: 1,
            minHeight: layout.height,
            gap: semanticTokens.spacing.component,
            paddingTop: ins.top + primitiveTokens.space[8],
            paddingLeft: primitiveTokens.space[8],
            paddingRight: Math.max(56, ins.right + 4),
            paddingBottom: Math.max(26, ins.bottom + 5),
            backgroundColor: C.cream,
            borderLeftWidth: semanticTokens.stroke.strong,
            borderColor: C.brown,
          }}
        >
          {copy}
          <View style={{ flex: 1 }} />
          {actions}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.cream,
        flexDirection: layout.landscape ? 'row' : 'column',
      }}
    >
      <View
        style={{
          height: layout.landscape
            ? '100%'
            : layout.tablet
              ? '42%'
              : Math.min((layout.width * 978) / 804, layout.height * 0.56),
          width: layout.landscape ? '48%' : '100%',
          overflow: 'hidden',
          borderBottomLeftRadius: layout.landscape ? 0 : primitiveTokens.space[10],
          borderBottomRightRadius: layout.landscape ? 0 : primitiveTokens.space[10],
        }}
      >
        <Pic id="welcome" w="100%" h="100%" cover />
        <View style={{ position: 'absolute', left: ins.left + 26, top: ins.top + 12 }}>{logo}</View>
        <Pic
          id="cat/black/sitting"
          w={150}
          style={{ position: 'absolute', right: primitiveTokens.space[4], bottom: -8 }}
        />
      </View>
      <ScrollView
        style={{ flex: 1, width: '100%' }}
        contentContainerStyle={{
          flexGrow: 1,
          width: '100%',
          maxWidth: 580,
          alignSelf: 'center',
          justifyContent: 'center',
          gap: semanticTokens.spacing.section,
          paddingHorizontal: semanticTokens.spacing.page,
          paddingTop: semanticTokens.spacing.section,
          paddingBottom: ins.bottom + semanticTokens.spacing.component,
        }}
      >
        {copy}
        {actions}
      </ScrollView>
    </View>
  );
}
