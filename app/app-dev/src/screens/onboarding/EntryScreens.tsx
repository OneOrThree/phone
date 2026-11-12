import { PolicyLinks } from '@/components/PolicyLink';
import { Btn, C, Pic, Txt, k } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { LoginScreen } from '@/screens/LoginScreen';
import { WebIslandEntry } from '@/screens/web-demo/WebIslandEntry';
import { OnboardingFlow } from '@/screens/onboarding/OnboardingFlow';
import { getSession } from '@/services/api/session';
import { Pressable, ScrollView, View } from 'react-native';
import type { ScreenContext } from '../island/navigation/useScreenState';

export function renderEntryScreens(context: ScreenContext) {
  const { route, e, terms, setTerms, act, state, home, go, layout, ins } = context;

  if (route === 'webIsland') return <WebIslandEntry e={e} />;

  if (route === 'login' && e.loginProviders) {
    return (
      <LoginScreen
        providers={e.loginProviders}
        termsVersion={e.termsVersion}
        termsAccepted={terms}
        onTermsAcceptedChange={setTerms}
        onProviderPress={e.startSocial ? (provider) => void e.startSocial?.(provider) : undefined}
        providerBusy={e.socialBusy}
        providerError={e.socialError}
        onGuestPress={
          e.startGuest
            ? () => void e.startGuest?.()
            : () => {
                act('LOGIN');
                state.onboarded ? home() : go('character');
              }
        }
        guestBusy={e.guestBusy}
        guestError={e.guestError}
      />
    );
  }

  if (route === 'login') {
    const agreeCheck = (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: terms }}
        onPress={() => setTerms(!terms)}
        style={[
          k.row,
          { minHeight: semanticTokens.size.tapMin },
          layout.compact && { paddingVertical: semanticTokens.spacing.control },
        ]}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderWidth: 2,
            borderColor: C.brown,
            borderRadius: 7,
            backgroundColor: terms ? C.pink : C.paper,
          }}
        >
          {terms && <Txt style={{ textAlign: 'center' }}>✓</Txt>}
        </View>
        <Txt kind="meta">{t('login.fallbackTermsAgree')}</Txt>
      </Pressable>
    );
    const agree = (
      <View>
        {agreeCheck}
        <PolicyLinks textStyle={{ fontSize: 13, color: C.ink }} />
      </View>
    );
    const start = (
      <View style={{ gap: 8 }}>
        {!!e.guestError && (
          <Txt kind="meta" accessibilityLiveRegion="polite" style={{ color: C.ink }}>
            {e.guestError}
          </Txt>
        )}
        <Btn
          title={
            e.guestBusy
              ? t('login.guestOpening')
              : e.startGuest
                ? t('login.guestStart')
                : t('login.fallbackStart')
          }
          disabled={!terms || !!e.guestBusy}
          onPress={() => {
            if (e.startGuest) {
              void e.startGuest?.();
              return;
            }
            act('LOGIN');
            state.onboarded ? home() : go('character');
          }}
        />
      </View>
    );
    // v2 로고: 흰 글자 + 아래로 떨어지는 그림자
    const shade = {
      color: C.paper,
      textShadowColor: '#49433955',
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 0,
    };
    const logo = (
      <>
        <Txt
          style={[
            shade,
            {
              fontSize: 42,
              lineHeight: 42,
              fontWeight: '900',
              letterSpacing: 1,
            },
          ]}
        >
          {t('onboardingStory.brand')}
        </Txt>
        <Txt style={[shade, { fontSize: 15, lineHeight: 21.75, fontWeight: '700' }]}>
          {t('login.tagline')}
        </Txt>
      </>
    );
    if (layout.compact)
      // 가로 폰: 그림을 넓게 깔고 오른쪽 크림 패널(380)에 문구·약관·시작
      return (
        <View style={{ flex: 1, backgroundColor: C.sky }}>
          <Pic
            id="L/welcome"
            w="100%"
            h="100%"
            cover
            style={{ position: 'absolute', left: 0, top: 0 }}
          />
          <View
            style={{
              position: 'absolute',
              left: Math.max(56, ins.left + 4),
              top: ins.top + 22,
            }}
          >
            {logo}
          </View>
          <Pic
            id="cat/black/sitting"
            w={150}
            style={{
              position: 'absolute',
              left: Math.max(230, ins.left + 178),
              bottom: 0,
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              // v2 welcome-panel: 폭 380 · 안쪽 여백 32 56 26 28(오른쪽 56은 다이내믹 아일랜드 자리)
              width: 380,
              gap: 10,
              paddingTop: ins.top + 32,
              paddingLeft: 28,
              paddingRight: Math.max(56, ins.right + 4),
              paddingBottom: Math.max(26, ins.bottom + 5),
              backgroundColor: C.cream,
              borderLeftWidth: 2,
              borderColor: C.brown,
              boxShadow: '-5px 0px 0px #8B695640',
            }}
          >
            <Txt kind="h" style={{ fontSize: 24, lineHeight: 31.2, letterSpacing: -0.48 }}>
              {t('login.heroTitle')}
            </Txt>
            <Txt style={{ color: C.muted }}>{t('login.heroSubtitle')}</Txt>
            {!!e.startGuest && <Txt kind="meta">{t('login.guestHint')}</Txt>}
            {agree}
            <View style={{ flex: 1 }} />
            {start}
          </View>
        </View>
      );
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
            // v2 welcome-top: 402×874에서 높이 490
            height: layout.landscape ? '100%' : layout.tablet ? '48%' : (layout.height * 490) / 874,
            width: layout.landscape ? '48%' : '100%',
            overflow: 'hidden',
            borderBottomLeftRadius: layout.landscape ? 0 : 44,
            borderBottomRightRadius: layout.landscape ? 0 : 44,
          }}
        >
          <Pic id="welcome" w="100%" h="100%" cover />
          <View
            style={{
              position: 'absolute',
              left: ins.left + 26,
              top: ins.top + 12,
            }}
          >
            {logo}
          </View>
          <Pic
            id="cat/black/sitting"
            w={150}
            style={{ position: 'absolute', right: 14, bottom: -8 }}
          />
        </View>
        <View
          style={{
            flex: 1,
            paddingTop: layout.landscape ? ins.top + 16 : 0,
            paddingRight: ins.right,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ScrollView
            style={{ width: '100%', maxWidth: 580, flex: 1 }}
            contentContainerStyle={{
              padding: 24,
              paddingTop: 22,
              gap: 12,
              flexGrow: 1,
              justifyContent: layout.tablet ? 'center' : 'flex-start',
            }}
          >
            <Txt kind="h" style={{ fontSize: 26, lineHeight: 33.8, letterSpacing: -0.52 }}>
              {t('login.heroTitle')}
            </Txt>
            <Txt style={{ color: C.muted }}>{t('login.heroSubtitle')}</Txt>
            {!!e.startGuest && <Txt kind="meta">{t('login.guestHint')}</Txt>}
            {agree}
          </ScrollView>
          <View
            style={{
              width: '100%',
              maxWidth: 580,
              paddingHorizontal: 20,
              paddingBottom: ins.bottom + 12,
            }}
          >
            {start}
          </View>
        </View>
      </View>
    );
  }

  // 첫 도착의 ISLAND_SYNC로 onboarded가 바뀌어도 완료 저장·홈 이동까지 같은 화면을 유지한다.
  if (route === 'character')
    return <OnboardingFlow key={getSession()?.userId ?? 'preview'} e={e} />;
}
