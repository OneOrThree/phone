/** @jest-environment @shopify/react-native-skia/jestEnv.js */
import React from 'react';
import { render } from '@testing-library/react-native';
import { CatAvatar } from './CatAvatar';
import { appearanceOutfit } from './CatOutfitLayers';
import type { CatalogEntry } from '@/services/customizationCatalog';

jest.mock('@/services/customizationCatalog', () => ({
  useCustomizationCatalog: () => mockTable,
}));
const mockTable: Record<string, CatalogEntry> = {
  mandarin: {
    productId: 'mandarin',
    slot: 'head',
    imageUrl: 'https://x/mandarin.png',
    width: 1254,
    height: 1254,
    anchorX: 0.5,
    anchorY: 0.5,
    catFit: {
      width: 1254,
      height: 1254,
      crop: [329, 349, 940, 942],
      colors: ['black'],
      motions: {},
      stills: ['avatar'],
      rigUrls: {},
      head: {
        drawWidth: 64,
        depthY: 9,
        contacts: { black: { 'still/avatar': { x: 100, y: 100, angleDegrees: 0 } } },
        shadow: { widthFactor: 0.22, height: 2.5 },
      },
    },
  } as unknown as CatalogEntry,
};

test('착용이 없거나 모르는 아이템이면 고양이 그림 한 장뿐이다', async () => {
  const bare = await render(<CatAvatar color="black" size={40} testID="av" />);
  expect(bare.getByTestId('cat-avatar-image')).toBeTruthy();
  expect(bare.queryByTestId('outfit-fit')).toBeNull();
  const unknown = await render(
    <CatAvatar color="black" outfit={appearanceOutfit({ head: 'nope', neck: null })} size={40} />,
  );
  expect(unknown.queryByTestId('outfit-fit')).toBeNull();
});

test('머리·목을 입으면 같은 상자에 합성 캔버스를 얹는다', async () => {
  const worn = await render(
    <CatAvatar color="black" outfit={appearanceOutfit({ head: 'mandarin' })} size={40} />,
  );
  expect(worn.getByTestId('outfit-fit')).toBeTruthy();
});

test('털색이 없으면 그림도 착용도 그리지 않는다', async () => {
  const none = await render(
    <CatAvatar
      color={null}
      outfit={appearanceOutfit({ head: 'mandarin' })}
      size={40}
      testID="av"
    />,
  );
  expect(none.queryByTestId('outfit-fit')).toBeNull();
  expect(none.queryByTestId('cat-avatar-image')).toBeNull();
});

test('appearanceOutfit — 머리·목 문자열만 꺼내고 이상한 값은 미장착', () => {
  expect(appearanceOutfit({ head: 'a', neck: 'b', shoes: 'c' })).toEqual({ head: 'a', neck: 'b' });
  expect(appearanceOutfit(null)).toEqual({ head: null, neck: null });
  expect(appearanceOutfit({ head: 3 })).toEqual({ head: null, neck: null });
  expect(appearanceOutfit({})).toEqual({ head: null, neck: null });
  expect(appearanceOutfit(undefined)).toEqual({ head: null, neck: null });
});
