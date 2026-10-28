/** @jest-environment @shopify/react-native-skia/jestEnv.js */
// recordFit 은 실제 CanvasKit 으로 기록·재생해 본다(mock 은 jest.setup.js)
import React from 'react';
import { render } from '@testing-library/react-native';
import { Skia } from '@shopify/react-native-skia';
import {
  CatOutfitLayers,
  FRAME_CACHE,
  OutfitItemArt,
  cachedFrame,
  outfitLayers,
  outfitRect,
  recordFit,
} from './CatOutfitLayers';
import type { CatalogEntry, CatFit } from '@/services/customizationCatalog';

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
  // 집중 보상 머리(GROMO-2382) — 크롭 611×593
  mandarin: entry('mandarin', 'head', {
    catFit: {
      width: 1254,
      height: 1254,
      crop: [329, 349, 940, 942],
      colors: ['black', 'ginger'],
      motions: { walk: 6, focus: 4, reel: 4, blink: 3, read: 6 },
      stills: ['idle', 'loaf', 'avatar'],
      rigUrls: { black: 'https://x/rig.json' },
      head: {
        drawWidth: 64,
        depthY: 9,
        contacts: {
          black: { 'walk-0': { x: 277, y: 182, angleDegrees: -20.6 } },
          ginger: { 'walk-0': { x: 278, y: 183, angleDegrees: -19.7 } },
        },
        shadow: { widthFactor: 0.22, height: 2.5 },
      },
    },
  }),
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

const walk0 = { color: 'black', motion: 'walk', frame: 0, size: 100 };

test('cat-fit 항목은 자세를 모르는 정지 그림에서 숨기고, 자세가 오면 정적 오버레이 대신 캔버스로 그린다', async () => {
  // 자세를 모르는 그림(pose 없음) — 귤은 숨기고 오리 모자 같은 정적 오버레이는 그대로
  const unknown = await render(<CatOutfitLayers outfit={{ head: 'mandarin', neck: 'scarf' }} />);
  expect(unknown.queryByTestId('outfit-fit')).toBeNull();
  expect(unknown.getByTestId('outfit-neck')).toBeTruthy();
  // 옷장·뗏목 정지 그림(still/idle) — 정적 오버레이와 귤을 함께 그린다
  const still = await render(
    <CatOutfitLayers
      outfit={{ head: 'mandarin', neck: 'scarf' }}
      pose={{ color: 'ginger', still: 'idle', size: 100 }}
    />,
  );
  expect(still.getByTestId('outfit-fit')).toBeTruthy();
  expect(still.getByTestId('outfit-neck')).toBeTruthy();
  // CatSprite 자세 — 정적 오버레이는 그 자세 좌표가 없어 그리지 않고 cat-fit 만 캔버스로
  const posed = await render(
    <CatOutfitLayers outfit={{ head: 'mandarin', neck: 'scarf' }} pose={walk0} />,
  );
  expect(posed.getByTestId('outfit-fit')).toBeTruthy();
  expect(posed.queryByTestId('outfit-neck')).toBeNull();
  const onlyStatic = await render(<CatOutfitLayers outfit={{ neck: 'scarf' }} pose={walk0} />);
  expect(onlyStatic.toJSON()).toBeNull();
  // 자료에 없는 털색은 그림·rig 를 받지도 않는다
  const calico = await render(
    <CatOutfitLayers outfit={{ head: 'mandarin' }} pose={{ ...walk0, color: 'calico' }} />,
  );
  expect(calico.toJSON()).toBeNull();
});

test('프로필 그림(still/avatar)은 고양이를 키워 그려 정적 오버레이를 숨기고 cat-fit 만 그린다', async () => {
  const avatar = await render(
    <CatOutfitLayers
      outfit={{ head: 'mandarin', neck: 'scarf' }}
      pose={{ color: 'ginger', still: 'avatar', size: 100 }}
    />,
  );
  expect(avatar.getByTestId('outfit-fit')).toBeTruthy();
  expect(avatar.queryByTestId('outfit-neck')).toBeNull();
});

test('OutfitItemArt — cat-fit 은 대표 영역만 잘라 상자에 맞추고, 정적 오버레이는 그림 전체', async () => {
  const art = await render(<OutfitItemArt entry={mockTable.mandarin} size={120} testID="art" />);
  const scale = 120 / 611;
  const crop = art.getByTestId('art');
  expect(crop.props.style).toEqual([
    { overflow: 'hidden' },
    { width: 611 * scale, height: 593 * scale },
  ]);
  const image = crop.children[0] as unknown as { props: { style: unknown } };
  expect(image.props.style).toEqual([
    { position: 'absolute' },
    { width: 1254 * scale, height: 1254 * scale, left: -329 * scale, top: -349 * scale },
  ]);
  const plain = await render(<OutfitItemArt entry={mockTable.hat} size={60} testID="plain" />);
  expect(plain.getByTestId('plain').props.style).toEqual({ width: 60, height: 60 });
});

test('recordFit — 머리는 접촉점 위에 그리고, 목은 가림 영역을 지운 레이어로 기록한다', () => {
  const { makeOffscreenSurface } = jest.requireActual(
    '@shopify/react-native-skia/lib/commonjs/headless',
  );
  const info = { width: 4, height: 4, colorType: 4, alphaType: 3 };
  const solid = Skia.Image.MakeImage(info, Skia.Data.fromBytes(new Uint8Array(64).fill(255)), 16)!;
  const alphaAt = (pictures: (ReturnType<typeof recordFit> | null)[], x: number, y: number) => {
    const surface = makeOffscreenSurface(512, 512);
    pictures.forEach((p) => surface.getCanvas().drawPicture(p!));
    surface.flush();
    const px = surface
      .makeImageSnapshot()
      .readPixels(x, y, { ...info, width: 1, height: 1 }) as Uint8Array;
    surface.dispose();
    return px[3];
  };
  const base = {
    width: 4,
    height: 4,
    crop: [0, 0, 4, 4] as const,
    colors: ['black'],
    motions: { walk: 6 },
    stills: ['avatar'],
    rigUrls: {},
  };
  // 머리: (100, 100 + 5) 에 폭 20 → x 90~110, y 85~105
  const headFit = {
    ...base,
    head: {
      drawWidth: 20,
      depthY: 5,
      contacts: {
        black: {
          'walk-0': { x: 100, y: 100, angleDegrees: 0 },
          // 프로필: 보통 크기 좌표 (100, 100) 을 2배로 키워 (+10, +20) 옮긴 그림 → (210, 230) 근처
          'still/avatar': { x: 100, y: 100, angleDegrees: 0, view: { x: 10, y: 20, scale: 2 } },
        },
      },
      shadow: { widthFactor: 0.22, height: 2.5 },
    },
  };
  const head = recordFit(headFit, 'black', 'walk-0', solid, null, null);
  expect(alphaAt([head], 100, 95)).toBe(255);
  expect(alphaAt([head], 100, 80)).toBe(0);
  const avatar = recordFit(headFit, 'black', 'still/avatar', solid, null, null);
  expect(alphaAt([avatar], 210, 215)).toBe(255);
  expect(alphaAt([avatar], 100, 95)).toBe(0);
  expect(recordFit(headFit, 'ginger', 'walk-0', solid, null, null)).toBeNull();
  expect(recordFit({ ...base, head: undefined }, 'black', 'walk-0', solid, null, null)).toBeNull();
  // 목: 띠는 y 100~110, 왼쪽 반(60~100)은 앞발 가림으로 지운다
  const neckFit = {
    ...base,
    neck: {
      style: 'pendant' as const,
      front: [0, 0, 4, 4] as const,
      commonBand: { url: '', box: [0, 0, 4, 4] as const },
    },
  };
  const rig = {
    frames: {
      'walk-0': {
        paths: [
          [
            [60, 100, 110],
            [140, 100, 110],
          ],
        ],
        anchor: [200, 200],
        angle: 0,
        occluders: [
          [
            [60, 95],
            [100, 95],
            [100, 115],
            [60, 115],
          ],
        ],
      },
    },
  };
  const neck = recordFit(neckFit, 'black', 'walk-0', solid, solid, rig);
  // 띠는 0.65px 열을 0.5px 간격으로 겹쳐 그려 가장자리 보간이 남는다
  expect(alphaAt([neck], 120, 105)).toBeGreaterThan(200);
  expect(alphaAt([neck], 80, 105)).toBe(0);
  // 독서처럼 rig 에 그 프레임이 없으면 목을 그리지 않는다
  expect(recordFit(neckFit, 'black', 'read-0', solid, solid, rig)).toBeNull();
});

test('프레임 캐시는 앱 전체 LRU — 같은 키는 한 번 그리고, 꺼낸 것은 뒤로 가서 오래 안 쓴 것부터 버린다', () => {
  const fit = {} as CatFit;
  const made: string[] = [];
  const get = (key: string, f: CatFit = fit) =>
    cachedFrame(`lru|${key}`, f, () => {
      made.push(key);
      return null;
    });
  get('a');
  get('b');
  get('a');
  expect(made).toEqual(['a', 'b']);
  // a·b 포함 정확히 FRAME_CACHE 장을 채운 뒤 a 를 꺼내면, 다음 한 장이 들어올 때 b 가 빠진다
  for (let i = 0; i < FRAME_CACHE - 2; i++) get(`f${i}`);
  get('a');
  get('new');
  made.length = 0;
  get('a');
  get('b');
  expect(made).toEqual(['b']);
  // 자료가 바뀌면(카탈로그 재조회) 같은 키도 다시 그린다
  get('a', {} as CatFit);
  expect(made).toEqual(['b', 'a']);
});
