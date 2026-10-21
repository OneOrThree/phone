import React, { useState } from 'react';
import { Image, PixelRatio, StyleSheet, View } from 'react-native';

export const islandTerrain = {
  day: require('@/assets/backgrounds/island/ocean/home-day.png'),
  night: require('@/assets/backgrounds/island/ocean/home-night.png'),
};
const water = {
  day: require('@/assets/backgrounds/island/ocean/day.png'),
  night: require('@/assets/backgrounds/island/ocean/night.png'),
};
export const OCEAN_WORLD_SIZE = 512;

/**
 * 화면(x0·y0 에서 width×height)에 걸치는 타일만 만든다. 인접 경계를 같이 반올림해 소수 배율에서도 빈 선이 없게 한다.
 */
export function visibleOceanTiles(
  width: number,
  height: number,
  left: number,
  top: number,
  scale: number,
  x0 = 0,
  y0 = 0,
) {
  const size = OCEAN_WORLD_SIZE * scale;
  if (width <= 0 || height <= 0 || size <= 0) return [];
  const tiles = [];
  for (
    let row = Math.floor((y0 - top) / size);
    row < Math.ceil((y0 + height - top) / size);
    row++
  ) {
    const y = PixelRatio.roundToNearestPixel(top + row * size);
    const bottom = PixelRatio.roundToNearestPixel(top + (row + 1) * size);
    for (
      let col = Math.floor((x0 - left) / size);
      col < Math.ceil((x0 + width - left) / size);
      col++
    ) {
      const x = PixelRatio.roundToNearestPixel(left + col * size);
      const right = PixelRatio.roundToNearestPixel(left + (col + 1) * size);
      tiles.push({ key: `${col}:${row}`, left: x, top: y, width: right - x, height: bottom - y });
    }
  }
  return tiles;
}

/** 해안과 바다가 같은 월드 원점·배율을 쓴다. SVG Pattern의 네이티브 이동 시 잘림을 피한다. */
export function IslandOcean({
  left,
  top,
  scale,
  night = false,
  cover,
}: {
  left: number;
  top: number;
  scale: number;
  night?: boolean;
  /**
   * 덮을 월드 범위(GROMO-2373). 주면 화면 크기와 무관하게 이 범위를 다 깔고 자르지 않는다 — 지도를 끄는 동안
   * 바깥 transform 만 움직여도 가장자리가 비지 않게 한다. 없으면 이 뷰의 크기만큼만 깐다.
   */
  cover?: { left: number; top: number; right: number; bottom: number };
}) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const tiles = cover
    ? visibleOceanTiles(
        (cover.right - cover.left) * scale,
        (cover.bottom - cover.top) * scale,
        left,
        top,
        scale,
        left + cover.left * scale,
        top + cover.top * scale,
      )
    : visibleOceanTiles(viewport.width, viewport.height, left, top, scale);
  return (
    <View
      testID="island-ocean"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={cover ? styles.cover : styles.viewport}
      onLayout={({ nativeEvent: { layout } }) => {
        setViewport((current) =>
          current.width === layout.width && current.height === layout.height
            ? current
            : { width: layout.width, height: layout.height },
        );
      }}
    >
      {tiles.map(({ key, ...box }) => (
        <Image
          key={key}
          source={water[night ? 'night' : 'day']}
          accessible={false}
          fadeDuration={0}
          resizeMode="stretch"
          style={[styles.tile, box]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  cover: StyleSheet.absoluteFill,
  tile: { position: 'absolute' },
});
