import { formatNumber } from '@/i18n/format';
import { t } from '@/i18n';
export const interiorArt = {
  boardBackground: require('@/assets/interiors/board-three-papers-v5.png'),
  buildings: {
    hall: require('@/assets/interiors/buildings/hall.png'),
    noticeboard: require('@/assets/interiors/buildings/noticeboard.png'),
    observatory: require('@/assets/interiors/buildings/observatory.png'),
    mailbox: require('@/assets/interiors/buildings/mailbox.png'),
    shop: require('@/assets/interiors/buildings/shop.png'),
    gramophone: require('@/assets/interiors/buildings/gramophone.png'),
    library: require('@/assets/interiors/buildings/library.png'),
  },
  avatars: {
    black: require('@/assets/interiors/avatars/black.png'),
    calico: require('@/assets/interiors/avatars/calico.png'),
    cream: require('@/assets/interiors/avatars/cream.png'),
    ginger: require('@/assets/interiors/avatars/ginger.png'),
    gray: require('@/assets/interiors/avatars/gray.png'),
    white: require('@/assets/interiors/avatars/white.png'),
  },
  catBlack: require('@/assets/redesign/cat-black.png'),
  boardPaper: {
    notice: require('@/assets/interiors/ui/board-sheet-notice-v2.png'),
    detail: require('@/assets/interiors/ui/board-sheet-notice-detail-v3.png'),
    quest: require('@/assets/interiors/ui/board-sheet-quest-v2.png'),
  },
  // 언어별 쌍 — 렌더 시점에 localized() 로 고른다(모듈 최상위에서 고르면 import 시점 언어로 굳는다)
  // src/assets/ota/ 아래 — assetPatternsToBeBundled 패턴에 맞아야 OTA 로 구 바이너리에도 실린다
  blueprintReadyStamp: {
    ko: require('@/assets/ota/interiors/ui/blueprint-ready-stamp-v3.ko.png'),
    en: require('@/assets/ota/interiors/ui/blueprint-ready-stamp-v3.en.png'),
  },
  letterEnvelope: require('@/assets/interiors/ui/letter-envelope-v1.png'),
};

// 원본 이미지 픽셀 크기 (배경은 모두 1024×1536)
export const artSize = {
  background: [1024, 1536],
  hall: [1163, 1178],
  noticeboard: [837, 877],
  observatory: [695, 1067],
  mailbox: [550, 849],
  shop: [1050, 874],
  gramophone: [632, 910],
  library: [814, 1178],
  avatar: [256, 256],
} as const;

export const kindCopy: Record<string, string> = {
  get 'island-management'() {
    return t('common.manageIsland');
  },
  get 'hall-desk'() {
    return t('ui.interiors.hallDesk');
  },
  get 'building-models'() {
    return t('ui.interiors.woodenBuildings');
  },
  get 'village-ledger'() {
    return t('ui.hall.sharedLedger');
  },
  get 'building-blueprint'() {
    return t('ui.interiors.buildingBlueprint');
  },
  get 'board-final'() {
    return t('building.board');
  },
  get 'board-notice'() {
    return t('ui.interiors.noticeList');
  },
  get 'board-notice-detail'() {
    return t('ui.board.noticeDetails');
  },
  get 'board-quest'() {
    return t('ui.board.questDetails');
  },
  get 'board-blueprint'() {
    return t('ui.interiors.blueprintDetails');
  },
  get 'observatory-desk'() {
    return t('ui.interiors.laptopMap');
  },
  get 'island-ranking'() {
    return t('ui.interiors.islandRanking');
  },
  get 'old-map'() {
    return t('ui.interiors.oldMap');
  },
  get 'mail-home'() {
    return t('ui.interiors.openMailbox');
  },
  get 'received-letters'() {
    return t('ui.mail.inbox');
  },
  get 'letter-detail'() {
    return t('ui.interiors.letterDetails');
  },
  get 'friend-select'() {
    return t('ui.interiors.chooseFriend');
  },
  get 'friend-compose'() {
    return t('ui.mail.writeLetter');
  },
  get tryon() {
    return t('ui.interiors.mirror');
  },
  get counter() {
    return t('ui.interiors.display');
  },
  get themes() {
    return t('ui.interiors.islandTheme');
  },
  get records() {
    return t('ui.interiors.record');
  },
  get player() {
    return t('ui.interiors.turntable');
  },
  get catalog() {
    return t('ui.interiors.recordBox');
  },
};

export const buildOptions = [
  {
    id: 'library',
    get name() {
      return t('building.library');
    },
    image: interiorArt.buildings.library,
    size: artSize.library,
    get price() {
      return t('ui.board.totalFishCost', { v0: formatNumber(2720) });
    },
    get time() {
      return t('ui.interiors.build15m');
    },
    get summary() {
      return t('ui.interiors.librarySummary');
    },
    get detail() {
      return t('ui.hall.libraryDescription');
    },
    locked: false,
  },
  {
    id: 'observatory',
    get name() {
      return t('building.tower');
    },
    image: interiorArt.buildings.observatory,
    size: artSize.observatory,
    get price() {
      return t('ui.board.totalFishCost', { v0: formatNumber(5440) });
    },
    get time() {
      return t('ui.interiors.build30m');
    },
    get summary() {
      return t('ui.interiors.towerSummary');
    },
    get detail() {
      return t('ui.interiors.towerDescription');
    },
    locked: false,
  },
  {
    id: 'mailbox',
    get name() {
      return t('building.mail');
    },
    image: interiorArt.buildings.mailbox,
    size: artSize.mailbox,
    get price() {
      return t('ui.board.totalFishCost', { v0: formatNumber(4080) });
    },
    get time() {
      return t('ui.interiors.build20m');
    },
    get summary() {
      return t('ui.hall.mailSummary');
    },
    get detail() {
      return t('ui.interiors.mailDescription');
    },
    locked: false,
  },
  {
    id: 'gramophone',
    get name() {
      return t('building.gram');
    },
    image: interiorArt.buildings.gramophone,
    size: artSize.gramophone,
    get price() {
      return t('ui.board.totalFishCost', { v0: formatNumber(1360) });
    },
    get time() {
      return t('ui.interiors.build5m');
    },
    get summary() {
      return t('ui.hall.gramSummary');
    },
    get detail() {
      return t('ui.interiors.gramDescription');
    },
    locked: false,
  },
  {
    id: 'shop',
    get name() {
      return t('building.shop');
    },
    image: interiorArt.buildings.shop,
    size: artSize.shop,
    get price() {
      return t('ui.board.totalFishCost', { v0: formatNumber(6800) });
    },
    get time() {
      return t('ui.interiors.build1h');
    },
    get summary() {
      return t('ui.hall.shopSummary');
    },
    get detail() {
      return t('ui.interiors.shopDescription');
    },
    locked: true,
  },
];
