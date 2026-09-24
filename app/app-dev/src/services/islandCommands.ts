// GROMO-2006 섬 서버 명령 오케스트레이션 — App 에서 분리해 실제 구현을 직접 테스트한다.
// 규칙: 쓰기 응답만으로 성공 처리하지 않는다(create·active 가입·approved는 /me/islands 재조회로
// 확정). 멱등 키·초대 token은 세대 격리 ref에만 두고 State/AsyncStorage에 저장하지 않는다.
// 모든 명령은 시작 세대를 잡고 후속 API·dispatch·반환 전에 재검사한다 — 세대가 바뀐 늦은
// 응답은 CLIENT_STALE_SESSION으로 버린다.
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  CLIENT_STALE_SESSION,
  CLIENT_TIMEOUT,
  uuid,
} from '@/services/api/client';
import { me as apiMe } from '@/services/api/auth';
import { sessionGeneration } from '@/services/api/session';
import {
  cancelJoinRequest as apiCancelJoinRequest,
  createIsland as apiCreateIsland,
  CreateIslandInput,
  discoverIslands as apiDiscoverIslands,
  explore as apiExplore,
  joinIsland as apiJoinIsland,
  joinRequest as apiJoinRequest,
  myIslands as apiMyIslands,
  myJoinRequests as apiMyJoinRequests,
  resolveInvitation as apiResolveInvitation,
  visitIsland as apiVisitIsland,
} from '@/services/api/islands';
import { intentKeyPool, myIslandsConsistent, State } from '@/services/model';
import { captureProductEvent } from '@/services/posthog';

export type IslandApi = {
  createIsland: typeof apiCreateIsland;
  explore: typeof apiExplore;
  discover: typeof apiDiscoverIslands;
  visit: typeof apiVisitIsland;
  resolveInvite: typeof apiResolveInvitation;
  join: typeof apiJoinIsland;
  joinRequest: typeof apiJoinRequest;
  myJoinRequests: typeof apiMyJoinRequests;
  cancelJoinRequest: typeof apiCancelJoinRequest;
  myIslands: typeof apiMyIslands;
  /** GET /me — 메인 섬 정본(GROMO-1971·2054). `/me/islands` 는 이 축을 싣지 않는다. */
  me: typeof apiMe;
};

export type IslandCommandDeps = {
  dispatch: (a: { type: string; [key: string]: unknown }) => void;
  go: (route: string, islandId?: string) => void;
  getSnap: () => State['serverIslands'];
  setBootError?: (on: boolean) => void;
  /** 세션 세대 — 기본은 실제 sessionGeneration. 계정·세션이 바뀌면 값이 바뀐다. */
  generation?: () => number;
  /** 멱등 키 생성기 — 기본 uuid. */
  newKey?: () => string;
  api?: Partial<IslandApi>;
};

const defaultApi: IslandApi = {
  createIsland: apiCreateIsland,
  explore: apiExplore,
  discover: apiDiscoverIslands,
  visit: apiVisitIsland,
  resolveInvite: apiResolveInvitation,
  join: apiJoinIsland,
  joinRequest: apiJoinRequest,
  myJoinRequests: apiMyJoinRequests,
  cancelJoinRequest: apiCancelJoinRequest,
  myIslands: apiMyIslands,
  me: apiMe,
};

const contractError = () =>
  new ApiError('UPSTREAM_CONTRACT_ERROR', '섬 소속 정보가 올바르지 않아요.', 502);
const staleError = () =>
  new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);

// 결과 불명 — 서버가 커밋했는지 알 수 없다. REQUEST_IN_PROGRESS는 같은 키의 앞선 요청이 아직 처리 중이다.
// UPSTREAM_TIMEOUT은 공개 응답에서 HTTP 400으로 오므로(티켓 2088) 상태가 아니라 code로 가른다.
const unknownOutcome = (e: unknown) =>
  e instanceof ApiError &&
  ['UPSTREAM_TIMEOUT', 'REQUEST_IN_PROGRESS', CLIENT_TIMEOUT, CLIENT_NETWORK_ERROR].includes(
    e.code,
  );

export const createIslandCommands = (deps: IslandCommandDeps) => {
  const api = { ...defaultApi, ...deps.api },
    generation = deps.generation ?? sessionGeneration,
    newKey = deps.newKey ?? uuid;
  // 세대 격리 저장소 — 계정·세션이 바뀌면 진행 중 멱등 키와 초대 token을 함께 버린다.
  let box: {
    gen: number;
    keys: ReturnType<typeof intentKeyPool>;
    tokens: Record<string, string>;
  } | null = null;
  const scoped = () => {
    const g = generation();
    if (box?.gen !== g) box = { gen: g, keys: intentKeyPool(newKey), tokens: {} };
    return box;
  };
  // 후속 API·dispatch·반환 전의 세대 fence — 바뀌었으면 늦은 응답이라 버린다
  const alive = (g: number) => {
    if (generation() !== g) throw staleError();
  };
  const allJoinRequests = async (g: number) => {
    const requests: Awaited<ReturnType<IslandApi['myJoinRequests']>>['items'] = [];
    const ids = new Set<string>(),
      cursors = new Set<string>();
    let cursor: string | undefined;
    while (true) {
      alive(g);
      const page = await api.myJoinRequests(cursor === undefined ? {} : { cursor });
      alive(g);
      for (const request of page.items)
        if (!ids.has(request.id)) {
          ids.add(request.id);
          requests.push(request);
        }
      if (page.nextCursor == null) return requests;
      if (cursors.has(page.nextCursor)) throw contractError();
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  };
  // /me/islands·/me/join-requests·/me 정본 동기화. current 가 있으면 items 안에 있어야 한다 —
  // null current+소속은 유효하다(첫 pending 승인이 소속을 만들어도 current는 안 옮긴다).
  // /me 의 mainIslandId 도 함께 싣는다 — 소속 목록이 바뀌는 자리마다(가입·생성·승인·이탈 복구)
  // 서버 도출값(가장 최근 가입)과 프로필 선택값이 갈리지 않게 같은 액션으로 갈아 끼운다.
  const syncIslands = async () => {
    const g = generation();
    const [my, requests, account] = await Promise.all([
      api.myIslands(),
      allJoinRequests(g),
      api.me(),
    ]);
    alive(g);
    if (!myIslandsConsistent(my)) throw contractError();
    deps.dispatch({
      type: 'ISLAND_SYNC',
      memberships: my,
      requests,
      mainIslandId: account.mainIslandId,
    });
    return my;
  };
  // 409·404 계열은 서버 상태가 바뀌었다는 뜻 — 재조회로 화면 데이터를 맞춘 뒤 원 오류를 다시 던진다.
  // 쓰기 명령(write)은 결과 불명 오류에서도 재조회한다 — 서버가 이미 커밋했을 수 있다(GROMO-2118).
  // 조회는 아무것도 불명으로 만들지 않으므로 제외한다(승인 대기 폴링이 실패마다 재조회를 부르지 않게).
  const call = async <T>(fn: () => Promise<T>, write = false): Promise<T> => {
    // 명령 시작 세대 — 오류가 늦게 도착해 세대가 죽었으면 재조회도 rethrow도 하지 않는다.
    // 새 세션 화면에 옛 세션의 오류 배너를 심지 않게 CLIENT_STALE_SESSION으로 바꾼다.
    const g = generation();
    try {
      return await fn();
    } catch (thrown) {
      if (generation() !== g) throw staleError();
      if (
        thrown instanceof ApiError &&
        (['STATE_CONFLICT', 'VERSION_CONFLICT', 'GROUP_NOT_FOUND', 'NOT_FOUND'].includes(
          thrown.code,
        ) ||
          (write && unknownOutcome(thrown)))
      )
        try {
          await syncIslands();
        } catch {}
      // 재조회 도중 세대가 죽었으면 원 오류도 옛 세션의 것 — stale로 바꿔 던진다
      if (generation() !== g) throw staleError();
      throw thrown;
    }
  };
  const commands = {
    // 만들기: 응답만으로 로컬 성공 처리하지 않고 /me/islands 재조회로 current를 확정한다
    create: (input: CreateIslandInput) =>
      call(async () => {
        const g = generation(),
          body = JSON.stringify(input);
        const before = new Set((deps.getSnap()?.memberships ?? []).map((m) => m.id));
        try {
          await api.createIsland(input, scoped().keys.key('create', body));
        } catch (thrown) {
          if (!unknownOutcome(thrown)) throw thrown;
          // 결과 불명 — 재조회에서 방금 입력한 이름의 새 섬이 current면 서버가 커밋한 것이다.
          // 실패로 보여주면 사용자가 다시 만들어 섬이 두 개 생긴다(GROMO-2118).
          alive(g);
          const my = await syncIslands().catch(() => null);
          alive(g);
          const current = my?.items.find((m) => m.id === my.currentIslandId);
          if (!current || before.has(current.id) || current.name !== input.name) throw thrown;
          scoped().keys.release('create', body);
          captureProductEvent('island_membership_activated', { method: 'created' });
          return;
        }
        alive(g);
        await syncIslands();
        alive(g);
        scoped().keys.release('create', body);
        captureProductEvent('island_membership_activated', { method: 'created' });
      }),
    // 첫 발견 첫 페이지 — memberships도 함께 오므로 같은 정합 검사를 거쳐 정본 반영한다
    explore: () =>
      call(async () => {
        const g = generation();
        const [screen, requests] = await Promise.all([api.explore(), allJoinRequests(g)]);
        alive(g);
        if (!myIslandsConsistent(screen.memberships)) throw contractError();
        deps.dispatch({ type: 'ISLAND_SYNC', memberships: screen.memberships });
        deps.dispatch({
          type: 'ISLAND_CANDIDATES',
          items: screen.islands.items,
          nextCursor: screen.islands.nextCursor,
          reset: true,
        });
        deps.dispatch({ type: 'ISLAND_SYNC_REQUESTS', requests });
        return screen.islands;
      }),
    // 발견 다음 페이지 — INVALID_CURSOR/CURSOR_EXPIRED는 화면이 첫 페이지부터 다시 부른다
    discover: (cursor: string) =>
      call(async () => {
        const g = generation(),
          page = await api.discover({ cursor });
        alive(g);
        deps.dispatch({
          type: 'ISLAND_CANDIDATES',
          items: page.items,
          nextCursor: page.nextCursor,
        });
        return page;
      }),
    visit: (islandId: string) =>
      call(async () => {
        const g = generation(),
          screen = await api.visit(islandId);
        alive(g);
        deps.dispatch({ type: 'ISLAND_VISIT', visit: screen });
        return screen;
      }),
    // 초대 코드 해석 — token은 state에 넣지 않고 세대 격리 ref에 보관해 join이 그대로 쓴다
    resolveInvite: (code: string) =>
      call(async () => {
        const g = generation(),
          resolved = await api.resolveInvite(code);
        alive(g);
        scoped().tokens[resolved.island.id] = resolved.invitationToken;
        return resolved.island;
      }),
    // 가입·가입 신청. pending이면 requestId를 스냅샷에 남기고 승인 화면으로,
    // active면 /me/islands 재조회로 current를 확정한다(arrival/home은 CurrentScreens 차단이
    // 풀리기 전까지 열지 않는다). 응답이 확정되면 의도 키를 해제한다 — 취소·거절 뒤 같은 섬
    // 재신청은 새 키를 쓴다.
    join: (islandId: string) =>
      call(async () => {
        const g = generation(),
          token = scoped().tokens[islandId],
          body = token ?? '',
          result = await api.join(islandId, {
            idempotencyKey: scoped().keys.key(`join:${islandId}`, body),
            invitationToken: token,
          });
        alive(g);
        if (result.status === 'pending' && result.requestId) {
          scoped().keys.release(`join:${islandId}`, body);
          deps.dispatch({
            type: 'ISLAND_REQUEST',
            request: {
              id: result.requestId,
              islandId,
              status: 'pending',
              version: result.version,
            },
          });
          deps.go('approval', islandId);
          captureProductEvent('island_join_requested');
        } else if (result.status === 'active') {
          await syncIslands();
          alive(g);
          scoped().keys.release(`join:${islandId}`, body);
          captureProductEvent('island_membership_activated', { method: 'joined' });
        }
        alive(g);
        return result;
      }, true),
    // 신청 상태 조회(승인 대기 폴링) — approved는 memberships 재조회 성공 뒤에만 공개한다.
    // 재조회가 실패하면 requestStatus를 갱신하지 않아 미확정 성공 카드가 뜨지 않고 다음 폴링이 재시도한다.
    status: (requestId: string) =>
      call(async () => {
        const g = generation(),
          r = await api.joinRequest(requestId);
        alive(g);
        const current = deps.getSnap()?.requestStatus.find((x) => x.id === requestId);
        if (r.status === 'pending' && current && current.status !== 'pending') return current;
        if (r.status === 'approved') await syncIslands();
        alive(g);
        deps.dispatch({ type: 'ISLAND_REQUEST', request: r });
        if (r.status === 'approved' && current?.status === 'pending')
          captureProductEvent('island_membership_activated', { method: 'approved' });
        return r;
      }),
    // pending 목록 재조회 — 재실행 복구와 취소 후 정정에 쓴다
    requests: () =>
      call(async () => {
        const g = generation(),
          requests = await allJoinRequests(g);
        alive(g);
        deps.dispatch({ type: 'ISLAND_SYNC_REQUESTS', requests });
        return { items: requests, nextCursor: null };
      }),
    // 신청 취소 — 목록 재조회 뒤 실제 취소 응답의 status를 requestStatus에도 기록해
    // 대기 카드·취소 버튼이 남지 않게 한다. 서버가 version을 안 주면 기존 값을 유지한다(합성 금지).
    cancel: (requestId: string) =>
      call(async () => {
        const g = generation(),
          res = await api.cancelJoinRequest(
            requestId,
            scoped().keys.key(`cancel:${requestId}`, ''),
          );
        alive(g);
        // 목록이 갈아 끼워지기 전 기존 엔트리에서 islandId를 찾는다 — 모르면 합성하지 않는다
        const snap = deps.getSnap(),
          prev =
            snap?.requestStatus.find((x) => x.id === requestId) ??
            snap?.joinRequests.find((x) => x.id === requestId);
        // 목록 갱신 전에 종결 상태를 먼저 기록한다 — reducer가 기존 항목의 version을 유지할 수 있게
        if (prev)
          deps.dispatch({
            type: 'ISLAND_REQUEST',
            request: { id: res.id, islandId: prev.islandId, status: res.status },
          });
        const requests = await allJoinRequests(g);
        alive(g);
        deps.dispatch({ type: 'ISLAND_SYNC_REQUESTS', requests });
        scoped().keys.release(`cancel:${requestId}`, '');
      }, true),
    // 부팅 동기화 재시도 — 성공하면 오류 플래그를 내린다. 단, 응답이 늦게 도착해 세대가
    // 죽었으면 플래그도 건드리지 않는다.
    sync: async () => {
      const g = generation(),
        my = await syncIslands();
      alive(g);
      deps.setBootError?.(false);
      return my;
    },
  };
  return { syncIslands, commands };
};
