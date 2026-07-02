// CharacterImage.tsx
// 정적 캐릭터 이미지(assets/character.png) — Character2D 드롭인 대체.
// 파츠 조합(커스터마이징) 없이 단일 PNG를 그린다. size 정사각 박스에 contain으로 비율 유지.
// 원본이 1536×1024(3:2 가로형)라 박스 안에서 위아래 여백이 생길 수 있다.

import { Image } from 'react-native';

export function CharacterImage({ size }: { size: number }) {
  return (
    <Image
      source={require('../../assets/character.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
