// 일 카드 공유 캡처 레이아웃(GROMO-1070). 평소엔 격자(children)만 보이고, 캡처 순간(capturing)에만
// 상단 헤더(좌: 날짜 / 우: gromo 워드마크) + 왼쪽 하단 마스코트가 드러난다.
//
// 마스코트는 격자 왼쪽 범례(과목명) 열의 '빈 아래 공간'에 absolute로 겹쳐 맨 아래에 놓는다 — 범례와
// 같은 좌측 위치·가장 하단. absolute라 레이아웃 높이를 늘리지 않아 '아래에 블록을 덧붙인' 느낌이 없다.
//
// ⚠️ children(FocusTimetable)은 '항상 같은 트리 위치'에 마운트된 채(스타일 변화 없음) 유지된다.
// 캡처 때 다른 트리로 갈아끼우면 언마운트→재조회로 격자가 스피너가 되므로, chrome(헤더·마스코트)만
// 붙였다 뗀다. 마스코트는 캡처 때만 마운트해 매번 onLoad를 다시 받는다.
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { CharacterImage } from '@/components/character/CharacterImage';
import { useCharacter } from '@/store/CharacterContext';
import { cs } from './cardStyles';
import { t } from '@/i18n';
import { WEEKDAY_KEYS } from './format';

// 왼쪽 하단 마스코트 크기 — 범례 열(76px)+간격 안에 들어가는 선에서 큼직하게(격자와 안 겹치게).
const DAY_CHAR_SIZE = 80;

// "2026년 7월 30일 (목)" — 캡처 시점 오늘 날짜(로컬).
function todayLabel(): string {
  const d = new Date();
  return t('stats.share.dateHeader', {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: t(WEEKDAY_KEYS[d.getDay()]),
  });
}

export function ShareDayFrame({
  capturing,
  onCharReady,
  children,
}: {
  // 캡처 순간에만 true — chrome(헤더·마스코트)를 드러낸다.
  capturing: boolean;
  // 마스코트 이미지가 그려진 시점 콜백 — 상위가 이 시점 전 captureRef를 막는 데 쓴다.
  onCharReady?: () => void;
  // 격자(FocusTimetable) — 항상 마운트 유지(위치·전체 폭 고정).
  children: ReactNode;
}) {
  // 홈·집중 화면과 동일한 계약 — activeSource가 누끼면 그 URI, 기본이면 null(정적 마스코트).
  const { activeSource } = useCharacter();
  return (
    <View>
      {/* 상단 헤더 — 좌: 날짜, 우: gromo 워드마크. 캡처 때만 노출(평소엔 display:none) */}
      <View style={[cs.shareDayHeader, !capturing && cs.hidden]}>
        <Text style={cs.shareDateHeader} allowFontScaling={false}>
          {todayLabel()}
        </Text>
        <Text style={cs.shareDayWordmark} allowFontScaling={false}>
          gromo
        </Text>
      </View>
      {/* 격자 + (겹쳐 놓는) 왼쪽 하단 마스코트 */}
      <View style={cs.shareDayBody}>
        {children}
        {capturing && (
          <View style={cs.shareDayMascot}>
            {/* 게이트(onCharReady)는 onLoad에만 건다. 로드 실패 시 CharacterImage가 기본 에셋으로
                폴백하는데, onError에 걸면 폴백이 '그려지기 전'에 풀려 전환 중간 프레임이 캡처될 수
                있다. 폴백이 실제 그려질 때 onLoad가 오고, 그마저 늦으면 훅의 타임아웃이 받는다. */}
            <CharacterImage
              size={DAY_CHAR_SIZE}
              sourceUri={activeSource ?? undefined}
              onLoad={onCharReady}
            />
          </View>
        )}
      </View>
    </View>
  );
}
