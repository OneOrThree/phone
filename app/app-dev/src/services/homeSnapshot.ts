/**
 * 홈 서버 스냅샷 로더(GROMO-2007). 비-React 서비스 — 화면 state·route 를 직접 갱신하지 않고
 * 한 번의 호출이 memberships → current 캡처 → home/options/members 병렬 수집 → current 재확인을
 * 거쳐 **원자적 결과 하나**를 돌려준다.
 *
 * 계약(동결표):
 *  - current 가 null 이면 소속 목록·lossReason 을 담은 명시적 선택 상태다 — 소속이 있어도 정상이고
 *    앱이 임의 섬을 고르지 않는다. mainIslandId 로 current 를 대체하지 않는다.
 *  - non-null current 가 소속 목록 밖이거나 `home.island.id` 가 current 와 다르면 계약 오류다.
 *  - members 는 `nextCursor` 를 끝까지 잇는다 — 되돌아온 커서·중복 주민·페이지 간 version 변경은
 *    불완전 목록을 완료로 보이지 않게 실패시킨다.
 *  - 조각을 다 모은 뒤 `/me/islands` 를 다시 읽어 current·소속 유지를 확인한다. 바뀌었으면
 *    옛 섬 스냅샷을 돌려주지 않는다.
 *  - 결과는 `HomeWorldFacts` 다 — rich local `Island` 를 만들지 않고, catColor null 보존,
 *    공사 시간·진행률 합성 없음, options 잔액으로 home 지갑을 덮어쓰지 않는다.
 *  - 각 비동기 경계마다 호출 시작의 인증 세대와 호출부 `isCurrent` 를 검사한다 — 오래된 호출은
 *    `CLIENT_STALE_SESSION` 으로 reject 하고 성공·undefined 로 돌아가지 않는다.
 */
import { ApiError, CLIENT_STALE_SESSION } from './api/client';
import {
  CLIENT_CONTRACT_ERROR,
  completedBuildings,
  getConstructionOptions,
  getHome,
  getMembers,
  type BuildingId,
  type HomeScreen,
  type IslandMember,
  type MembersPage,
} from './api/home';
import { myIslands, type MyIslands } from './api/islands';
import { sessionGeneration } from './api/session';

/** 수집 도중 current·소속이 바뀌었다 — 호출부는 memberships 복구부터 다시 시작한다. */
export const CLIENT_SNAPSHOT_STALE = 'CLIENT_SNAPSHOT_STALE';

export type HomeWorldFacts = {
  /** 캡처한 current — home.island.id·options·members 의 target 과 같음이 검증된 섬. */
  islandId: string;
  /** `/screens/home` 응답 그대로 — 지갑·집중 요약·island 모두 서버 값이다. */
  home: HomeScreen;
  /** canonical7 − options.items — 정확한 완공 건물 목록. */
  completedBuildings: BuildingId[];
  /** 서버 주민 전원(모든 페이지) — catColor null 은 그대로, 임의색·임의 actor 추가 금지. */
  members: IslandMember[];
};

export type HomeSnapshot =
  | { status: 'loaded'; facts: HomeWorldFacts }
  /** current 없음 — 소속 목록과 lossReason 을 담은 명시적 선택 상태. 소속이 있어도 정상이다. */
  | { status: 'select'; memberships: MyIslands };

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

// ponytail: 정원 15·limit 100 이라 정상 계약에선 members 가 1쪽이다 — 서버가 커서를 계속 주는
// 비정상을 32쪽에서 끊는다(무한 pagination 금지). 커서 재등장 검사보다 넓은 최후 방어선.
const MAX_MEMBER_PAGES = 32;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export async function loadHomeSnapshot({
  date,
  timezone,
  isCurrent,
}: LoadHomeOptions): Promise<HomeSnapshot> {
  // 호출이 «시작된» 인증 세대 — 이후 모든 경계에서 이 값과 비교한다.
  const generation = sessionGeneration();
  const alive = () => {
    if (sessionGeneration() !== generation || isCurrent?.() === false) {
      throw new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);
    }
  };
  const contractError = (field: string) =>
    new ApiError(CLIENT_CONTRACT_ERROR, `계약과 다른 응답입니다 (${field}).`, 0, { field });
  const stale = () =>
    new ApiError(CLIENT_SNAPSHOT_STALE, '섬 상태가 바뀌었어요. 다시 시도해 주세요.', 0);
  // 모든 await 는 여기를 지난다 — 성공이든 reject 이든 경계 뒤에 세대·isCurrent 를 검사한다.
  // 죽은 호출의 늦은 실패는 CLIENT_STALE_SESSION 으로 바꾸고, 살아 있으면 원래 오류를 보존한다.
  const gate = async <T>(pending: Promise<T>): Promise<T> => {
    try {
      const value = await pending;
      alive();
      return value;
    } catch (thrown) {
      alive();
      throw thrown;
    }
  };
  // 어댑터는 wire 를 검증하지 않는다 — 최상위 null·비객체·빠진 items·null 항목이 TypeError 로
  // 새지 않게 쓰기 직전에 좁게 확인하고 계약 오류로 통일한다.
  const membershipsOk = (m: unknown): m is MyIslands =>
    isRecord(m) &&
    Array.isArray(m.items) &&
    m.items.every((item) => isRecord(item) && typeof item.id === 'string');

  // 시작부터 죽은 호출은 요청을 하나도 보내지 않는다.
  alive();
  const mine = await gate(myIslands());
  if (!membershipsOk(mine)) throw contractError('items');
  const current = mine.currentIslandId;
  if (current === null) return { status: 'select', memberships: mine };
  // current 는 소속 목록 안에 있어야 한다 — 밖이면 서버 응답 자체가 모순이다.
  if (!mine.items.some((item) => item.id === current)) throw contractError('currentIslandId');

  alive();
  const [home, options, firstPage] = await gate(
    Promise.all([getHome(date, timezone), getConstructionOptions(current), getMembers(current)]),
  );
  // 두 도메인 응답에는 islandId 가 없다 — home 의 섬이 캡처한 current 와 같은지 여기서 묶는다.
  if (!isRecord(home) || !isRecord(home.island) || typeof home.island.id !== 'string') {
    throw contractError('home.island');
  }
  if (home.island.id !== current) throw contractError('home.island.id');
  if (!Number.isInteger(home.island.memberCount) || home.island.memberCount < 0) {
    throw contractError('home.island.memberCount');
  }

  // members 를 끝까지 잇는다 — 첫 페이지든 후속이든 같은 검사를 탄다:
  // items 배열·finite version·cursor 모양 확인 뒤 주민 id 중복까지 전부 계약 오류다.
  const members: IslandMember[] = [];
  const seenIds = new Set<string>();
  const usedCursors = new Set<string>();
  let version: number | null = null;
  const take = (page: MembersPage) => {
    if (!isRecord(page) || !Array.isArray(page.items)) throw contractError('members.items');
    if (!isNumber(page.version)) throw contractError('members.version');
    if (page.nextCursor !== null && typeof page.nextCursor !== 'string') {
      throw contractError('members.nextCursor');
    }
    if (version === null) version = page.version;
    else if (page.version !== version) throw contractError('members.version');
    for (const member of page.items) {
      const id = isRecord(member) ? member.id : undefined;
      if (typeof id !== 'string' || seenIds.has(id)) throw contractError('members.items');
      seenIds.add(id);
      members.push(member);
    }
  };
  take(firstPage);
  let cursor = firstPage.nextCursor;
  let pages = 1;
  while (cursor !== null) {
    if (usedCursors.has(cursor) || pages >= MAX_MEMBER_PAGES) {
      throw contractError('members.nextCursor');
    }
    usedCursors.add(cursor);
    alive();
    const page = await gate(getMembers(current, cursor));
    take(page);
    cursor = page.nextCursor;
    pages += 1;
  }

  // 홈이 말한 정원과 실제로 모은 주민 수가 다르면 수집 도중 소속이 바뀐 것이다 —
  // 불완전 목록을 완료로 보이지 않게 stale 로 실패시킨다.
  if (home.island.memberCount !== members.length) throw stale();

  // 조각을 다 모은 뒤의 재조회 — 그 사이 전환·강퇴가 있었으면 이 스냅샷은 옛 섬의 것이다.
  alive();
  const again = await gate(myIslands());
  if (!membershipsOk(again)) throw contractError('items');
  if (again.currentIslandId !== current || !again.items.some((item) => item.id === current)) {
    throw stale();
  }

  return {
    status: 'loaded',
    facts: {
      islandId: current,
      home,
      completedBuildings: completedBuildings(options),
      members,
    },
  };
}
