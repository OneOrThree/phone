import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { CURRENCY } from '@/constants/currency';

// 시간조각(인게임 재화) 아이콘 — 기기·폰트마다 모양이 달라지던 이모지 ⏳를 대체한다(GROMO-1072).
// Ionicons(아이콘 폰트)를 쓰는 이유: 잔액 칩·배지·내역처럼 글자와 한 줄로 섞이는 자리가 많은데
// 아이콘 폰트는 <Text> 안에 그대로 중첩되지만 SVG는 텍스트 줄에 섞이지 않는다.
// 크기·색은 함께 놓이는 글자에 맞춰 호출부에서 지정한다(기본값은 인디고 강조색 14pt).
//
// 접근성(코드리뷰 반영): 이모지 ⏳는 스크린리더가 읽어 주지만 아이콘 폰트는 사설 영역 글리프라
// 그대로 두면 '+100 획득!'처럼 무엇을 얻었는지 알 수 없게 된다. 그래서 기본으로 '시간조각'이라는
// 이름을 붙이고, 옆 글자가 이미 그 단어를 말하는 자리에서만 decorative로 뺀다.

interface CurrencyIconProps {
  size?: number;
  color?: string;
  // 옆 글자에 이미 '시간조각'이 들어 있는 자리(잔액 라벨·빈 상태)에 true —
  // 스크린리더가 같은 말을 두 번 읽지 않게 아이콘을 접근성 트리에서 뺀다.
  decorative?: boolean;
}

export function CurrencyIcon({
  size = 14,
  color = T.accentDeep,
  decorative = false,
}: CurrencyIconProps) {
  return (
    <Ionicons
      name="hourglass"
      size={size}
      color={color}
      accessibilityLabel={decorative ? undefined : CURRENCY.label}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no' : 'auto'}
    />
  );
}
