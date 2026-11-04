import { Route } from './types';

/**
 * 소속 섬이 없어도 머무를 수 있는 바다 라우트인가(GROMO-2310). 항해·표류·결과창·바다 잡지(GROMO-2314) 모두 — 표류(세션 없음)도 정상 상태라
 * 강퇴된 뒤 그만둬도 멀어지는 연출·표류 화면이 끊기지 않는다. 바다 라우트를 떠나는 순간 App 의 소속 가드가 섬 선택으로 보낸다.
 */
/**
 * 진행 세션이 열 화면 — 앱 안의 「세션 → 라우트」는 전부 이것을 쓴다(GROMO-2310). 바다 세션은 휴식이 없고 항해 화면이 집중 화면이다.
 */
export const sessionRoute = (x: { kind?: string; status?: string }): Route =>
  x.kind === 'sea' ? 'sea' : x.status === 'paused' ? 'rest' : 'focus';

export const seaRouteHeld = (route: Route) =>
  route === 'sea' || route === 'seaArrival' || route === 'seaMagazine';

/** 서버 섬 구경 중에 열 수 있는 라우트(허용 목록) — CurrentScreens 의 구경 가드와 App 의 소속 검사가 같은 것을 쓴다. */
export const SERVER_VISIT_ROUTES: readonly Route[] = [
  'visitIsland',
  'manage',
  'members',
  'board',
  'notice',
  'visitIslandFocus',
  'raft',
];

/** 소속이 없어도(바다 도착 뒤 강퇴 등) 서버 방문 중에 열 수 있는 화면은 소속 검사가 되돌리지 않는다(GROMO-2311). */
export const visitRouteHeld = (route: Route, visitingIslandId: string | null | undefined) =>
  !!visitingIslandId && SERVER_VISIT_ROUTES.includes(route);
