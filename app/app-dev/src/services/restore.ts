/**
 * 앱 재시작 복구 — 어느 화면에서 다시 시작할지.
 *
 * 서버 세션이 있으면 **계정 상태는 서버가 정본**이다. 로컬 저장본의 `loggedIn` 은 서버가 이미
 * 폐기한 세션도 참으로 남아 있고, `onboarded`(섬 선택 여부)는 서버의 `onboardingComplete`
 * (고양이 색·이름 선택 여부)와 **다른 것**이라 둘을 따로 본다.
 *
 * 서버 세션이 없으면 종전대로 로컬 저장본만 본다 — 로그인 API 연결 전의 목업 흐름이 그대로 산다.
 */
import type { Route } from '@/services/model';

export interface SavedShape {
  loggedIn?: boolean;
  onboarded?: boolean;
  session?: { status?: string } | null;
}

export interface RestoredAccount {
  onboardingComplete: boolean;
}

/**
 * @param sessionRejected 저장돼 있던 세션을 서버가 401 로 거절했다. 이때는 로컬 저장본이
 *   `loggedIn: true` 여도 로그인 화면이다 — 네트워크 오류로 확인만 못 한 경우와 구분한다
 *   (확인 실패는 오프라인 시작을 막지 않도록 로컬 저장본대로 복구한다).
 */
export function restoredRoute(
  saved: SavedShape,
  account: RestoredAccount | null,
  sessionRejected = false,
): Route {
  if (sessionRejected) return 'login';
  if (!account && !saved.loggedIn) return 'login';
  // 서버가 「고양이·이름 미선택」이라고 하면 섬보다 그쪽이 먼저다.
  if (account && !account.onboardingComplete) return 'character';
  if (!saved.onboarded) return 'chooseIsland';
  if (saved.session) return saved.session.status === 'paused' ? 'rest' : 'focus';
  return 'home';
}
