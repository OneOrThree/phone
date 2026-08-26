import type { ImageSourcePropType } from 'react-native';

// 티어 5단계 메타 — Claude Design 리그 시안 기준.
// 백엔드는 tierLevel(1~5)만 주고, 이름·주간 시간 기준은 프론트 표시값.
// image = 방패형 일러스트 뱃지 — 히어로·연출 큰 뱃지와 랭킹 행 코너의 작은 뱃지(TierBadge)까지
// 모든 티어 표시가 이 일러스트를 공용으로 쓴다.
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
    name: '뽀시래기',
    rangeLabel: '주간 집중 0–14시간',
    minHours: 0,
    maxHours: 14,
    image: require('@/assets/tier_image/tier1.png'),
  },
  {
    level: 2,
    name: '예열 모드',
    rangeLabel: '주간 집중 14–28시간',
    minHours: 14,
    maxHours: 28,
    image: require('@/assets/tier_image/tier2.png'),
  },
  {
    level: 3,
    name: '초집중 모드',
    rangeLabel: '주간 집중 28–42시간',
    minHours: 28,
    maxHours: 42,
    image: require('@/assets/tier_image/tier3.png'),
  },
  {
    level: 4,
    name: '갓생러',
    rangeLabel: '주간 집중 42–56시간',
    minHours: 42,
    maxHours: 56,
    image: require('@/assets/tier_image/tier4.png'),
  },
  {
    level: 5,
    name: '집중 정복자',
    rangeLabel: '주간 집중 56–70시간',
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
