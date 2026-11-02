/** @jest-environment @shopify/react-native-skia/jestEnv.js */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { CatAvatar } from './CatAvatar';
import { appearanceOutfit } from './CatOutfitLayers';
import { art } from '@/constants/art';
import type { CatalogEntry } from '@/services/customizationCatalog';
import { fakeMemberLooksServer } from '@/services/memberLooks.testing';

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

// userId 경로 — 세션·memberLooks·request 는 실물이고 서버 자리의 fetch 만 대신한다
const server = fakeMemberLooksServer();
afterEach(() => server.stop());
const USER = '11111111-1111-4111-8111-111111111111';

test('userId 가 있으면 묶음 조회로 읽은 털색·착용을 그리고 호출부가 준 값은 쓰지 않는다', async () => {
  await server.start({ [USER]: { catColor: 'black', appearance: { head: 'mandarin' } } });
  const ui = await render(<CatAvatar userId={USER} color="white" size={40} />);
  await waitFor(() => expect(ui.getByTestId('outfit-fit')).toBeTruthy());
  expect(ui.getByTestId('cat-avatar-image').props.source).toBe(art['avatar/black']);
  expect(server.asked).toEqual([USER]);
});

test('서버가 가린 사용자(hiddenUserIds)는 호출부가 준 털색이 있어도 빈 상자다', async () => {
  await server.start({}); // USER 를 서버가 모른다 → hiddenUserIds
  const ui = await render(
    <CatAvatar
      userId={USER}
      color="black"
      outfit={appearanceOutfit({ head: 'mandarin' })}
      size={40}
    />,
  );
  await waitFor(() => expect(ui.queryByTestId('cat-avatar-image')).toBeNull());
  expect(ui.queryByTestId('outfit-fit')).toBeNull();
  expect(server.asked).toEqual([USER]);
});

test('조회가 실패하면 색을 추측하지 않는다 — 호출부 값이 없으면 빈 상자, 있으면 그 값을 유지한다', async () => {
  await server.start({ [USER]: { catColor: 'black' } }, true); // 모든 조회가 500
  const none = await render(<CatAvatar userId={USER} color={null} size={40} />);
  await waitFor(() => expect(server.asked).toEqual([USER]));
  expect(none.queryByTestId('cat-avatar-image')).toBeNull();
  const kept = await render(<CatAvatar userId={USER} color="ginger" size={40} />);
  expect(kept.getByTestId('cat-avatar-image').props.source).toBe(art['avatar/ginger']);
});

test('appearanceOutfit — 머리·목 문자열만 꺼내고 이상한 값은 미장착', () => {
  expect(appearanceOutfit({ head: 'a', neck: 'b', shoes: 'c' })).toEqual({ head: 'a', neck: 'b' });
  expect(appearanceOutfit(null)).toEqual({ head: null, neck: null });
  expect(appearanceOutfit({ head: 3 })).toEqual({ head: null, neck: null });
  expect(appearanceOutfit({})).toEqual({ head: null, neck: null });
  expect(appearanceOutfit(undefined)).toEqual({ head: null, neck: null });
});
