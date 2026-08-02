import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';

// 시간조각(인게임 재화) 아이콘 — 기기·폰트마다 모양이 달라지던 이모지 ⏳를 대체한다(GROMO-1072).
// Ionicons(아이콘 폰트)를 쓰는 이유: 잔액 칩·배지·내역처럼 글자와 한 줄로 섞이는 자리가 많은데
// 아이콘 폰트는 <Text> 안에 그대로 중첩되지만 SVG는 텍스트 줄에 섞이지 않는다.
// 크기·색은 함께 놓이는 글자에 맞춰 호출부에서 지정한다(기본값은 인디고 강조색 14pt).

interface CurrencyIconProps {
  size?: number;
  color?: string;
}

export function CurrencyIcon({ size = 14, color = T.accentDeep }: CurrencyIconProps) {
  return <Ionicons name="hourglass" size={size} color={color} />;
}
