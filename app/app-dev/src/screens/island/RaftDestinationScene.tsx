import React from 'react';
import { useFonts } from 'expo-font';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { useAppLayout } from '@/utils/layout';
import { t } from '@/i18n';

const c = componentTokens.raftDestinations;

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={styles.arrow}
    >
      <Svg
        width={back ? c.backIconSize : c.forwardIconSize}
        height={back ? c.backIconSize : c.forwardIconSize}
        viewBox="0 0 24 24"
      >
        <Path
          d={back ? 'm14 5-7 7 7 7' : 'M4 12h15m-6-6 6 6-6 6'}
          fill="none"
          stroke={semanticTokens.color.text}
          strokeWidth={semanticTokens.stroke.strong}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

/** 1인칭 뗏목에서 집중섬과 지평선을 바라보는 이동 화면. 그림 속 표식과 노는 두지 않는다. */
export function RaftDestinationScene({
  visiting,
  selected,
  busy,
  onMembers,
  onSea,
  onFocus,
}: {
  visiting: boolean;
  selected?: string;
  busy: boolean;
  onMembers: () => void;
  onSea: () => void;
  onFocus: () => void;
}) {
  const L = useAppLayout();
  const reflow = L.fontScale > c.largeTextThreshold;
  const [fontLoaded] = useFonts({ RaftGowun: require('@/assets/fonts/gowun-dodum.ttf') });
  const font = fontLoaded ? { fontFamily: 'RaftGowun' } : undefined;
  const imageSize = L.landscape ? c.landscape : c;
  const source = L.landscape
    ? require('@/assets/ota/raft/destinations-landscape.png')
    : require('@/assets/ota/raft/destinations.png');
  const scale = Math.max(
    (L.width * c.imageBleedX) / imageSize.imageWidth,
    (L.height * c.imageBleedY) / imageSize.imageHeight,
  );
  const imageWidth = imageSize.imageWidth * scale,
    imageHeight = imageSize.imageHeight * scale;
  const top = Math.max(c.headerTop, L.insets.top + semanticTokens.spacing.control);
  const titleTop =
    top +
    (L.width < c.narrowWidth || L.fontScale > c.largeTextThreshold
      ? semanticTokens.size.tapMin
      : c.titleOffset);
  const choice = (kind: 'sea' | 'focus', action: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(kind === 'sea' ? 'home.raft.departSea' : 'home.raft.goFocus')}
      accessibilityState={{ disabled: busy, selected: selected === kind }}
      disabled={busy}
      onPress={action}
      style={({ pressed }) => [
        styles.choice,
        reflow
          ? [styles.flowChoice, { alignSelf: kind === 'sea' ? 'flex-end' : 'flex-start' }]
          : kind === 'sea'
            ? {
                right: Math.max(L.insets.right, L.width * c.choiceInset),
                top: L.height * c.seaTop,
                maxWidth:
                  L.width - L.insets.left - Math.max(L.insets.right, L.width * c.choiceInset),
              }
            : {
                left: Math.max(L.insets.left, L.width * c.choiceInset),
                top: L.height * c.focusTop,
                maxWidth:
                  L.width - L.insets.right - Math.max(L.insets.left, L.width * c.choiceInset),
              },
        { opacity: busy ? componentTokens.button.disabledOpacity : pressed ? c.pressedOpacity : 1 },
      ]}
    >
      <Txt style={[styles.choiceText, font, selected === kind && styles.selected]}>
        {t(kind === 'sea' ? 'home.raft.departSea' : 'home.raft.goFocus')}
      </Txt>
      <Arrow />
    </Pressable>
  );
  const heading = (
    <Txt
      accessibilityRole="header"
      style={[
        styles.heading,
        font,
        reflow ? styles.flowHeading : { top: titleTop, left: L.insets.left, right: L.insets.right },
      ]}
    >
      {t('home.raft.departureTitle')}
    </Txt>
  );
  const members = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.raft.myIslands')}
      disabled={busy}
      onPress={onMembers}
      style={[
        styles.members,
        reflow
          ? styles.flowMembers
          : { top, left: L.insets.left + semanticTokens.spacing.component },
      ]}
    >
      <Arrow back />
      <Txt style={[styles.membersText, font]}>{t('home.raft.myIslands')}</Txt>
    </Pressable>
  );
  const caption = !visiting && (
    <Txt
      style={[
        styles.caption,
        font,
        reflow
          ? styles.flowCaption
          : {
              top: L.height * c.focusTop + semanticTokens.size.tapMin + c.titleOffset,
              left: Math.max(L.insets.left, L.width * c.captionInset),
            },
      ]}
    >
      {t('home.raft.fishingIsland')}
    </Txt>
  );
  return (
    <View style={styles.scene}>
      <Image
        source={source}
        accessible={false}
        style={{
          position: 'absolute',
          width: imageWidth,
          height: imageHeight,
          left: (L.width - imageWidth) * c.imagePositionX,
          top: (L.height - imageHeight) / 2,
        }}
      />
      {reflow ? (
        // 큰 글자에서는 비율 좌표 대신 문서 흐름을 써 제목·행동이 겹치거나 화면 밖에서 잘리지 않게 한다.
        <ScrollView
          testID="raft-destination-scroll"
          contentContainerStyle={{
            paddingTop: top,
            paddingBottom: L.insets.bottom + semanticTokens.spacing.section,
            paddingLeft: L.insets.left + semanticTokens.spacing.component,
            paddingRight: L.insets.right + semanticTokens.spacing.component,
            gap: semanticTokens.spacing.section,
          }}
        >
          {members}
          {heading}
          {choice('sea', onSea)}
          {!visiting && choice('focus', onFocus)}
          {caption}
        </ScrollView>
      ) : (
        <>
          {heading}
          {members}
          {choice('sea', onSea)}
          {!visiting && choice('focus', onFocus)}
          {caption}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1, overflow: 'hidden', backgroundColor: semanticTokens.color.secondary },
  arrow: { flexShrink: 0 },
  flowChoice: { position: 'relative', maxWidth: '100%', minWidth: 0 },
  flowHeading: { position: 'relative' },
  flowMembers: { position: 'relative', alignSelf: 'flex-start', maxWidth: '100%' },
  flowCaption: { position: 'relative', marginLeft: semanticTokens.spacing.control },
  heading: {
    position: 'absolute',
    fontSize: c.titleSize,
    lineHeight: c.titleSize * 1.5,
    fontWeight: semanticTokens.typography.regular,
    textAlign: 'center',
    textShadowColor: c.textShadow,
    textShadowRadius: c.textShadowRadius.title,
  },
  members: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: c.inlineGap,
    minHeight: semanticTokens.size.tapMin,
    minWidth: semanticTokens.size.tapMin,
  },
  membersText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: semanticTokens.typography.caption,
    fontWeight: semanticTokens.typography.regular,
    textShadowColor: c.textShadow,
    textShadowRadius: c.textShadowRadius.members,
  },
  choice: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: componentTokens.homeNavigation.gap,
    minHeight: semanticTokens.size.tapMin,
    paddingHorizontal: semanticTokens.spacing.control,
  },
  choiceText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: c.choiceSize,
    lineHeight: c.choiceSize * 1.4,
    fontWeight: semanticTokens.typography.regular,
    textDecorationLine: 'underline',
    textShadowColor: c.textShadow,
    textShadowRadius: c.textShadowRadius.choice,
  },
  selected: { fontWeight: semanticTokens.typography.bold },
  caption: {
    position: 'absolute',
    fontSize: componentTokens.homeNavigation.clockSize,
    textShadowColor: c.textShadow,
    textShadowRadius: c.textShadowRadius.title,
  },
});
