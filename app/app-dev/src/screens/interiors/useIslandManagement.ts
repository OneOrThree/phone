/**
 * 섬 관리 화면 상태 hook(GROMO-2008) — 읽기 경로 + 설정 저장 쓰기. 승인/거절·강퇴·위임은
 * 같은 write runner 를 타는 후속 슬라이스다.
 *
 * 계약:
 *  - `{active, islandId}` 를 호출부가 명시한다. inactive·null 섬이면 보호 GET·쓰기 모두 0건이고
 *    mock 값을 만들지 않는다.
 *  - `GET /islands/{id}` 가 주민 상세가 아니라 공개 요약을 주면(role 이 host/member 가 아니거나
 *    version 이 정수가 아니거나 id 가 다르면) 관리 상세로 쓰지 않고 `accessLost` 로 반환하며
 *    기존 상세·주민·신청 캐시를 지운다. role 의 정본은 서버 — 로딩·오류 중 방장 권한을
 *    추측하지 않는다(쓰기는 마지막으로 확정된 host 상세에서만 나간다).
 *  - 유효한 주민 상세가 확인되면 주민 목록을, host 일 때만 신청 목록을 읽는다. 둘은 병렬이고
 *    요청마다 limit=100 으로 cursor 체인을 끝까지 모은다. 반복 cursor·중복 ID(첫 페이지
 *    포함)·주민 page version 불일치·깨진 페이지 모양은 전부 오류다 — 모르는 값을 빈 목록으로
 *    접지 않는다. reload 는 원자적 — 부분 결과를 싣지 않는다.
 *  - 쓰기는 의도 슬롯마다 UUID36 key 를 한 번 만든다 — 같은 payload 의 네트워크/재시도 가능한
 *    실패는 같은 key+body 로 다시 보내고, 다른 payload 는 다른 의도다. 진행 중 같은 payload 의
 *    중복 호출은 진행 중인 promise 하나를 돌려주고, 진행 중 다른 payload·다른 명령은 거절한다
 *    (단일 쓰기 flight). 성공 뒤에는 상세·주민·신청 재조회가 끝나야 resolve 한다. 403/409 는
 *    최신 상태 재조회를 시도하되 원래 오류를 그대로 올리고, terminal 실패는 의도를 종료해
 *    재호출이 새 key 를 받게 한다.
 *  - 모든 비동기 발행은 scope 객체(섬 + 인증 세대)·호출 순서(seq)·mounted fence 를 통과해야
 *    한다. 세대 교체·섬 이동·inactive·unmount 뒤 옛 scope 의 결과는 절대 뒤늦게 확정하지
 *    않고, stale 호출은 CLIENT_STALE_SESSION 로 reject 한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  CLIENT_STALE_SESSION,
  CLIENT_TIMEOUT,
  uuid,
} from '@/services/api/client';
import {
  answerIslandJoinRequest,
  getManagedIsland,
  islandJoinRequests,
  islandMembers,
  kickIslandMember,
  manageIsland,
  transferIslandHost,
  type IslandJoinRequestItem,
  type IslandMember,
  type ManagedIsland,
  type ManageIslandPatch,
} from '@/services/api/islandManagement';
import type { IslandSummary } from '@/services/api/islands';
import { sessionGeneration } from '@/services/api/session';

/** 앱이 만든 code — 서버 코드와 섞이지 않게 CLIENT_ 접두어(client.ts 규칙). */
export const CLIENT_INACTIVE = 'CLIENT_INACTIVE';
/** cursor 체인이 계약과 어긋났다 — 반복 cursor·중복 ID·주민 version 불일치·깨진 페이지. */
export const CLIENT_BROKEN_PAGE = 'CLIENT_BROKEN_PAGE';
/** 쓰기는 마지막으로 확정된 host 상세에서만 나간다 — 추측된 권한으로 보내지 않는다. */
export const CLIENT_FORBIDDEN = 'CLIENT_FORBIDDEN';
/** 진행 중인 쓰기와 다른 명령·다른 payload — 암묵 성공으로 두지 않고 거절한다. */
export const CLIENT_IN_FLIGHT = 'CLIENT_IN_FLIGHT';

const PAGE_LIMIT = 100;

export type IslandManagementSnapshot = {
  /** 주민 상세 — role/version 이 확인된 것만 싣는다. */
  detail: ManagedIsland | null;
  /** 주민 첫 페이지. null = 미확정(로딩·오류·접근 상실), [] = 확인된 빈 목록. */
  members: IslandMember[] | null;
  /** host 전용 신청 첫 페이지. 일반 주민·미확정이면 null. */
  requests: IslandJoinRequestItem[] | null;
  loading: boolean;
  error: ApiError | null;
  /** 요약만 와서 관리 권한이 없음이 확인된 상태. */
  accessLost: boolean;
};

const EMPTY: IslandManagementSnapshot = {
  detail: null,
  members: null,
  requests: null,
  loading: false,
  error: null,
  accessLost: false,
};

/** 한 번 살아 있는 읽기 범위 — 객체 자체가 epoch 이다(정리되면 scopeRef 에서 빠진다). */
type Scope = { gen: number; islandId: string };
type WriteIntent = { key: string; payload: string; scope: Scope };

const staleError = () =>
  new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);
const inactiveError = () => new ApiError(CLIENT_INACTIVE, '화면이 닫혔어요.', 0);
const forbiddenError = () => new ApiError(CLIENT_FORBIDDEN, '방장만 실행할 수 있어요.', 0);
const inFlightError = () => new ApiError(CLIENT_IN_FLIGHT, '다른 명령이 처리 중이에요.', 0);
const brokenPage = () =>
  new ApiError(CLIENT_BROKEN_PAGE, '목록이 갱신 중 섞였어요. 다시 시도해 주세요.', 0);
const asApiError = (error: unknown): ApiError =>
  error instanceof ApiError
    ? error
    : new ApiError('CLIENT_UNEXPECTED', '처리 중 문제가 생겼어요.', 0);

/** 응답 유실·네트워크 계열 — 같은 key+body 로 다시내도 되는 실패만 true. */
const isRetryable = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.retryable === true ||
    error.code === CLIENT_TIMEOUT ||
    error.code === CLIENT_NETWORK_ERROR);

/** 같은 설정 의도인지 비교하는 정본 문자열 — 키 순서 고정, undefined 는 body 에도 안 실린다. */
const canonicalPatch = (patch: ManageIslandPatch): string =>
  JSON.stringify({
    name: patch.name,
    intro: patch.intro,
    approvalRequired: patch.approvalRequired,
    maxMembers: patch.maxMembers,
  });

/**
 * 주민 상세인지 판별 — 비주민·방문자에게는 role/version 없는 공개 요약이 올 수 있다.
 * role 은 host/member 만 주민이고 version 은 정수, 섬 id 도 요청한 것과 같아야 한다.
 */
const isResidentDetail = (
  detail: ManagedIsland | IslandSummary,
  islandId: string,
): detail is ManagedIsland =>
  !!detail &&
  detail.id === islandId &&
  'role' in detail &&
  (detail.role === 'host' || detail.role === 'member') &&
  Number.isInteger(detail.version);

type Page<T> = { items: T[]; nextCursor: string | null; version?: number };

/**
 * cursor 체인을 끝까지 모은다. 반복 cursor·중복 ID(첫 페이지 포함)·주민 version 불일치·
 * 깨진 페이지(items 배열 없음·id 없는 항목)는 전부 CLIENT_BROKEN_PAGE — 부분 목록을
 * 정상 결과로 돌려주지 않는다. 매 페이지 전에 guard() 로 scope·순서를 다시 본다.
 */
export async function collectPages<T extends { id: string }>(
  guard: () => void,
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  versioned: boolean,
): Promise<T[]> {
  const items: T[] = [];
  const ids = new Set<string>();
  const used = new Set<string>();
  let cursor: string | undefined;
  let version: number | undefined;
  for (;;) {
    guard();
    if (cursor !== undefined) {
      if (used.has(cursor)) throw brokenPage();
      used.add(cursor);
    }
    const page = await fetchPage(cursor);
    guard(); // 늦게 도착한 페이지를 살아 있는 것처럼 처리하지 않는다
    if (!page || !Array.isArray(page.items)) throw brokenPage();
    if (versioned) {
      if (!Number.isInteger(page.version)) throw brokenPage();
      if (version === undefined) version = page.version;
      else if (page.version !== version) throw brokenPage();
    }
    for (const item of page.items) {
      if (!item || typeof item.id !== 'string') throw brokenPage();
      if (ids.has(item.id)) throw brokenPage();
      ids.add(item.id);
      items.push(item);
    }
    cursor = page.nextCursor ?? undefined;
    if (cursor === undefined) return items;
  }
}

export function useIslandManagement({
  active,
  islandId,
}: {
  active: boolean;
  islandId: string | null;
}) {
  const [snap, setSnap] = useState<IslandManagementSnapshot>(EMPTY);
  const mounted = useRef(false);
  const scopeRef = useRef<Scope | null>(null);
  const loadSeq = useRef(0);
  /** 마지막으로 확정된 상세 — 쓰기의 host 게이트가 여기만 본다(추측 금지). */
  const detailRef = useRef<ManagedIsland | null>(null);
  /** 마지막으로 성공 확정된 재조회의 seq — 쓰기 성공은 이 값이 최신 loadSeq 일 때만. */
  const confirmSeq = useRef(0);
  /** 의도 슬롯 — 같은 payload 재시도는 같은 key 를 쓰게 보관한다. */
  const intents = useRef(new Map<string, WriteIntent>());
  const flights = useRef(new Map<string, Promise<void>>());
  /** 단일 쓰기 flight — 명령 병렬 실행으로 관리 상태를 덮지 않는다. 의도 객체가 소유권 토큰. */
  const writeBusy = useRef<WriteIntent | null>(null);
  // 렌더 시점에 읽어 effect deps 에 태운다 — 세션 교체 뒤 첫 렌더에서 범위가 재생성된다.
  const generation = sessionGeneration();

  // mounted fence 는 load effect 보다 먼저 선언한다(선언 순서 = 실행 순서).
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const alive = useCallback(
    (scope: Scope): boolean =>
      mounted.current && scopeRef.current === scope && scope.gen === sessionGeneration(),
    [],
  );

  /** 한 범위의 원자적 읽기: 상세 → 주민 전체 페이지 + (host) 신청 전체 페이지(병렬). */
  const runReload = useCallback(
    async (scope: Scope): Promise<void> => {
      const seq = ++loadSeq.current;
      const current = () => alive(scope) && seq === loadSeq.current;
      const guard = () => {
        if (!current()) throw staleError();
      };
      const publish = (next: IslandManagementSnapshot) => {
        if (current()) {
          detailRef.current = next.detail; // 캐시는 scope 와 함께 살고 죽는다
          setSnap(next);
        }
      };
      guard(); // 이미 죽은 scope 에서는 첫 요청도 내지 않는다
      publish({ ...EMPTY, loading: true });
      try {
        const detail = await getManagedIsland(scope.islandId);
        guard();
        if (!isResidentDetail(detail, scope.islandId)) {
          publish({ ...EMPTY, accessLost: true });
          return;
        }
        const membersP = collectPages(
          guard,
          (cursor) => islandMembers(scope.islandId, { cursor, limit: PAGE_LIMIT }),
          true,
        );
        const requestsP =
          detail.role === 'host'
            ? collectPages(
                guard,
                (cursor) => islandJoinRequests(scope.islandId, { cursor, limit: PAGE_LIMIT }),
                false,
              )
            : Promise.resolve(null);
        const [members, requests] = await Promise.all([membersP, requestsP]);
        guard(); // 죽은 scope 의 완료는 성공으로 끝내지 않는다 — stale reject
        publish({
          detail,
          members,
          requests,
          loading: false,
          error: null,
          accessLost: false,
        });
        confirmSeq.current = seq; // canonical 확정 — 쓰기 성공의 근거는 이 값이다
      } catch (error) {
        publish({ ...EMPTY, loading: false, error: asApiError(error) });
        // 옛 scope(세대 교체·섬 이동·supersede)의 결과는 성공이든 실패든 STALE 로 통일한다 —
        // 쓰기 후 재조회가 옛 scope 에서 끝나도 성공으로 오인되지 않는다.
        if (!current()) throw staleError();
        throw error;
      }
    },
    [alive],
  );

  useEffect(() => {
    const intentMap = intents.current;
    const flightMap = flights.current;
    if (!active || islandId === null) {
      scopeRef.current = null;
      detailRef.current = null;
      loadSeq.current += 1;
      setSnap(EMPTY);
      return;
    }
    const scope: Scope = { gen: generation, islandId };
    // 화면을 잠깐 닫았다가 같은 섬·같은 계정으로 돌아오면, 아직 서버에 도착 중인 PATCH를
    // 새 요청보다 먼저 끝내야 한다. 반면 섬/계정이 달라진 범위는 서로 막지 않는다.
    if (
      writeBusy.current === null ||
      writeBusy.current.scope.gen !== scope.gen ||
      writeBusy.current.scope.islandId !== scope.islandId
    ) {
      intentMap.clear();
      flightMap.clear();
      writeBusy.current = null;
    }
    scopeRef.current = scope;
    runReload(scope).catch(() => undefined);
    return () => {
      if (scopeRef.current === scope) scopeRef.current = null;
      detailRef.current = null;
      loadSeq.current += 1;
    };
  }, [active, islandId, generation, runReload]);

  /** 공개 콜백의 현재 scope — 옛 섬·옛 세대·닫힌 화면에서 만든 콜백은 여기서 거절된다. */
  const callScope = useCallback((): Scope => {
    const scope = scopeRef.current;
    if (!mounted.current || scope === null) throw inactiveError();
    if (
      scope.islandId !== islandId ||
      scope.gen !== generation ||
      scope.gen !== sessionGeneration()
    )
      throw staleError();
    return scope;
  }, [islandId, generation]);

  /** 수동 재조회 — 현재 scope 의 것만 받는다. async 여야 거절이 throw 가 아니라 reject 다. */
  const reload = useCallback(
    async (): Promise<void> => runReload(callScope()),
    [callScope, runReload],
  );

  /**
   * 모든 쓰기 명령의 단일 통로 — fence·의도 슬롯·단일 flight·성공 후 재조회·오류 분류를
   * 여기서만 처리한다. `slot` 은 명령+대상을, `payload` 는 같은 의도인지의 정본 문자열을 받는다.
   */
  const runWrite = useCallback(
    async (
      scope: Scope,
      slot: string,
      payload: string,
      exec: (key: string) => Promise<unknown>,
    ): Promise<void> => {
      // dedupe·단일 flight 먼저 — 재조회 구간에 detail 이 잠시 비어도 같은 의도는 합류하고
      // 다른 의도는 IN_FLIGHT 로 거절돼야지 FORBIDDEN 으로 잘못 나가면 안 된다.
      const inFlight = flights.current.get(slot);
      if (inFlight !== undefined) {
        const intent = intents.current.get(slot);
        if (intent !== undefined && intent.payload === payload && intent.scope === scope)
          return inFlight; // 같은 의도의 중복 호출 — 진행 중인 것 하나로 합류
        throw inFlightError(); // 진행 중 다른 payload — 암묵 성공으로 두지 않는다
      }
      if (writeBusy.current !== null) throw inFlightError(); // 다른 명령 진행 중

      // 네트워크 오류로 성공 뒤 canonical 재조회만 실패한 동일 의도는, 직전의 확정 host
      // 근거와 key/body를 보존해 다시 보낸다. 진짜 403·요약 응답은 intent를 끝내므로 이
      // 예외로 권한을 추측하지 않는다.
      const previousIntent = intents.current.get(slot);
      const retryingConfirmedIntent =
        previousIntent !== undefined &&
        previousIntent.payload === payload &&
        previousIntent.scope === scope;
      // 방장 권한은 마지막으로 확정된 상세로만 판단한다 — 로딩·오류·비주민에서는 보내지 않는다.
      const confirmed = detailRef.current;
      if (
        !retryingConfirmedIntent &&
        (confirmed === null || confirmed.id !== scope.islandId || confirmed.role !== 'host')
      )
        throw forbiddenError();

      const intent: WriteIntent = retryingConfirmedIntent
        ? previousIntent
        : { key: uuid(), payload, scope };
      if (!retryingConfirmedIntent) {
        intents.current.set(slot, intent);
      }
      const key = intent.key;
      writeBusy.current = intent;
      // finally 가 자기 자신과 identity 비교한다 — 선언과 생성을 나눠야 tsc 가 받는다.
      let flight!: Promise<void>;
      flight = (async () => {
        try {
          await exec(key);
          // 쓰기 성공은 서버 재조회로 확정한 뒤에만 resolve 한다 — 응답 본문만으로 확정 금지.
          await runReload(scope).catch((error) => {
            // 살아 있는 scope 의 STALE 은 더 늦게 시작한 읽기가 확정권을 가져간 것뿐이다 —
            // 아래에서 그 최신 읽기가 실제로 성공 확정됐는지 본다. 죽은 scope 의 STALE 은 올린다.
            if (error instanceof ApiError && error.code === CLIENT_STALE_SESSION && alive(scope))
              return;
            throw error;
          });
          // 성공은 최신 canonical 재조회가 실제로 확정됐을 때만 — supersede·pending·실패면 stale.
          if (!alive(scope) || confirmSeq.current !== loadSeq.current) throw staleError();
          if (intents.current.get(slot) === intent) intents.current.delete(slot); // 성공 — 의도 종료
        } catch (error) {
          // 403/409 — 최신 상태를 다시 읽어 오래된 권한 버튼이 성공으로 남지 않게 하되,
          // 원래 오류는 호출부에 그대로 전달한다.
          if (error instanceof ApiError && (error.status === 403 || error.status === 409))
            await runReload(scope).catch(() => undefined);
          // terminal 실패는 의도를 끝내 다음 호출이 새 key 를 받게 한다 — 재시도 가능한
          // 실패만 의도를 남겨 같은 key+body 재시도가 서버 멱등 경로를 탄다.
          if (!isRetryable(error) && intents.current.get(slot) === intent)
            intents.current.delete(slot);
          // 어떤 실패든 scope 가 죽은 뒤면 옛 화면에 원래 오류(403·네트워크 등)를
          // 노출하지 않는다 — STALE 로 통일. 죽은 scope 의 재조회는 상태도 발행하지 않는다.
          if (!alive(scope)) throw staleError();
          throw error;
        } finally {
          // identity 로만 정리 — 세대 교체 뒤 새 scope 가 같은 slot 에 올린
          // flight·의도·busy 를 옛 flight 의 늦은 finally 가 지우면 안 된다.
          if (flights.current.get(slot) === flight) flights.current.delete(slot);
          if (writeBusy.current === intent) writeBusy.current = null;
        }
      })();
      flights.current.set(slot, flight);
      flight.catch(() => undefined); // 호출부가 버려도 unhandled rejection 으로 울지 않게
      return flight;
    },
    [alive, runReload],
  );

  /**
   * 섬 설정 저장 — `name/intro/approvalRequired/maxMembers` 만 보낸다(공개 PATCH 계약에
   * expectedVersion 은 없다). 정원 정수 1~15·현원 미만 축소 거절은 서버 결과를 그대로 올린다.
   */
  const saveSettings = useCallback(
    async (patch: ManageIslandPatch): Promise<void> => {
      const scope = callScope();
      // 호출부 객체를 그대로 들고 다니면 재시도 사이 mutation 이 같은 의도의 body 를 바꾼다 —
      // 허용 필드만 복사·freeze 한 스냅샷이 key·body·payload 비교의 정본이다.
      const body = Object.freeze({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.intro !== undefined && { intro: patch.intro }),
        ...(patch.approvalRequired !== undefined && {
          approvalRequired: patch.approvalRequired,
        }),
        ...(patch.maxMembers !== undefined && { maxMembers: patch.maxMembers }),
      });
      return runWrite(scope, 'settings', canonicalPatch(body), (key) =>
        manageIsland(scope.islandId, body, key),
      );
    },
    [callScope, runWrite],
  );

  /** 가입 신청 승인·거절 — 성공은 재조회된 신청·주민 목록으로만 확정한다. */
  const answerRequest = useCallback(
    async (requestId: string, decision: 'approve' | 'reject'): Promise<void> => {
      const scope = callScope();
      return runWrite(scope, `answer:${requestId}`, decision, (key) =>
        answerIslandJoinRequest(scope.islandId, requestId, decision, key),
      );
    },
    [callScope, runWrite],
  );

  /** 주민 강퇴 — 성공 뒤 주민 목록은 재조회로 확정한다. */
  const kickMember = useCallback(
    async (userId: string): Promise<void> => {
      const scope = callScope();
      return runWrite(scope, `kick:${userId}`, userId, (key) =>
        kickIslandMember(scope.islandId, userId, key),
      );
    },
    [callScope, runWrite],
  );

  /** 방장 위임 — 성공 뒤 내 role 은 재조회로 확정된다(member 강등 포함). */
  const transferHost = useCallback(
    async (targetUserId: string): Promise<void> => {
      const scope = callScope();
      return runWrite(scope, `transfer:${targetUserId}`, targetUserId, (key) =>
        transferIslandHost(scope.islandId, targetUserId, key),
      );
    },
    [callScope, runWrite],
  );

  return {
    detail: snap.detail,
    role: snap.detail === null ? null : snap.detail.role,
    members: snap.members,
    requests: snap.requests,
    loading: snap.loading,
    error: snap.error,
    accessLost: snap.accessLost,
    reload,
    saveSettings,
    answerRequest,
    kickMember,
    transferHost,
  };
}
