import { MAGAZINE_TIP_COUNT } from '@/constants/magazineTips';

// 앱 실행 중 마지막으로 보여 준 문구만 기억한다. 호·계정·날짜별 기록은 저장하지 않는다.
let previousTip: number | null = null;

/** 성공적으로 잡지를 펼칠 때 호출한다. 직전 문구를 제외한 나머지에서 같은 확률로 고른다. */
export function pickEditorTip(): number {
  const choices = previousTip === null ? MAGAZINE_TIP_COUNT : MAGAZINE_TIP_COUNT - 1;
  const picked = Math.floor(Math.random() * choices);
  const next = previousTip !== null && picked >= previousTip ? picked + 1 : picked;
  previousTip = next;
  return next;
}
