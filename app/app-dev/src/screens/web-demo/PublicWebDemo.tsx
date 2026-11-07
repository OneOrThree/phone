import { usesSharedWebIsland } from '@/services/webIsland';
import React, { useEffect, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Btn, Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens as s } from '@/design-system/tokens';
import { STORE_URLS } from '@/services/developerLetter';
import { useGowunFont } from '@/screens/island/sceneKit';
import { PolicyLinks } from '@/components/PolicyLink';
import {
  captureWebDemoEvent,
  setWebDemoAnalyticsEnabled,
  webDemoAnalyticsEnabled,
} from '@/services/webDemoAnalytics';

const layout = componentTokens.publicWebDemo;

/**
 * 체험 앱 번들을 소개 화면이 다 뜬 뒤(load) 미리 받아 둔다(GROMO-2788).
 * 주소는 web-demo/build.cjs가 meta로 넣는다. 받기만 하고 실행하지 않으며, 시작하기를 누르면 iframe이 캐시에서 쓴다.
 * 데이터 절약 모드나 2G 회선에서는 시작하지 않을 수도 있는 사용자에게 받게 하지 않는다.
 */
export function usePrefetchAppBundle(doc: Document = document, win: Window = window) {
  useEffect(() => {
    const href = doc.querySelector<HTMLMetaElement>('meta[name="cattus-app-bundle"]')?.content;
    if (!href) return;
    const connection = (
      win.navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return;
    const prefetch = () => {
      // 다시 마운트돼도 같은 링크를 쌓지 않는다.
      if (doc.head.querySelector(`link[rel="prefetch"][href="${href}"]`)) return;
      const link = doc.createElement('link');
      link.rel = 'prefetch';
      link.as = 'script';
      link.href = href;
      doc.head.appendChild(link);
    };
    if (doc.readyState === 'complete') {
      prefetch();
      return;
    }
    win.addEventListener('load', prefetch, { once: true });
    return () => win.removeEventListener('load', prefetch);
  }, [doc, win]);
}

export default function PublicWebDemo() {
  useGowunFont();
  usePrefetchAppBundle();
  const [started, setStarted] = useState(false);
  const [help, setHelp] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(webDemoAnalyticsEnabled);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const { width, height } = useWindowDimensions();
  const compact = width < layout.compactBreakpoint;
  const edgeToEdge = compact || height < layout.shortViewportHeight;
  const framePadding = edgeToEdge ? 0 : s.spacing.page;
  const canvasWidth = compact ? layout.phoneCanvasWidth : layout.frameMaxWidth;
  const canvasHeight = layout.frameMaxWidth / layout.frameAspectRatio;
  const availableWidth = Math.max(0, stage.width - framePadding * 2);
  const availableHeight = Math.max(0, stage.height - framePadding * 2);
  const scale = Math.min(1, availableWidth / canvasWidth, availableHeight / canvasHeight);
  const frameWidth = canvasWidth * scale;
  const frameHeight = canvasHeight * scale;
  const contentWidth = Math.min(canvasWidth - s.spacing.page * 2, layout.contentMaxWidth);
  const heroWidth = compact ? contentWidth : (contentWidth - s.spacing.section) / 2;
  const openStore = (platform: 'ios' | 'android') => {
    captureWebDemoEvent('store_clicked', {
      platform,
      placement: started ? 'experience_help' : 'landing',
    });
    void Linking.openURL(STORE_URLS[platform]);
  };
  const analyticsNotice = (
    <View style={styles.privacy}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="개인정보·분석 설정"
        accessibilityState={{ expanded: privacyOpen }}
        onPress={() => setPrivacyOpen(!privacyOpen)}
        style={styles.privacyLink}
      >
        <Txt kind="meta" style={styles.linkText}>
          개인정보·분석 설정
        </Txt>
      </Pressable>
      {privacyOpen && (
        <>
          <Txt kind="meta">
            서비스 개선을 위해 랜덤 브라우저 식별자와 유입 경로·화면 이동·집중 시간·앱 설치 버튼
            클릭을 PostHog로 분석해요. 분석에 이름·입력한 할 일·채팅 본문은 보내지 않아요.
          </Txt>
          <Btn
            small
            kind="secondary"
            title={analyticsEnabled ? '사용 분석 끄기' : '사용 분석 켜기'}
            onPress={() => {
              setWebDemoAnalyticsEnabled(!analyticsEnabled);
              setAnalyticsEnabled(!analyticsEnabled);
            }}
          />
          <PolicyLinks />
        </>
      )}
    </View>
  );
  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <View style={styles.bar}>
          <View style={styles.label}>
            <Txt style={styles.brand}>집중할고양 · cattus</Txt>
            <Txt kind="meta">고양이와 함께하는 집중 시간</Txt>
          </View>
          <Btn
            small
            kind="secondary"
            title={help ? '닫기' : '앱 기능·안내'}
            accessibilityLabel={help ? '이용 안내 닫기' : '이용 안내와 앱 설치'}
            onPress={() => {
              captureWebDemoEvent(help ? 'help_closed' : 'help_opened');
              setHelp(!help);
            }}
          />
        </View>
        <View
          style={styles.stage}
          onLayout={({ nativeEvent: { layout: measured } }) => {
            setStage((previous) =>
              previous.width === measured.width && previous.height === measured.height
                ? previous
                : { width: measured.width, height: measured.height },
            );
          }}
        >
          <div
            data-testid="web-viewport"
            style={{
              position: 'relative',
              width: frameWidth,
              height: frameHeight,
              overflow: 'hidden',
              flexShrink: 0,
              borderRadius: edgeToEdge ? 0 : s.radius.preview,
            }}
          >
            <div
              data-testid="web-canvas"
              style={{
                display: 'flex',
                flexDirection: 'column',
                position: 'absolute',
                top: 0,
                left: 0,
                width: canvasWidth,
                height: canvasHeight,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            >
              {started ? (
                <iframe
                  title="집중할고양 — 고양이를 고르고 섬에서 함께 집중하기"
                  src="/experience.html"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    border: 0,
                    backgroundColor: s.color.surface,
                  }}
                  allow="autoplay"
                />
              ) : (
                <View style={styles.landing}>
                  <View style={[styles.content, !compact && styles.wide]}>
                    <View style={styles.copy}>
                      <Txt kind="meta">집중할고양 · cattus</Txt>
                      <Txt accessibilityRole="header" style={styles.title}>
                        잠깐, 고양이가 되어{'\n'}집중해 볼까요?
                      </Txt>
                      <Txt>고양이로 섬을 산책하고, 낚시하며 나만의 집중 시간을 만들어 보세요.</Txt>
                      <Btn
                        title="웹에서 시작하기"
                        onPress={() => {
                          captureWebDemoEvent('experience_started');
                          setHelp(false);
                          setStarted(true);
                        }}
                      />
                      <Txt kind="meta">
                        {usesSharedWebIsland()
                          ? '설치 없이 시작 · 같은 섬에서 함께 집중'
                          : '설치 없이 시작 · 나만의 고양이와 첫 항해'}
                      </Txt>
                    </View>
                    <Image
                      source={require('@/assets/reference-v2/L-home-05-final-shop.jpg')}
                      accessibilityLabel="바다에 둘러싸인 집중할고양의 섬과 건물"
                      style={[
                        styles.hero,
                        { width: heroWidth, height: heroWidth / layout.heroAspectRatio },
                      ]}
                      resizeMode="cover"
                    />
                  </View>
                  <View style={styles.actions}>
                    <Btn
                      title="Google Play에서 받기"
                      kind="secondary"
                      onPress={() => openStore('android')}
                    />
                    <Btn
                      title="App Store에서 받기"
                      kind="secondary"
                      onPress={() => openStore('ios')}
                    />
                  </View>
                </View>
              )}
            </div>
          </div>
        </View>
        {help && (
          <ScrollView style={styles.help} contentContainerStyle={styles.helpContent}>
            <Txt>길을 누르면 고양이가 걸어요. 건물과 뗏목을 눌러 섬을 둘러보세요.</Txt>
            <Txt>
              집중 시작 → 낚시섬의 빈 땅 선택 → 집중 시작 → 오늘의 할 일 입력 → 집중 시작 순서로
              시작해요. 종료하기를 1.5초 동안 길게 누르면 집중을 마칠 수 있어요.
            </Txt>
            <Txt>
              {usesSharedWebIsland()
                ? '고양이와 이름을 고르면 모두 같은 웹 전용 섬에서 함께 집중해요.'
                : '웹에서도 고양이를 고르고 섬을 찾아 함께 집중할 수 있어요.'}{' '}
              게스트로 시작하면 이 브라우저에서 이어서 이용해요. 브라우저 데이터를 지우면 게스트
              계정에 다시 들어오지 못할 수 있어요.
            </Txt>
            <Txt accessibilityRole="header" kind="h">
              앱에서 더 깊이 집중해요
            </Txt>
            <Txt>
              AI 집중 측정, 휴대폰 사용 시간 측정과 홈 화면 위젯은 모바일 앱에서 이용할 수 있어요.
              iPhone에서는 집중 중 다른 앱도 차단할 수 있어요.
            </Txt>
            <View style={styles.actions}>
              <Btn title="Google Play" onPress={() => openStore('android')} />
              <Btn title="App Store" kind="secondary" onPress={() => openStore('ios')} />
            </View>
            {analyticsNotice}
          </ScrollView>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', backgroundColor: s.color.canvas },
  stage: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landing: {
    flex: 1,
    padding: s.spacing.page,
    gap: s.spacing.section,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { width: '100%', maxWidth: layout.contentMaxWidth, gap: s.spacing.section },
  wide: { flexDirection: 'row', alignItems: 'center' },
  copy: {
    flexShrink: 1,
    gap: s.spacing.component,
    maxWidth: layout.copyMaxWidth,
  },
  title: {
    fontSize: s.typography.display,
    lineHeight: layout.headingLineHeight,
    fontWeight: s.typography.extraBold,
  },
  hero: {
    maxWidth: layout.heroMaxWidth,
    borderRadius: s.radius.preview,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: s.spacing.control },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s.spacing.control,
    paddingHorizontal: s.spacing.page,
    paddingVertical: s.spacing.control,
    backgroundColor: s.color.surface,
  },
  brand: { fontWeight: s.typography.bold },
  privacy: { gap: s.spacing.control },
  privacyLink: { minHeight: s.size.tapMin, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { textDecorationLine: 'underline' },
  label: { flex: 1 },
  help: {
    position: 'absolute',
    bottom: s.spacing.control,
    alignSelf: 'center',
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    maxHeight: '70%',
    backgroundColor: s.color.surface,
    borderWidth: s.stroke.subtle,
    borderColor: s.color.divider,
    borderRadius: s.radius.card,
  },
  helpContent: { padding: s.spacing.page, gap: s.spacing.control },
});
