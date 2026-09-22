import React from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Txt } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import type { Quest, Reward } from '@/services/model';

type Props = {
  quests: Quest[];
  rewardCount: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

const questCondition = (quest: Quest) =>
  quest.type === 'focus'
    ? `${quest.windowStart ?? '00:00'}–${quest.windowEnd ?? '24:00'} · ${quest.target}분`
    : `하루 폰 사용 · ${quest.target}분 이하`;

export const claimableQuestRewards = (rewards: Reward[] | undefined, islandId: string) =>
  (rewards ?? []).filter(
    (reward) => reward.islandId === islandId && reward.kind === 'personal' && !reward.acknowledged,
  );

export const claimableQuestRewardCount = (rewards: Reward[] | undefined, islandId: string) =>
  claimableQuestRewards(rewards, islandId).length;

export function HomeQuestIndicator({ quests, rewardCount, onPress, style }: Props) {
  const { fontScale } = useWindowDimensions();
  const first = quests[0];
  if (!first && rewardCount === 0) return null;

  const largeText = fontScale >= componentTokens.homeQuestIndicator.largeTextThreshold;
  const reward = rewardCount > 0;
  const multiple = !reward && quests.length > 1;
  const count = reward ? rewardCount : multiple ? quests.length : null;
  const eyebrow = reward ? `완료한 퀘스트 ${rewardCount}개` : '오늘 퀘스트';
  const title = reward ? '보상 받기' : first?.title;
  const meta = reward
    ? '눌러서 받을 보상 보기'
    : multiple
      ? `외 ${quests.length - 1}개 보기`
      : first
        ? questCondition(first)
        : '';
  const accessibilityLabel = reward
    ? `받을 퀘스트 보상 ${rewardCount}개. 보상 받기`
    : multiple
      ? `오늘 퀘스트 ${quests.length}개. ${first?.title} 외 ${quests.length - 1}개 보기`
      : `오늘 퀘스트. ${first?.title}. ${meta}`;

  return (
    <Pressable
      testID="home-quest-indicator"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.wrap, style, pressed && styles.pressed]}
    >
      {(multiple || reward) && (
        <>
          <View
            pointerEvents="none"
            testID="home-quest-note-back-far"
            style={[styles.back, styles.backFar]}
          />
          <View
            pointerEvents="none"
            testID="home-quest-note-back-near"
            style={[styles.back, styles.backNear]}
          />
        </>
      )}
      <View
        pointerEvents="none"
        testID="home-quest-note-front"
        style={[styles.note, largeText && styles.largeTextNote, reward && styles.rewardNote]}
      >
        <View style={[styles.tape, reward && styles.rewardTape]} />
        <Txt numberOfLines={1} style={styles.eyebrow}>
          {eyebrow}
        </Txt>
        <Txt numberOfLines={largeText ? 2 : 1} style={[styles.title, reward && styles.rewardTitle]}>
          {title}
        </Txt>
        <Txt numberOfLines={largeText ? 2 : 1} style={styles.meta}>
          {meta}
        </Txt>
        <View style={styles.accessory}>
          {count !== null ? (
            <View style={styles.countBadge}>
              <Txt numberOfLines={1} style={styles.count}>
                {count}
              </Txt>
            </View>
          ) : (
            <Txt style={styles.chevron}>›</Txt>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const { space, fontSize, fontWeight, radius, stroke } = primitiveTokens;
const noteToken = componentTokens.homeQuestIndicator;

const styles = StyleSheet.create({
  wrap: {
    width: noteToken.width,
    minHeight: noteToken.noteMinHeight + noteToken.touchTrailingSpace,
    paddingBottom: noteToken.touchTrailingSpace,
  },
  pressed: { opacity: 0.72 },
  back: {
    position: 'absolute',
    width: noteToken.backWidth,
    borderRadius: radius.control,
    borderWidth: stroke.default,
    borderColor: semanticTokens.color.outline,
    backgroundColor: semanticTokens.color.letter,
  },
  backFar: {
    left: 10,
    top: noteToken.backFarInsetTop,
    bottom: noteToken.backFarInsetBottom,
    transform: [{ rotate: '2.4deg' }],
  },
  backNear: {
    left: 5,
    top: noteToken.backNearInsetTop,
    bottom: noteToken.backNearInsetBottom,
    transform: [{ rotate: '1.1deg' }],
  },
  note: {
    width: noteToken.noteWidth,
    minHeight: noteToken.noteMinHeight,
    paddingTop: noteToken.contentPaddingTop,
    paddingBottom: noteToken.contentPaddingBottom,
    paddingLeft: noteToken.contentPaddingLeft,
    paddingRight: noteToken.contentPaddingRight,
    borderRadius: radius.control,
    borderWidth: stroke.default,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
    boxShadow: `0px 4px 0px ${semanticTokens.color.outline}`,
    transform: [{ rotate: '-0.7deg' }],
  },
  largeTextNote: { paddingRight: noteToken.largeTextContentPaddingRight },
  rewardNote: {
    borderWidth: stroke.strong,
    borderColor: semanticTokens.color.primary,
  },
  tape: {
    position: 'absolute',
    top: -space[1],
    left: space[12],
    width: noteToken.tapeWidth,
    height: space[2],
    borderRadius: space[1],
    backgroundColor: semanticTokens.color.accent,
    opacity: 0.86,
  },
  rewardTape: { backgroundColor: semanticTokens.color.primary },
  eyebrow: {
    fontSize: fontSize.xs,
    lineHeight: 17,
    fontWeight: fontWeight.semibold,
    color: semanticTokens.color.textMuted,
  },
  title: {
    fontSize: fontSize.md,
    lineHeight: 23,
    fontWeight: fontWeight.extraBold,
    color: semanticTokens.color.text,
  },
  rewardTitle: { color: semanticTokens.color.primary },
  meta: {
    fontSize: fontSize.xs,
    lineHeight: 17,
    fontWeight: fontWeight.medium,
    color: semanticTokens.color.textMuted,
  },
  countBadge: {
    minWidth: noteToken.badgeMinSize,
    minHeight: noteToken.badgeMinSize,
    paddingHorizontal: space[1],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: semanticTokens.color.primary,
  },
  count: {
    fontSize: fontSize.xs,
    lineHeight: 17,
    fontWeight: fontWeight.extraBold,
    color: primitiveTokens.color.white,
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    fontSize: fontSize.lg,
    lineHeight: 24,
    fontWeight: fontWeight.bold,
    color: semanticTokens.color.outline,
  },
  accessory: {
    position: 'absolute',
    top: 0,
    right: space[3],
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
