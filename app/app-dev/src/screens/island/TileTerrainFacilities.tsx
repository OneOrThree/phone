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
import { TILE_FACILITIES } from './tileFacilities';

// 바닥 원화에 포함된 두 시설의 외곽. 원본 타일을 그대로 잘라 사용하므로 낮·밤·캐시 에셋이 함께 바뀐다.
const contours = {
  fire: [
    [2, 31],
    [6, 19],
    [17, 11],
    [30, 5],
    [44, 1],
    [58, 2],
    [70, 0],
    [86, 5],
    [100, 13],
    [109, 24],
    [113, 37],
    [107, 48],
    [96, 55],
    [79, 61],
    [57, 64],
    [35, 61],
    [18, 55],
    [6, 45],
  ],
  raft: [
    [3, 58],
    [13, 48],
    [25, 48],
    [38, 39],
    [53, 31],
    [69, 21],
    [80, 12],
    [90, 6],
    [106, 5],
    [116, 10],
    [133, 12],
    [142, 19],
    [155, 20],
    [165, 28],
    [166, 39],
    [159, 49],
    [142, 55],
    [130, 65],
    [115, 70],
    [97, 80],
    [80, 90],
    [68, 100],
    [54, 101],
    [43, 96],
    [34, 88],
    [20, 88],
    [11, 81],
    [3, 79],
  ],
};
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
      Object.entries(contours).map(([id, points]) => {
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
