import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { ISLAND_STAGE_ART } from '@/constants/magazineAssets';
import { GOWUN } from './sceneKit';

const token = componentTokens.observatory;
const styles = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: token.rankGap,
    flexShrink: 0,
  },
  portrait: {
    width: token.portraitSize,
    height: token.portraitSize,
    borderRadius: semanticTokens.radius.full,
    borderWidth: semanticTokens.stroke.default,
    borderColor: semanticTokens.color.outline,
    backgroundColor: semanticTokens.color.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  art: {
    width: token.portraitSize * token.portraitZoom,
    height: token.portraitSize * token.portraitZoom,
  },
  number: {
    fontFamily: GOWUN,
    minWidth: token.rankMinWidth,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    fontSize: token.rankSize,
    lineHeight: token.rankLineHeight,
    fontWeight: semanticTokens.typography.bold,
    color: semanticTokens.color.text,
  },
});

/** 전망대 목록의 섬 대표 그림. 순위·이름은 행 전체가 읽어 중복 낭독하지 않는다. */
export function ObservatoryIslandPortrait({
  rank,
  memberCount,
  size = token.portraitSize,
}: {
  rank?: number;
  memberCount?: number;
  size?: number;
}) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.frame}
    >
      {rank != null && <Txt style={styles.number}>{rank}</Txt>}
      <View
        testID="observatory-island-portrait"
        style={[styles.portrait, { width: size, height: size }]}
      >
        {/* 조회 계약에 건물 수가 없어 대표 그림을 쓴다. 주민 0명인 검색 결과만 무인도로 구분한다. */}
        <Image
          source={memberCount === 0 ? ISLAND_STAGE_ART.houses0 : ISLAND_STAGE_ART.houses1}
          resizeMode="contain"
          style={[
            styles.art,
            { width: size * token.portraitZoom, height: size * token.portraitZoom },
          ]}
        />
      </View>
    </View>
  );
}
