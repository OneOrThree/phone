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

/** 해안과 바다가 같은 월드 원점·배율을 쓴다. Android는 x/y 대신 셰이더 행렬로 원점을 옮긴다. */
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
        <Pattern
          id={id}
          x={0}
          y={0}
          width={size}
          height={size}
          patternTransform={`translate(${left} ${top})`}
          patternUnits="userSpaceOnUse"
        >
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
