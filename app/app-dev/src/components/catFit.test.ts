import type { CatFit } from '@/services/customizationCatalog';
import { catFitArtBox, catFitFrameId, headLayer, neckLayer } from './catFit';

const base = {
  width: 1254,
  height: 1254,
  colors: ['black', 'ginger'],
  motions: { walk: 6, focus: 4, reel: 4, blink: 3, read: 6 },
  stills: ['idle', 'loaf', 'avatar'],
  rigUrls: { black: 'https://x/neck.json', ginger: 'https://x/neck-ginger.json' },
};
// 서버 render_data 의 귤 한 알(cust.head.mandarin) 값 그대로(검정 contactFrames · 치즈 colorContactFrames 일부)
const mandarin: CatFit = {
  ...base,
  crop: [329, 349, 940, 942],
  head: {
    drawWidth: 64,
    depthY: 9,
    contacts: {
      black: {
        'walk-0': { x: 277, y: 182, angleDegrees: -20.6 },
        'reel-2': { x: 238, y: 108, angleDegrees: -22 },
      },
      ginger: {
        'walk-0': { x: 278, y: 183, angleDegrees: -19.7 },
        'still/avatar': {
          x: 259.57,
          y: 108.77,
          angleDegrees: -13.2,
          view: { x: -1.53, y: 126.36, scale: 1.1 },
        },
      },
    },
    shadow: { widthFactor: 0.22, height: 2.5 },
  },
};

test('자료에 있는 털색·자세·프레임·정지 그림만 프레임 id 가 있다', () => {
  expect(catFitFrameId(mandarin, { color: 'black', motion: 'walk', frame: 5 })).toBe('walk-5');
  expect(catFitFrameId(mandarin, { color: 'ginger', motion: 'reel', frame: 3 })).toBe('reel-3');
  expect(catFitFrameId(mandarin, { color: 'black', motion: 'blink', frame: 2 })).toBe('blink-2');
  expect(catFitFrameId(mandarin, { color: 'black', motion: 'read', frame: 5 })).toBe('read-5');
  expect(catFitFrameId(mandarin, { color: 'ginger', still: 'loaf' })).toBe('still/loaf');
  expect(catFitFrameId(mandarin, { color: 'black', motion: 'walk', frame: 6 })).toBeNull();
  // 기지개·던지기와 자료에 없는 정지 그림·털색은 그리지 않는다
  expect(catFitFrameId(mandarin, { color: 'black', motion: 'stretch', frame: 0 })).toBeNull();
  expect(catFitFrameId(mandarin, { color: 'black', motion: 'cast', frame: 0 })).toBeNull();
  expect(catFitFrameId(mandarin, { color: 'black', still: 'sleep' })).toBeNull();
  expect(catFitFrameId(mandarin, { color: 'calico', motion: 'walk', frame: 0 })).toBeNull();
  // 독서는 머리만 — 목은 rig 에 프레임이 있어도 그리지 않는다
  const neck: CatFit = {
    ...mandarin,
    head: undefined,
    neck: {
      style: 'pendant',
      front: [406, 406, 839, 913],
      commonBand: { url: 'https://x/band.png', box: [82, 392, 1693, 493] },
    },
  };
  expect(catFitFrameId(neck, { color: 'black', motion: 'read', frame: 0 })).toBeNull();
  expect(catFitFrameId(neck, { color: 'black', motion: 'walk', frame: 0 })).toBe('walk-0');
  // 옛 자료(validatedColors 없음)는 검정만 — 파서가 colors 를 ['black'] 으로 채운다
  expect(
    catFitFrameId(
      { ...mandarin, colors: ['black'] },
      { color: 'ginger', motion: 'walk', frame: 0 },
    ),
  ).toBeNull();
});

test('머리 — 접촉점 + itemDepthY 에 크롭 아래 가운데를 두고 접촉 각도로 돌린다', () => {
  // walk-0: (277, 182 + 9), -20.6°. 폭 drawWidth 64, 높이는 알파 크롭 비율 64 × 593 / 611
  const h = (64 * 593) / 611;
  expect(h).toBeCloseTo(62.1146, 3);
  expect(headLayer(mandarin, 'black', 'walk-0')).toEqual({
    shadow: { x: 277, y: 191, deg: -20.6, rx: 64 * 0.22, ry: 2.5 },
    op: {
      img: 'item',
      src: [329, 349, 611, 593],
      dst: [-32, -h, 64, h],
      at: { x: 277, y: 191, deg: -20.6 },
    },
    view: undefined,
  });
  // reel-2 는 들어 올린 접촉점(+12, +5)이 이미 반영된 값이다 — 앱이 다시 더하지 않는다
  expect(headLayer(mandarin, 'black', 'reel-2')!.op.at).toEqual({ x: 238, y: 117, deg: -22 });
  expect(headLayer(mandarin, 'black', 'focus-0')).toBeNull();
  // 털색마다 자기 접촉점 — 치즈 walk-0 은 (278, 183 + 9), -19.7°
  expect(headLayer(mandarin, 'ginger', 'walk-0')!.op.at).toEqual({ x: 278, y: 192, deg: -19.7 });
  // 프로필 그림은 보통 크기 좌표 + view(옮기고 키우기)
  const avatar = headLayer(mandarin, 'ginger', 'still/avatar')!;
  expect(avatar.op.at).toEqual({ x: 259.57, y: 117.77, deg: -13.2 });
  expect(avatar.view).toEqual({ x: -1.53, y: 126.36, scale: 1.1 });
  expect(headLayer(mandarin, 'calico', 'walk-0')).toBeNull();
});

test('목 펜던트 — 공통 목줄을 먼저 곡선에 붙이고 장식을 rig 의 고정점·각도에 얹는다', () => {
  const pendant: CatFit = {
    ...base,
    crop: [406, 406, 839, 913],
    neck: {
      style: 'pendant',
      front: [406, 406, 839, 913],
      commonBand: { url: 'https://x/band.png', box: [82, 392, 1693, 493] },
    },
  };
  const occluder = [
    [0, 0],
    [1, 0],
    [1, 1],
  ] as const;
  const layer = neckLayer(pendant, {
    paths: [
      [
        [100, 10, 20],
        [104, 12, 24],
      ],
    ],
    anchor: [102, 18],
    angle: -3,
    occluders: [occluder.map((p) => [...p] as const)],
  })!;
  // 띠는 0.5px 열 8개(100~103.5), 장식은 마지막 한 장
  expect(layer.ops).toHaveLength(9);
  expect(layer.ops[0]).toEqual({
    img: 'band',
    src: [82, 392, (1611 / 4) * 0.65, 101],
    dst: [100, 10, 0.65, 10],
  });
  const h = (29 * 507) / 433;
  expect(layer.ops[8]).toEqual({
    img: 'item',
    src: [406, 406, 433, 507],
    dst: [-14.5, -h * 0.14, 29, h],
    at: { x: 102, y: 18, deg: -3 },
  });
  // 턱선(윗변 - 1) 위쪽과 앞발 가림을 지운다
  expect(layer.erase).toEqual([
    [
      [100, 0],
      [100, 9],
      [104, 11],
      [104, 0],
    ],
    occluder,
  ]);
});

test('목 곡선에 같은 x 두 점이 있어도 0 으로 나누지 않고 앞 점 값을 쓴다', () => {
  const pendant: CatFit = {
    ...base,
    crop: [406, 406, 839, 913],
    neck: {
      style: 'pendant',
      front: [406, 406, 839, 913],
      commonBand: { url: 'https://x/band.png', box: [82, 392, 1693, 493] },
    },
  };
  const layer = neckLayer(pendant, {
    paths: [
      [
        [100, 10, 20],
        [100, 11, 21],
        [104, 12, 24],
      ],
    ],
    anchor: [102, 18],
    angle: 0,
    occluders: [],
  })!;
  expect(layer.ops[0].dst).toEqual([100, 10, 0.65, 10]);
  expect(layer.ops.flatMap((op) => op.dst).every(Number.isFinite)).toBe(true);
});

test('목 스카프 — 앞 장식 열을 먼저, 감는 띠를 그 위에 그리고 원본에 없는 열은 건너뛴다', () => {
  const scarf: CatFit = {
    ...base,
    crop: [0, 0, 10, 12],
    neck: {
      style: 'scarf',
      front: [0, 0, 10, 10],
      columns: [0, 0, 0, 0, 0, null, null, null, null, null],
      band: [0, 10, 10, 12],
      commonBand: { url: 'https://x/band.png', box: [0, 0, 1, 1] },
    },
  };
  const layer = neckLayer(scarf, {
    paths: [
      [
        [0, 10, 20],
        [100, 10, 20],
      ],
    ],
    anchor: [50, 15],
    angle: 0,
    occluders: [],
  })!;
  // 폭 = min(86, 100 × 0.83) = 83, 가운데 = clamp(50 - 10, 41.5, 58.5) = 41.5 → 0 부터
  // 원본 앞 5열만 있으니 x < 41.5 인 83개, 띠는 0~99.5 의 200개
  expect(layer.ops).toHaveLength(83 + 200);
  expect(layer.ops[0]).toEqual({ img: 'item', src: [0, 0, 1, 10], dst: [0, 14, 0.65, 48] });
  expect(layer.ops[83].img).toBe('item');
  expect(layer.ops[83].src[1]).toBe(10);
  expect(layer.ops.some((op) => op.img === 'band')).toBe(false);
});

test('썸네일 영역 — 목은 앞 장식, 머리는 알파 크롭', () => {
  expect(catFitArtBox(mandarin)).toEqual([329, 349, 940, 942]);
  expect(
    catFitArtBox({
      ...mandarin,
      head: undefined,
      neck: {
        style: 'pendant',
        front: [406, 406, 839, 913],
        commonBand: { url: 'https://x/band.png', box: [82, 392, 1693, 493] },
      },
    }),
  ).toEqual([406, 406, 839, 913]);
});
