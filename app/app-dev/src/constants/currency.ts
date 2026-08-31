// 인게임 재화 "시간조각" — UI 표기 상수 (코드 식별자는 coin/currency 유지)
// 아이콘은 이 상수에 없다 — 이모지 ⏳가 기기·폰트마다 모양이 달라 @/components/CurrencyIcon 으로
// 전부 옮겼다(GROMO-1072). 아이콘이 필요하면 그 컴포넌트를 쓸 것.
//
// label 은 **게터**다 — 모듈 최상위에서 t()를 부르면 값이 굳어 로케일을 못 따라간다.
// 읽는 시점에 번역되므로 `CURRENCY.label`을 쓰는 호출부는 그대로 두면 된다.
import { t } from '@/i18n';

export const CURRENCY = {
  get label() {
    return t('shared.currency.label');
  },
} as const;
