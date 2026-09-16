// 공유 캡처 전용 브랜드 밴드 — 일/주 타임테이블 카드가 공용으로 쓴다(GROMO-1070).
// 캡처 순간(visible=capturing)에만 shotRef 본문 아래(normal flow)에 렌더되어 '저장되는 이미지에만'
// 담긴다(평소 카드 UI에는 안 보임). 좌측 현재 선택 캐릭터(기본 마스코트/누끼) + 우측 "gromo"
// 워드마크·태그라인. 기존 GROMO-1014 텍스트 워터마크(cs.shareWatermark 회색 한 줄)를 대체·흡수한다.
//
// 오버레이가 아니라 본문 아래로 밀어내는 밴드라 데이터를 가리지 않는다. 캡처 타이밍(캐릭터 로드
// 대기)·여백은 useTimetableShareCapture 훅이 담당한다.
import { View, Text } from 'react-native';
import { CharacterImage } from '@/components/character/CharacterImage';
import { useCharacter } from '@/store/CharacterContext';
import { t } from '@/i18n';
import { cs } from './cardStyles';

// 밴드 안 캐릭터 박스 — 밴드 높이에 맞춘 소형. 누끼는 가변 비율이라도 contain으로 이 정사각에
// 가둬 큰 세로 이미지가 밴드를 밀어 올리지 못하게 한다(높이 상한 = size).
const BRAND_CHAR_SIZE = 56;

export function ShareBrandFooter({
  visible,
  onCharReady,
}: {
  // 캡처 순간에만 true — 각 카드의 capturing 상태를 그대로 넘긴다.
  visible: boolean;
  // 밴드 캐릭터 이미지가 그려진 시점 콜백 — 상위가 이 시점 전 captureRef를 막는 데 쓴다.
  onCharReady?: () => void;
}) {
  // 홈·집중 화면과 동일한 계약 — activeSource가 누끼면 그 URI, 기본이면 null(정적 마스코트).
  const { activeSource } = useCharacter();
  if (!visible) return null;
  return (
    <View style={cs.shareBrandBand}>
      {/* 게이트(onCharReady)는 onLoad에만 — 로드 실패 시 폴백 기본 에셋이 실제 그려질 때 풀린다
          (onError에 걸면 폴백 페인트 전에 풀려 전환 중간 프레임이 캡처될 수 있음). ShareDayFrame과 동일. */}
      <CharacterImage
        size={BRAND_CHAR_SIZE}
        sourceUri={activeSource ?? undefined}
        onLoad={onCharReady}
      />
      <View style={cs.shareBrandTextCol}>
        <Text style={cs.shareWordmark} allowFontScaling={false}>
          gromo
        </Text>
        <Text style={cs.shareTagline} allowFontScaling={false}>
          {t('stats.share.tagline')}
        </Text>
      </View>
    </View>
  );
}
