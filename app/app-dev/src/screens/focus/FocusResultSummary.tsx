import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { art } from '@/constants/art';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { Text } from '@/design-system/typography';
import { t } from '@/i18n';
import { hms } from './FishingIsland';

export function FocusResultSummary({
  subject,
  seconds,
  fish,
  questTitles,
}: {
  subject: string;
  seconds: number;
  fish: number;
  questTitles: string[];
}) {
  return (
    <View testID="focus-result-summary">
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{t('focusFlow.result.title')}</Text>
        <Text style={styles.subject}>{subject}</Text>
      </View>
      <View style={styles.duration}>
        <Text style={styles.label}>{t('focusFlow.result.durationLabel')}</Text>
        <Text
          testID="focus-result-duration"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={styles.time}
        >
          {hms(seconds)}
        </Text>
      </View>
      <View style={styles.reward}>
        <Image source={art.fish} style={styles.fish} />
        <Text style={styles.rewardLabel}>{t('focusFlow.result.fishLabel')}</Text>
        <Text style={styles.fishCount}>{t('focusFlow.result.fishCount', { count: fish })}</Text>
      </View>
      {questTitles.length > 0 && (
        <View testID="focus-result-quests" style={styles.quests}>
          <Text style={styles.questHeading}>{t('focusFlow.result.questsAchievedTitle')}</Text>
          {questTitles.map((title, index) => (
            <View key={`${index}:${title}`} style={styles.questRow}>
              <Svg width={token.checkSize} height={token.checkSize} viewBox="0 0 20 20">
                <Path
                  d="M4 10.5 8 14.5 16 5.5"
                  fill="none"
                  stroke={semanticTokens.color.textMuted}
                  strokeWidth={semanticTokens.stroke.strong}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={styles.questTitle}>{title}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const token = componentTokens.focusResult;
const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: semanticTokens.spacing.control },
  eyebrow: {
    color: semanticTokens.color.textMuted,
    fontSize: semanticTokens.typography.label,
    fontWeight: semanticTokens.typography.semibold,
    textAlign: 'center',
  },
  subject: {
    color: semanticTokens.color.text,
    fontSize: semanticTokens.typography.title,
    lineHeight: token.subjectLineHeight,
    fontWeight: semanticTokens.typography.bold,
    textAlign: 'center',
  },
  duration: {
    alignItems: 'center',
    gap: token.timeGap,
    paddingVertical: semanticTokens.spacing.section,
  },
  label: { color: semanticTokens.color.textMuted, fontSize: semanticTokens.typography.label },
  time: {
    color: semanticTokens.color.text,
    fontSize: token.timeSize,
    lineHeight: token.timeLineHeight,
    fontWeight: semanticTokens.typography.extraBold,
    letterSpacing: token.timeLetterSpacing,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  reward: {
    backgroundColor: token.rewardBackground,
    borderRadius: semanticTokens.radius.control,
    padding: semanticTokens.spacing.component,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: semanticTokens.spacing.control,
  },
  fish: { width: token.fishSize, height: token.fishSize },
  rewardLabel: {
    flex: 1,
    color: semanticTokens.color.textMuted,
    fontSize: semanticTokens.typography.label,
    fontWeight: semanticTokens.typography.semibold,
  },
  fishCount: {
    color: semanticTokens.color.text,
    fontSize: semanticTokens.typography.title,
    fontWeight: semanticTokens.typography.extraBold,
  },
  quests: {
    marginTop: semanticTokens.spacing.section,
    paddingTop: semanticTokens.spacing.component,
    borderTopWidth: semanticTokens.stroke.subtle,
    borderTopColor: semanticTokens.color.divider,
    gap: semanticTokens.spacing.control,
  },
  questHeading: {
    color: semanticTokens.color.textMuted,
    fontSize: semanticTokens.typography.label,
    fontWeight: semanticTokens.typography.semibold,
  },
  questRow: { flexDirection: 'row', alignItems: 'flex-start', gap: token.questGap },
  questTitle: {
    flex: 1,
    color: semanticTokens.color.text,
    fontSize: semanticTokens.typography.body,
    lineHeight: token.questLineHeight,
    fontWeight: semanticTokens.typography.semibold,
  },
});
