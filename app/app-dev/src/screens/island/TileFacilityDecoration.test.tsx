import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, configure } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  TILE_FACILITY_OUTLINE_MARGIN,
  TileFacilityOutline,
  tileFacilityLayerSource,
  tileFacilityOutlineSource,
} from './TileFacilityDecoration';
import { ImageTerrainFacilities } from './ImageTerrainFacilities';
import { TILE_FACILITIES, TILE_MAILBOX_PELICAN_RECT, type FacilityRect } from './tileFacilities';
import { componentTokens } from '@/design-system/tokens';
configure({ defaultIncludeHiddenElements: true });

const tokens = componentTokens.tileFacility;
const night = [false, true];
// jest 의 require(png) 는 { testUri } 다. 실제 파일의 PNG 헤더(IHDR)에서 가로·세로를 읽는다.
const pngSize = (source: unknown) => {
  const rel = (source as { testUri: string }).testUri.replace(/^(\.\.\/)+/, '');
  const head = fs.readFileSync(path.join(__dirname, '../../..', rel)).subarray(16, 24);
  return { w: head.readUInt32BE(0), h: head.readUInt32BE(4) };
};
const collect = (tree: unknown, type: string) => {
  const nodes: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === type) nodes.push(node);
    (node.children ?? []).forEach(walk);
  };
  walk(tree);
  return nodes;
};

it('외곽선은 빠른 줌에도 기본 이미지 좌표를 유지하고 미리 그린 마스크 한 장을 건물과 함께 확대한다', async () => {
  const rect = TILE_FACILITIES.tower;
  const baseScale = 0.73;
  const source = tileFacilityOutlineSource('tower', false)!;
  const outline = (scale: number) => (
    <TileFacilityOutline
      source={source}
      rect={rect}
      left={-120}
      top={50}
      scale={scale}
      baseScale={baseScale}
      pressed={false}
      reduceMotion={false}
    />
  );
  const screen = await render(outline(1));
  for (const scale of [0.26, 1.9, 0.35, 1.5, 0.26]) {
    await screen.rerender(outline(scale));
    const outer = StyleSheet.flatten(screen.getByTestId('native-facility-outline').props.style);
    expect(outer).toMatchObject({
      left: -120 + rect.x * scale,
      top: 50 + rect.y * scale,
      width: rect.w * baseScale,
      height: rect.h * baseScale,
    });
    expect(outer.transform).toEqual([{ scale: scale / baseScale }]);
    // 8방향 복제 대신 한 장. 마스크는 rect 사방 MARGIN 만큼 크고, 그만큼 왼쪽 위로 당겨 놓는다.
    const nodes = collect(screen.toJSON(), 'Image');
    expect(nodes).toHaveLength(1);
    const image = StyleSheet.flatten(nodes[0].props.style);
    const pad = tokens.outlineWidth * 2,
      margin = TILE_FACILITY_OUTLINE_MARGIN * baseScale;
    expect(image).toMatchObject({
      left: pad - margin,
      top: pad - margin,
      width: rect.w * baseScale + margin * 2,
      height: rect.h * baseScale + margin * 2,
      tintColor: tokens.outline,
    });
    expect(nodes[0].props.source).toBe(source);
    expect(nodes[0].props.fadeDuration).toBe(0);
  }
  await screen.unmount();
});

it.each(night)('외곽선 마스크(밤 %s)는 시설 rect 사방으로 MARGIN 만큼 크다', (isNight) => {
  // 외곽선 두께는 build-facility-crops.py OUTLINE_PT 로 미리 그렸다. 토큰을 바꾸면 마스크도 다시 만든다.
  expect(tokens.outlineWidth).toBe(2);
  const rects: Record<string, FacilityRect> = {
    ...TILE_FACILITIES,
    'mail-pelican': TILE_MAILBOX_PELICAN_RECT,
  };
  for (const id of ['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop', 'mail-pelican']) {
    const rect = rects[id];
    expect([id, pngSize(tileFacilityOutlineSource(id, isNight))]).toEqual([
      id,
      {
        w: rect.w + TILE_FACILITY_OUTLINE_MARGIN * 2,
        h: rect.h + TILE_FACILITY_OUTLINE_MARGIN * 2,
      },
    ]);
  }
});

it.each(night)('잘린 정적 건물·지형 그림(밤 %s)은 원화 rect 크기 그대로다', (isNight) => {
  for (const id of ['board', 'gram', 'mail']) {
    const { w, h } = TILE_FACILITIES[id];
    expect([id, pngSize(tileFacilityLayerSource(id, isNight))]).toEqual([id, { w, h }]);
  }
  expect(tileFacilityLayerSource('hall', isNight)).toBeUndefined();
});

it.each(night)(
  '지형 시설(밤 %s)은 rect 둘레만 덮는 SVG 에 잘린 지형을 원화 좌표 그대로 놓는다',
  async (isNight) => {
    const left = -40,
      top = 25,
      scale = 0.5,
      baseScale = 0.73;
    const screen = await render(
      <ImageTerrainFacilities
        left={left}
        top={top}
        scale={scale}
        baseScale={baseScale}
        night={isNight}
        reduceMotion={false}
      />,
    );
    const pad = (tokens.outlineWidth * 2 + tokens.pressOffset) / baseScale;
    const svgs = collect(screen.toJSON(), 'RNSVGSvgView');
    const images = collect(screen.toJSON(), 'RNSVGImage');
    expect(svgs).toHaveLength(2);
    expect(images).toHaveLength(2);
    ['fire', 'raft'].forEach((id, k) => {
      const rect = TILE_FACILITIES[id];
      const box = StyleSheet.flatten(svgs[k].props.style);
      expect(box).toMatchObject({
        left: left + (rect.x - pad) * scale,
        top: top + (rect.y - pad) * scale,
      });
      expect(svgs[k].props.bbWidth).toBeCloseTo((rect.w + pad * 2) * scale);
      expect(svgs[k].props.bbHeight).toBeCloseTo((rect.h + pad * 2) * scale);
      expect(svgs[k].props).toMatchObject({ minX: rect.x - pad, minY: rect.y - pad });
      const { x, y, width, height } = images[k].props;
      expect([x, y, width, height].map(Number)).toEqual([rect.x, rect.y, rect.w, rect.h]);
      expect(pngSize(images[k].props.src)).toEqual({ w: rect.w, h: rect.h });
    });
    await screen.unmount();
  },
);
