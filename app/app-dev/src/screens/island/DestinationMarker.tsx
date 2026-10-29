import React from 'react';
import { Group, LinearGradient, Oval, Path } from '@shopify/react-native-skia';
import { componentTokens } from '@/design-system/tokens';

const marker = componentTokens.walkPath;
const ring = 'M19.02 69.02 A30 11.5 0 0 1 76.98 69.02 M76.98 74.98 A30 11.5 0 0 1 19.02 74.98';
const arrow =
  'M41 14 Q41 10 45 10 L51 10 Q55 10 55 14 L55 34 L66 34 Q71 34 68 38 L51 61 Q48 65 45 61 L28 38 Q25 34 30 34 L41 34 Z';

// Claude 시안 A. 바닥 링 중심 (48,72)을 목적지에 맞추고 화면 크기를 유지한다.
export function DestinationMarker({ x, y, scale }: { x: number; y: number; scale: number }) {
  const unit = marker.markerSize / 96 / scale;
  return (
    <Group
      transform={[{ translateX: x - 48 * unit }, { translateY: y - 72 * unit }, { scale: unit }]}
    >
      <Oval x={17} y={60} width={62} height={24} color={marker.fill} opacity={0.18} />
      <Path path={ring} style="stroke" strokeWidth={6.5} strokeCap="round" color={marker.outline} />
      <Path path={ring} style="stroke" strokeWidth={3.2} strokeCap="round" color={marker.fill} />
      <Oval x={40} y={69} width={16} height={6} color={marker.outline} opacity={0.32} />
      <Path path={arrow} opacity={0.94}>
        <LinearGradient
          start={{ x: 28, y: 0 }}
          end={{ x: 68, y: 0 }}
          colors={[marker.highlight, marker.highlight, marker.shade, marker.shade]}
          positions={[0, 0.5, 0.5, 1]}
        />
      </Path>
      <Path
        path={arrow}
        style="stroke"
        strokeWidth={4.5}
        strokeJoin="round"
        color={marker.outline}
      />
      <Path
        path="M45.2 15.5 L45.2 30.5 M35.9 41 L43.5 51.4"
        style="stroke"
        strokeWidth={2.6}
        strokeCap="round"
        color={marker.shine}
        opacity={0.8}
      />
    </Group>
  );
}
