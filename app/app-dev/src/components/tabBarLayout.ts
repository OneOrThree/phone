// 플로팅 탭바의 치수 — TabBar.tsx가 그리는 값의 정본(GROMO-1487).
//
// ⚠️ 왜 TabBar.tsx가 아니라 여기 있나: TabBar는 @callstack/liquid-glass(ESM)를 끌고 와,
//    이 값을 쓰려고 import 하면 그 화면의 jest 스위트가 **로드 단계에서** 죽는다.
//    치수는 렌더와 무관한 순수 값이므로 잎 모듈로 떼어 어디서든 부담 없이 쓰게 한다.
//    탭바 레이아웃을 바꾸면 여기 값과 TabBar의 스타일을 함께 갱신할 것
//    (TabBar.test.tsx가 실제 렌더 결과와 대조해 어긋나면 실패한다).
import { T } from '@/constants/theme';

export const BAR_H = 56; // 유리 바 높이
export const FAB_R = 28; // 중앙 FAB 반지름(56/2)
export const FAB_LIFT = -8; // FAB 중심의 바 상단선 대비 높이 — 양수=위로 뜸, 음수=더 깊이 안착

/**
 * 탭바가 화면 바닥에서 실제로 덮는 높이.
 * wrap(paddingTop + 바 + paddingBottom)에 FAB가 바 위로 솟은 만큼을 더한 값이다.
 * 탭 화면의 하단 고정 요소·스크롤 하단 여백은 이 값 이상을 잡아야 FAB에 가리지 않는다.
 */
export function tabBarSafeBottom(insetsBottom: number): number {
  const wrapH = T.space.sm + BAR_H + Math.max(insetsBottom, T.space.sm);
  // fab.top(= T.space.sm - FAB_LIFT - FAB_R)이 음수인 만큼 바 위로 솟는다.
  const fabOverhang = Math.max(0, FAB_R + FAB_LIFT - T.space.sm);
  return wrapH + fabOverhang;
}
