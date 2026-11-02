import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { Text } from '@/design-system/typography';
import { componentTokens, semanticTokens as s } from '@/design-system/tokens';
import { t } from '@/i18n';
import { hms } from './FishingIsland';

/** 사용한 경우에만 인증 시간 / 총 집중 시간을 한 칸에 표시한다. */
export function VerificationResultSummary({
  verifiedSeconds,
  totalSeconds,
  fontStyle,
}: {
  verifiedSeconds?: number;
  totalSeconds: number;
  fontStyle?: StyleProp<TextStyle>;
}) {
  if (verifiedSeconds == null) return null;
  const total = Math.max(0, Math.floor(totalSeconds));
  const seconds = Math.max(0, Math.min(Math.floor(verifiedSeconds), total));
  return (
    <View testID="verification-result" style={styles.summary}>
      <Text style={[styles.label, fontStyle]}>{t('verification.result.title')}</Text>
      <Text
        accessible
        accessibilityLabel={t('verification.result.accessibility', {
          verified: hms(seconds),
          total: hms(total),
        })}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={[styles.time, fontStyle]}
      >
        <Text testID="verification-result-duration">{hms(seconds)}</Text>
        {' / '}
        <Text testID="focus-result-duration">{hms(total)}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: componentTokens.focusResult.timeGap },
  label: { fontSize: s.typography.caption, color: s.color.textMuted, textAlign: 'center' },
  time: {
    fontSize: s.typography.title,
    lineHeight: componentTokens.focusResult.timeLineHeight,
    fontWeight: s.typography.extraBold,
    letterSpacing: componentTokens.focusResult.timeLetterSpacing,
    fontVariant: ['tabular-nums'],
    color: s.color.text,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
});
