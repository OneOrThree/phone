// CharacterImage.tsx
// 정적 캐릭터 이미지 렌더러. variant로 상황별 캐릭터를 고른다:
//  - 'default' assets/character.png       (기본)
//  - 'study'   assets/character_study.png (공부 집중 세션 — 책 읽는 모습)
// size 정사각 박스에 contain으로 비율 유지.
// ⚠️ 에셋 교체 시 투명 여백을 트림해서 넣을 것(여백 있으면 캐릭터가 작아 보임).
//    위젯 쪽 사본(ios/Widget/Assets.xcassets/character.imageset)도 같이 갱신.
//    집중 세션 캐릭터는 스냅샷(saveCharacterSnapshot)으로 Live Activity·가림막에도 반영됨.

import { Image } from 'react-native';

export type CharacterVariant = 'default' | 'study';

const SOURCES: Record<CharacterVariant, number> = {
  default: require('../../assets/character.png'),
  study: require('../../assets/character_study.png'),
};

export function CharacterImage({
  size,
  variant = 'default',
}: {
  size: number;
  variant?: CharacterVariant;
}) {
  return (
    <Image source={SOURCES[variant]} style={{ width: size, height: size }} resizeMode="contain" />
  );
}
