import { StyleSheet, View } from 'react-native';
import { Character2D } from '@/components/character/Character2D';
import { TierBadge } from './TierBadge';

// 원형 캐릭터 아바타 + 코너 티어 뱃지.
// TODO: 랭킹/친구 응답에 캐릭터 정보가 없어 제네릭 마스코트(기본 Character2D)로 표시 —
//       상대 캐릭터 연동은 별도 엔드포인트 협의 후 후속.
interface Props {
  size?: number;
  tierLevel?: number | null; // null/undefined면 뱃지 생략
}

export function MemberAvatar({ size = 46, tierLevel }: Props) {
  const badgeSize = Math.max(size * 0.42, 16);
  return (
    <View style={{ width: size, height: size }}>
      <View style={[s.circle, { width: size, height: size, borderRadius: size / 2 }]}>
        <Character2D size={size * 0.66} />
      </View>
      {tierLevel != null && (
        <View style={[s.badge, { right: -badgeSize * 0.16, bottom: -badgeSize * 0.16 }]}>
          <TierBadge level={tierLevel} size={badgeSize} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  circle: {
    backgroundColor: '#EBD7B5',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  badge: { position: 'absolute' },
});
