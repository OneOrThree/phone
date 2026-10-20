import React from 'react';
import { useFonts } from 'expo-font';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { useAppLayout } from '@/utils/layout';
import { t } from '@/i18n';

const c = componentTokens.raftDestinations;

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width={back ? 13 : 18} height={back ? 13 : 18} viewBox="0 0 24 24">
        <Path
          d={back ? 'm14 5-7 7 7 7' : 'M4 12h15m-6-6 6 6-6 6'}
          fill="none"
          stroke={semanticTokens.color.text}
          strokeWidth={2}
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
  const [fontLoaded] = useFonts({ RaftGowun: require('@/assets/fonts/gowun-dodum.ttf') });
  const font = fontLoaded ? { fontFamily: 'RaftGowun' } : undefined;
  const imageSize = L.landscape ? c.landscape : c;
  const source = L.landscape
    ? require('@/assets/ota/raft/destinations-landscape.png')
    : require('@/assets/ota/raft/destinations.png');
  const scale = Math.max(
    (L.width * 1.04) / imageSize.imageWidth,
    (L.height * 1.02) / imageSize.imageHeight,
  );
  const imageWidth = imageSize.imageWidth * scale,
    imageHeight = imageSize.imageHeight * scale;
  const top = Math.max(c.headerTop, L.insets.top + semanticTokens.spacing.control);
  const titleTop =
    top + (L.width < 350 || L.fontScale > 1.2 ? semanticTokens.size.tapMin : c.titleOffset);
  const choice = (kind: 'sea' | 'focus', action: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(kind === 'sea' ? 'home.raft.departSea' : 'home.raft.goFocus')}
      accessibilityState={{ disabled: busy, selected: selected === kind }}
      disabled={busy}
      onPress={action}
      style={({ pressed }) => [
        styles.choice,
        kind === 'sea'
          ? { right: Math.max(L.insets.right, L.width * c.choiceInset), top: L.height * c.seaTop }
          : { left: Math.max(L.insets.left, L.width * c.choiceInset), top: L.height * c.focusTop },
        { opacity: busy ? componentTokens.button.disabledOpacity : pressed ? 0.7 : 1 },
      ]}
    >
      <Txt style={[styles.choiceText, font, selected === kind && styles.selected]}>
        {t(kind === 'sea' ? 'home.raft.departSea' : 'home.raft.goFocus')}
      </Txt>
      <Arrow />
    </Pressable>
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
      <Txt
        style={[
          styles.heading,
          font,
          { top: titleTop, left: L.insets.left, right: L.insets.right },
        ]}
      >
        {t('home.raft.departureTitle')}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.raft.myIslands')}
        disabled={busy}
        onPress={onMembers}
        style={[styles.members, { top, left: L.insets.left + semanticTokens.spacing.component }]}
      >
        <Arrow back />
        <Txt style={[styles.membersText, font]}>{t('home.raft.myIslands')}</Txt>
      </Pressable>
      {choice('sea', onSea)}
      {!visiting && choice('focus', onFocus)}
      {!visiting && (
        <Txt
          style={[
            styles.caption,
            font,
            {
              top: L.height * c.focusTop + semanticTokens.size.tapMin + c.titleOffset,
              left: Math.max(L.insets.left, L.width * 0.11),
            },
          ]}
        >
          {t('home.raft.fishingIsland')}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1, overflow: 'hidden', backgroundColor: semanticTokens.color.secondary },
  heading: {
    position: 'absolute',
    fontSize: c.titleSize,
    lineHeight: c.titleSize * 1.5,
    fontWeight: '400',
    textAlign: 'center',
    textShadowColor: c.textShadow,
    textShadowRadius: 5,
  },
  members: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: semanticTokens.size.tapMin,
  },
  membersText: {
    fontSize: semanticTokens.typography.caption,
    fontWeight: '400',
    textShadowColor: c.textShadow,
    textShadowRadius: 3,
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
    fontSize: c.choiceSize,
    lineHeight: c.choiceSize * 1.4,
    fontWeight: '400',
    textDecorationLine: 'underline',
    textShadowColor: c.textShadow,
    textShadowRadius: 8,
  },
  selected: { fontWeight: '700' },
  caption: {
    position: 'absolute',
    fontSize: componentTokens.homeNavigation.clockSize,
    textShadowColor: c.textShadow,
    textShadowRadius: 5,
  },
});
