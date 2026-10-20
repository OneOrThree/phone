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

/** 화면에 걸치는 타일만 만든다. 인접 경계를 같이 반올림해 소수 배율에서도 빈 선이 없게 한다. */
export function visibleOceanTiles(
  width: number,
  height: number,
  left: number,
  top: number,
  scale: number,
) {
  const size = OCEAN_WORLD_SIZE * scale;
  if (width <= 0 || height <= 0 || size <= 0) return [];
  const tiles = [];
  for (let row = Math.floor(-top / size); row < Math.ceil((height - top) / size); row++) {
    const y = PixelRatio.roundToNearestPixel(top + row * size);
    const bottom = PixelRatio.roundToNearestPixel(top + (row + 1) * size);
    for (let col = Math.floor(-left / size); col < Math.ceil((width - left) / size); col++) {
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
}: {
  left: number;
  top: number;
  scale: number;
  night?: boolean;
}) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const tiles = visibleOceanTiles(viewport.width, viewport.height, left, top, scale);
  return (
    <View
      testID="island-ocean"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.viewport}
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
  tile: { position: 'absolute' },
});
