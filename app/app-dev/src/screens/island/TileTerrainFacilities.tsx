import React, { useMemo } from 'react';
import {
  Atlas,
  Group,
  Path,
  Skia,
  type SkImage,
  type SkRect,
  type SkRSXform,
} from '@shopify/react-native-skia';
import { componentTokens } from '@/design-system/tokens';
import { TILE_FACILITIES, TERRAIN_FACILITY_CONTOURS } from './tileFacilities';

// 바닥 원화에 포함된 두 시설의 외곽. 원본 타일을 그대로 잘라 사용하므로 낮·밤·캐시 에셋이 함께 바뀐다.
const tokens = componentTokens.tileFacility;

export function TileTerrainFacilities({
  image,
  atlas,
  scale,
  pressedFacility,
  reduceMotion,
  night,
}: {
  image: SkImage;
  atlas: { sprites: SkRect[]; transforms: SkRSXform[] };
  scale: number;
  pressedFacility?: string | null;
  reduceMotion: boolean;
  night: boolean;
}) {
  const objects = useMemo(
    () =>
      Object.entries(TERRAIN_FACILITY_CONTOURS).map(([id, points]) => {
        const r = TILE_FACILITIES[id];
        const path = Skia.PathBuilder.Make();
        points.forEach(([x, y], i) =>
          i ? path.lineTo(r.x + x, r.y + y) : path.moveTo(r.x + x, r.y + y),
        );
        const indices = atlas.transforms.flatMap((t, i) =>
          t.tx < r.x + r.w &&
          t.ty < r.y + r.h &&
          t.tx + atlas.sprites[i].width * t.scos > r.x &&
          t.ty + atlas.sprites[i].height * t.scos > r.y
            ? [i]
            : [],
        );
        return {
          id,
          rect: r,
          path: path.close().build(),
          sprites: indices.map((i) => atlas.sprites[i]),
          transforms: indices.map((i) => atlas.transforms[i]),
        };
      }),
    [atlas],
  );
  return (
    <>
      {objects.map(({ id, rect, path, sprites, transforms }) => {
        const pressed = pressedFacility === id;
        const moving = pressed && !reduceMotion;
        return (
          <Group key={id}>
            {moving && (
              <Path
                path={path}
                color={tokens.terrainUnderlay[night ? 'night' : 'day'][id as 'fire' | 'raft']}
              />
            )}
            <Group
              origin={{ x: rect.x + rect.w / 2, y: rect.y + rect.h }}
              transform={
                moving
                  ? [{ translateY: tokens.pressOffset / scale }, { scale: tokens.pressScale }]
                  : []
              }
            >
              <Path
                path={path}
                style="stroke"
                strokeJoin="round"
                strokeWidth={(tokens.outlineWidth * 2) / scale}
                color={tokens.outline}
              />
              <Group clip={path}>
                <Atlas image={image} sprites={sprites} transforms={transforms} />
              </Group>
              {pressed && reduceMotion && (
                <Path
                  path={path}
                  color={tokens.pressedShade}
                  opacity={tokens.pressedShadeOpacity}
                />
              )}
            </Group>
          </Group>
        );
      })}
    </>
  );
}
