import { StyleSheet, View } from 'react-native';
import { Character2D } from '@/components/character/Character2D';
import { CharacterImage } from '@/components/character/CharacterImage';

// 원형 캐릭터 아바타 — 내 아바타(me)는 내 캐릭터(CharacterImage), 상대는 제네릭 마스코트.
// 티어 뱃지는 아바타 코너 오버레이가 아니라 행에서 따로 그린다(TierBadge, 순위-아바타 사이).
// TODO: 랭킹/친구 응답에 캐릭터 정보가 생기면 상대 캐릭터도 연동(엔드포인트 협의 후속).
interface Props {
  size?: number;
  me?: boolean; // true면 내 캐릭터로 표시
}

export function MemberAvatar({ size = 46, me }: Props) {
  return (
    <View style={[s.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      {me ? <CharacterImage size={size * 0.66} /> : <Character2D size={size * 0.66} />}
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
});
