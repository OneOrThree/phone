import React from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { art } from '@/constants/art';
import { assets } from '@/constants/assets';
import { CatOutfitLayers, type Outfit } from './CatOutfitLayers';

/**
 * 프로필 고양이 그림(avatar/<털색>) 위에 머리·목 꾸미기를 얹는다(GROMO-2391). 정사각 size 안에 그림을 채우고, 착용은 같은 상자에
 * 같은 자세(still/avatar)로 겹친다 — 그림 크기(128²·256²)와 상관없이 비율로 맞는다. 착용이 없거나 카탈로그에 없는 아이템이면
 * 옛 그림 한 장과 같다.
 * still='idle' 은 idle.png 를 아바타로 쓰는 화면(일기장·섬 시트)용 — 그림도 착용 자세도 idle 이다.
 * 털색이 없으면(null·미선택) 그림도 착용도 그리지 않는 빈 상자 — 남의 칸을 임의 색으로 채우지 않는다.
 */
export function CatAvatar({
  color,
  outfit,
  size,
  still = 'avatar',
  style,
  testID,
}: {
  color: string | null | undefined;
  outfit?: Outfit | null;
  size: number;
  still?: 'avatar' | 'idle';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const source = !color
    ? undefined
    : still === 'idle'
      ? assets[`characters/cat/${color}/idle.png`]
      : art[`avatar/${color}`];
  return (
    <View testID={testID} style={[{ width: size, height: size }, style]}>
      {source && (
        <Image testID="cat-avatar-image" source={source} resizeMode="contain" style={styles.fill} />
      )}
      {source && color && (outfit?.head || outfit?.neck) && (
        <CatOutfitLayers outfit={outfit} pose={{ color, still, size }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { width: '100%', height: '100%' } });
