import { PolicyLinks } from '@/components/PolicyLink';
import { Btn, C, Field, Pic, Txt, k } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { LoginScreen } from '@/screens/LoginScreen';
import { WebIslandEntry } from '@/screens/web-demo/WebIslandEntry';
import { OnboardingFlow } from '@/screens/onboarding/OnboardingFlow';
import { updateProfile } from '@/services/api/account';
import { uuid } from '@/services/api/client';
import { getSession } from '@/services/api/session';
import { Color } from '@/services/model';
import { stripNicknameWhitespace } from '@/utils/nickname';
import { Pressable, ScrollView, View } from 'react-native';
import { AvatarGrid, H17, H22, INP, META, Onboard } from '../island/navigation/screenParts';
import type { ScreenContext } from '../island/navigation/useScreenState';

const SEC = {
  fontSize: 13,
  lineHeight: 18.85,
  fontWeight: '700',
  color: C.muted,
  letterSpacing: 0.26,
} as const;
export function renderEntryScreens(context: ScreenContext) {
  const {
    route,
    e,
    terms,
    setTerms,
    act,
    state,
    home,
    go,
    layout,
    ins,
    back,
    serverBusy,
    server,
    characterSaveIntent,
    run,
    routeNowRef,
    serverError,
  } = context;

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

  if (route === 'character' && !state.onboarded)
    return <OnboardingFlow key={getSession()?.userId ?? 'preview'} e={e} />;

  if (route === 'character')
    return (
      <Onboard
        title={t('character.title')}
        back={back}
        hideCtaOnKeyboard
        leftBg={C.soft}
        left={
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Pic id="cat/black/sitting" w={170} />
            <Txt style={H17}>{t('character.greeting')}</Txt>
            <Txt kind="meta" style={META}>
              {t('character.furColorLaterCompact')}
            </Txt>
          </View>
        }
        cta={
          <Btn
            title={t('character.startWithCat')}
            disabled={!state.name || serverBusy}
            onPress={() => {
              if (!server) {
                // 목업·데모 흐름 — 서버 계정이 없어 PATCH 할 곳이 없다.
                go('sea');
                return;
              }
              // 서버 모드: GET /me.onboardingComplete는 PATCH /me(name+catColor)로만 true가 된다.
              // 여기서 저장하지 않으면 이번 세션은 로컬 state.onboarded만으로 홈에 들어가지만,
              // 재실행 복구(restoredRoute)는 서버 값을 정본으로 봐서 이 화면으로 되돌아간다.
              const name = state.name;
              const signature = JSON.stringify([name, state.color]);
              if (characterSaveIntent.current?.signature !== signature)
                characterSaveIntent.current = { signature, key: uuid() };
              const intent = characterSaveIntent.current;
              run(() =>
                updateProfile({ name, catColor: state.color }, intent.key).then((saved) => {
                  if (characterSaveIntent.current?.key === intent.key)
                    characterSaveIntent.current = null;
                  act('PROFILE', {
                    name: saved.name ?? name,
                    color: saved.catColor ?? state.color,
                  });
                  // 저장이 늦어 그 사이 뒤로 가기 등으로 화면을 떠났다면 다시 끌어오지 않는다
                  if (routeNowRef.current === 'character') go('sea');
                }),
              );
            }}
          />
        }
      >
        {!layout.compact && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 }}>
            <Pic id="cat/black/sitting" w={84} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt style={H22}>{t('character.greeting')}</Txt>
              <Txt kind="meta" style={META}>
                {t('character.furColorLaterFull')}
              </Txt>
            </View>
          </View>
        )}
        {serverError ? (
          <Txt kind="meta" style={[META, { color: C.danger }]}>
            {serverError}
          </Txt>
        ) : null}
        <Txt style={[SEC, { marginTop: layout.compact ? 0 : 6 }]}>{t('character.whichCat')}</Txt>
        <AvatarGrid
          six={layout.compact}
          value={state.color}
          disabled={serverBusy}
          // 저장 요청이 오가는 동안은 입력을 잠가, 응답이 화면의 새 값을 되돌리지 않게 한다
          onChange={(color: Color) => {
            if (!serverBusy) act('PROFILE', { color });
          }}
        />
        <Field
          label={t('account.profile.nickname')}
          placeholder={t('account.profile.nicknamePlaceholder')}
          value={state.name}
          disabled={serverBusy}
          onChange={(name: string) => {
            if (!serverBusy) act('PROFILE', { name: stripNicknameWhitespace(name) });
          }}
          inputStyle={INP}
        />
      </Onboard>
    );
}
