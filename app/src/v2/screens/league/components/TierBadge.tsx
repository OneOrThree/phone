import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { tierByLevel } from '@/v2/constants/tiers';

// 별+그라디언트 티어 칩 — 아바타 코너·프로필 티어 pill 등에 쓰는 작은 뱃지.
// (큰 방패형 일러스트는 tiers.ts의 image를 직접 사용)
interface Props {
  level: number;
  size?: number; // 칩 한 변(px)
}

export function TierBadge({ level, size = 20 }: Props) {
  const tier = tierByLevel(level);
  return (
    <LinearGradient
      colors={tier.gradient}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[s.chip, { width: size, height: size, borderRadius: size * 0.32 }]}
    >
      <Ionicons name="star" size={size * 0.56} color={tier.starColor} />
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
});
