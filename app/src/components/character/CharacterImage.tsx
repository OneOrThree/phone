// CharacterImage.tsx
// 정적 캐릭터 이미지 렌더러. variant로 상황별 캐릭터를 고른다:
//  - 'default' assets/character.png       (기본)
//  - 'study'   assets/character_study.png (공부 집중 세션 — 책 읽는 모습)
// size 정사각 박스에 contain으로 비율 유지.
// ⚠️ 에셋 교체 시 투명 여백을 트림해서 넣을 것(여백 있으면 캐릭터가 작아 보임).
//    위젯 쪽 사본(ios/Widget/Assets.xcassets/character.imageset)도 같이 갱신.
//    집중 세션 캐릭터는 스냅샷(saveCharacterSnapshot)으로 Live Activity·가림막에도 반영됨.

import { Image, type ImageProps } from 'react-native';

export type CharacterVariant = 'default' | 'study';

const SOURCES: Record<CharacterVariant, number> = {
  default: require('../../assets/character.png'),
  study: require('../../assets/character_study.png'),
};

// 캐릭터 에셋 프리캐시(GROMO-848) — 축하 모달처럼 갑자기 노출되는 화면에서 첫 로드
// (dev는 Metro 다운로드) 지연으로 캐릭터가 늦게 뜨는 것을 줄인다. 실패해도 무해.
Object.values(SOURCES).forEach((mod) => {
  const src = Image.resolveAssetSource(mod);
  if (src?.uri) Image.prefetch(src.uri).catch(() => {});
});

export function CharacterImage({
  size,
  variant = 'default',
  sourceUri,
  onLoad,
}: {
  size: number;
  variant?: CharacterVariant;
  /** 오브젝트 캐릭터(누끼) URI. 있으면 정적 에셋 대신 이 이미지를 그린다(같은 size·contain 박스).
   *  없으면 기존 variant 정적 에셋 동작 그대로 — 기존 호출부는 이 prop을 넘기지 않으므로 영향 없음. */
  sourceUri?: string;
  /** 이미지 표시 완료 콜백 — 축하 모달이 색종이 시작 타이밍을 맞추는 데 쓴다 */
  onLoad?: ImageProps['onLoad'];
}) {
  return (
    <Image
      source={sourceUri ? { uri: sourceUri } : SOURCES[variant]}
      style={{ width: size, height: size }}
      resizeMode="contain"
      onLoad={onLoad}
    />
  );
}
