/**
 * 회관 「목각 건물 고르기」 화면 전용 view model (GROMO-2012).
 *
 * 데이터는 전부 서버다 — 로컬 `costs`·`buildingOrder`·`i.construction`·`i.buildingQuest` 와
 * 무관하다:
 *  - 선택지·가격·권한은 `GET /islands/{islandId}/construction-options` 한 번의 스냅샷이다.
 *    `items` 는 서버가 준 순서 그대로(자유 순서 — 앱이 다시 정렬·제한하지 않는다)이고
 *    `selectable`/`buildable`/`blockedReason` 이 권한·선행·잔금 판정의 정본이다.
 *  - 목표는 `PUT …/construction-target`(`buildingId`+`expectedVersion`), 착공은
 *    `POST …/constructions`(`expectedCostPolicyVersion` 포함) — 둘 다 `Idempotency-Key` 필수.
 *    같은 의도의 재시도는 같은 키·같은 본문, 바뀐 본문은 새 키다(409 `IDEMPOTENCY_KEY_REUSED`).
 *  - BUILDING·`startedAt`/`completesAt` 은 POST 응답이 정본이다 — GET 에는 공사 시각이 없다.
 *    앱은 `completesAt` 경과를 「재조회 신호」로만 쓰고 로컬 타이머로 완공을 확정하지 않는다.
 *    재실행·앱 전면 복귀·기기 시각 변경·완공 예정 시각 도달 때마다 GET 을 다시 부른다.
 *  - `islandId` 입력은 지금 로컬 섬 id 라 fetch 에 쓰지 않는다 — 서버 섬 id 는 `/me/islands`
 *    의 current 에서 배우고(`useLedgerScreen` 과 같은 계약), `islandId` 는 scope 리셋 신호다.
 *  - 「각자 몫」의 대상 명단은 목표 선택 시점 주민 스냅샷(GROMO-1999) — 공개 읽기 계약에는
 *    cohort 필드가 없어 화면은 같은 조회 순간의 주민 목록으로 표시한다(서버 정본과의
 *    차이는 목표 선택 후 가입한 주민이 화면 분모에 섞이는 경우뿐이다).
 *
 * 경합·쓰기 규칙은 `useIslandManagement` 와 같다 — scope(로컬 섬 id + 인증 세대)·순서·mounted
 * fence, 단일 쓰기 flight, 성공은 서버 재조회로만 확정, 403/409 는 재조회 뒤 원래 오류를 올린다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  CLIENT_STALE_SESSION,
  CLIENT_TIMEOUT,
  uuid,
} from '@/services/api/client';
import {
  CLIENT_CONTRACT_ERROR,
  getConstructionOptions,
  getMembers,
  selectConstructionTarget,
  startConstruction,
  type ConstructionOptions,
  type ConstructionStarted,
  type IslandMember,
} from '@/services/api/home';
import { myIslands } from '@/services/api/islands';
import { sessionGeneration } from '@/services/api/session';
import { collectPages } from '@/screens/interiors/useIslandManagement';

/** 화면이 닫혀 있을 때 캡처된 쓰기 콜백이 나가지 않게 하는 앱 측 code. */
export const CLIENT_INACTIVE = 'CLIENT_INACTIVE';
/** 서버 옵션에서 selectable=false 인 항목 — 앱이 권한·선행을 추측해 보내지 않는다. */
export const CLIENT_NOT_SELECTABLE = 'CLIENT_NOT_SELECTABLE';
/** 진행 중인 쓰기와 다른 명령·다른 payload — 암묵 성공으로 두지 않고 거절한다. */
export const CLIENT_IN_FLIGHT = 'CLIENT_IN_FLIGHT';

/**
 * 이 값보다 크게 `now` 가 뛰면 기기 시각 변경(또는 장시간 JS 정지)으로 보고 서버를 다시 읽는다.
 * ponytail: 짧은 지연(수 초)의 타이머 밀림을 걸러내려고 30초 — 그보다 작은 시각 오차는
 * 표시 카운트다운에만 영향이라 상태 판정과 무관하다.
 */
const CLOCK_JUMP_MS = 30_000;

const staleError = () =>
  new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);
const inactiveError = () => new ApiError(CLIENT_INACTIVE, '화면이 닫혔어요.', 0);
const notSelectableError = () =>
  new ApiError(CLIENT_NOT_SELECTABLE, '지금은 선택할 수 없는 건물이에요.', 0);
const inFlightError = () => new ApiError(CLIENT_IN_FLIGHT, '다른 명령이 처리 중이에요.', 0);
const asApiError = (error: unknown): ApiError =>
  error instanceof ApiError
    ? error
    : new ApiError('CLIENT_UNEXPECTED', '처리 중 문제가 생겼어요.', 0);

/** 응답 유실·네트워크 계열 — 같은 key+body 로 다시 내도 되는 실패만 true. */
const isRetryable = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.retryable === true ||
    error.code === CLIENT_TIMEOUT ||
    error.code === CLIENT_NETWORK_ERROR);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** 한 번 살아 있는 읽기 범위 — 객체 자체가 epoch 이다(정리되면 scopeRef 에서 빠진다). */
type Scope = { gen: number; islandId: string };
type WriteIntent = { key: string; payload: string; scope: Scope };

export type ConstructionSnapshot = {
  /** 마지막으로 확정된 옵션 — 쓰기의 expectedVersion·selectable 정본. */
  options: ConstructionOptions | null;
  /** 서버 주민 전원(모든 페이지) — 「각자 몫」 분모와 대상 명단 표시의 정본. */
  members: IslandMember[] | null;
  loading: boolean;
  error: ApiError | null;
};

const EMPTY: ConstructionSnapshot = { options: null, members: null, loading: false, error: null };

export function useConstruction({
  active,
  islandId,
  now,
}: {
  /** 이 화면이 보이고 주민일 때만 true — 방문자·모크 모드·다른 route 에서는 호출이 0회다. */
  active: boolean;
  /** scope 리셋 신호로만 쓰는 화면의 섬 식별자(현재는 로컬 id). */
  islandId: string | null;
  /** 렌더 타이머(App 의 1초 tick) — 기기 시각 변경·완공 예정 도달 감지에만 쓰고 완공 판정엔 안 쓴다. */
  now: number;
}) {
  const [snap, setSnap] = useState<ConstructionSnapshot>(EMPTY);
  /** 이 세션에서 POST 로 접수된 공사 — GET 에는 공사 시각이 없어 응답을 그대로 들고 있는다. */
  const [started, setStarted] = useState<ConstructionStarted | null>(null);
  const mounted = useRef(false);
  const scopeRef = useRef<Scope | null>(null);
  const loadSeq = useRef(0);
  /** `/me/islands` 의 current 에서 배운 서버 섬 id — 모든 섬 경로 요청은 이 값으로 보낸다. */
  const serverIsland = useRef<string | null>(null);
  /** 마지막으로 확정된 옵션 — 쓰기의 expectedVersion·selectable 정본. 재조회 중에도 유지된다. */
  const optionsRef = useRef<ConstructionOptions | null>(null);
  /** 마지막으로 성공 확정된 재조회의 seq — 쓰기 성공은 이 값이 최신 loadSeq 일 때만. */
  const confirmSeq = useRef(0);
  /** 의도 슬롯 — 같은 payload 재시도는 같은 key 를 쓰게 보관한다. */
  const intents = useRef(new Map<string, WriteIntent>());
  const flights = useRef(new Map<string, Promise<void>>());
  /** 단일 쓰기 flight — 명령 병렬 실행으로 상태를 덮지 않는다. 의도 객체가 소유권 토큰. */
  const writeBusy = useRef<WriteIntent | null>(null);
  /** 마지막으로 본 now — 시각 변경 감지용. */
  const lastNow = useRef(now);
  /** 완공 예정 도달 재조회는 예정 시각당 한 번 — 매 렌더 재조회하지 않는다. */
  const dueHandled = useRef<string | null>(null);
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

  /** 한 범위의 원자적 읽기: current 섬 확인 → options + 주민 전체 페이지(병렬). */
  const runReload = useCallback(
    async (scope: Scope): Promise<void> => {
      const seq = ++loadSeq.current;
      const current = () => alive(scope) && seq === loadSeq.current;
      const guard = () => {
        if (!current()) throw staleError();
      };
      const publish = (next: ConstructionSnapshot) => {
        if (current()) setSnap(next);
      };
      guard(); // 이미 죽은 scope 에서는 첫 요청도 내지 않는다
      publish({ ...EMPTY, loading: true });
      try {
        const mine = await myIslands();
        guard();
        if (
          !isRecord(mine) ||
          !Array.isArray(mine.items) ||
          typeof mine.currentIslandId !== 'string' ||
          !mine.items.some((item) => isRecord(item) && item.id === mine.currentIslandId)
        ) {
          throw new ApiError(CLIENT_CONTRACT_ERROR, '계약과 다른 응답입니다 (myIslands).', 0, {
            field: 'myIslands',
          });
        }
        const serverId = mine.currentIslandId;
        const membersP = collectPages(guard, (cursor) => getMembers(serverId, cursor), true);
        const options = await getConstructionOptions(serverId);
        const members = await membersP;
        guard(); // 죽은 scope 의 완료는 성공으로 끝내지 않는다
        serverIsland.current = serverId;
        optionsRef.current = options;
        publish({ options, members, loading: false, error: null });
        confirmSeq.current = seq; // canonical 확정 — 쓰기 성공의 근거는 이 값이다
        // POST 로 접수한 건물이 items 에서 빠졌다 = 서버가 완공으로 옮겼다. 앱이 시각으로
        // 판정한 것이 아니라 서버 목록이 말한 것이다.
        setStarted((prev) =>
          prev !== null && !options.items.some((item) => item.id === prev.buildingId) ? null : prev,
        );
      } catch (error) {
        publish({ ...EMPTY, loading: false, error: asApiError(error) });
        // 옛 scope(세대 교체·섬 이동·supersede)의 결과는 성공이든 실패든 STALE 로 통일한다.
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
      serverIsland.current = null;
      optionsRef.current = null;
      loadSeq.current += 1;
      setStarted(null);
      setSnap(EMPTY);
      return;
    }
    const scope: Scope = { gen: generation, islandId };
    // 화면을 잠깐 닫았다가 같은 섬·같은 계정으로 돌아오면, 아직 서버에 도착 중인 쓰기를
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
      serverIsland.current = null;
      optionsRef.current = null;
      loadSeq.current += 1;
      setStarted(null);
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

  // 앱이 다시 전면에 오면 서버 공사 상태를 다시 읽는다 — 로컬 경과 시간으로 완공을 추정하지 않는다.
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') reload().catch(() => undefined);
    });
    return () => sub.remove();
  }, [active, reload]);

  // 기기 시각 변경·completesAt 도달은 「재조회 신호」다 — 완공 확정은 서버 목록이 내린다.
  useEffect(() => {
    const prev = lastNow.current;
    lastNow.current = now;
    if (!active || scopeRef.current === null) return;
    const jumped = Math.abs(now - prev) > CLOCK_JUMP_MS;
    const dueKey = started !== null ? `${started.buildingId}:${started.completesAt}` : null;
    const due =
      dueKey !== null && now >= Date.parse(started!.completesAt) && dueHandled.current !== dueKey;
    if (due) dueHandled.current = dueKey;
    if (jumped || due) reload().catch(() => undefined);
  }, [now, active, started, reload]);

  /**
   * 모든 쓰기 명령의 단일 통로 — fence·의도 슬롯·단일 flight·성공 후 재조회·오류 분류를
   * 여기서만 처리한다. `slot` 은 명령+대상을, `payload` 는 같은 의도인지의 정본 문자열이다
   * (본문 그대로 — 버전이 바뀌면 payload 도 바뀌어 새 키를 받는다).
   */
  const runWrite = useCallback(
    async (
      scope: Scope,
      slot: string,
      payload: string,
      exec: (key: string) => Promise<unknown>,
      apply?: (result: unknown) => void,
    ): Promise<void> => {
      // dedupe·단일 flight 먼저 — 재조회 구간에도 같은 의도는 합류하고 다른 의도는 거절한다.
      const inFlight = flights.current.get(slot);
      if (inFlight !== undefined) {
        const intent = intents.current.get(slot);
        if (intent !== undefined && intent.payload === payload && intent.scope === scope)
          return inFlight; // 같은 의도의 중복 호출 — 진행 중인 것 하나로 합류
        throw inFlightError(); // 진행 중 다른 payload — 암묵 성공으로 두지 않는다
      }
      if (writeBusy.current !== null) throw inFlightError(); // 다른 명령 진행 중

      // 재시도 가능한 실패로 남은 같은 의도는 같은 key+body 로 다시 보낸다(서버 멱등 경로).
      const previousIntent = intents.current.get(slot);
      const retryingConfirmedIntent =
        previousIntent !== undefined &&
        previousIntent.payload === payload &&
        previousIntent.scope === scope;
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
          const wrote = await exec(key);
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
          apply?.(wrote);
          if (intents.current.get(slot) === intent) intents.current.delete(slot); // 성공 — 의도 종료
        } catch (error) {
          // 403/409 — 최신 상태를 다시 읽어 오래된 화면이 성공으로 남지 않게 하되,
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
   * 쓰기 전 게이트 — 마지막으로 확정된 옵션에서 항목을 찾고 명령에 맞는 플래그만 본다
   * (목표는 `selectable`, 착공은 `buildable` — 이미 목표인 건물은 selectable=false 일 수 있다).
   * 권한(FORBIDDEN)·선행·잔금은 서버 evaluator 가 플래그에 반영했다 — 앱이 방장 여부·
   * 잔액을 다시 추측하지 않는다. 플래그를 통과해도 서버가 403/409 로 재판정할 수 있다.
   */
  const confirmedItem = useCallback(
    (scope: Scope, buildingId: string, flag: 'selectable' | 'buildable'): ConstructionOptions => {
      const options = optionsRef.current;
      const item = options?.items.find((it) => it.id === buildingId);
      if (
        options === null ||
        item === undefined ||
        !item[flag] ||
        serverIsland.current === null ||
        // optionsRef 는 마지막 성공 읽기다 — 확인되지 않은 옵션으로는 보내지 않는다
        !alive(scope)
      )
        throw notSelectableError();
      return options;
    },
    [alive],
  );

  /** 목표 선택 — body 는 {buildingId, expectedVersion} 뿐이다(서버가 필드 수를 검사한다). */
  const select = useCallback(
    async (buildingId: string): Promise<void> => {
      const scope = callScope();
      const options = confirmedItem(scope, buildingId, 'selectable');
      const body = { buildingId, expectedVersion: options.islandVersion };
      return runWrite(scope, `target:${buildingId}`, JSON.stringify(body), (key) =>
        selectConstructionTarget(serverIsland.current!, buildingId, body.expectedVersion, key),
      );
    },
    [callScope, confirmedItem, runWrite],
  );

  /** 착공 — 가격 버전까지 서명한다. 성공 확정 뒤 BUILDING·시각을 서버 응답 그대로 싣는다. */
  const build = useCallback(
    async (buildingId: string): Promise<void> => {
      const scope = callScope();
      const options = confirmedItem(scope, buildingId, 'buildable');
      const body = {
        buildingId,
        expectedVersion: options.islandVersion,
        expectedCostPolicyVersion: options.costPolicyVersion,
      };
      return runWrite(
        scope,
        `build:${buildingId}`,
        JSON.stringify(body),
        (key) =>
          startConstruction(
            serverIsland.current!,
            buildingId,
            body.expectedVersion,
            body.expectedCostPolicyVersion,
            key,
          ),
        (result) => setStarted(result as ConstructionStarted),
      );
    },
    [callScope, confirmedItem, runWrite],
  );

  return {
    status:
      snap.error !== null ? 'error' : snap.loading || snap.options === null ? 'loading' : 'ready',
    options: snap.options,
    members: snap.members,
    started,
    error: snap.error,
    reload,
    retry: reload,
    select,
    build,
  };
}
