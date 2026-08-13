// CharacterImage.tsx
// 정적 캐릭터 이미지 렌더러. variant로 상황별 캐릭터를 고른다:
//  - 'default'   assets/character.png           (기본)
//  - 'study'     assets/character_study.png     (공부 집중 세션 — 책 읽는 모습)
//  - 'happy'     assets/character_happy.png     (달성·성공)
//  - 'hi'        assets/character_hi.png        (인사·빈 상태 안내)
//  - 'sensitive' assets/character_sensitive.png (미달성·아쉬움)
// size 정사각 박스에 contain으로 비율 유지.
// ⚠️ 에셋 교체 시 투명 여백을 트림해서 넣을 것(여백 있으면 캐릭터가 작아 보임).
//    위젯 쪽 사본(ios/Widget/Assets.xcassets/character.imageset)도 같이 갱신.
//    집중 세션 캐릭터는 스냅샷(saveCharacterSnapshot)으로 Live Activity·가림막에도 반영됨.
//
// ⚠️ 표정(variant)과 커스텀 누끼(sourceUri)는 **양자택일**이다 (GROMO-1381).
//    아래 showDefault 분기 때문에 sourceUri가 있으면 variant는 통째로 무시된다 — 누끼는
//    사용자가 찍은 사진 한 장뿐이라 표정 대안이 존재하지 않는다. 따라서 커스텀 캐릭터를 쓰는
//    사용자에게는 표정 전환이 불가능하고, AnimatedCharacter의 transform 반응(호흡·점프)만
//    적용된다. 표정으로만 의미를 전달하는 화면은 문구·색으로도 같은 뜻이 서게 만들 것.

import { useEffect, useState } from 'react';
import { Image, Platform, type ImageProps } from 'react-native';

export type CharacterVariant = 'default' | 'study' | 'happy' | 'hi' | 'sensitive';

const SOURCES: Record<CharacterVariant, number> = {
  default: require('../../assets/character.png'),
  study: require('../../assets/character_study.png'),
  happy: require('../../assets/character_happy.png'),
  hi: require('../../assets/character_hi.png'),
  sensitive: require('../../assets/character_sensitive.png'),
};

// 캐릭터 에셋 프리캐시(GROMO-848) — 축하 모달처럼 갑자기 노출되는 화면에서 첫 로드
// (dev는 Metro 다운로드) 지연으로 캐릭터가 늦게 뜨는 것을 줄인다. 실패해도 무해.
// SOURCES를 순회하므로 variant를 늘리면 자동으로 함께 프리캐시된다(릴리즈는 번들 로컬 에셋이라
// 사실상 no-op, dev만 Metro에서 받아 온다).
// 웹은 제외 — resolveAssetSource가 웹에서 다르게 동작해 프리캐시가 무의미하다(GROMO-1484).
if (Platform.OS !== 'web') {
  Object.values(SOURCES).forEach((mod) => {
    const src = Image.resolveAssetSource(mod);
    if (src?.uri) Image.prefetch(src.uri).catch(() => {});
  });
}

export function CharacterImage({
  size,
  variant = 'default',
  sourceUri,
  onLoad,
  onSourceError,
  testID,
}: {
  size: number;
  variant?: CharacterVariant;
  /** 오브젝트 캐릭터(누끼) URI. 있으면 정적 에셋 대신 이 이미지를 그린다(같은 size·contain 박스).
   *  없으면 기존 variant 정적 에셋 동작 그대로 — 기존 호출부는 이 prop을 넘기지 않으므로 영향 없음.
   *  ⚠️ 이게 있으면 variant는 무시된다(파일 상단 주석 참고). */
  sourceUri?: string;
  /** 이미지 표시 완료 콜백 — 축하 모달의 색종이 타이밍·공유 캡처 게이트 등에 쓴다. 로드 실패 시엔
   *  기본 에셋으로 폴백되고, 그 폴백이 그려질 때 이 콜백이 온다(실패 순간이 아니라 폴백 페인트 시점). */
  onLoad?: ImageProps['onLoad'];
  /** sourceUri 로드 실패 콜백 — 폴백은 이 컴포넌트가 알아서 하지만, "이 누끼는 못 쓴다"는 사실을
   *  알아야 하는 화면(캐릭터 변경 화면의 장착 차단)이 있어 밖으로 열어 둔다. */
  onSourceError?: () => void;
  /** E2E(Maestro)·RTL 셀렉터. 홈·집중 세션의 캐릭터를 집어야 애니메이션 회귀를 잡을 수 있다. */
  testID?: string;
}) {
  // sourceUri(누끼) 로드 실패 시 기본 에셋으로 폴백 — 만료/삭제된 URI가 빈/깨진 박스로 그려지는 걸 막는다.
  // 공유 이미지뿐 아니라 홈·집중 화면 등 sourceUri 사용처 전반이 함께 폴백된다(GROMO-1070 리뷰 반영).
  const [failed, setFailed] = useState(false);
  // sourceUri가 바뀌면 실패 상태 초기화(새 이미지 재시도).
  useEffect(() => {
    setFailed(false);
  }, [sourceUri]);
  const showDefault = !sourceUri || failed;
  return (
    <Image
      testID={testID}
      source={showDefault ? SOURCES[variant] : { uri: sourceUri }}
      style={{ width: size, height: size }}
      resizeMode="contain"
      onLoad={onLoad}
      onError={() => {
        setFailed(true);
        onSourceError?.();
      }}
    />
  );
}
