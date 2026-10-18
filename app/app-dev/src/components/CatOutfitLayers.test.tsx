import React from 'react';
import { render } from '@testing-library/react-native';
import { CatOutfitLayers, outfitLayers, outfitRect } from './CatOutfitLayers';
import type { CatalogEntry } from '@/services/customizationCatalog';

jest.mock('@/services/customizationCatalog', () => ({
  useCustomizationCatalog: () => mockTable,
}));
const entry = (productId: string, slot: string, over: Partial<CatalogEntry> = {}) =>
  ({
    productId,
    slot,
    kind: slot,
    title: productId,
    imageUrl: `https://x/${productId}.png`,
    width: 256,
    height: 128,
    anchorX: 0.5,
    anchorY: 0.25,
    sortOrder: 0,
    retiredAt: null,
    ...over,
  }) as CatalogEntry;
const mockTable: Record<string, CatalogEntry> = {
  hat: entry('hat', 'head'),
  scarf: entry('scarf', 'neck'),
  boots: entry('boots', 'shoes'),
};

test('shoes → neck → head 순서, anchor 는 그림 중심 기준 % 좌표', () => {
  expect(
    outfitLayers({ head: 'hat', neck: 'scarf', shoes: 'boots' }, mockTable).map((e) => e.slot),
  ).toEqual(['shoes', 'neck', 'head']);
  // 고양이 캔버스(1254²)와 같은 크기의 전면 오버레이 — 상자를 꽉 채우고 offset 0
  expect(outfitRect(entry('full', 'head', { width: 1254, height: 1254, anchorY: 0.5 }))).toEqual({
    width: '100%',
    height: '100%',
    left: '0%',
    top: '0%',
  });
  // 잘라낸 소품(313px, anchor 0.5/0.1) — 25% 크기, 중심이 anchor 에 놓인다
  expect(outfitRect(entry('prop', 'head', { width: 313.5, height: 313.5, anchorY: 0.1 }))).toEqual({
    width: '25%',
    height: '25%',
    left: '37.5%',
    top: '-2.5%',
  });
});

test('키 없음·null·모르는 id 는 모두 미장착 — 레이어를 그리지 않는다', async () => {
  const none = await render(<CatOutfitLayers outfit={{ neck: null, shoes: 'unknown' }} />);
  expect(none.toJSON()).toBeNull();
  const some = await render(<CatOutfitLayers outfit={{ head: 'hat' }} />);
  expect(some.getByTestId('outfit-head')).toBeTruthy();
});
