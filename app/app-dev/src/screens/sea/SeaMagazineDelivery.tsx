import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Btn, Txt } from '@/design-system/patterns';
import { useScreenInsets } from '@/design-system/primitives';
import {
  componentTokens as c,
  primitiveTokens as p,
  semanticTokens as s,
} from '@/design-system/tokens';
import { VideoCutscene } from '@/components/VideoCutscene';
import { assets } from '@/constants/assets';
import { MAGAZINE_UI } from '@/constants/magazineAssets';
import { t } from '@/i18n';
import { seaAssets } from './seaAssets';

const D = c.magazineReader.seaDelivery;
const PELICAN_MAIL = require('@/assets/ota/cutscenes/pelican-mail.mp4');

/**
 * 바다 위 펠리컨 배달(GROMO-2314 · Figma B1 `1228:1308`) — 표류 중 아직 받지 않은 오늘 호가 있으면 `SeaScreen` 이
 * 다른 창이 없을 때 화면 전체로 띄운다. 먼저 펠리컨 배달 영상(5초)을 보여 주고, 끝나면 말풍선·버튼을 띄운다.
 * 영상이 시작된 순간이 «실제로 뜬 순간» — 그때 `onShown` 을 한 번 부르고(호스트가 받음 SEA 를 적는다)
 * 스크린리더에 문구를 한 번 알린다(iOS 는 직접 읽고, 안드로이드는 말풍선 문구의 live region).
 * 영상 구간의 접근성 라벨은 같은 문구가 겹쳐 읽히지 않게 장면 설명이다.
 * 그림은 402×874 기준 크기를 화면에 맞춰 줄이고, 큰 글자·가로 화면에서 넘치면 세로로 민다.
 */
export function SeaMagazineDelivery({
  onShown,
  onOpen,
  onLater,
}: {
  onShown: () => void;
  onOpen: () => void;
  onLater: () => void;
}) {
  const insets = useScreenInsets();
  const title = t('magazine.delivery.noMailbox');
  // 첫 그림은 창 크기로 — onLayout 전 기준 크기(402×874)로 그렸다가 튀지 않게
  const screen = useWindowDimensions();
  const [intro, setIntro] = useState(true);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const { width, height } = box ?? screen;
  const k = Math.min(1, width / D.referenceWidth, height / D.referenceHeight);
  useEffect(() => {
    onShown();
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(title);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 뜬 순간 한 번
  }, []);
  return (
    <View
      testID="sea-magazine-delivery"
      accessibilityViewIsModal
      role="dialog"
      aria-modal
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setBox(event.nativeEvent.layout)}
    >
      {intro ? (
        <VideoCutscene
          source={PELICAN_MAIL}
          accessibilityLabel={t('magazine.delivery.seaCutscene')}
          testID="sea-magazine-cutscene"
          onFinish={() => setIntro(false)}
        />
      ) : (
        <>
          <Image
            source={seaAssets.background}
            resizeMode="cover"
            accessible={false}
            style={[StyleSheet.absoluteFill, { width, height }]}
          />
          <ScrollView
            bounces={false}
            contentContainerStyle={[
              styles.content,
              {
                paddingTop: insets.top + p.space[6],
                paddingBottom: Math.max(insets.bottom, p.space[6]),
                paddingLeft: insets.left + p.space[5],
                paddingRight: insets.right + p.space[5],
              },
            ]}
          >
            <View style={styles.scene}>
              <View style={styles.bubble}>
                <Txt
                  accessibilityRole="header"
                  accessibilityLiveRegion="polite"
                  style={styles.text}
                >
                  {title}
                </Txt>
                {/* 꼬리는 왼쪽 아래 펠리컨 쪽 */}
                <View style={styles.tail} accessible={false} />
              </View>
              <View style={styles.art}>
                <Image
                  source={assets['characters/pelican/npc/idle.png']}
                  resizeMode="contain"
                  accessible={false}
                  style={{ width: D.pelican * k, height: D.pelican * k }}
                />
                <Image
                  source={MAGAZINE_UI.cover}
                  resizeMode="contain"
                  accessible={false}
                  style={{
                    width: D.cover.width * k,
                    height: D.cover.height * k,
                    marginLeft: -D.overlap * k,
                    transform: [{ rotate: D.coverTilt }],
                  }}
                />
              </View>
            </View>
            <View style={styles.actions}>
              <Btn
                id="sea-magazine-open"
                dynamicHeight
                title={t('magazine.delivery.open')}
                onPress={onOpen}
              />
              <Btn
                id="sea-magazine-later"
                dynamicHeight
                kind="ghost"
                title={t('magazine.delivery.readLater')}
                onPress={onLater}
              />
            </View>
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'space-between', gap: p.space[6] },
  scene: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: p.space[4] },
  bubble: {
    maxWidth: D.bubbleMaxWidth,
    paddingHorizontal: p.space[8],
    paddingVertical: p.space[8],
    backgroundColor: s.color.surface,
    borderWidth: s.stroke.strong,
    borderColor: s.color.outline,
    borderRadius: D.bubbleRadius,
    boxShadow: D.shadow,
  },
  text: { fontSize: s.typography.title, lineHeight: D.textLineHeight, textAlign: 'center' },
  tail: {
    position: 'absolute',
    left: D.tailLeft,
    bottom: -D.tail / 2 - s.stroke.strong,
    width: D.tail,
    height: D.tail,
    backgroundColor: s.color.surface,
    borderRightWidth: s.stroke.strong,
    borderBottomWidth: s.stroke.strong,
    borderColor: s.color.outline,
    transform: [{ rotate: '45deg' }],
  },
  art: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  actions: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: D.actionMaxWidth,
    gap: p.space[2],
  },
});
