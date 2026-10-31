// GROMO-2009 집중 세션 서버 명령 오케스트레이션 — App 에서 분리해 실제 구현을 직접 테스트한다.
// islandCommands 와 같은 규칙: 쓰기는 의도당 멱등 키 하나(재시도는 같은 키·같은 body),
// 후속 API·dispatch·반환 전에 세대 fence, 409·404 계열은 current 재조회로 정본을 맞춘 뒤
// 원 오류를 다시 던진다. 멱등 키는 세대 격리 ref에만 두고 State/AsyncStorage에 저장하지 않는다.
import { ApiError, CLIENT_STALE_SESSION, uuid } from '@/services/api/client';
import { getSession, sessionGeneration } from '@/services/api/session';
import {
  acknowledgeFocusResult as apiAcknowledge,
  claimTutorialReward as apiTutorialReward,
  claimTutorialExperienceReward as apiTutorialExperienceReward,
  currentFocusSession as apiCurrent,
  finishFocusSession as apiFinish,
  FocusFinishView,
  FocusSeat,
  focusSeat,
  FocusSessionStartInput,
  FocusSessionView,
  pauseFocusSession as apiPause,
  pendingFocusResult as apiPendingResult,
  resumeFocusSession as apiResume,
  startFocusSession as apiStart,
  startSeaFocusSession as apiStartSea,
} from '@/services/api/focusSessions';
import { getTelescope as apiTelescope } from '@/services/api/telescope';
import { intentKeyPool, RecordItem, Route, Session, sessionRoute, State } from '@/services/model';
import { captureProductEvent } from '@/services/posthog';
import { markActivationStage } from '@/services/activationJourney';
import { measureDatadogOperation } from '@/services/datadog';

/**
 * 집중 완료 기록의 섬/바다 집중시간 요약(GROMO-2540). PostHog 대시보드의 「섬과 바다 중 어디서 집중」·
 * 「장소별 하루 집중시간」을 채운다. 한 세션은 섬 또는 바다 하나이므로 activeSeconds 를 그 장소에 싣고,
 * kind 가 없으면(구버전 서버) 경과시간으로 장소를 추측하지 않고 미상으로 둔다.
 */
function captureFocusLocationSummary(view: FocusFinishView): void {
  const seconds = view.activeSeconds;
  // 자동 종료 세션을 다음 날 복구해 발행해도, 대시보드가 수집 시각이 아닌 서버 완료 시각(completedAt)으로
  // 집계·완료일 귀속을 하도록 이벤트 시각을 완료 시각으로 덮어쓴다. 파싱 실패 시에만 수집 시각으로 둔다.
  const completedAt = new Date(view.completedAt);
  captureProductEvent(
    'focus_location_summary',
    {
      record_id: view.recordId,
      duration_seconds: seconds,
      island_seconds: view.kind === 'island' ? seconds : 0,
      sea_seconds: view.kind === 'sea' ? seconds : 0,
      unknown_seconds: view.kind === undefined ? seconds : 0,
      metrics_schema_version: 1,
      analytics_excluded: 0,
    },
    Number.isNaN(completedAt.getTime()) ? undefined : { timestamp: completedAt },
  );
}

export type FocusApi = {
  current: typeof apiCurrent;
  pendingResult: typeof apiPendingResult;
  start: typeof apiStart;
  pause: typeof apiPause;
  resume: typeof apiResume;
  finish: typeof apiFinish;
  acknowledge: typeof apiAcknowledge;
  tutorialReward: typeof apiTutorialReward;
  tutorialExperienceReward: typeof apiTutorialExperienceReward;
  startSea: typeof apiStartSea;
  /** startSea 409 SEA_DESTINATION_UNAVAILABLE 뒤 목적지가 아직 목록에 있는지 본다. */
  telescope: typeof apiTelescope;
};

export type SessionCommandDeps = {
  dispatch: (a: { type: string; [key: string]: unknown }) => void;
  /** 진행 중 로컬 세션 — 서버 전이의 expectedVersion·sessionId 출처. */
  getSession: () => Session | null;
  /** 서버 섬 스냅샷 — start 의 islandId 는 memberships 의 current 다. */
  getSnap: () => State['serverIslands'];
  /** 세션 세대 — 기본은 실제 sessionGeneration. 계정·세션이 바뀌면 값이 바뀐다. */
  generation?: () => number;
  /** 멱등 키 생성기 — 기본 uuid. */
  newKey?: () => string;
  api?: Partial<FocusApi>;
};

const defaultApi: FocusApi = {
  current: apiCurrent,
  pendingResult: apiPendingResult,
  start: apiStart,
  pause: apiPause,
  resume: apiResume,
  finish: apiFinish,
  acknowledge: apiAcknowledge,
  tutorialReward: apiTutorialReward,
  tutorialExperienceReward: apiTutorialExperienceReward,
  startSea: apiStartSea,
  telescope: apiTelescope,
};

const staleError = () =>
  new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);

// 서버 ACTIVE 구간 → 로컬 {start,end}(ms) 매핑(GROMO-2131). 필드가 아예 없으면(구버전 서버)
// undefined 를 유지한다 — []로 두면 당일 집중이 있어도 구간 0건이 되어 퀘스트 진행이 사라진다.
// 파싱 못 한 시각이 하나라도 있으면 역시 undefined 로 폴백한다 — NaN 구간은 Math.min/max 합산을
// 오염시켜 그 섬·그 날 전체 합계가 NaN 이 되고, 구간 하나만 버리면 집중 초가 빠진다.
const mapIntervals = (spans?: { startedAt: string; endedAt: string }[]) => {
  const mapped = spans?.map((span) => ({
    start: Date.parse(span.startedAt),
    end: Date.parse(span.endedAt),
  }));
  return mapped?.some((i) => Number.isNaN(i.start) || Number.isNaN(i.end)) ? undefined : mapped;
};

/**
 * 서버 뷰 → 로컬 Session. 시각은 서버가 정본이다 — `startedAt` 을 serverNow 로 두고
 * `seconds` 에 activeSeconds 를 넣으면 화면은 serverNow 이후의 경과를 이어서 센다.
 * paused 면 초가 고정되고 restStartedAt 만 의미를 가진다.
 * intervals 는 activeIntervals(있으면) 를 그대로 옮긴다 — 서버가 마지막 구간을 serverNow 로
 * 닫아 보내므로, 이어서 리듀서가 붙이는 실시간 꼬리 [startedAt(=serverNow), now] 와 겹치지 않는다.
 */
export const sessionFromServer = (v: FocusSessionView): Session => ({
  id: v.id,
  islandId: v.islandId,
  subject: v.subject,
  startedAt: Date.parse(v.serverNow),
  restStartedAt: v.restStartedAt ? Date.parse(v.restStartedAt) : undefined,
  seconds: v.activeSeconds,
  status: v.status === 'paused' ? 'paused' : 'active',
  version: v.version,
  intervals: mapIntervals(v.activeIntervals),
  syncedAt: Date.now(),
  // 바다 세션(GROMO-2310)은 종류·항해 분·목적지 이름을 지닌다 — 없는 필드는 키째 뺀다(구버전 서버·섬 집중 모양 유지)
  ...(v.kind ? { kind: v.kind } : {}),
  ...(v.kind === 'sea' && v.targetMinutes != null ? { targetMinutes: v.targetMinutes } : {}),
  ...(v.destinationIslandName ? { destinationIslandName: v.destinationIslandName } : {}),
});

/**
 * 정산 뷰 → 기록. `recordId`(= sessionId)로 중복 반영을 막는다 — 같은 세션의 finish 재생이
 * 두 번 오거나 pending-result 가 다시 와도 한 줄이다. pending-result 에만 `ackId` 를 달아
 * 결과창을 닫을 때 acknowledge 로 보낸다.
 */
export const recordFromFinish = (f: FocusFinishView, ackId?: string): RecordItem => ({
  id: f.recordId,
  islandId: f.islandId,
  subject: f.subject,
  seconds: f.activeSeconds,
  at: Date.parse(f.completedAt),
  fish: f.earnedFish,
  contributed: true,
  intervals: mapIntervals(f.activeIntervals),
  ...(ackId ? { ackId } : {}),
  ...(f.kind ? { kind: f.kind } : {}),
  ...(f.seaReward?.grantedProductIds?.length ? { rewards: f.seaReward.grantedProductIds } : {}),
  ...newRewardsOf(f),
});

/** 받은 것 중 처음 받은 것 — 서버가 newProductIds 를 안 주면(구버전) 없다. */
function newRewardsOf(f: FocusFinishView) {
  const granted = f.seaReward?.grantedProductIds ?? [];
  const fresh = (f.seaReward?.newProductIds ?? []).filter((id) => granted.includes(id));
  return fresh.length ? { newRewards: fresh } : {};
}

export const createSessionCommands = (deps: SessionCommandDeps) => {
  const api = { ...defaultApi, ...deps.api },
    generation = deps.generation ?? sessionGeneration,
    newKey = deps.newKey ?? uuid;
  // 세대 격리 저장소 — 계정·세션이 바뀌면 진행 중 멱등 키를 함께 버린다.
  let box: { gen: number; keys: ReturnType<typeof intentKeyPool> } | null = null;
  let transitionRevision = 0;
  let transitioning = 0;
  const scoped = () => {
    const g = generation();
    if (box?.gen !== g) box = { gen: g, keys: intentKeyPool(newKey) };
    return box;
  };
  // 후속 API·dispatch·반환 전의 세대 fence — 바뀌었으면 늦은 응답이라 버린다
  const alive = (g: number) => {
    if (generation() !== g) throw staleError();
  };
  // current 정본 재조회 — 세션이 없어졌거나 version 이 밀렸을 때 state 를 맞춘다
  const syncCurrent = async (g: number) => {
    const view = await api.current();
    alive(g);
    deps.dispatch({ type: 'SESSION_SYNC', session: view ? sessionFromServer(view) : null });
    return view;
  };
  // 409·404 계열은 서버 상태가 바뀌었다는 뜻 — current 재조회로 화면 데이터를 맞춘 뒤 원 오류를 다시 던진다.
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    const g = generation();
    try {
      return await fn();
    } catch (thrown) {
      if (generation() !== g) throw staleError();
      if (
        thrown instanceof ApiError &&
        ['STATE_CONFLICT', 'VERSION_CONFLICT', 'NOT_FOUND', 'GROUP_NOT_FOUND'].includes(thrown.code)
      )
        try {
          await syncCurrent(g);
        } catch {}
      if (generation() !== g) throw staleError();
      throw thrown;
    }
  };
  // pause/resume/finish 공용 전이 — expectedVersion 은 현재 세션의 version, 멱등 키는
  // (전이, 세션, version) 당 하나라 응답 유실 재시도는 같은 키·같은 body 로 간다.
  const transition = async <T>(
    kind: 'pause' | 'resume' | 'finish',
    fn: (id: string, expectedVersion: number, key: string) => Promise<T>,
    // 결과 불명 재시도의 대상 — 그사이 복구가 로컬 세션을 지웠어도 같은 (세션, version) 키로 한 번 더 묻는다
    target?: { id: string; version?: number },
  ): Promise<T> => {
    const g = generation();
    // 대상과 다른 세션이 로컬에 있으면 그 세션을 대신 끝내지 않는다 — 확정 실패로 돌려 호출부가 정본을 다시 읽게 한다
    if (target && deps.getSession() && deps.getSession()?.id !== target.id)
      throw new ApiError('STATE_CONFLICT', '다른 집중이 진행 중이에요.', 409);
    const session = deps.getSession() ?? target ?? null;
    if (!session || session.version == null) {
      // 서버 세션이 아니면 전이할 수 없다 — 정본을 맞춘 뒤 실패로 돌린다.
      await syncCurrent(g).catch(() => {});
      throw new ApiError('STATE_CONFLICT', '진행 중인 집중이 없어요.', 409);
    }
    const body = String(session.version),
      key = scoped().keys.key(`${kind}:${session.id}`, body);
    transitioning += 1;
    transitionRevision += 1;
    try {
      const result = await fn(session.id, session.version, key);
      alive(g);
      scoped().keys.release(`${kind}:${session.id}`, body);
      return result;
    } finally {
      transitioning -= 1;
      transitionRevision += 1;
    }
  };
  // 바다 출항 본체 — startSea 가 전이 카운터 안에서 부른다
  const startSeaOnce = async (destinationIslandId: string) => {
    const g = generation(),
      slot = 'startSea';
    // 같은 키가 이미 있으면 직전 출항의 응답이 유실된 재시도다 — 서버는 최초 응답을 재생할 수 있다
    const retried = scoped().keys.has(slot, destinationIslandId);
    const once = () =>
      api.startSea(destinationIslandId, scoped().keys.key(slot, destinationIslandId));
    let view: FocusSessionView;
    try {
      try {
        view = await once();
      } catch (thrown) {
        if (!(thrown instanceof ApiError) || thrown.code !== 'SEA_DESTINATION_UNAVAILABLE')
          throw thrown;
        scoped().keys.release(slot, destinationIslandId);
        const list = await api.telescope();
        alive(g);
        if (!list.items.some((item) => item.islandId === destinationIslandId)) throw thrown;
        view = await once();
      }
    } catch (thrown) {
      // 확정 4xx(STATE_CONFLICT·403 등)는 서버가 영수증을 남기지 않는다(성공만 저장 — PublicCommandService.run) —
      // 키를 풀어 다음 시도가 새 의도로 간다. 결과 불명(네트워크·5xx)과 처리 중(REQUEST_IN_PROGRESS)만 같은 키를 지킨다.
      if (
        thrown instanceof ApiError &&
        thrown.status >= 400 &&
        thrown.status < 500 &&
        thrown.code !== 'REQUEST_IN_PROGRESS'
      )
        scoped().keys.release(slot, destinationIslandId);
      throw thrown;
    }
    alive(g);
    // 재시도면 응답이 «최초 응답»(activeSeconds 0·옛 serverNow) 재생일 수 있고, 그사이 다른 기기가 그 항해를 끝내고
    // 다른 세션을 시작했을 수도 있다 — 응답과 무관하게 current 를 읽어 정본으로 쓴다. 첫 시도 성공은 조회를 더하지 않는다.
    let latest: FocusSessionView | null = view;
    if (retried) {
      latest = await api.current();
      alive(g);
    }
    deps.dispatch({ type: 'SESSION_SYNC', session: latest ? sessionFromServer(latest) : null });
    scoped().keys.release(slot, destinationIslandId);
    captureProductEvent('focus_started');
    void markActivationStage(getSession()?.userId, 'first_focus_started', {
      prerequisite: 'island_arrived',
    });
    // 확정된 최신 세션 — 호출부가 이것의 종류로 화면을 고른다(null = 그사이 끝나 진행 세션이 없다)
    return latest;
  };
  /**
   * recover 를 두 단계로 나눈 것 — 조회(current·pending-result)는 지금 시작하고, 반영(SESSION_SYNC·결과)과
   * 화면 결정은 돌려준 함수가 한다. 부팅이 섬 동기화와 겹쳐 읽되 반영은 그 뒤 원래 순서로 하게 한다
   * (GROMO-2377). 세대·전이 fence 는 조회를 시작한 시점 기준이다.
   */
  const beginRecover = (): (() => Promise<Route | null>) => {
    const g = generation();
    const deferred = () => new ApiError('CLIENT_RECOVERY_DEFERRED', '집중 상태 전환 중이에요.', 0);
    // 폴링 응답이 동시에 진행한 재개·종료 명령의 최신 상태를 되돌리지 않게 한다.
    const revision = transitionRevision;
    const read = transitioning ? null : Promise.all([api.current(), api.pendingResult()]);
    // 반영 전에 실패해도 처리되지 않은 거부로 남기지 않는다 — 실패는 반영 함수가 던진다
    read?.catch(() => {});
    return async () => {
      if (!read) throw deferred();
      const [view, pending] = await read;
      alive(g);
      if (transitioning || transitionRevision !== revision) throw deferred();
      deps.dispatch({ type: 'SESSION_SYNC', session: view ? sessionFromServer(view) : null });
      // 바다 세션은 휴식이 없다 — 항해 화면으로 돌아간다(GROMO-2310)
      if (view) return sessionRoute(view);
      if (pending) {
        deps.dispatch({
          type: 'SESSION_RESULT',
          record: recordFromFinish(pending, pending.recordId),
          fromRest: true,
        });
        // 자동 종료된 미확인 결과도 장소 요약을 남긴다(finish 경로만으로는 돌아오지 않는 세션이 빠진다).
        captureFocusLocationSummary(pending);
        return 'focusResult';
      }
      return null;
    };
  };
  const commands = {
    // 체험 보상에는 current 재조회나 SESSION_SYNC도 필요 없다.
    tutorialExperienceReward: async (islandId: string) => {
      const g = generation();
      if (deps.getSnap()?.currentIslandId !== islandId) throw staleError();
      const result = await api.tutorialExperienceReward(islandId);
      alive(g);
      if (deps.getSnap()?.currentIslandId !== islandId) throw staleError();
      if (
        !result ||
        result.islandId !== islandId ||
        !['granted', 'unavailable'].includes(result.status)
      )
        throw new ApiError('INVALID_RESPONSE', '보상 정보를 확인하지 못했어요.', 0);
      return result;
    },
    tutorialReward: (sessionId: string) =>
      call(async () => {
        const g = generation();
        const result = await api.tutorialReward(sessionId);
        alive(g);
        if (
          !result ||
          result.sessionId !== sessionId ||
          !['pending', 'granted', 'unavailable'].includes(result.status)
        )
          throw new ApiError('INVALID_RESPONSE', '보상 정보를 확인하지 못했어요.', 0);
        if (result.status === 'granted')
          deps.dispatch({ type: 'TUTORIAL_FISH_CONFIRMED', sessionId });
        return result;
      }),
    // 시작 — islandId 는 memberships 의 current 에서만 온다(화면이 고르지 않는다).
    // seat(GROMO-2478) 는 고른 집중섬 자리 — 0~100 밖(옛 저장 좌표)·없음이면 키를 생략한다.
    // 멱등 키는 본문 JSON 기준이라 같은 의도의 재시도는 같은 seat 로 간다.
    start: (input: { subject: string; targetMinutes?: number; seat?: FocusSeat }) =>
      measureDatadogOperation('focus_start', () =>
        call(async () => {
          const g = generation(),
            islandId = deps.getSnap()?.currentIslandId;
          if (!islandId) throw new ApiError('ISLAND_NOT_CURRENT', '현재 소속된 섬이 없어요.', 403);
          const body: FocusSessionStartInput = { islandId, subject: input.subject },
            seat = focusSeat(input.seat);
          if (input.targetMinutes !== undefined) body.targetMinutes = input.targetMinutes;
          if (seat) body.seat = seat;
          const raw = JSON.stringify(body),
            view = await api.start(body, scoped().keys.key('start', raw));
          alive(g);
          deps.dispatch({ type: 'SESSION_SYNC', session: sessionFromServer(view) });
          scoped().keys.release('start', raw);
          captureProductEvent('focus_started');
          void markActivationStage(getSession()?.userId, 'first_focus_started', {
            prerequisite: 'island_arrived',
          });
          return view;
        }),
      ),
    /**
     * 바다 항해 집중 시작(GROMO-2310). 키는 목적지당 의도 하나. 409 `SEA_DESTINATION_UNAVAILABLE` 은 망원경
     * 시간대가 바뀌어 목적지가 목록에서 빠졌을 수 있다는 뜻 — 목록을 한 번 다시 읽어 그 섬이 아직 있으면
     * 새 키로 한 번만 다시 시도하고(확정 4xx 라 서버가 만든 것이 없다), 없으면 원 오류를 던진다.
     */
    startSea: (destinationIslandId: string) =>
      measureDatadogOperation('focus_sea_start', () =>
        call(async () => {
          // 전이처럼 센다 — 표류 화면의 recover() 가 출항 전에 읽은 current(null) 를 늦게 적용해 새 세션을 지우지 않게
          // recover 의 「전환 중이면 미루고, 그사이 전환이 있었으면 옛 응답을 버린다」 보호를 탄다.
          transitioning += 1;
          transitionRevision += 1;
          try {
            return await startSeaOnce(destinationIslandId);
          } finally {
            transitioning -= 1;
            transitionRevision += 1;
          }
        }),
      ),
    pause: () =>
      call(async () => {
        const view = await transition('pause', api.pause);
        deps.dispatch({ type: 'SESSION_SYNC', session: sessionFromServer(view) });
        return view;
      }),
    resume: () =>
      call(async () => {
        const view = await transition('resume', api.resume);
        deps.dispatch({ type: 'SESSION_SYNC', session: sessionFromServer(view) });
        return view;
      }),
    // 종료 — 응답은 정산 뷰다. 기록·결과창 반영은 SESSION_RESULT 가 한다(물고기는 서버가 이미 적립).
    finish: (target?: { id: string; version?: number }) =>
      measureDatadogOperation('focus_finish', () =>
        call(async () => {
          const fromRest = deps.getSession()?.status === 'paused',
            result = await transition('finish', api.finish, target);
          deps.dispatch({ type: 'SESSION_RESULT', record: recordFromFinish(result), fromRest });
          captureProductEvent('focus_completed', {
            duration_seconds: result.activeSeconds,
            earned_fish: result.earnedFish,
          });
          captureFocusLocationSummary(result);
          void markActivationStage(getSession()?.userId, 'first_focus_completed', {
            prerequisite: 'first_focus_started',
            extra: { duration_seconds: result.activeSeconds },
          });
          return result;
        }),
      ),
    // 결과 1회 표시의 확인 — 서버가 조건부 UPDATE 라 재시도·중복 호출이 무해하다.
    acknowledge: (sessionId: string) =>
      call(async () => {
        const g = generation();
        await api.acknowledge(sessionId);
        alive(g);
        deps.dispatch({ type: 'RESULT_ACK', id: sessionId });
      }),
    /**
     * 부팅 복구 — current·pending-result 를 함께 읽어 정본을 state 에 반영하고,
     * 복구할 화면을 돌려준다. 진행 세션이 있으면 미확인 결과는 다음 실행으로 미룬다
     * (ack 전까지 서버가 계속 돌려주므로 잃지 않는다).
     */
    recover: async (): Promise<Route | null> => beginRecover()(),
    beginRecover,
  };
  return { commands };
};
