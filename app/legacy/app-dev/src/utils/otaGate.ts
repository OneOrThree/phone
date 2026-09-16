// OTA 준비 화면(App.tsx HotUpdater.wrap fallback) 노출 여부 공유(GROMO-875).
// 준비 화면이 온보딩 진입 스플래시와 같은 비주얼(캐릭터+GROMO)이라,
// 방금 보였으면 온보딩 스플래시를 건너뛰어 같은 화면이 연달아 두 번 뜨는 것을 막는다.
// 릴리즈 빌드에선 업데이트 확인 동안 준비 화면이 매 실행 잠깐 뜨므로 시작 직후엔 true,
// 개발 모드(Metro)에선 안 뜨므로 false — 온보딩 스플래시가 기존대로 동작한다.
let shownAt = 0;

// '방금'의 시효 — 같은 실행에서 한참 뒤 온보딩이 다시 마운트되는 경우
// (예: 로그아웃·탈퇴 → 재온보딩)까지 스플래시를 스킵하지 않도록 제한한다(코드리뷰 P2).
const RECENT_MS = 15_000;

export function markOtaSplashShown(): void {
  shownAt = Date.now();
}

export function wasOtaSplashJustShown(): boolean {
  return shownAt > 0 && Date.now() - shownAt < RECENT_MS;
}
