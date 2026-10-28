import React from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { Btn, Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { useAppLayout } from '@/utils/layout';
import { t } from '@/i18n';
import { useGowun } from './sceneKit';

const c = componentTokens.raftDestinations;

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
  // 앱에 넣어 둔 고운돋움(sceneKit 의 GOWUN) — 글꼴 파일을 따로 불러오면 네이티브 번들에 한 번 더 들어간다
  const font = { fontFamily: useGowun() };
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
  // 목적지는 바다 위 보조 버튼(Btn glass). 마지막에 고른 목적지만 Primary(Pink)로 칠해 선택을 보인다 — 한 화면에 Primary 는 하나
  const choice = (kind: 'sea' | 'focus', action: () => void) => (
    <Btn
      kind={selected === kind ? '' : 'glass'}
      title={t(kind === 'sea' ? 'home.raft.departSea' : 'home.raft.goFocus')}
      selected={selected === kind}
      disabled={busy}
      dynamicHeight={reflow}
      onPress={action}
      style={
        reflow
          ? [styles.flowChoice, { alignSelf: kind === 'sea' ? 'flex-end' : 'flex-start' }]
          : kind === 'sea'
            ? {
                position: 'absolute',
                right: Math.max(L.insets.right, L.width * c.choiceInset),
                top: L.height * c.seaTop,
                maxWidth:
                  L.width - L.insets.left - Math.max(L.insets.right, L.width * c.choiceInset),
              }
            : {
                position: 'absolute',
                left: Math.max(L.insets.left, L.width * c.choiceInset),
                top: L.height * c.focusTop,
                maxWidth:
                  L.width - L.insets.right - Math.max(L.insets.left, L.width * c.choiceInset),
              }
      }
    />
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
    <Btn
      small
      kind="glass"
      title={t('home.raft.myIslands')}
      disabled={busy}
      dynamicHeight={reflow}
      onPress={onMembers}
      style={
        reflow
          ? styles.flowMembers
          : {
              position: 'absolute',
              top,
              left: L.insets.left + semanticTokens.spacing.component,
            }
      }
    />
  );
  const caption = !visiting && (
    <Txt
      style={[
        styles.caption,
        font,
        reflow
          ? styles.flowCaption
          : {
              top: L.height * c.focusTop + componentTokens.button.height + c.titleOffset,
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
  flowChoice: { maxWidth: '100%', minWidth: 0 },
  flowHeading: { position: 'relative' },
  flowMembers: { alignSelf: 'flex-start', maxWidth: '100%' },
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
  caption: {
    position: 'absolute',
    fontSize: componentTokens.homeNavigation.clockSize,
    textShadowColor: c.textShadow,
    textShadowRadius: c.textShadowRadius.title,
  },
});
