import { Image } from 'react-native';
import { tierByLevel } from '@/v2/constants/tiers';

// 티어 뱃지 — tier_image 일러스트(tiers.ts image)를 그대로 사용.
// (기존 별+그라디언트 칩에서 교체 — 아바타 코너·티어 리스트·연출 전환 공용)
interface Props {
  level: number;
  size?: number; // 한 변(px)
}

export function TierBadge({ level, size = 20 }: Props) {
  return (
    <Image
      source={tierByLevel(level).image}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
