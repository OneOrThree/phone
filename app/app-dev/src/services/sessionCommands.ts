// GROMO-2009 집중 세션 서버 명령 오케스트레이션 — App 에서 분리해 실제 구현을 직접 테스트한다.
// islandCommands 와 같은 규칙: 쓰기는 의도당 멱등 키 하나(재시도는 같은 키·같은 body),
// 후속 API·dispatch·반환 전에 세대 fence, 409·404 계열은 current 재조회로 정본을 맞춘 뒤
// 원 오류를 다시 던진다. 멱등 키는 세대 격리 ref에만 두고 State/AsyncStorage에 저장하지 않는다.
import { ApiError, CLIENT_STALE_SESSION, uuid } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import {
  acknowledgeFocusResult as apiAcknowledge,
  currentFocusSession as apiCurrent,
  finishFocusSession as apiFinish,
  FocusFinishView,
  FocusSessionStartInput,
  FocusSessionView,
  pauseFocusSession as apiPause,
  pendingFocusResult as apiPendingResult,
  resumeFocusSession as apiResume,
  startFocusSession as apiStart,
} from '@/services/api/focusSessions';
import { intentKeyPool, RecordItem, Route, Session, State } from '@/services/model';
import { captureProductEvent } from '@/services/posthog';

export type FocusApi = {
  current: typeof apiCurrent;
  pendingResult: typeof apiPendingResult;
  start: typeof apiStart;
  pause: typeof apiPause;
  resume: typeof apiResume;
  finish: typeof apiFinish;
  acknowledge: typeof apiAcknowledge;
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
});

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
  ): Promise<T> => {
    const g = generation();
    const session = deps.getSession();
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
  const commands = {
    // 시작 — islandId 는 memberships 의 current 에서만 온다(화면이 고르지 않는다)
    start: (input: { subject: string; targetMinutes?: number }) =>
      call(async () => {
        const g = generation(),
          islandId = deps.getSnap()?.currentIslandId;
        if (!islandId) throw new ApiError('ISLAND_NOT_CURRENT', '현재 소속된 섬이 없어요.', 403);
        const body: FocusSessionStartInput = { islandId, subject: input.subject };
        if (input.targetMinutes !== undefined) body.targetMinutes = input.targetMinutes;
        const raw = JSON.stringify(body),
          view = await api.start(body, scoped().keys.key('start', raw));
        alive(g);
        deps.dispatch({ type: 'SESSION_SYNC', session: sessionFromServer(view) });
        scoped().keys.release('start', raw);
        captureProductEvent('focus_started');
        return view;
      }),
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
    finish: () =>
      call(async () => {
        const fromRest = deps.getSession()?.status === 'paused',
          result = await transition('finish', api.finish);
        deps.dispatch({ type: 'SESSION_RESULT', record: recordFromFinish(result), fromRest });
        captureProductEvent('focus_completed', {
          duration_seconds: result.activeSeconds,
          earned_fish: result.earnedFish,
        });
        return result;
      }),
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
    recover: async (): Promise<Route | null> => {
      const g = generation();
      // 폴링 응답이 동시에 진행한 재개·종료 명령의 최신 상태를 되돌리지 않게 한다.
      if (transitioning)
        throw new ApiError('CLIENT_RECOVERY_DEFERRED', '집중 상태 전환 중이에요.', 0);
      const revision = transitionRevision;
      const [view, pending] = await Promise.all([api.current(), api.pendingResult()]);
      alive(g);
      if (transitioning || transitionRevision !== revision)
        throw new ApiError('CLIENT_RECOVERY_DEFERRED', '집중 상태 전환 중이에요.', 0);
      deps.dispatch({ type: 'SESSION_SYNC', session: view ? sessionFromServer(view) : null });
      if (view) return view.status === 'paused' ? 'rest' : 'focus';
      if (pending) {
        deps.dispatch({
          type: 'SESSION_RESULT',
          record: recordFromFinish(pending, pending.recordId),
          fromRest: true,
        });
        return 'focusResult';
      }
      return null;
    },
  };
  return { commands };
};
