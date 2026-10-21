import React, { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { OutfitItemArt } from '@/components/CatOutfitLayers';
import { Badge, Btn, Overlay, Txt } from '@/design-system/patterns';
import {
  componentTokens as c,
  primitiveTokens as p,
  semanticTokens as s,
} from '@/design-system/tokens';
import { t } from '@/i18n';
import { useCustomizationCatalog } from '@/services/customizationCatalog';
import { addUnseenOutfits } from '@/services/unseenOutfits';
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
  const table = useCustomizationCatalog();
  // 서버 grantedProductIds 순서를 보존한다. 첫 아이템은 대표 그림·이름, 나머지는 이름 목록으로 표시한다.
  // 이름을 모르는 id(카탈로그 미로드·실패)는 상품 id 를 그대로 보이지 않게 거른다 — 전부 모르면 보상 칸을 숨긴다.
  const name = (id: string) => catalog[id]?.title ?? table[id]?.title;
  const [primary, ...rest] = result.rewards.filter((id) => name(id));
  const showItem = !!primary || result.rewards.length === 0;
  // 처음 받은 것은 NEW! — 옷장의 안 본 새 꾸미기에도 넣는다(받은 목록에 있는 것만)
  const fresh = (result.newRewards ?? []).filter((id) => result.rewards.includes(id));
  const freshKey = fresh.join(',');
  useEffect(() => {
    if (freshKey) addUnseenOutfits(result.recordId, freshKey.split(','));
  }, [result.recordId, freshKey]);
  const art = primary ? catalog[primary] : undefined;
  const entry = primary ? table[primary] : undefined;
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
          {showItem && <Txt style={styles.label}>{t('common.caughtItem')}</Txt>}
          {!!primary && fresh.includes(primary) && (
            <Badge small style={styles.newBadge}>
              {t('common.newBadge')}
            </Badge>
          )}
          {art ? (
            <View
              accessible={false}
              style={[
                styles.rewardWindow,
                { width: art.preview.width, height: art.preview.height },
              ]}
            >
              <Image
                source={art.source}
                style={[
                  styles.rewardImage,
                  {
                    width: art.preview.size,
                    height: art.preview.size,
                    left: art.preview.left,
                    top: art.preview.top,
                  },
                ]}
              />
            </View>
          ) : (
            entry && (
              <OutfitItemArt entry={entry} size={REWARD_PICTURE} testID={`sea-reward-${primary}`} />
            )
          )}
          {showItem && (
            <Txt style={styles.value}>
              {primary
                ? name(primary)
                : t(result.rewardsUnknown ? 'openSea.rewardsUnknown' : 'openSea.noReward')}
            </Txt>
          )}
          {rest.length > 0 && (
            <Txt style={styles.label}>
              {t('openSea.additionalRewards', { names: rest.map(name).join(', ') })}
            </Txt>
          )}
          {result.minutesToNextTier != null && (
            <Txt style={styles.label}>
              {t('openSea.nextTier', { minutes: result.minutesToNextTier })}
            </Txt>
          )}
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

const REWARD_PICTURE = 120;
const styles = StyleSheet.create({
  rewardWindow: { overflow: 'hidden' },
  newBadge: { alignSelf: 'center' },
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
