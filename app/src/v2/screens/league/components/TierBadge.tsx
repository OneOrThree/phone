import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { tierByLevel } from '@/v2/constants/tiers';

// 별+그라디언트 티어 칩 — 아바타 코너·프로필 pill·티어 리스트·연출 전환에 쓰는 뱃지.
// (티어 안내 히어로·승격 큰 뱃지는 tiers.ts의 일러스트 image 사용 — 계획서에서 확정한 대체)
interface Props {
  level: number;
  size?: number; // 칩 한 변(px)
  /** 아바타 코너용 흰 테두리 (시안 border 2px #fff) */
  outlined?: boolean;
}

export function TierBadge({ level, size = 20, outlined = true }: Props) {
  const tier = tierByLevel(level);
  return (
    <LinearGradient
      colors={tier.gradient}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[
        s.chip,
        outlined ? s.outlined : null,
        { width: size, height: size, borderRadius: size * 0.38 },
      ]}
    >
      <Ionicons name="star" size={size * 0.55} color={tier.starColor} />
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center' },
  outlined: { borderWidth: 2, borderColor: '#FFFFFF' },
});
