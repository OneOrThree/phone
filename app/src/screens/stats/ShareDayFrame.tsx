// 일 카드 공유 캡처 레이아웃(GROMO-1070). 평소엔 격자(children)만 보이고, 캡처 순간(capturing)에만
// 상단 날짜 헤더 + '왼쪽 하단' 브랜드 마크(작은 캐릭터 + gromo + 오늘 총 집중시간)가 드러난다.
//
// 브랜드 마크는 격자 왼쪽 범례(과목명) 열의 '빈 아래 공간'에 absolute로 겹쳐 놓는다 — 범례와 같은
// 좌측 위치·가장 하단. absolute라 레이아웃 높이를 늘리지 않아 '아래에 블록을 덧붙인' 느낌이 없다.
//
// ⚠️ children(FocusTimetable)은 '항상 같은 트리 위치'에 마운트된 채(스타일 변화 없음) 유지된다.
// 캡처 때 다른 트리로 갈아끼우면 언마운트→재조회로 격자가 스피너가 되므로, chrome(날짜·브랜드
// 마크)만 붙였다 뗀다. 캐릭터는 캡처 때만 마운트해 매번 onLoad를 다시 받는다.
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { CharacterImage } from '@/components/character/CharacterImage';
import { useCharacter } from '@/store/CharacterContext';
import { hms } from '@/utils/timeFormat';
import { cs } from './cardStyles';

// 왼쪽 하단 캐릭터 크기 — 범례 열(76px) 폭 안에 들어가게 작게.
const DAY_CHAR_SIZE = 56;

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

// "2026년 7월 30일 (목)" — 캡처 시점 오늘 날짜(로컬).
function todayKoreanLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS_KO[d.getDay()]})`;
}

export function ShareDayFrame({
  capturing,
  totalSeconds,
  onCharReady,
  children,
}: {
  // 캡처 순간에만 true — chrome(날짜 헤더·브랜드 마크)를 드러낸다.
  capturing: boolean;
  // 오늘 총 집중시간(초) — 브랜드 마크에 HH:MM:SS로 표시.
  totalSeconds: number;
  // 캐릭터 이미지가 그려진 시점 콜백 — 상위가 이 시점 전 captureRef를 막는 데 쓴다.
  onCharReady?: () => void;
  // 격자(FocusTimetable) — 항상 마운트 유지(위치·전체 폭 고정).
  children: ReactNode;
}) {
  // 홈·집중 화면과 동일한 계약 — activeSource가 누끼면 그 URI, 기본이면 null(정적 마스코트).
  const { activeSource } = useCharacter();
  return (
    <View>
      {/* 날짜 헤더 — 캡처 때만 노출(평소엔 display:none으로 자리 없음) */}
      <Text style={[cs.shareDateHeader, !capturing && cs.hidden]} allowFontScaling={false}>
        {todayKoreanLabel()}
      </Text>
      {/* 격자 + (겹쳐 놓는) 왼쪽 하단 브랜드 마크 */}
      <View style={cs.shareDayBody}>
        {children}
        {capturing && (
          <View style={cs.shareDayBrand}>
            <CharacterImage
              size={DAY_CHAR_SIZE}
              sourceUri={activeSource ?? undefined}
              onLoad={onCharReady}
            />
            <Text style={cs.shareWordmark} allowFontScaling={false}>
              gromo
            </Text>
            <Text style={cs.shareDayTime} allowFontScaling={false}>
              {hms(totalSeconds)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
