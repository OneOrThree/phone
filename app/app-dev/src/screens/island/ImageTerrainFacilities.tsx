import React, { useId } from 'react';
import type { ImageSourcePropType } from 'react-native';
import Svg, { ClipPath, Defs, G, Image, Path } from 'react-native-svg';
import { componentTokens } from '@/design-system/tokens';
import { TILE_FACILITIES, TERRAIN_FACILITY_CONTOURS } from './tileFacilities';

const tokens = componentTokens.tileFacility;
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

/** 일반 이미지 섬도 같은 원화의 뗏목·모닥불만 분리한다. 웹은 CanvasKit 없이 SVG로 그린다. */
export function ImageTerrainFacilities({
  source,
  left,
  top,
  scale,
  baseScale = 1,
  night,
  pressedFacility,
  reduceMotion,
}: {
  source: ImageSourcePropType;
  left: number;
  top: number;
  scale: number;
  baseScale?: number;
  night: boolean;
  pressedFacility?: string | null;
  reduceMotion: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  return (
    <Svg
      testID="image-terrain-facilities"
      pointerEvents="none"
      width={1536 * scale}
      height={1024 * scale}
      viewBox="0 0 1536 1024"
      style={{ position: 'absolute', left, top }}
    >
      <Defs>
        {objects.map(({ id, path }) => (
          <ClipPath key={id} id={`${uid}-${id}`}>
            <Path d={path} />
          </ClipPath>
        ))}
      </Defs>
      {objects.map(({ id, rect, path }) => {
        const pressed = pressedFacility === id;
        const moving = pressed && !reduceMotion;
        const x = rect.x + rect.w / 2,
          y = rect.y + rect.h;
        return (
          <G key={id}>
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
                  href={source}
                  x={0}
                  y={0}
                  width={1536}
                  height={1024}
                  preserveAspectRatio="none"
                />
              </G>
              {pressed && reduceMotion && (
                <Path d={path} fill={tokens.pressedShade} opacity={tokens.pressedShadeOpacity} />
              )}
            </G>
          </G>
        );
      })}
    </Svg>
  );
}
