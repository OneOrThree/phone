import * as Haptics from 'expo-haptics';

// 화면 전환·주요 터치의 촉각 피드백 래퍼 (GROMO-786).
// 연출 보조 기능이라 실패해도 흐름에 영향이 없어야 한다 — 미지원 환경(시뮬레이터 등)
// 에러는 조용히 무시하고, 호출부는 await 없이 fire-and-forget으로 쓴다.

/** 탭 전환 등 선택 변경 — 가장 약한 진동 */
export function hapticSelect(): void {
  Haptics.selectionAsync().catch(() => {});
}

/** 버튼 탭·화면 진입 등 가벼운 임팩트 */
export function hapticLight(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** 화면 전환 등 또렷하게 느껴져야 하는 중간 임팩트 */
export function hapticMedium(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}
