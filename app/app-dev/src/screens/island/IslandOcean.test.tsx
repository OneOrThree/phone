import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { IslandOcean, OCEAN_WORLD_SIZE, visibleOceanTiles } from './IslandOcean';

it.each([
  [402, 874, -20, 300, 0.27],
  [402, 874, -123, 77, 0.5],
  [874, 402, 20, -5, 2],
  [1024, 1366, -400, -300, 1.5],
  [402, 874, -100000, 200000, 0.26],
])(
  '화면 %s×%s, 원점 %s/%s, 배율 %s에서 보이는 타일만 빈틈없이 배치한다',
  (w, h, left, top, scale) => {
    const tiles = visibleOceanTiles(w, h, left, top, scale);
    const size = OCEAN_WORLD_SIZE * scale;
    expect(tiles.length).toBeLessThanOrEqual((Math.ceil(w / size) + 1) * (Math.ceil(h / size) + 1));
    expect(new Set(tiles.map((tile) => tile.key)).size).toBe(tiles.length);
    for (let y = 0; y < h; y += 7) {
      const row = tiles.filter((tile) => tile.top <= y && tile.top + tile.height > y);
      expect(row.length).toBeGreaterThan(0);
      expect(row[0].left).toBeLessThanOrEqual(0);
      expect(row[row.length - 1].left + row[row.length - 1].width).toBeGreaterThanOrEqual(w);
      row.slice(1).forEach((tile, i) => expect(tile.left).toBeCloseTo(row[i].left + row[i].width));
    }
  },
);

it('월드 원점에 맞춘 반복 무늬를 팬과 줌에도 유지한다', () => {
  const tiles = visibleOceanTiles(402, 874, -20, 300, 0.27);
  const origin = tiles.find((tile) => tile.key === '0:0')!;
  expect(origin.left).toBeCloseTo(-20);
  expect(origin.top).toBeCloseTo(300);
  const moved = visibleOceanTiles(402, 874, -10, 290, 0.27).find((tile) => tile.key === '0:0')!;
  expect(moved.left - origin.left).toBeCloseTo(10);
  expect(moved.top - origin.top).toBeCloseTo(-10);
});

it('레이아웃과 낮·밤 변경을 실제 이미지에 반영한다', async () => {
  const screen = await render(<IslandOcean left={-20} top={300} scale={0.27} />);
  const ocean = () => screen.getByTestId('island-ocean', { includeHiddenElements: true });
  await fireEvent(ocean(), 'layout', { nativeEvent: { layout: { width: 402, height: 874 } } });
  const imageNodes = () => {
    const visit = (node: any): any[] =>
      !node || typeof node !== 'object'
        ? []
        : Array.isArray(node)
          ? node.flatMap(visit)
          : [...(node.type === 'Image' ? [node] : []), ...visit(node.children)];
    return visit(screen.toJSON());
  };
  let images = imageNodes();
  expect(images.length).toBeGreaterThan(0);
  expect(
    images.every(
      (node: any) => node.props.source === require('@/assets/backgrounds/island/ocean/day.png'),
    ),
  ).toBe(true);
  await screen.rerender(<IslandOcean left={20} top={-5} scale={2} night />);
  await fireEvent(ocean(), 'layout', { nativeEvent: { layout: { width: 874, height: 402 } } });
  images = imageNodes();
  expect(images).toHaveLength(visibleOceanTiles(874, 402, 20, -5, 2).length);
  expect(
    images.every(
      (node: any) => node.props.source === require('@/assets/backgrounds/island/ocean/night.png'),
    ),
  ).toBe(true);
  expect(StyleSheet.flatten(images[0].props.style).width).toBe(1024);
});
