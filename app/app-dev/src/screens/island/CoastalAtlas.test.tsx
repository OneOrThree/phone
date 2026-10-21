/** @jest-environment @shopify/react-native-skia/jestEnv.js */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { CoastalAtlas } from './CoastalAtlas';

const { makeOffscreenSurface, drawOffscreen, getSkiaExports } = jest.requireActual(
  '@shopify/react-native-skia/lib/commonjs/headless',
);

it('구 캐시 원화에 마스크를 씌우면 바다는 투명하고 육지는 원본 색을 유지한다', async () => {
  const { Skia } = getSkiaExports();
  const load = (file: string) =>
    Skia.Image.MakeImageFromEncoded(
      Skia.Data.fromBytes(
        fs.readFileSync(path.join(__dirname, '../../assets/backgrounds/island', file)),
      ),
    );
  const surface = makeOffscreenSurface(1536, 1024);
  const original = load('base/day.png');
  const mask = load('ocean/home-mask.png');
  const render = async (image: any, alpha?: any) =>
    drawOffscreen(
      surface,
      <CoastalAtlas
        image={image}
        mask={alpha}
        sprites={[{ x: 0, y: 0, width: 1536, height: 1024 }]}
        transforms={[Skia.RSXform(1, 0, 0, 0)]}
      />,
    );
  const old = await render(original, mask);
  const fresh = await render(load('ocean/home-day.png'));
  const info = { width: 1536, height: 1024, colorType: 4, alphaType: 3 };
  const a = old.readPixels(0, 0, info) as Uint8Array;
  const b = fresh.readPixels(0, 0, info) as Uint8Array;
  const pixel = (data: Uint8Array, x: number, y: number) => [
    ...data.slice((y * 1536 + x) * 4, (y * 1536 + x) * 4 + 4),
  ];
  expect(pixel(a, 0, 0)[3]).toBe(0);
  expect(pixel(a, 800, 1000)[3]).toBe(0);
  expect(pixel(a, 700, 400)).toEqual(pixel(b, 700, 400));
  expect(pixel(a, 700, 400)[3]).toBe(255);
  surface.dispose();
});
