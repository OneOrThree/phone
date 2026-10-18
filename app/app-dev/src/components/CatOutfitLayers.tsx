import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { CatalogEntry, CatalogTable } from '@/services/customizationCatalog';
import { useCustomizationCatalog } from '@/services/customizationCatalog';

/** 겹치는 순서 — 신발이 맨 아래, 머리가 맨 위. */
export const OUTFIT_ORDER = ['shoes', 'neck', 'head'] as const;
export type OutfitSlot = (typeof OUTFIT_ORDER)[number];
export type Outfit = Partial<Record<OutfitSlot, string | null | undefined>>;

/** 카탈로그 width/height 가 잰 기준 고양이 상자(px) — CatSprite 프레임과 같은 512. */
const REFERENCE = 512;

/** 고양이 상자 안의 그림 사각형(상자 대비 %) — anchor 는 그림 중심이 놓일 상자 안 0~1 위치. 상자 크기를 몰라도 된다. */
export function outfitRect(entry: CatalogEntry) {
  const w = entry.width / REFERENCE;
  const h = entry.height / REFERENCE;
  const pct = (n: number) => `${Math.round(n * 1e4) / 100}%` as `${number}%`;
  return {
    width: pct(w),
    height: pct(h),
    left: pct(entry.anchorX - w / 2),
    top: pct(entry.anchorY - h / 2),
  };
}

/** 장착 중인 항목을 shoes → neck → head 순으로 — 카탈로그에 없는 id 는 건너뛴다. */
export function outfitLayers(outfit: Outfit, catalog: CatalogTable): CatalogEntry[] {
  return OUTFIT_ORDER.flatMap((slot) => {
    const id = outfit[slot];
    const entry = id ? catalog[id] : undefined;
    return entry ? [entry] : [];
  });
}

/**
 * 카탈로그 그림으로 고양이 위에 머리·목·신발을 겹친다(GROMO-2311). 부모는 고양이와 같은 정사각 상자(position 이 있는 View)여야 한다.
 * 그림을 못 읽으면 아무것도 그리지 않는다(Image 실패는 조용히 비어 보인다).
 */
export function CatOutfitLayers({ outfit }: { outfit: Outfit }) {
  const catalog = useCustomizationCatalog();
  const layers = outfitLayers(outfit, catalog);
  if (layers.length === 0) return null;
  return (
    <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
      {layers.map((entry) => (
        <Image
          key={entry.productId}
          testID={`outfit-${entry.slot}`}
          accessible={false}
          source={{ uri: entry.imageUrl }}
          style={[styles.layer, outfitRect(entry)]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ layer: { position: 'absolute' } });
