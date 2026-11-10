import { Bar } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { Text } from '@/design-system/typography';
import { getLocale, t } from '@/i18n';
import { GOWUN } from '@/screens/island/sceneKit';
import React, { useId } from 'react';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';
import { Image, ImageSourcePropType, StyleSheet, useWindowDimensions, View } from 'react-native';

const c = componentTokens.constructionPlan;
const s = semanticTokens;
const fish = require('@/assets/redesign/fish.png');

/** 네이티브와 웹에서 같은 청사진 격자를 표시한다. */
export function ConstructionPlanGrid() {
  const id = `construction-grid-${useId().replace(/:/g, '')}`;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { borderRadius: c.radius, overflow: 'hidden' }]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} width={c.gridSize} height={c.gridSize} patternUnits="userSpaceOnUse">
            <Path
              d={`M ${c.gridSize} 0 L 0 0 0 ${c.gridSize}`}
              fill="none"
              stroke={c.grid}
              strokeWidth={s.stroke.subtle}
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export function constructionFish(amount: number) {
  return t('constructionPlan.fish', { count: amount, amount: amount.toLocaleString(getLocale()) });
}

/** 마을회관과 게시판이 같은 현재 잔액·총액을 보여 주는 통장 요약이다. */
export function ConstructionWalletSummary({
  balance,
  cost,
  progress = false,
  testID,
}: {
  balance: number;
  cost: number;
  progress?: boolean;
  testID?: string;
}) {
  const remaining = balance - cost;
  const rate = cost > 0 ? Math.min(100, Math.max(0, (balance / cost) * 100)) : 100;
  return (
    <View testID={testID} style={styles.wallet}>
      <View style={styles.walletBody}>
        <View style={styles.row}>
          <Text tabletScale={1} style={styles.meta}>
            {t('constructionPlan.balance')}
          </Text>
          <Text tabletScale={1} style={styles.meta}>
            {t('constructionPlan.savedTogether')}
          </Text>
        </View>
        <View style={styles.balance}>
          <Image
            source={fish}
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.fish}
            resizeMode="contain"
          />
          <Text tabletScale={1} style={styles.number}>
            {constructionFish(balance)}
          </Text>
        </View>
        <View style={styles.row}>
          <Text tabletScale={1} style={styles.body}>
            {t('constructionPlan.cost')}
          </Text>
          <Text tabletScale={1} style={styles.body}>
            {constructionFish(cost)}
          </Text>
        </View>
        <View style={[styles.row, styles.total]}>
          <Text tabletScale={1} style={styles.body}>
            {t(remaining >= 0 ? 'constructionPlan.remaining' : 'constructionPlan.shortfall')}
          </Text>
          <Text tabletScale={1} style={[styles.amount, remaining < 0 && styles.shortfall]}>
            {constructionFish(Math.abs(remaining))}
          </Text>
        </View>
      </View>
      {progress && (
        <View style={styles.progress}>
          <View style={styles.row}>
            <Text tabletScale={1} style={styles.meta}>
              {remaining >= 0
                ? t('constructionPlan.funded')
                : t('constructionPlan.needMore', { amount: constructionFish(-remaining) })}
            </Text>
            <Text tabletScale={1} style={styles.meta}>
              {Math.floor(rate)}%
            </Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={t('constructionPlan.progress')}
            accessibilityValue={{ min: 0, max: 100, now: Math.floor(rate) }}
          >
            <Bar value={rate} />
          </View>
        </View>
      )}
    </View>
  );
}

export function ConstructionPlanPreview({
  name,
  image,
  description,
  testID,
}: {
  name: string;
  image: ImageSourcePropType;
  description: string;
  testID?: string;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <View
      testID={testID}
      style={[styles.preview, fontScale >= s.typography.largeTextThreshold && styles.stacked]}
    >
      <Image
        source={image}
        resizeMode="contain"
        accessibilityLabel={t('constructionPlan.preview', { name })}
        style={styles.art}
      />
      <View style={styles.copy}>
        <Text tabletScale={1} accessibilityRole="header" style={styles.title}>
          {name}
        </Text>
        {!!description && (
          <Text tabletScale={1} style={styles.description}>
            {description}
          </Text>
        )}
      </View>
    </View>
  );
}

export const constructionPlanStyles = StyleSheet.create({
  card: {
    backgroundColor: c.background,
    borderWidth: s.stroke.strong,
    borderColor: c.border,
    borderRadius: c.radius,
    padding: c.padding,
  },
  content: { gap: c.gap, paddingBottom: s.spacing.control },
  notice: {
    backgroundColor: s.color.surface,
    borderRadius: s.radius.control,
    padding: s.spacing.control,
    color: s.color.text,
    fontFamily: GOWUN,
    fontSize: s.typography.label,
    lineHeight: c.bodyLineHeight,
  },
});

const styles = StyleSheet.create({
  wallet: {
    backgroundColor: s.color.surface,
    borderWidth: s.stroke.subtle,
    borderColor: s.color.outline,
    borderRadius: c.radius,
  },
  walletBody: { padding: c.padding, gap: s.spacing.control },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s.spacing.control,
  },
  balance: { flexDirection: 'row', alignItems: 'center', gap: s.spacing.control },
  fish: { width: c.fishSize, height: c.fishSize },
  number: { fontFamily: GOWUN, fontSize: c.numberSize, color: s.color.text, flexShrink: 1 },
  body: { fontFamily: GOWUN, fontSize: s.typography.label, color: s.color.text },
  meta: { fontFamily: GOWUN, fontSize: s.typography.caption, color: s.color.textMuted },
  total: {
    borderTopWidth: s.stroke.subtle,
    borderStyle: 'dashed',
    borderTopColor: s.color.outline,
    paddingTop: s.spacing.control,
  },
  amount: { fontFamily: GOWUN, fontSize: s.typography.title, color: s.color.text },
  shortfall: { color: s.color.danger },
  progress: {
    gap: s.spacing.control,
    padding: s.spacing.control,
    backgroundColor: s.color.letter,
    borderBottomLeftRadius: c.radius,
    borderBottomRightRadius: c.radius,
  },
  preview: { flexDirection: 'row', alignItems: 'center', gap: c.gap },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  art: { width: c.artWidth, height: c.artHeight, alignSelf: 'center' },
  copy: { flex: 1, minWidth: 0, gap: s.spacing.control },
  title: { fontFamily: GOWUN, fontSize: c.titleSize, color: c.foreground },
  description: {
    fontFamily: GOWUN,
    fontSize: s.typography.label,
    lineHeight: c.bodyLineHeight,
    color: s.color.text,
    backgroundColor: s.color.surface,
    borderRadius: s.radius.control,
    padding: s.spacing.control,
  },
});
