// GROMO-2006 부팅 경로 결정 — 실제 부팅 로직을 App 에서 분리해 직접 테스트한다.
// 규칙: checkSession 결과 직후 포획한 세대(bootGen)로 동기화 도중 세션이 죽었는지 본다.
// syncIslands 도중 401이 나면 client 가 세션을 지우고 notifySessionLost → App 핸들러가
// LOGOUT+reset('login')을 실행한다 — 그 뒤 stale account로 setRoute하면 login을 덮어쓴다.
// 세대가 죽었으면 route·오류 플래그를 쓰지 않고 null을 돌려 login 핸들러가 이기게 한다.
import { restoredRoute, RestoredAccount, SavedShape } from '@/services/restore';
import type { MyIslands } from '@/services/api/islands';
import type { Route } from '@/services/model';

export const decideBootRoute = async (deps: {
  saved: SavedShape | null;
  account: RestoredAccount | null;
  rejected: boolean;
  /** account && !mock — 서버 정본으로 onboarded를 정하는 모드 */
  serverMode: boolean;
  /** checkSession 결과가 나온 직후 포획한 인증 세대 */
  bootGen: number;
  generation: () => number;
  syncIslands: () => Promise<MyIslands>;
  onBootError: (on: boolean) => void;
}): Promise<Route | null> => {
  let serverOnboarded: boolean | null = null;
  if (deps.serverMode) {
    try {
      const my = await deps.syncIslands();
      // 늦게 도착한 성공도 죽은 세대의 것이다 — 플래그·route를 쓰지 않는다
      if (deps.generation() !== deps.bootGen) return null;
      serverOnboarded = my.currentIslandId != null;
      deps.onBootError(false);
    } catch {
      // 세대가 죽은 채 끝난 실패(401→세션 상실 등)는 플래그도 쓰지 않는다
      if (deps.generation() === deps.bootGen) deps.onBootError(true);
    }
  }
  // 세션 상실 핸들러가 이미 login으로 돌렸다 — stale account로 덮어쓰지 않는다
  if (deps.generation() !== deps.bootGen) return null;
  if (!deps.saved && !deps.account) return null;
  let r = restoredRoute(
    {
      ...(deps.saved ?? {}),
      onboarded: deps.serverMode ? (serverOnboarded ?? false) : deps.saved?.onboarded,
    },
    deps.account,
    deps.rejected,
  );
  // 서버 모드 홈은 서버 스냅샷을 직접 그린다(GROMO-2138). 옛 로컬 집중 세션은 되살리지 않는다 —
  // 진행 세션은 App 이 부팅 뒤 서버 recover 로 따로 복구한다.
  if (deps.serverMode && (r === 'arrival' || r === 'focus' || r === 'rest')) r = 'home';
  return r;
};
