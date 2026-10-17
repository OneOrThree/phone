import type { ImageSourcePropType } from 'react-native';

export type SeaRewardArt = {
  source: ImageSourcePropType;
  category: 'head' | 'neck' | 'shoes' | 'decor' | 'hull';
  /** 원본의 투명 여백을 보존하면서 표시 창에 배치한다. */
  preview: { width: number; height: number; size: number; left: number; top: number };
};

// 실제 보상 아이템 ID는 연결 전이다. 알 수 없는 ID를 예시 보상으로 대체하지 않는다.
export const seaRewardCatalog: Readonly<Record<string, SeaRewardArt>> = {};

export const duckPreviewArt: SeaRewardArt = {
  source: require('@/assets/ota/customization/head/duck.png'),
  category: 'head',
  preview: { width: 176, height: 148, size: 330, left: -84, top: -98 },
};
