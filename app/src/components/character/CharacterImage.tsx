// CharacterImage.tsx
// 정적 캐릭터 이미지(assets/character.png) — Character2D 드롭인 대체.
// 파츠 조합(커스터마이징) 없이 단일 PNG를 그린다. size 정사각 박스에 contain으로 비율 유지.
// 에셋은 투명 여백을 잘라낸 574×641(거의 정사각) — 프레임을 거의 꽉 채운다.
// ⚠️ 에셋 교체 시 투명 여백을 트림해서 넣을 것(여백 있으면 캐릭터가 작아 보임).
//    위젯 쪽 사본(ios/Widget/Assets.xcassets/character.imageset)도 같이 갱신.

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
