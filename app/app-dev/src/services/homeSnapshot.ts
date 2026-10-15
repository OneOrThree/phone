/**
 * 홈 서버 스냅샷 로더(GROMO-2151). `GET /screens/home` **한 번**으로 홈 전체를 그린다 —
 * island·완공 건물·주민 첫 페이지가 모두 한 응답에 실려서, memberships 사전 확인 → home·
 * construction-options·members 병렬 조회 → memberships 재확인으로 이어지던 이전 5콜 흐름
 * (GROMO-2007)이 더는 필요 없다.
 *
 * 계약(동결표):
 *  - 서버는 currentIslandId 가 없으면 `GET /screens/home` 을 `409 STATE_CONFLICT`
 *    (`field: 'currentIslandId'`)로 거절한다(IM-D06 미승인 — 서버도 임의 섬을 고르지 않는다).
 *    이 로더는 그 실패를 명시 선택 상태로 접어 돌려준다. 소속 목록은 이 응답에 없으므로
 *    호출부가 별도로 `/me/islands` 를 다시 읽어야 한다(App.tsx 의 `syncIslands`).
 *  - 결과는 `HomeWorldFacts` 다 — rich local `Island` 를 만들지 않고, catColor null 보존,
 *    완공 건물은 서버가 준 `buildings` 그대로다(클라이언트 재계산 없음).
 *  - 호출이 «시작된» 인증 세대와 호출부 `isCurrent` 를 유일한 await 경계에서 검사한다 —
 *    오래된 호출은 `CLIENT_STALE_SESSION` 으로 reject 하고 성공·undefined 로 돌아가지 않는다.
 */
import { ApiError, CLIENT_STALE_SESSION } from './api/client';
import {
  CANONICAL_BUILDINGS,
  CLIENT_CONTRACT_ERROR,
  getHome,
  type BuildingId,
  type HomeScreen,
  type IslandMember,
} from './api/home';
import { sessionGeneration } from './api/session';

export type HomeWorldFacts = {
  /** `home.island.id` — 이 스냅샷이 그린 섬. */
  islandId: string;
  /** `/screens/home` 응답 그대로 — 지갑·집중 요약·island·주민 모두 서버 값이다. */
  home: HomeScreen;
  /** 서버가 준 완공 건물 id — canonical7 부분집합, canonical 순서. */
  completedBuildings: BuildingId[];
  /** 주민 첫 페이지 — 정원 15 라 한 페이지가 전원이다. catColor null 은 그대로 보존한다. */
  members: IslandMember[];
};

export type HomeSnapshot =
  | { status: 'loaded'; facts: HomeWorldFacts }
  /** current 없음(서버 409 STATE_CONFLICT/currentIslandId) — 소속 목록은 호출부가 따로 읽는다. */
  | { status: 'select' };

export interface LoadHomeOptions {
  /** `YYYY-MM-DD` — home 의 오늘 집중 요약 기준일. */
  date: string;
  /** IANA 타임존(예 `Asia/Seoul`). */
  timezone: string;
  /**
   * 호출부의 화면 세대가 아직 유효한지(선택). false 를 돌려주는 즉시 이 로더는
   * `CLIENT_STALE_SESSION` 으로 reject 한다 — 늦은 응답을 화면에 적용하는 것은 호출부 몫이다.
   */
  isCurrent?: () => boolean;
}

const CANONICAL = new Set<string>(CANONICAL_BUILDINGS);

export async function loadHomeSnapshot({
  date,
  timezone,
  isCurrent,
}: LoadHomeOptions): Promise<HomeSnapshot> {
  // 호출이 «시작된» 인증 세대 — 유일한 await 경계에서 이 값과 비교한다.
  const generation = sessionGeneration();
  const alive = () => {
    if (sessionGeneration() !== generation || isCurrent?.() === false) {
      throw new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);
    }
  };
  const contractError = (field: string) =>
    new ApiError(CLIENT_CONTRACT_ERROR, `계약과 다른 응답입니다 (${field}).`, 0, { field });

  // 시작부터 죽은 호출은 요청을 하나도 보내지 않는다.
  alive();
  let home: HomeScreen;
  try {
    home = await getHome(date, timezone);
  } catch (thrown) {
    alive();
    // IM-D06 미승인 — 서버가 현재 섬 없음을 알리는 유일한 경로다. 소속·lossReason 은
    // 이 응답에 없으니 임의로 지어내지 않고 명시 선택 상태로만 접는다.
    if (
      thrown instanceof ApiError &&
      thrown.code === 'STATE_CONFLICT' &&
      thrown.field === 'currentIslandId'
    ) {
      return { status: 'select' };
    }
    throw thrown;
  }
  alive();

  // 어댑터는 wire 를 검증하지 않는다 — 빠진 island·members 가 TypeError 로 새지 않게 계약 오류로 통일한다
  if (typeof home?.island?.id !== 'string') throw contractError('island');
  if (!Array.isArray(home.members?.items)) throw contractError('members');
  // buildings 는 completedBuildings 로 그대로 노출되는 공개 타입이라 모르는 id·비배열을
  // 지어내지 않고 여기서 계약 오류로 막는다(GROMO-2151) — home.ts 의 기존 계약 오류 스타일과 같다.
  if (!Array.isArray(home.buildings) || home.buildings.some((id) => !CANONICAL.has(id))) {
    throw contractError('buildings');
  }

  return {
    status: 'loaded',
    facts: {
      islandId: home.island.id,
      home,
      completedBuildings: home.buildings,
      members: home.members.items,
    },
  };
}
