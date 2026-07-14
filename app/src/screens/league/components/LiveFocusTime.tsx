import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useLiveFocusClock } from '@/hooks/useLiveFocusClock';
import { liveTotalSeconds } from '@/utils/liveFocus';
import { hmsCompact } from '@/screens/focus/format';

// 집중 중 유저의 총 집중시간(기준 누적분 + 진행 중 경과) 초 단위 라이브 텍스트 (GROMO-658·811·812).
// 1초 틱 리렌더를 이 컴포넌트 안에 가둬 화면 전체가 매초 리렌더되는 것을 막는다.
// baseSeconds: 친구 탭은 당일 누적 분×60, 리그 랭킹은 주간 누적 초(totalFocusSeconds)를 넘긴다.
export function LiveFocusTime({
  baseSeconds,
  focusStartedAt,
  style,
  format = hmsCompact,
}: {
  baseSeconds: number;
  focusStartedAt: string | null;
  style?: StyleProp<TextStyle>;
  format?: (totalSeconds: number) => string;
}) {
  const now = useLiveFocusClock(focusStartedAt != null);
  return <Text style={style}>{format(liveTotalSeconds(baseSeconds, focusStartedAt, now))}</Text>;
}
