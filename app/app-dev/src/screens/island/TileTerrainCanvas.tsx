import React, { useMemo } from 'react';
import {
  Atlas,
  Canvas,
  Group,
  rect,
  Skia,
  useImage,
  type SkRect,
  type SkRSXform,
} from '@shopify/react-native-skia';
import bundledTilemap from '@/assets/village-world/v1/tilemap.json';
import bundledTileset from '@/assets/village-world/v1/tileset.json';
import { activeTilesetUri, readMapJson } from '@/services/mapAssets';

// 타일 섬 지형(GROMO-2230): terrain.png 한 장 대신 tileset@2x.png 의 384 조각을 Atlas 한 번(드로우콜 1)으로 그린다.
// 소품·건물은 지금처럼 VillageScenery 가 RN 뷰로 그린다 — 한 캔버스로 합치는 건 실기기 측정 뒤 다음 단계.
// 실기기 측정 항목: tileset@2x.png 는 4096×2048 RGBA(≈32 MB)라 최대 텍스처 크기가 4096 인 일부 저사양 Android 기기에서
// 한계에 걸리거나 메모리 부담이 될 수 있다. 코드는 그대로 두고 실기기에서 로드·메모리를 확인한다.

/** tilemap 의 terrain 레이어를 아틀라스 소스 rect(2x)·목적지 rsxform(1x)으로 바꾼다. gid 0 은 빈 칸. */
export function buildTerrainAtlas() {
  // 활성 소스(GROMO-2233)가 cache 면 캐시본, 아니면 번들 — 이미지와 같은 버전에서 읽는다.
  const tilemap = readMapJson('tilemap.json', bundledTilemap);
  const tileset = readMapJson('tileset.json', bundledTileset);
  const terrain = tilemap.layers.find((layer) => layer.name === 'terrain')!;
  const { tilewidth, tileheight, margin, spacing, columns, scale } = tileset;
  const sprites: SkRect[] = [],
    transforms: SkRSXform[] = [];
  for (let i = 0; i < terrain.data.length; i++) {
    const gid = terrain.data[i];
    if (!gid) continue;
    const slot = gid - 1;
    sprites.push(
      rect(
        margin + (slot % columns) * (tilewidth + spacing),
        margin + Math.floor(slot / columns) * (tileheight + spacing),
        tilewidth,
        tileheight,
      ),
    );
    // 2x 원화를 1/scale 로 줄여 1x 이미지 좌표(지형 1536×1024)에 놓는다. 회전 없음.
    transforms.push(
      Skia.RSXform(
        1 / scale,
        0,
        (i % tilemap.width) * tilemap.tilewidth,
        Math.floor(i / tilemap.width) * tilemap.tileheight,
      ),
    );
  }
  return { sprites, transforms };
}

/**
 * WorldMap 의 지형 `<Image>` 와 같은 투영(scale = base·z, 화면 중앙에 camera.x·y)을 Group transform 하나로 적용한다.
 * 샘플링은 기본(bilinear) — 원화를 자른 타일이라 nearest 로 두면 줌에서 계단이 생긴다.
 * ponytail: 카메라는 React state 라 팬·줌마다 이 컴포넌트가 다시 렌더된다(배열은 이미지 로드 뒤 useMemo 로 한 번만).
 * 측정에서 p95 16.7ms 를 넘으면 camera 를 Reanimated shared value 로 옮겨 Group transform 만 UI 스레드에서 바꾼다.
 */
export function TileTerrainCanvas({
  width,
  height,
  camera,
  base,
}: {
  width: number;
  height: number;
  camera: { x: number; y: number; z: number };
  base: number;
}) {
  // Metro 는 `@2x` 를 배율 접미사로 읽어 파일명 그대로는 못 찾는다 — 기본 이름으로 부르면 tileset@2x.png 변형을 고른다.
  // 활성 소스가 cache 면 파일 URI(GROMO-2233). 소스는 화면 수명 동안 고정이라 마운트 때 한 번만 고른다.
  // 번들 쪽은 Metro 의 @2x 배율 해석에 기댄 우회, Expo 57 / `expo export --platform ios` 로 확인(2026-10-08).
  const source = useMemo(
    () => activeTilesetUri() ?? require('@/assets/village-world/v1/tileset.png'),
    [],
  );
  const image = useImage(source);
  // 이미지가 뜬 뒤 한 번만 만든다. 로드 전에는 기존 Image 처럼 아무것도 그리지 않는다(뒤의 바다 배경이 보인다).
  const atlas = useMemo(() => (image ? buildTerrainAtlas() : null), [image]);
  if (!image || !atlas) return null;
  const scale = base * camera.z;
  return (
    <Canvas pointerEvents="none" style={{ position: 'absolute', width, height }}>
      <Group
        transform={[
          { translateX: width / 2 - camera.x * scale },
          { translateY: height / 2 - camera.y * scale },
          { scale },
        ]}
      >
        <Atlas image={image} sprites={atlas.sprites} transforms={atlas.transforms} />
      </Group>
    </Canvas>
  );
}
