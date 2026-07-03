import { StyleSheet, View } from 'react-native';
import { CharacterImage } from '@/components/character/CharacterImage';

// 원형 캐릭터 아바타 — 정적 캐릭터 이미지(assets/character.png) 단일 사용.
// TODO: 랭킹/친구 응답에 캐릭터 정보가 생기면 상대 캐릭터 연동(엔드포인트 협의 후속).
interface Props {
  size?: number;
}

export function MemberAvatar({ size = 46 }: Props) {
  return (
    <View style={[s.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <CharacterImage size={size * 0.66} />
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
