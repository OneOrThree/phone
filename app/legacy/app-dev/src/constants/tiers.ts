import type { ImageSourcePropType } from 'react-native';

import { t } from '@/i18n';

// 티어 5단계 메타 — Claude Design 리그 시안 기준.
// 백엔드는 tierLevel(1~5)만 주고, 이름·주간 시간 기준은 프론트 표시값.
// image = 방패형 일러스트 뱃지 — 히어로·연출 큰 뱃지와 랭킹 행 코너의 작은 뱃지(TierBadge)까지
// 모든 티어 표시가 이 일러스트를 공용으로 쓴다.
// ⚠️ name·rangeLabel 은 각 원소에서 **게터**로 구현한다 — 모듈 최상위에서 t()를 부르면 값이
//    굳어 로케일을 못 따라간다. 읽는 시점에 번역되므로 호출부(`tierByLevel(x).name`)는 그대로다.
export interface TierMeta {
  level: number;
  name: string;
  /** 주간 집중 시간 구간 라벨 (예: '주간 0–5시간') */
  rangeLabel: string;
  /** 다음 단계 승급 기준(시간). 마지막 단계는 null */
  minHours: number;
  maxHours: number | null;
  image: ImageSourcePropType;
}

// 구간은 하루 기준 0–2/2–4/4–6/6–8/8–10시간 × 7일 = 주간 수치.
export const TIERS: TierMeta[] = [
  {
    level: 1,
    get name() {
      return t('shared.tiers.tier1.name');
    },
    get rangeLabel() {
      return t('shared.tiers.tier1.range');
    },
    minHours: 0,
    maxHours: 14,
    image: require('@/assets/tier_image/tier1.png'),
  },
  {
    level: 2,
    get name() {
      return t('shared.tiers.tier2.name');
    },
    get rangeLabel() {
      return t('shared.tiers.tier2.range');
    },
    minHours: 14,
    maxHours: 28,
    image: require('@/assets/tier_image/tier2.png'),
  },
  {
    level: 3,
    get name() {
      return t('shared.tiers.tier3.name');
    },
    get rangeLabel() {
      return t('shared.tiers.tier3.range');
    },
    minHours: 28,
    maxHours: 42,
    image: require('@/assets/tier_image/tier3.png'),
  },
  {
    level: 4,
    get name() {
      return t('shared.tiers.tier4.name');
    },
    get rangeLabel() {
      return t('shared.tiers.tier4.range');
    },
    minHours: 42,
    maxHours: 56,
    image: require('@/assets/tier_image/tier4.png'),
  },
  {
    level: 5,
    get name() {
      return t('shared.tiers.tier5.name');
    },
    get rangeLabel() {
      return t('shared.tiers.tier5.range');
    },
    minHours: 56,
    maxHours: null,
    image: require('@/assets/tier_image/tier5.png'),
  },
];

// level(1~5) → 메타. 범위 밖은 가장 가까운 단계로 클램프.
export function tierByLevel(level: number): TierMeta {
  const idx = Math.min(Math.max(Math.round(level), 1), TIERS.length) - 1;
  return TIERS[idx];
}
