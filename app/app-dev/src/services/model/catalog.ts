import { t } from '@/i18n';
import { Building, Color, Product } from './types';

export const colors: Color[] = ['black', 'ginger', 'cream', 'gray', 'white', 'calico'];

// colorNames 배열은 게터로 못 만든다 — 호출 시점에 해석하는 함수로 둔다(GROMO-2238)
// 범위 밖 index 는 원래 colorNames[i] 처럼 undefined 였다 — "color.undefined" 키 문자열이
// 그대로 노출되지 않게 빈 문자열로 막는다.
export function colorName(index: number): string {
  return colors[index] ? t(`color.${colors[index]}`) : '';
}

// 프로퍼티 게터 — 호출부는 색인·점 접근 그대로 쓰고, 값은 호출 시점 언어로 해석된다(GROMO-2238)
export const buildingNames: Record<Building, string> = {
  get hall() {
    return t('building.hall');
  },
  get board() {
    return t('building.board');
  },
  get tower() {
    return t('building.tower');
  },
  get mail() {
    return t('building.mail');
  },
  get gram() {
    return t('building.gram');
  },
  get library() {
    return t('building.library');
  },
  get shop() {
    return t('building.shop');
  },
};

// 유효 집중 이 초만큼마다 물고기 1마리 (GROMO-1830, 2026-09-15)
export const SECONDS_PER_FISH = 60;

// 건물 가격은 섬 인원과 무관한 고정 총액이다 (GROMO-1829, 2026-09-15)
export const costs: Record<Building, number> = {
  hall: 60,
  board: 240,
  gram: 1360,
  library: 2720,
  mail: 4080,
  tower: 5440,
  shop: 6800,
};

export const buildMinutes: Record<Building, number> = {
  hall: 1,
  board: 15,
  gram: 30,
  library: 60,
  mail: 90,
  tower: 150,
  shop: 240,
};

export const buildingOrder: Building[] = [
  'hall',
  'board',
  'gram',
  'library',
  'mail',
  'tower',
  'shop',
];

export const trackNames: Record<string, string> = {
  get waves() {
    return t('track.waves');
  },
  get campfire() {
    return t('track.campfire');
  },
  get 'forest-wind'() {
    return t('track.forestWind');
  },
  get rain() {
    return t('track.rain');
  },
};

export const products: Product[] = [
  {
    id: 'soda-theme',
    get title() {
      return t('ui.remaining.copy2');
    },
    kind: 'island',
    price: 1000,
    currency: 'fish',
    get description() {
      return t('ui.remaining.copy3');
    },
  },
  {
    id: 'strawberry-roof',
    get title() {
      return t('ui.remaining.copy4');
    },
    building: 'hall',
    kind: 'building',
    price: 300,
    currency: 'fish',
    get description() {
      return t('ui.remaining.copy5');
    },
  },
  {
    id: 'rain',
    get title() {
      return t('track.rain');
    },
    kind: 'audio',
    price: 30,
    currency: 'fish',
    get description() {
      return t('ui.remaining.copy7');
    },
  },
];

// title·description 은 프로퍼티 게터 — buildingNames 처럼 호출 시점 언어로 건물 이름을 읽는다.
// 접미사("딸기 테마"·"한 곳에만 적용하는 외양이에요.")는 그대로 둔다 — 상점 문구 번역은 1840 몫.
for (const building of ['board', 'tower', 'mail', 'shop'] as Building[])
  products.push({
    id: 'strawberry-' + building,
    get title() {
      return buildingNames[building] + t('ui.remaining.copy8');
    },
    building,
    kind: 'building',
    price: 300,
    currency: 'fish',
    get description() {
      return buildingNames[building] + t('ui.remaining.copy9');
    },
  });
