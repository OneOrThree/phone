import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { CatOutfitLayers, type Outfit } from '@/components/CatOutfitLayers';
import { CatSprite } from '@/components/CatSprite';
import type { Color } from '@/services/model';
import { seaAssets, seaLoaf } from './seaAssets';

export function SeaRaft({
  color,
  focusing,
  size,
  reduceMotion = false,
  outfit,
}: {
  color: Color;
  focusing: boolean;
  size: number;
  reduceMotion?: boolean;
  /** 카탈로그 그림으로 고양이 위에 겹칠 머리·목·신발(GROMO-2311). */
  outfit?: Outfit;
}) {
  const catSize = size * 0.49;
  // 같은 발 위치를 기준으로 독서/식빵 포즈를 교체한다. 앞뒤 판자는 기존 레이어다.
  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      <Image
        source={seaAssets.raftBack}
        style={[StyleSheet.absoluteFill, { width: size, height: size }]}
      />
      <View style={[styles.absolute, { left: size * 0.48, top: size * 0.67 }]}>
        {focusing ? (
          <CatSprite
            color={color}
            motion="read"
            size={catSize}
            reduce={reduceMotion}
            outfit={outfit}
          />
        ) : (
          <Image
            source={seaLoaf[color]}
            style={[
              styles.absolute,
              {
                width: catSize,
                height: catSize,
                left: -catSize / 2,
                top: -(catSize * 464) / 512,
              },
            ]}
          />
        )}
      </View>
      {outfit && (
        <View
          style={[
            styles.absolute,
            {
              left: size * 0.48 - catSize / 2,
              top: size * 0.67 - (catSize * 464) / 512,
              width: catSize,
              height: catSize,
            },
          ]}
        >
          {/* 식빵은 정지 그림 자료로, 독서는 CatSprite 가 프레임마다 그린다 — 이 상자에는 정적 오버레이만 남는다 */}
          <CatOutfitLayers
            outfit={outfit}
            pose={focusing ? undefined : { color, still: 'loaf', size: catSize }}
          />
        </View>
      )}
      <Image
        source={seaAssets.raftFront}
        style={[StyleSheet.absoluteFill, { width: size, height: size }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({ absolute: { position: 'absolute' } });
