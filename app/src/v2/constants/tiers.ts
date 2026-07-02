import type { ImageSourcePropType } from 'react-native';

// 티어 5단계 메타 — Claude Design 리그 시안 기준.
// 백엔드는 tierLevel(1~5)만 주고, 이름·주간 시간 기준·색은 프론트 표시값.
// image = 방패형 일러스트 뱃지(홈·티어 안내 히어로·승격/강등 연출의 큰 뱃지).
// 랭킹 행 코너의 작은 뱃지는 시안대로 별(star) 칩(TierBadge)을 쓴다.
export interface TierMeta {
  level: number;
  name: string;
  /** 주간 집중 시간 구간 라벨 (예: '주간 0–5시간') */
  rangeLabel: string;
  /** 다음 단계 승급 기준(시간). 마지막 단계는 null */
  minHours: number;
  maxHours: number | null;
  /** 별 칩 그라디언트 [시작, 끝] — 1단계는 플랫(같은 색 2개) */
  gradient: [string, string];
  /** 별 아이콘 색 */
  starColor: string;
  image: ImageSourcePropType;
}

export const TIERS: TierMeta[] = [
  {
    level: 1,
    name: '뽀시래기',
    rangeLabel: '주간 0–5시간',
    minHours: 0,
    maxHours: 5,
    gradient: ['#E3DAC9', '#E3DAC9'],
    starColor: '#9A8C7C',
    image: require('@/assets/tier_image/tier1.png'),
  },
  {
    level: 2,
    name: '예열 모드',
    rangeLabel: '주간 5–12시간',
    minHours: 5,
    maxHours: 12,
    gradient: ['#E8C188', '#DDA45A'],
    starColor: '#FFFFFF',
    image: require('@/assets/tier_image/tier2.png'),
  },
  {
    level: 3,
    name: '초집중 모드',
    rangeLabel: '주간 12–22시간',
    minHours: 12,
    maxHours: 22,
    gradient: ['#D49A4E', '#C8893F'],
    starColor: '#FFFFFF',
    image: require('@/assets/tier_image/tier3.png'),
  },
  {
    level: 4,
    name: '갓생러',
    rangeLabel: '주간 22–35시간',
    minHours: 22,
    maxHours: 35,
    gradient: ['#A4682F', '#7E4A1C'],
    starColor: '#F2D79E',
    image: require('@/assets/tier_image/tier4.png'),
  },
  {
    level: 5,
    name: '집중 정복자',
    rangeLabel: '주간 35시간+',
    minHours: 35,
    maxHours: null,
    gradient: ['#F2CE73', '#D29A3C'],
    starColor: '#6B3F18',
    image: require('@/assets/tier_image/tier5.png'),
  },
];

// level(1~5) → 메타. 범위 밖은 가장 가까운 단계로 클램프.
export function tierByLevel(level: number): TierMeta {
  const idx = Math.min(Math.max(Math.round(level), 1), TIERS.length) - 1;
  return TIERS[idx];
}
