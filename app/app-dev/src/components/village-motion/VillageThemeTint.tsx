import React from 'react';
import { Image, StyleSheet, type ImageSourcePropType } from 'react-native';
import { componentTokens } from '@/design-system/tokens';

/**
 * 건물 테마 착색을 현재 모션 프레임의 알파 모양 그대로 덧입힌다.
 * 정적 테마 레이어 대신 이 레이어를 쓰면 진입·유휴 모션 어느 쪽에서도 닫힌 모습의 잔상이 남지 않는다.
 */
export function VillageThemeTint({
  source,
  testID,
}: {
  source: ImageSourcePropType;
  testID?: string;
}) {
  return <Image testID={testID} source={source} resizeMode="stretch" style={styles.tint} />;
}

const styles = StyleSheet.create({
  tint: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    tintColor: componentTokens.villageBuildingThemeTint.color,
    opacity: componentTokens.villageBuildingThemeTint.opacity,
  },
});
