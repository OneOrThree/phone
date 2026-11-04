import {
  State,
  displayIsland as currentIsland,
  isHost,
  serverHome,
  viewIsland,
} from '@/services/model';

// 주민 화면 가드 판정(GROMO-2138). 서버 모드는 로컬 목업 섬 대신 서버 current 로 소속을,
// 스냅샷의 완공 건물로 잠금을 본다. 미조회는 undefined로 유지해 아래 진입 가드가 기다리게 한다.
// 방문자는 현재 섬 주민 여부를 이어받지 않고 공개 읽기 API로 완공 여부를 확인한다.
export function memberGate(state: State, server: boolean) {
  if (!server) {
    const i = currentIsland(state);
    return { joined: i.joined, built: viewIsland(state).buildings, host: isHost(i) };
  }
  const facts = state.visitingIslandId ? null : serverHome(state);
  const visit = state.serverIslands?.visit;
  return {
    joined: !state.visitingIslandId && state.serverIslands?.currentIslandId != null,
    built: state.visitingIslandId
      ? visit?.island.id === state.visitingIslandId
        ? (visit.buildings ?? undefined)
        : undefined
      : facts?.completedBuildings,
    // 스냅샷 전에는 섬장인지 모른다 — false(주민)와 구분해 undefined 로 둔다(주민 소식 토스트가 섬장에게 새지 않게)
    host: facts ? facts.home.island.role === 'host' : undefined,
  };
}
