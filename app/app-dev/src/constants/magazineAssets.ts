import { ImageSourcePropType } from 'react-native';

/**
 * 고양이 잡지 꾸미기 재료(GROMO-2289) — 틀 11 · 스티커 45 · 테이프 8, 전부 무료(10/14 확정).
 *
 * - id = "mag." + D1 카탈로그 id(`mag.frame-scallop` · `mag.tape-cream` · `mag.cat-black-book`). 서버 catalog_assets.product_id 가
 *   옷·꾸미기 상품과 같은 전역 키라 접두어로 구분한다. API 의 assetId 와 칸 레이아웃 JSON 의 frameId·assetId 가 이 값 그대로다.
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
  /** 틀에 인쇄된 장식 위로 글이 내려가지 않게 한 줄 글을 이 줄 수까지만(글자를 줄여 맞춘다). */
  maxBodyLines?: number;
  /** 주민/평균 줄만 글 상자 왼쪽에서 칸 너비의 이 비율만큼 더 들인다(왼쪽 아래 인쇄 장식 피하기). */
  metaLeft?: number;
};
type FrameTune = Pick<MagazineFrame, 'maxBodyLines' | 'metaLeft'>;
export type StickerTab = 'cat' | 'sea' | 'friends' | 'deco';
export type MagazineSticker = { source: ImageSourcePropType; aspect: number; tab: StickerTab };
export type MagazineTape = { source: ImageSourcePropType; aspect: number };

// prettier-ignore
const FRAME_ROWS: [string, ImageSourcePropType, number, readonly [number, number, number, number], FrameTune?][] = [
  ['mag.frame-scallop', require('@/assets/ota/magazine/frame/frame-scallop.png'), 1.861, [0.08, 0.16, 0.08, 0.16]],
  ['mag.frame-ticket', require('@/assets/ota/magazine/frame/frame-ticket.png'), 1.933, [0.17, 0.11, 0.17, 0.11]],
  ['mag.frame-grid', require('@/assets/ota/magazine/frame/frame-grid.png'), 1.669, [0.07, 0.22, 0.07, 0.1]],
  ['mag.frame-polaroid', require('@/assets/ota/magazine/frame/frame-polaroid.png'), 1.698, [0.12, 0.14, 0.12, 0.31]],
  ['mag.frame-catear', require('@/assets/ota/magazine/frame/frame-catear.png'), 1.701, [0.08, 0.24, 0.08, 0.13], { maxBodyLines: 2, metaLeft: 0.19 }],
  ['mag.frame-cloud', require('@/assets/ota/magazine/frame/frame-cloud.png'), 1.741, [0.14, 0.32, 0.27, 0.2]],
  ['mag.frame-envelope', require('@/assets/ota/magazine/frame/frame-envelope.png'), 2.064, [0.1, 0.32, 0.1, 0.14]],
  ['mag.frame-woodsign', require('@/assets/ota/magazine/frame/frame-woodsign.png'), 2.108, [0.08, 0.3, 0.07, 0.12]],
  ['mag.frame-lifering', require('@/assets/ota/magazine/frame/frame-lifering.png'), 2.05, [0.22, 0.26, 0.22, 0.26]],
  ['mag.frame-notebook', require('@/assets/ota/magazine/frame/frame-notebook.png'), 2.2, [0.11, 0.12, 0.05, 0.12]],
  ['mag.frame-wave', require('@/assets/ota/magazine/frame/frame-wave.png'), 2.32, [0.09, 0.15, 0.09, 0.17]],
];
// prettier-ignore
const TAPE_ROWS: [string, ImageSourcePropType, number][] = [
  ['mag.tape-cream', require('@/assets/ota/magazine/tape/tape-cream.png'), 2.522],
  ['mag.tape-pink', require('@/assets/ota/magazine/tape/tape-pink.png'), 2.414],
  ['mag.tape-blue', require('@/assets/ota/magazine/tape/tape-blue.png'), 2.352],
  ['mag.tape-pinkdots', require('@/assets/ota/magazine/tape/tape-pinkdots.png'), 2.193],
  ['mag.tape-bluestripe', require('@/assets/ota/magazine/tape/tape-bluestripe.png'), 2.179],
  ['mag.tape-yellowcheck', require('@/assets/ota/magazine/tape/tape-yellowcheck.png'), 2.205],
  ['mag.tape-mint', require('@/assets/ota/magazine/tape/tape-mint.png'), 2.19],
  ['mag.tape-paw', require('@/assets/ota/magazine/tape/tape-paw.png'), 2.167],
];
// prettier-ignore
const STICKER_ROWS: [string, StickerTab, ImageSourcePropType, number][] = [
  ['mag.cat-black-book', 'cat', require('@/assets/ota/magazine/sticker/cat-black-book.png'), 1.01],
  ['mag.cat-white-sleep', 'cat', require('@/assets/ota/magazine/sticker/cat-white-sleep.png'), 1.119],
  ['mag.cat-ginger-fish', 'cat', require('@/assets/ota/magazine/sticker/cat-ginger-fish.png'), 1.112],
  ['mag.cat-calico-wave', 'cat', require('@/assets/ota/magazine/sticker/cat-calico-wave.png'), 1.016],
  ['mag.cat-cream-heart', 'cat', require('@/assets/ota/magazine/sticker/cat-cream-heart.png'), 1.076],
  ['mag.cat-gray-cheer', 'cat', require('@/assets/ota/magazine/sticker/cat-gray-cheer.png'), 1.071],
  ['mag.cat-black-peek', 'cat', require('@/assets/ota/magazine/sticker/cat-black-peek.png'), 1.608],
  ['mag.cat-ginger-face', 'cat', require('@/assets/ota/magazine/sticker/cat-ginger-face.png'), 1.204],
  ['mag.cat-calico-raft', 'cat', require('@/assets/ota/magazine/sticker/cat-calico-raft.png'), 1.027],
  ['mag.cat-white-pencil', 'cat', require('@/assets/ota/magazine/sticker/cat-white-pencil.png'), 0.99],
  ['mag.cat-cream-coffee', 'cat', require('@/assets/ota/magazine/sticker/cat-cream-coffee.png'), 1.019],
  ['mag.cat-gray-bottle', 'cat', require('@/assets/ota/magazine/sticker/cat-gray-bottle.png'), 1.003],
  ['mag.cat-gray-headphone', 'cat', require('@/assets/ota/magazine/sticker/cat-gray-headphone.png'), 0.958],
  ['mag.cat-cream-booknap', 'cat', require('@/assets/ota/magazine/sticker/cat-cream-booknap.png'), 0.947],
  ['mag.fish', 'sea', require('@/assets/ota/magazine/sticker/fish.png'), 1.148],
  ['mag.fish-basket', 'sea', require('@/assets/ota/magazine/sticker/fish-basket.png'), 1.076],
  ['mag.bottle', 'sea', require('@/assets/ota/magazine/sticker/bottle.png'), 0.652],
  ['mag.map', 'sea', require('@/assets/ota/magazine/sticker/map.png'), 0.955],
  ['mag.palm-island', 'sea', require('@/assets/ota/magazine/sticker/palm-island.png'), 0.87],
  ['mag.shell', 'sea', require('@/assets/ota/magazine/sticker/shell.png'), 1.045],
  ['mag.sailboat', 'sea', require('@/assets/ota/magazine/sticker/sailboat.png'), 0.881],
  ['mag.lighthouse', 'sea', require('@/assets/ota/magazine/sticker/lighthouse.png'), 0.874],
  ['mag.lantern', 'sea', require('@/assets/ota/magazine/sticker/lantern.png'), 0.663],
  ['mag.whale', 'sea', require('@/assets/ota/magazine/sticker/whale.png'), 1.395],
  ['mag.seagull', 'sea', require('@/assets/ota/magazine/sticker/seagull.png'), 0.906],
  ['mag.turtle', 'sea', require('@/assets/ota/magazine/sticker/turtle.png'), 1.184],
  ['mag.telescope', 'sea', require('@/assets/ota/magazine/sticker/telescope.png'), 0.906],
  ['mag.campfire', 'sea', require('@/assets/ota/magazine/sticker/campfire.png'), 0.817],
  ['mag.pelican', 'friends', require('@/assets/ota/magazine/sticker/pelican.png'), 0.831],
  ['mag.dog', 'friends', require('@/assets/ota/magazine/sticker/dog.png'), 0.929],
  ['mag.mongdol', 'friends', require('@/assets/ota/magazine/sticker/mongdol.png'), 0.929],
  ['mag.mailbox', 'friends', require('@/assets/ota/magazine/sticker/mailbox.png'), 0.713],
  ['mag.star', 'deco', require('@/assets/ota/magazine/sticker/star.png'), 1.034],
  ['mag.heart', 'deco', require('@/assets/ota/magazine/sticker/heart.png'), 1.176],
  ['mag.cloud', 'deco', require('@/assets/ota/magazine/sticker/cloud.png'), 1.307],
  ['mag.pencil', 'deco', require('@/assets/ota/magazine/sticker/pencil.png'), 0.72],
  ['mag.book', 'deco', require('@/assets/ota/magazine/sticker/book.png'), 1.416],
  ['mag.paw', 'deco', require('@/assets/ota/magazine/sticker/paw.png'), 1.056],
  ['mag.bow', 'deco', require('@/assets/ota/magazine/sticker/bow.png'), 1.123],
  ['mag.sparkle', 'deco', require('@/assets/ota/magazine/sticker/sparkle.png'), 0.823],
  ['mag.crown', 'deco', require('@/assets/ota/magazine/sticker/crown.png'), 1.442],
  ['mag.drink', 'deco', require('@/assets/ota/magazine/sticker/drink.png'), 0.683],
  ['mag.moon', 'deco', require('@/assets/ota/magazine/sticker/moon.png'), 0.889],
  ['mag.clock', 'deco', require('@/assets/ota/magazine/sticker/clock.png'), 0.817],
  ['mag.tomato-timer', 'deco', require('@/assets/ota/magazine/sticker/tomato-timer.png'), 1.047],
];

/** 순서 = 틀 고르기 줄·서랍의 순서(카탈로그 순). */
export const MAGAZINE_FRAMES: Record<string, MagazineFrame> = Object.fromEntries(
  FRAME_ROWS.map(([id, source, aspect, inset, tune]) => [id, { source, aspect, inset, ...tune }]),
);
export const MAGAZINE_TAPES: Record<string, MagazineTape> = Object.fromEntries(
  TAPE_ROWS.map(([id, source, aspect]) => [id, { source, aspect }]),
);
export const MAGAZINE_STICKERS: Record<string, MagazineSticker> = Object.fromEntries(
  STICKER_ROWS.map(([id, tab, source, aspect]) => [id, { source, aspect, tab }]),
);
/** 서버에 있는데 이 앱 버전 표에 없는 틀(새 시즌)을 받았을 때 대신 그리는 틀. */
export const DEFAULT_FRAME_ID = 'mag.frame-scallop';

/**
 * 섬 그림 4장(GROMO-2317 승인 시안 v5 — 같은 땅에 집만 0·1·3·5채) — 망원경 파노라마와 잡지 칸 섬 프로필이 같이 쓴다.
 * 주민 0명(무인도) = houses0 · 완공 건물 0~2 = houses1 · 3~4 = houses3 · 5 이상 = houses5.
 */
export const ISLAND_STAGE_ART = {
  houses0: require('@/assets/ota/magazine/island/island-houses-0.png'),
  houses1: require('@/assets/ota/magazine/island/island-houses-1.png'),
  houses3: require('@/assets/ota/magazine/island/island-houses-3.png'),
  houses5: require('@/assets/ota/magazine/island/island-houses-5.png'),
} as const satisfies Record<string, ImageSourcePropType>;
/** 섬 그림 너비 ÷ 높이(네 장 모두 섬만 잘라 둔 480×266). */
export const ISLAND_ART_ASPECT = 480 / 266;
export type IslandStage = keyof typeof ISLAND_STAGE_ART;
export function islandStage(memberCount: number, buildingCount: number): IslandStage {
  if (memberCount <= 0) return 'houses0';
  if (buildingCount >= 5) return 'houses5';
  if (buildingCount >= 3) return 'houses3';
  return 'houses1';
}

/** 바다판 칸 오른쪽 아래 망원경 동그라미 안 그림(A5). */
export const MAGAZINE_TELESCOPE_ICON: ImageSourcePropType = require('@/assets/ota/magazine/ui/icon-telescope.png');

/** 홍보 접수 발도장(C2) — 다음 호 미리보기 칸 위에 찍힌다. */
export const MAGAZINE_STAMP: ImageSourcePropType = require('@/assets/ota/magazine/ui/stamp.png');

/**
 * 잡지 읽기 그림(A1~A4·C4·C5). page 는 속지(모눈 + 별·물고기·발자국·하트 테두리, 위 리본에 제호)로 비율 502:900 을
 * 그대로 늘려 쓰고, 글·칸은 componentTokens.magazineReader 의 안쪽 여백 안에 둔다. cover 는 우체통 없는 섬의 잡지 물건.
 */
export const MAGAZINE_UI = {
  page: require('@/assets/ota/magazine/ui/page.png'),
  close: require('@/assets/ota/magazine/ui/close.png'),
  cover: require('@/assets/ota/magazine/ui/cover.png'),
  bannerRanking: require('@/assets/ota/magazine/ui/banner-ranking.png'),
  tagNew: require('@/assets/ota/magazine/ui/tag-new.png'),
  editorCat: require('@/assets/ota/magazine/ui/editor-cat.png'),
  medals: [
    require('@/assets/ota/magazine/ui/medal-1.png'),
    require('@/assets/ota/magazine/ui/medal-2.png'),
    require('@/assets/ota/magazine/ui/medal-3.png'),
  ],
} as const satisfies Record<string, ImageSourcePropType | readonly ImageSourcePropType[]>;
