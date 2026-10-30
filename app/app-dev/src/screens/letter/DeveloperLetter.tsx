import React, { useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Btn, Txt } from '@/design-system/patterns';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { assets } from '@/constants/assets';
import { t } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { useGowun } from '@/screens/island/sceneKit';
import { useScreenReaderEnabled } from '@/screens/island/NpcGuide';
import { useAppLayout } from '@/utils/layout';

const D = componentTokens.developerLetter;
const ENVELOPE = require('@/assets/ota/interiors/ui/letter-envelope.png');
const CATS = ['ginger', 'gray', 'calico'] as const;

/**
 * 운영진의 편지(GROMO-2615) — 앱 루트의 트리 내 오버레이(RN Modal 이 아니다). 봉투가 날아와 흔들리고, 누르면 편지지가
 * 올라온다. 바깥 터치는 삼키고 닫는 길은 `잘 읽었어요`와 Android 뒤로 가기(App 의 hardwareBack 첫 줄)뿐이다. 닫으면 부모가 바로 언마운트한다.
 * 폰 세로 잠금은 App 의 useRouteOrientation 이 건다. 가로로 떠 있으면 회전을 최대 portraitWaitMs 만 기다렸다가 봉투를 낸다.
 */
export function DeveloperLetter({
  title,
  body,
  date,
  onClose,
}: {
  title: string;
  body: string;
  date: Date;
  onClose: () => void;
}) {
  const layout = useAppLayout();
  // 동작 줄이기와 스크린 리더는 비행·흔들림을 건너뛴다(탭으로 여는 단계는 유지)
  const screenReader = useScreenReaderEnabled();
  const reduce = useContext(MotionContext) || screenReader;
  const bigText = layout.fontScale >= semanticTokens.typography.largeTextThreshold;
  const gowun = useGowun();
  const [waited, setWaited] = useState(false);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const fly = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const unfold = useRef(new Animated.Value(0)).current;
  const paper = useRef(new Animated.Value(0)).current;
  const staged = layout.tablet || layout.height >= layout.width || waited;

  useEffect(() => {
    const id = setTimeout(() => setWaited(true), D.portraitWaitMs);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    // 봉투가 처음 나타날 때 한 번 알린다(iOS 는 직접 읽고, 안드로이드는 봉투의 live region)
    if (staged && Platform.OS === 'ios')
      AccessibilityInfo.announceForAccessibility(t('developerLetter.envelopeLabel'));
  }, [staged]);
  useEffect(() => {
    if (!staged) return;
    if (reduce) {
      fly.setValue(1);
      return;
    }
    const swing = (to: number) =>
      Animated.timing(wiggle, { toValue: to, duration: D.wiggleMs, useNativeDriver: true });
    const animation = Animated.sequence([
      Animated.timing(fly, {
        toValue: 1,
        duration: D.flyMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([swing(-1), swing(1), swing(-0.6), swing(0.6), swing(0)]),
    ]);
    animation.start();
    return () => animation.stop();
  }, [staged, reduce, fly, wiggle]);
  useEffect(() => {
    if (!open) return;
    if (reduce) {
      setOpened(true);
      return;
    }
    const animation = Animated.timing(unfold, {
      toValue: 1,
      duration: D.openMs,
      easing: Easing.bezier(0.16, 0.8, 0.25, 1),
      useNativeDriver: true,
    });
    animation.start(() => setOpened(true));
    return () => animation.stop();
  }, [open, reduce, unfold]);
  useEffect(() => {
    if (opened && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(title);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열린 순간 한 번
  }, [opened]);
  useEffect(() => {
    if (!opened) return;
    if (reduce) {
      paper.setValue(1);
      return;
    }
    const animation = Animated.timing(paper, {
      toValue: 1,
      duration: D.openMs,
      easing: Easing.bezier(0.16, 0.8, 0.25, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opened, reduce, paper]);

  const width = Math.min(D.maxWidth, layout.width - D.margin * 2);
  const text = { fontFamily: gowun, color: semanticTokens.color.text };
  const muted = {
    ...text,
    fontSize: D.metaSize,
    textAlign: 'center' as const,
    color: semanticTokens.color.textMuted,
  };

  return (
    <View
      testID="developer-letter"
      accessibilityViewIsModal
      aria-modal
      style={[styles.root, { backgroundColor: componentTokens.overlay.background }]}
    >
      {/* 바깥 터치는 삼키기만 한다 */}
      <Pressable accessible={false} style={StyleSheet.absoluteFill} />
      {!opened && staged && (
        <Animated.View
          accessibilityLiveRegion="polite"
          style={{
            alignItems: 'center',
            gap: D.stackGap,
            opacity: unfold.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [
              {
                translateX: fly.interpolate({
                  inputRange: [0, 1],
                  outputRange: [layout.width / 2, 0],
                }),
              },
              {
                translateY: Animated.add(
                  fly.interpolate({ inputRange: [0, 1], outputRange: [-layout.height / 2, 0] }),
                  unfold.interpolate({ inputRange: [0, 1], outputRange: [0, 80] }),
                ),
              },
              {
                rotate: wiggle.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] }),
              },
            ],
          }}
        >
          <Pressable
            testID="developer-letter-envelope"
            accessibilityRole="button"
            accessibilityLabel={t('developerLetter.envelopeLabel')}
            disabled={open}
            onPress={() => setOpen(true)}
            style={{ alignItems: 'center', gap: D.stackGap }}
          >
            <Image
              source={ENVELOPE}
              style={{ width: D.envelopeWidth, height: D.envelopeWidth / D.envelopeAspect }}
            />
            <Txt
              tabletScale={1}
              style={{ ...text, fontSize: D.bodySize, color: semanticTokens.color.canvas }}
            >
              {t('developerLetter.tapToOpen')}
            </Txt>
          </Pressable>
        </Animated.View>
      )}
      {opened && (
        <Animated.View
          accessibilityLiveRegion="polite"
          style={{
            alignItems: 'center',
            gap: D.gap,
            opacity: paper,
            transform: [
              { translateY: paper.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
            ],
          }}
        >
          <View
            testID="developer-letter-paper"
            style={{
              width,
              maxHeight: layout.height * D.maxHeightRatio,
              paddingTop: D.padding.top,
              paddingHorizontal: D.padding.side,
              paddingBottom: D.padding.bottom,
              borderRadius: D.radius,
              borderWidth: D.borderWidth,
              borderColor: semanticTokens.color.outline,
              backgroundColor: semanticTokens.color.canvas,
            }}
          >
            {/* 큰 글자에서는 고정 영역이 높이 상한을 채워 본문이 0 이 되지 않도록 전체를 한 스크롤에 넣는다 */}
            {bigText ? (
              <ScrollView
                testID="developer-letter-body"
                style={{ flexGrow: 0, flexShrink: 1 }}
                showsVerticalScrollIndicator
              >
                <Txt tabletScale={1} style={muted}>
                  {t('developerLetter.from')}
                </Txt>
                <Txt
                  tabletScale={1}
                  accessibilityRole="header"
                  style={{
                    ...text,
                    fontSize: D.titleSize,
                    fontWeight: '700',
                    textAlign: 'center',
                    marginTop: D.titleGapTop,
                  }}
                >
                  {title}
                </Txt>
                <Txt
                  tabletScale={1}
                  style={{ ...muted, marginTop: D.dateGapTop, marginBottom: D.dateGapBottom }}
                >
                  {formatDate(date, { month: 'long', day: 'numeric' })}
                </Txt>
                <Txt
                  tabletScale={1}
                  style={{ ...text, fontSize: D.bodySize, lineHeight: D.bodyLineHeight }}
                >
                  {body}
                </Txt>
                <View style={{ marginTop: D.signGapTop }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    {CATS.map((color, i) => (
                      <Image
                        testID="developer-letter-cat"
                        accessible={false}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                        key={color}
                        source={assets[`characters/cat/${color}/idle.png`]}
                        style={{ width: D.cat, height: D.cat, marginLeft: i ? -D.catOverlap : 0 }}
                      />
                    ))}
                  </View>
                  <Txt
                    tabletScale={1}
                    style={{ ...text, fontSize: D.signSize, textAlign: 'right' }}
                  >
                    {t('developerLetter.signature')}
                  </Txt>
                </View>
              </ScrollView>
            ) : (
              <>
                <Txt tabletScale={1} style={muted}>
                  {t('developerLetter.from')}
                </Txt>
                <Txt
                  tabletScale={1}
                  accessibilityRole="header"
                  style={{
                    ...text,
                    fontSize: D.titleSize,
                    fontWeight: '700',
                    textAlign: 'center',
                    marginTop: D.titleGapTop,
                  }}
                >
                  {title}
                </Txt>
                <Txt
                  tabletScale={1}
                  style={{ ...muted, marginTop: D.dateGapTop, marginBottom: D.dateGapBottom }}
                >
                  {formatDate(date, { month: 'long', day: 'numeric' })}
                </Txt>
                {/* 버튼은 편지 바깥이라 긴 본문만 이 안에서 스크롤한다 */}
                <ScrollView
                  testID="developer-letter-body"
                  style={{ flexGrow: 0, flexShrink: 1 }}
                  showsVerticalScrollIndicator
                >
                  <Txt
                    tabletScale={1}
                    style={{ ...text, fontSize: D.bodySize, lineHeight: D.bodyLineHeight }}
                  >
                    {body}
                  </Txt>
                </ScrollView>
                <View style={{ marginTop: D.signGapTop }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    {CATS.map((color, i) => (
                      <Image
                        testID="developer-letter-cat"
                        accessible={false}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                        key={color}
                        source={assets[`characters/cat/${color}/idle.png`]}
                        style={{ width: D.cat, height: D.cat, marginLeft: i ? -D.catOverlap : 0 }}
                      />
                    ))}
                  </View>
                  <Txt
                    tabletScale={1}
                    style={{ ...text, fontSize: D.signSize, textAlign: 'right' }}
                  >
                    {t('developerLetter.signature')}
                  </Txt>
                </View>
              </>
            )}
          </View>
          <Btn
            id="developer-letter-confirm"
            title={t('developerLetter.confirm')}
            font={gowun}
            onPress={onClose}
            style={{ width: Math.min(D.buttonMaxWidth, layout.width - 96) }}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    zIndex: 20000,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
