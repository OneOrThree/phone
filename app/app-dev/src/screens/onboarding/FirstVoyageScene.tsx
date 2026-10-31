import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Btn, Txt } from '@/design-system/patterns';
import { MotionContext, useScreenInsets } from '@/design-system/primitives';
import { primitiveTokens as p, semanticTokens as s } from '@/design-system/tokens';
import { GuideBox, useScreenReaderEnabled } from '@/screens/island/NpcGuide';
import { SeaScene } from '@/screens/sea/SeaScene';
import type { SeaParticipant } from '@/screens/sea/seaModel';
import { t } from '@/i18n';

export const FIRST_VOYAGE_MS = 5000;

/** 첫 항해만의 목업이다. 실제 방·친구 API에 연결하지 않는다. */
export function FirstVoyageScene({
  self,
  destination,
  onArrive,
  error,
  pending,
  onChooseAgain,
}: {
  self: SeaParticipant;
  destination: string;
  onArrive: () => void;
  error: string;
  pending: boolean;
  onChooseAgain?: () => void;
}) {
  const reduceMotion = useContext(MotionContext);
  const nativeScreenReader = useScreenReaderEnabled();
  // RN Web은 실제 보조기기 사용 여부를 알 수 없어 항상 true를 돌려준다.
  const screenReader = Platform.OS !== 'web' && nativeScreenReader;
  const insets = useScreenInsets();
  const { width, height } = useWindowDimensions();
  const compact = width > height && height < 660;
  const [ready, setReady] = useState(false);
  const [footer, setFooter] = useState(0);
  const arrival = useRef(onArrive);
  const autoArrived = useRef(false);
  arrival.current = onArrive;
  useEffect(() => {
    let remaining = FIRST_VOYAGE_MS;
    let startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      startedAt = Date.now();
      timer = setTimeout(() => setReady(true), remaining);
    };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (!timer) start();
      } else if (timer) {
        clearTimeout(timer);
        timer = undefined;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (ready && !screenReader && !error && !autoArrived.current) {
      autoArrived.current = true;
      arrival.current();
    }
  }, [ready, screenReader, error]);
  const peer: SeaParticipant = {
    userId: 'first-voyage-example',
    name: t('firstVoyage.peerName'),
    color: self.color === 'white' ? 'ginger' : 'white',
    focusing: true,
    activeSeconds: 0,
    message: t('firstVoyage.peerMessage'),
  };
  return (
    <View testID="first-voyage" style={styles.root}>
      <View
        style={styles.root}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <SeaScene
          self={{ ...self, focusing: true }}
          participants={[peer]}
          focusing
          compact={compact}
          footerHeight={compact ? 0 : footer}
          reduceMotion={reduceMotion}
          onParticipant={() => {}}
          onMessage={() => {}}
        />
      </View>
      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, p.space[4]), left: compact ? width / 3 : 0 },
        ]}
        onLayout={(event) => setFooter(event.nativeEvent.layout.height)}
      >
        <Txt style={styles.heading}>{t('firstVoyage.destination', { name: destination })}</Txt>
        <GuideBox character={null} text={t('firstVoyage.meeting')} style={{ position: 'relative' }}>
          {error ? (
            <>
              <Txt accessibilityRole="alert">{error}</Txt>
              <Btn
                id="first-voyage-retry"
                title={t('onboardingStory.retry')}
                onPress={onArrive}
                disabled={pending}
              />
              {onChooseAgain && (
                <Btn kind="ghost" title={t('firstVoyage.chooseAgain')} onPress={onChooseAgain} />
              )}
            </>
          ) : ready && screenReader ? (
            <Btn title={t('openSea.disembark')} onPress={onArrive} disabled={pending} />
          ) : (
            <Txt accessibilityLiveRegion="polite">
              {t(pending ? 'openSea.entering' : 'firstVoyage.sailing')}
            </Txt>
          )}
        </GuideBox>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: p.space[4],
    gap: p.space[3],
  },
  heading: { textAlign: 'center', color: s.color.text, fontSize: p.fontSize.lg },
});
