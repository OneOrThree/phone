import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Badge, Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { useAppLayout } from '@/utils/layout';
import { t } from '@/i18n';
import { ObservatoryIslandPortrait } from './ObservatoryIslandPortrait';
import { ObservatoryLedger, ObservatoryRow } from './ObservatoryLayout';
import { GOWUN } from './sceneKit';
import { useScreenReaderEnabled } from './NpcGuide';

const token = componentTokens.observatory.podium;
const color = semanticTokens.color;
const styles = StyleSheet.create({
  stage: { paddingTop: componentTokens.observatory.scenery.podiumTop },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: token.gap },
  column: { flex: 1, minWidth: 0 },
  body: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: token.gap,
    paddingHorizontal: token.columnPadding,
    paddingBottom: token.gap,
  },
  details: {
    minWidth: 0,
    maxWidth: '100%',
    alignSelf: 'center',
    alignItems: 'center',
    gap: token.columnPadding,
    padding: token.columnPadding,
    backgroundColor: color.canvas,
    borderRadius: token.gap,
  },
  name: {
    fontFamily: GOWUN,
    textAlign: 'center',
    fontSize: token.nameSize,
    lineHeight: token.nameLineHeight,
    fontWeight: semanticTokens.typography.bold,
  },
  average: {
    fontFamily: GOWUN,
    textAlign: 'center',
    fontSize: token.averageSize,
    lineHeight: token.averageLineHeight,
    color: color.textMuted,
  },
  step: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: color.outline,
    borderWidth: semanticTokens.stroke.default,
    borderTopLeftRadius: semanticTokens.radius.control,
    borderTopRightRadius: semanticTokens.radius.control,
  },
  number: {
    fontFamily: GOWUN,
    fontSize: token.numberSize,
    lineHeight: token.numberLineHeight,
    fontWeight: semanticTokens.typography.extraBold,
    color: color.text,
  },
  base: { height: token.baseHeight, backgroundColor: color.outline },
  crown: { alignSelf: 'center' },
  pressed: { opacity: 0.7 },
});

export type ObservatoryPodiumItem = {
  id: string;
  name: string;
  rank: number;
  average: string;
  label: string;
  memberCount?: number;
  joined?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

/** 2·1·3 시상대. 배열 순서로 메달을 매기지 않고 서버 rank를 그대로 묶는다. */
export function ObservatoryPodium({ items }: { items: ObservatoryPodiumItem[] }) {
  const scale = useAppLayout().fontScale ?? 1;
  const screenReader = useScreenReaderEnabled();
  if (!items.length) return null;
  // 확대 글자에서 세 개의 좁은 칸은 섬 이름을 한 글자씩 끊는다. 순위는 유지하고 넓은 행으로 읽게 한다.
  // 화면 읽기도 같은 목록을 써서 시상대의 높이·좌우 배치와 무관하게 1·2·3 순서로 탐색한다.
  if (screenReader || scale >= semanticTokens.typography.largeTextThreshold) {
    return (
      <View testID="observatory-podium">
        <ObservatoryLedger>
          {[...items]
            .sort((a, b) => a.rank - b.rank)
            .map((item) => (
              <ObservatoryRow
                key={item.id}
                title={item.name}
                rank={item.rank}
                average={item.average}
                memberCount={item.memberCount}
                label={item.label}
                below={item.joined && <Badge soft>{t('observatory.joined')}</Badge>}
                disabled={item.disabled}
                onPress={item.onPress}
              />
            ))}
        </ObservatoryLedger>
      </View>
    );
  }
  const sizes = { 1: token.winnerHeight, 2: token.secondHeight, 3: token.thirdHeight };
  const bodyHeight = items.some((item) => item.joined) ? token.joinedBodyHeight : token.bodyHeight;
  const colors = { 1: color.accent, 2: color.secondary, 3: color.selected };
  return (
    <View testID="observatory-podium" style={styles.stage}>
      <View style={styles.podium}>
        {([2, 1, 3] as const).map((rank) => {
          const entries = items.filter((item) => item.rank === rank);
          return (
            <View key={rank} testID={`observatory-podium-${rank}`} style={styles.column}>
              {rank === 1 && entries.length > 0 && (
                <Svg
                  width={token.crownSize}
                  height={token.crownSize}
                  viewBox="0 0 32 28"
                  style={styles.crown}
                  accessible={false}
                >
                  <Path
                    d="M4 7 11 13 16 3 21 13 28 7 25 23H7Z"
                    fill={color.accent}
                    stroke={color.outline}
                    strokeWidth={semanticTokens.stroke.strong}
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
              {entries.map((item) => {
                const content = (
                  <>
                    <ObservatoryIslandPortrait
                      memberCount={item.memberCount}
                      size={rank === 1 ? token.winnerSize : token.finalistSize}
                    />
                    <View style={styles.details}>
                      <Txt style={styles.name}>{item.name}</Txt>
                      <Txt style={styles.average}>{item.average}</Txt>
                      {item.joined && <Badge soft>{t('observatory.joined')}</Badge>}
                    </View>
                  </>
                );
                const bodyStyle = [styles.body, { minHeight: bodyHeight * Math.max(1, scale) }];
                return item.onPress ? (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    accessibilityState={{ disabled: !!item.disabled }}
                    disabled={item.disabled}
                    onPress={item.onPress}
                    style={({ pressed }) => [bodyStyle, pressed && styles.pressed]}
                  >
                    {content}
                  </Pressable>
                ) : (
                  <View key={item.id} accessible accessibilityLabel={item.label} style={bodyStyle}>
                    {content}
                  </View>
                );
              })}
              {entries.length > 0 && (
                <View
                  accessible={false}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[styles.step, { minHeight: sizes[rank], backgroundColor: colors[rank] }]}
                >
                  <Txt style={styles.number}>{rank}</Txt>
                </View>
              )}
            </View>
          );
        })}
      </View>
      <View style={styles.base} />
    </View>
  );
}
