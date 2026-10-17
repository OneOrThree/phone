import React, { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, Image, Pattern, Rect } from 'react-native-svg';

export const islandTerrain = {
  day: require('@/assets/backgrounds/island/ocean/home-day.png'),
  night: require('@/assets/backgrounds/island/ocean/home-night.png'),
};
const water = {
  day: require('@/assets/backgrounds/island/ocean/day.png'),
  night: require('@/assets/backgrounds/island/ocean/night.png'),
};
export const OCEAN_WORLD_SIZE = 512;

/** Both shores and water use the same world origin and camera scale, including negative pan. */
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
  const id = `island-ocean-${useId().replace(/:/g, '')}`;
  const size = OCEAN_WORLD_SIZE * scale;
  return (
    <Svg
      testID="island-ocean"
      pointerEvents="none"
      width="100%"
      height="100%"
      style={StyleSheet.absoluteFill}
    >
      <Defs>
        <Pattern id={id} x={left} y={top} width={size} height={size} patternUnits="userSpaceOnUse">
          <Image
            href={water[night ? 'night' : 'day']}
            width={size}
            height={size}
            preserveAspectRatio="none"
          />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
