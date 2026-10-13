import { ImageSourcePropType } from 'react-native';

/**
 * 고양이 잡지 꾸미기 재료(GROMO-2289) — 틀 11 · 스티커 45 · 테이프 8, 전부 무료(10/14 확정).
 *
 * - id 는 서버 카탈로그 product_id 와 같다(`mag.<종류>.<이름>`). 칸 레이아웃 JSON 의 assetId·frameId 가 이 값이다.
 * - 처음 표는 디자인 D1 의 id 표(catalog.json, 10/14)에서 뽑았다. 새 재료(바다 시즌)는 PNG 를
 *   src/assets/ota/magazine/ 에 넣고 여기 한 줄을 더한다 — OTA 로 구 바이너리에도 실리는 경로다(README 「문구·이미지 추가 규칙」).
 * - aspect = 그림 너비 ÷ 높이. 스티커 높이를 이것으로 정한다(magazineAssets.test 가 PNG 실제 크기와 대조).
 * - 틀 inset = [왼, 위, 오른, 아래] — 칸을 틀 그림으로 꽉 채웠을 때(늘려 붙임) 글을 써도 테두리·귀·끈을 넘지 않는
 *   안쪽 상자까지의 거리를 칸 크기에 대한 비율로 잰 값이다. 섬 이름·한 줄 글·주민/평균 줄이 이 상자 안에만 놓인다.
 * - 이름(서랍·틀 고르기 접근성 라벨)은 쓰기 화면 PR 에서 i18n 키로 붙인다.
 */
export type MagazineFrame = {
  source: ImageSourcePropType;
  aspect: number;
  inset: readonly [number, number, number, number];
};
export type StickerTab = 'cat' | 'sea' | 'friends' | 'deco';
export type MagazineSticker = { source: ImageSourcePropType; aspect: number; tab: StickerTab };
export type MagazineTape = { source: ImageSourcePropType; aspect: number };

// prettier-ignore
const FRAME_ROWS: [string, ImageSourcePropType, number, readonly [number, number, number, number]][] = [
  ['mag.frame.scallop', require('@/assets/ota/magazine/frame/frame-scallop.png'), 1.861, [0.08, 0.16, 0.08, 0.16]],
  ['mag.frame.ticket', require('@/assets/ota/magazine/frame/frame-ticket.png'), 1.933, [0.17, 0.11, 0.17, 0.11]],
  ['mag.frame.grid', require('@/assets/ota/magazine/frame/frame-grid.png'), 1.669, [0.07, 0.22, 0.07, 0.1]],
  ['mag.frame.polaroid', require('@/assets/ota/magazine/frame/frame-polaroid.png'), 1.698, [0.12, 0.14, 0.12, 0.31]],
  ['mag.frame.catear', require('@/assets/ota/magazine/frame/frame-catear.png'), 1.701, [0.08, 0.24, 0.08, 0.13]],
  ['mag.frame.cloud', require('@/assets/ota/magazine/frame/frame-cloud.png'), 1.741, [0.14, 0.32, 0.12, 0.2]],
  ['mag.frame.envelope', require('@/assets/ota/magazine/frame/frame-envelope.png'), 2.064, [0.1, 0.32, 0.1, 0.14]],
  ['mag.frame.woodsign', require('@/assets/ota/magazine/frame/frame-woodsign.png'), 2.108, [0.08, 0.3, 0.07, 0.12]],
  ['mag.frame.lifering', require('@/assets/ota/magazine/frame/frame-lifering.png'), 2.05, [0.19, 0.25, 0.19, 0.25]],
  ['mag.frame.notebook', require('@/assets/ota/magazine/frame/frame-notebook.png'), 2.2, [0.11, 0.12, 0.05, 0.12]],
  ['mag.frame.wave', require('@/assets/ota/magazine/frame/frame-wave.png'), 2.32, [0.09, 0.15, 0.09, 0.17]],
];
// prettier-ignore
const TAPE_ROWS: [string, ImageSourcePropType, number][] = [
  ['mag.tape.cream', require('@/assets/ota/magazine/tape/tape-cream.png'), 2.522],
  ['mag.tape.pink', require('@/assets/ota/magazine/tape/tape-pink.png'), 2.414],
  ['mag.tape.blue', require('@/assets/ota/magazine/tape/tape-blue.png'), 2.352],
  ['mag.tape.pinkdots', require('@/assets/ota/magazine/tape/tape-pinkdots.png'), 2.193],
  ['mag.tape.bluestripe', require('@/assets/ota/magazine/tape/tape-bluestripe.png'), 2.179],
  ['mag.tape.yellowcheck', require('@/assets/ota/magazine/tape/tape-yellowcheck.png'), 2.205],
  ['mag.tape.mint', require('@/assets/ota/magazine/tape/tape-mint.png'), 2.19],
  ['mag.tape.paw', require('@/assets/ota/magazine/tape/tape-paw.png'), 2.167],
];
// prettier-ignore
const STICKER_ROWS: [string, StickerTab, ImageSourcePropType, number][] = [
  ['mag.sticker.cat-black-book', 'cat', require('@/assets/ota/magazine/sticker/cat-black-book.png'), 1.01],
  ['mag.sticker.cat-white-sleep', 'cat', require('@/assets/ota/magazine/sticker/cat-white-sleep.png'), 1.119],
  ['mag.sticker.cat-ginger-fish', 'cat', require('@/assets/ota/magazine/sticker/cat-ginger-fish.png'), 1.112],
  ['mag.sticker.cat-calico-wave', 'cat', require('@/assets/ota/magazine/sticker/cat-calico-wave.png'), 1.016],
  ['mag.sticker.cat-cream-heart', 'cat', require('@/assets/ota/magazine/sticker/cat-cream-heart.png'), 1.076],
  ['mag.sticker.cat-gray-cheer', 'cat', require('@/assets/ota/magazine/sticker/cat-gray-cheer.png'), 1.071],
  ['mag.sticker.cat-black-peek', 'cat', require('@/assets/ota/magazine/sticker/cat-black-peek.png'), 1.608],
  ['mag.sticker.cat-ginger-face', 'cat', require('@/assets/ota/magazine/sticker/cat-ginger-face.png'), 1.204],
  ['mag.sticker.cat-calico-raft', 'cat', require('@/assets/ota/magazine/sticker/cat-calico-raft.png'), 1.027],
  ['mag.sticker.cat-white-pencil', 'cat', require('@/assets/ota/magazine/sticker/cat-white-pencil.png'), 0.99],
  ['mag.sticker.cat-cream-coffee', 'cat', require('@/assets/ota/magazine/sticker/cat-cream-coffee.png'), 1.019],
  ['mag.sticker.cat-gray-bottle', 'cat', require('@/assets/ota/magazine/sticker/cat-gray-bottle.png'), 1.003],
  ['mag.sticker.cat-gray-headphone', 'cat', require('@/assets/ota/magazine/sticker/cat-gray-headphone.png'), 0.958],
  ['mag.sticker.cat-cream-booknap', 'cat', require('@/assets/ota/magazine/sticker/cat-cream-booknap.png'), 0.947],
  ['mag.sticker.fish', 'sea', require('@/assets/ota/magazine/sticker/fish.png'), 1.148],
  ['mag.sticker.fish-basket', 'sea', require('@/assets/ota/magazine/sticker/fish-basket.png'), 1.076],
  ['mag.sticker.bottle', 'sea', require('@/assets/ota/magazine/sticker/bottle.png'), 0.652],
  ['mag.sticker.map', 'sea', require('@/assets/ota/magazine/sticker/map.png'), 0.955],
  ['mag.sticker.palm-island', 'sea', require('@/assets/ota/magazine/sticker/palm-island.png'), 0.87],
  ['mag.sticker.shell', 'sea', require('@/assets/ota/magazine/sticker/shell.png'), 1.045],
  ['mag.sticker.sailboat', 'sea', require('@/assets/ota/magazine/sticker/sailboat.png'), 0.881],
  ['mag.sticker.lighthouse', 'sea', require('@/assets/ota/magazine/sticker/lighthouse.png'), 0.874],
  ['mag.sticker.lantern', 'sea', require('@/assets/ota/magazine/sticker/lantern.png'), 0.663],
  ['mag.sticker.whale', 'sea', require('@/assets/ota/magazine/sticker/whale.png'), 1.395],
  ['mag.sticker.seagull', 'sea', require('@/assets/ota/magazine/sticker/seagull.png'), 0.906],
  ['mag.sticker.turtle', 'sea', require('@/assets/ota/magazine/sticker/turtle.png'), 1.184],
  ['mag.sticker.telescope', 'sea', require('@/assets/ota/magazine/sticker/telescope.png'), 0.906],
  ['mag.sticker.campfire', 'sea', require('@/assets/ota/magazine/sticker/campfire.png'), 0.817],
  ['mag.sticker.pelican', 'friends', require('@/assets/ota/magazine/sticker/pelican.png'), 0.831],
  ['mag.sticker.dog', 'friends', require('@/assets/ota/magazine/sticker/dog.png'), 0.929],
  ['mag.sticker.mongdol', 'friends', require('@/assets/ota/magazine/sticker/mongdol.png'), 0.929],
  ['mag.sticker.mailbox', 'friends', require('@/assets/ota/magazine/sticker/mailbox.png'), 0.713],
  ['mag.sticker.star', 'deco', require('@/assets/ota/magazine/sticker/star.png'), 1.034],
  ['mag.sticker.heart', 'deco', require('@/assets/ota/magazine/sticker/heart.png'), 1.176],
  ['mag.sticker.cloud', 'deco', require('@/assets/ota/magazine/sticker/cloud.png'), 1.307],
  ['mag.sticker.pencil', 'deco', require('@/assets/ota/magazine/sticker/pencil.png'), 0.72],
  ['mag.sticker.book', 'deco', require('@/assets/ota/magazine/sticker/book.png'), 1.416],
  ['mag.sticker.paw', 'deco', require('@/assets/ota/magazine/sticker/paw.png'), 1.056],
  ['mag.sticker.bow', 'deco', require('@/assets/ota/magazine/sticker/bow.png'), 1.123],
  ['mag.sticker.sparkle', 'deco', require('@/assets/ota/magazine/sticker/sparkle.png'), 0.823],
  ['mag.sticker.crown', 'deco', require('@/assets/ota/magazine/sticker/crown.png'), 1.442],
  ['mag.sticker.drink', 'deco', require('@/assets/ota/magazine/sticker/drink.png'), 0.683],
  ['mag.sticker.moon', 'deco', require('@/assets/ota/magazine/sticker/moon.png'), 0.889],
  ['mag.sticker.clock', 'deco', require('@/assets/ota/magazine/sticker/clock.png'), 0.817],
  ['mag.sticker.tomato-timer', 'deco', require('@/assets/ota/magazine/sticker/tomato-timer.png'), 1.047],
];

/** 순서 = 틀 고르기 줄·서랍의 순서(카탈로그 순). */
export const MAGAZINE_FRAMES: Record<string, MagazineFrame> = Object.fromEntries(
  FRAME_ROWS.map(([id, source, aspect, inset]) => [id, { source, aspect, inset }]),
);
export const MAGAZINE_TAPES: Record<string, MagazineTape> = Object.fromEntries(
  TAPE_ROWS.map(([id, source, aspect]) => [id, { source, aspect }]),
);
export const MAGAZINE_STICKERS: Record<string, MagazineSticker> = Object.fromEntries(
  STICKER_ROWS.map(([id, tab, source, aspect]) => [id, { source, aspect, tab }]),
);
/** 서버에 있는데 이 앱 버전 표에 없는 틀(새 시즌)을 받았을 때 대신 그리는 틀. */
export const DEFAULT_FRAME_ID = 'mag.frame.scallop';

/**
 * 섬 그림 7단계(P8, 10/14 확정) — 주민 0명(무인도) = s0 · 완공 건물 0~1 = s1 · 2 = s2 · 3 = s3 · 4 = s4 · 5~6 = s5 · 7 이상 = s7.
 * 「s6」 그림은 없다(5·6 이 같은 그림).
 */
export const ISLAND_STAGE_ART = {
  s0: require('@/assets/ota/magazine/island/island-s0.png'),
  s1: require('@/assets/ota/magazine/island/island-s1.png'),
  s2: require('@/assets/ota/magazine/island/island-s2.png'),
  s3: require('@/assets/ota/magazine/island/island-s3.png'),
  s4: require('@/assets/ota/magazine/island/island-s4.png'),
  s5: require('@/assets/ota/magazine/island/island-s5.png'),
  s7: require('@/assets/ota/magazine/island/island-s7.png'),
} as const satisfies Record<string, ImageSourcePropType>;
export type IslandStage = keyof typeof ISLAND_STAGE_ART;
export function islandStage(memberCount: number, buildingCount: number): IslandStage {
  if (memberCount <= 0) return 's0';
  if (buildingCount >= 7) return 's7';
  if (buildingCount >= 5) return 's5';
  if (buildingCount >= 2) return `s${buildingCount}` as IslandStage;
  return 's1';
}

/** 바다판 칸 오른쪽 아래 망원경 동그라미 안 그림(A5). */
export const MAGAZINE_TELESCOPE_ICON: ImageSourcePropType = require('@/assets/ota/magazine/ui/icon-telescope.png');
