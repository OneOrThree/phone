import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Btn, Overlay, Txt } from '@/design-system/patterns';
import {
  componentTokens as c,
  primitiveTokens as p,
  semanticTokens as s,
} from '@/design-system/tokens';
import { t } from '@/i18n';
import { SeaArrival, seaDuration } from './seaModel';
import { SeaRewardArt, seaRewardCatalog } from './seaRewardCatalog';

export function SeaArrivalResult({
  result,
  pending,
  error,
  onExplore,
  catalog = seaRewardCatalog,
}: {
  result: SeaArrival;
  pending: boolean;
  error?: string;
  onExplore: () => void;
  catalog?: Readonly<Record<string, SeaRewardArt>>;
}) {
  const reward = result.reward;
  const rewardArt = reward.status === 'earned' ? catalog[reward.itemId] : undefined;
  return (
    <Overlay maxWidth={354} contentStyle={styles.content} frameStyle={styles.frame}>
      <View accessibilityViewIsModal testID="sea-arrival-result" style={styles.contentInner}>
        <View style={styles.heading}>
          <Txt accessibilityRole="header" style={styles.title}>
            {result.destinationName}
          </Txt>
          <Txt style={styles.subtitle}>{t('openSea.arrived')}</Txt>
        </View>
        <View style={styles.time}>
          <Txt style={styles.label}>{t('openSea.voyageTime')}</Txt>
          <Txt style={styles.value}>{seaDuration(result.activeSeconds)}</Txt>
        </View>
        <View style={styles.reward}>
          <Txt style={styles.label}>{t('openSea.rewardTitle')}</Txt>
          {rewardArt && (
            <View
              accessible={false}
              style={[
                styles.rewardWindow,
                { width: rewardArt.preview.width, height: rewardArt.preview.height },
              ]}
            >
              <Image
                source={rewardArt.source}
                style={[
                  styles.rewardImage,
                  {
                    width: rewardArt.preview.size,
                    height: rewardArt.preview.size,
                    left: rewardArt.preview.left,
                    top: rewardArt.preview.top,
                  },
                ]}
              />
            </View>
          )}
          <Txt style={styles.value}>
            {reward.status === 'earned'
              ? reward.name
              : t(reward.status === 'unknown' ? 'openSea.unknownReward' : 'openSea.noReward')}
          </Txt>
        </View>
        {!!error && (
          <Txt accessibilityRole="alert" style={styles.error}>
            {error}
          </Txt>
        )}
        <Btn
          dynamicHeight
          title={pending ? t('openSea.entering') : t('openSea.explore')}
          disabled={pending}
          onPress={onExplore}
        />
      </View>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  rewardWindow: { overflow: 'hidden' },
  rewardImage: { position: 'absolute' },
  frame: { borderRadius: s.radius.modal, boxShadow: c.modal.shadow },
  content: { padding: p.space[6], paddingBottom: p.space[6] },
  contentInner: { gap: p.space[5] },
  heading: { alignItems: 'center', gap: p.space[1] },
  title: {
    fontSize: s.typography.heading,
    lineHeight: 39,
    fontWeight: s.typography.bold,
    textAlign: 'center',
  },
  subtitle: { fontSize: s.typography.body, color: s.color.textMuted, textAlign: 'center' },
  time: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: p.space[2],
    minHeight: 48,
    backgroundColor: `${s.color.accent}4D`,
    borderRadius: s.radius.control,
    paddingHorizontal: p.space[4],
    paddingVertical: p.space[2],
  },
  label: { fontSize: s.typography.label, color: s.color.textMuted, textAlign: 'center' },
  value: {
    fontSize: s.typography.title,
    lineHeight: 30,
    fontWeight: s.typography.bold,
    textAlign: 'center',
  },
  reward: { alignItems: 'center', gap: p.space[2] },
  error: { color: s.color.danger, textAlign: 'center' },
});
