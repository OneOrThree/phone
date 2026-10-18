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
  expect(outfitRect(mockTable.hat)).toEqual({
    width: '50%',
    height: '25%',
    left: '25%',
    top: '12.5%',
  });
});

test('키 없음·null·모르는 id 는 모두 미장착 — 레이어를 그리지 않는다', async () => {
  const none = await render(<CatOutfitLayers outfit={{ neck: null, shoes: 'unknown' }} />);
  expect(none.toJSON()).toBeNull();
  const some = await render(<CatOutfitLayers outfit={{ head: 'hat' }} />);
  expect(some.getByTestId('outfit-head')).toBeTruthy();
});
