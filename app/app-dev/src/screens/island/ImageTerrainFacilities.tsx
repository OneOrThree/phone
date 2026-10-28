import React, { useId } from 'react';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Svg, { ClipPath, Defs, G, Image, Path } from 'react-native-svg';
import { componentTokens } from '@/design-system/tokens';
import { TILE_FACILITIES, TERRAIN_FACILITY_CONTOURS } from './tileFacilities';

const tokens = componentTokens.tileFacility;
// 지형 원화(home-<낮·밤>.png)를 시설 rect 로 자른 그림(scripts/build-facility-crops.py, GROMO-2378). [낮, 밤]
const terrainSources: Record<string, readonly ImageSourcePropType[]> = {
  fire: [
    require('@/assets/village-world/facility/terrain/fire-day.png'),
    require('@/assets/village-world/facility/terrain/fire-night.png'),
  ],
  raft: [
    require('@/assets/village-world/facility/terrain/raft-day.png'),
    require('@/assets/village-world/facility/terrain/raft-night.png'),
  ],
};
const objects = Object.entries(TERRAIN_FACILITY_CONTOURS).map(([id, points]) => {
  const rect = TILE_FACILITIES[id];
  return {
    id,
    rect,
    path:
      points.map(([x, y], index) => `${index ? 'L' : 'M'}${rect.x + x} ${rect.y + y}`).join(' ') +
      ' Z',
  };
});

/**
 * 일반 이미지 섬도 같은 원화의 뗏목·모닥불만 분리한다. 웹은 CanvasKit 없이 SVG로 그린다.
 * SVG 는 뷰 크기만큼 비트맵을 잡으므로 섬 전체 크기 하나 대신 시설마다 rect 둘레만 덮는 작은 SVG 를 쓴다.
 */
export function ImageTerrainFacilities({
  left,
  top,
  scale,
  baseScale = 1,
  night,
  pressedFacility,
  reduceMotion,
}: {
  left: number;
  top: number;
  scale: number;
  baseScale?: number;
  night: boolean;
  pressedFacility?: string | null;
  reduceMotion: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  // 외곽선 획 + 누름 이동이 rect 밖으로 나가는 만큼의 여백(원화 px).
  const pad = (tokens.outlineWidth * 2 + tokens.pressOffset) / baseScale;
  return (
    <View testID="image-terrain-facilities" pointerEvents="none" style={StyleSheet.absoluteFill}>
      {objects.map(({ id, rect, path }) => {
        const pressed = pressedFacility === id;
        const moving = pressed && !reduceMotion;
        const x = rect.x + rect.w / 2,
          y = rect.y + rect.h;
        const box = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
        return (
          <Svg
            key={id}
            width={box.w * scale}
            height={box.h * scale}
            viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
            style={{ position: 'absolute', left: left + box.x * scale, top: top + box.y * scale }}
          >
            <Defs>
              <ClipPath id={`${uid}-${id}`}>
                <Path d={path} />
              </ClipPath>
            </Defs>
            {moving && (
              <Path
                d={path}
                fill={tokens.terrainUnderlay[night ? 'night' : 'day'][id as 'fire' | 'raft']}
              />
            )}
            <G
              testID={`image-terrain-facility-${id}`}
              transform={
                moving
                  ? `translate(0 ${tokens.pressOffset / baseScale}) translate(${x} ${y}) scale(${tokens.pressScale}) translate(${-x} ${-y})`
                  : undefined
              }
            >
              <Path
                d={path}
                fill="none"
                stroke={tokens.outline}
                strokeWidth={(tokens.outlineWidth * 2) / baseScale}
                strokeLinejoin="round"
              />
              <G clipPath={`url(#${uid}-${id})`}>
                <Image
                  href={terrainSources[id][night ? 1 : 0]}
                  x={rect.x}
                  y={rect.y}
                  width={rect.w}
                  height={rect.h}
                  preserveAspectRatio="none"
                />
              </G>
              {pressed && reduceMotion && (
                <Path d={path} fill={tokens.pressedShade} opacity={tokens.pressedShadeOpacity} />
              )}
            </G>
          </Svg>
        );
      })}
    </View>
  );
}
