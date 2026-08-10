import { getMyRanking } from '@/services/leagueApi';
import type { LeagueMemberResponse } from '@/types/api';
import { todayStrKst } from '@/utils/localDate';

export type GroupFocusStatusState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: LeagueMemberResponse[] }
  | { status: 'error'; error: unknown }
  | { status: 'coverage-unknown' }
  | { status: 'stale'; data: LeagueMemberResponse[]; error: unknown };

export type GroupFocusCount =
  | { status: 'ready'; count: number }
  | { status: 'stale'; count: number }
  | { status: 'unavailable' };

interface CacheEntry {
  state: GroupFocusStatusState;
  lastComplete: LeagueMemberResponse[] | null;
  inFlight: Promise<GroupFocusStatusState> | null;
}

type Listener = () => void;
type RankingLoader = (date: string) => Promise<LeagueMemberResponse[]>;

const cacheKey = (userId: string, date: string) => `${userId}\u0000${date}`;

/** 화면의 모든 카드가 공유하는 category 없는 ranking 원본 cache. */
export class GroupFocusStatusStore {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly load: RankingLoader) {}

  getState(userId: string, date: string): GroupFocusStatusState {
    return this.entries.get(cacheKey(userId, date))?.state ?? { status: 'idle' };
  }

  subscribe(userId: string, date: string, listener: Listener): () => void {
    const key = cacheKey(userId, date);
    const listeners = this.listeners.get(key) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  ensure(userId: string, date: string): Promise<GroupFocusStatusState> {
    const entry = this.entries.get(cacheKey(userId, date));
    if (!entry) return this.start(userId, date);
    if (entry.inFlight) return entry.inFlight;
    return Promise.resolve(entry.state);
  }

  /** 60초 tick·복귀·명시 retry가 새 refresh cycle을 여는 경로다. */
  retry(userId: string, date: string): Promise<GroupFocusStatusState> {
    const entry = this.entries.get(cacheKey(userId, date));
    if (entry?.inFlight) return entry.inFlight;
    return this.start(userId, date, entry);
  }

  clearUser(userId: string): void {
    const prefix = `${userId}\u0000`;
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      this.entries.delete(key);
      this.emit(key);
    }
  }

  private start(
    userId: string,
    date: string,
    previous = this.entries.get(cacheKey(userId, date)),
  ): Promise<GroupFocusStatusState> {
    const key = cacheKey(userId, date);
    const entry: CacheEntry = {
      state: { status: 'loading' },
      lastComplete: previous?.lastComplete ?? null,
      inFlight: null,
    };
    this.entries.set(key, entry);
    this.emit(key);

    const request = this.load(date).then(
      (rows): GroupFocusStatusState => {
        if (rows.length >= 100) return { status: 'coverage-unknown' };
        return { status: 'ready', data: rows };
      },
      (error): GroupFocusStatusState =>
        entry.lastComplete
          ? { status: 'stale', data: entry.lastComplete, error }
          : { status: 'error', error },
    );

    entry.inFlight = request.then((state) => {
      if (this.entries.get(key) !== entry) return state;
      entry.state = state;
      entry.inFlight = null;
      if (state.status === 'ready') entry.lastComplete = state.data;
      this.emit(key);
      return state;
    });
    return entry.inFlight;
  }

  private emit(key: string): void {
    this.listeners.get(key)?.forEach((listener) => listener());
  }
}

/**
 * members에 없는 ranking 행은 무시한다. raw가 완전하다고 확인된 ready/stale에서만 부재를
 * isFocusing=false로 해석하므로 0도 확인된 값이고, 그 밖의 상태는 숫자를 만들지 않는다.
 */
export function deriveGroupFocusCount(
  memberIds: readonly string[],
  state: GroupFocusStatusState,
): GroupFocusCount {
  if (state.status !== 'ready' && state.status !== 'stale') {
    return { status: 'unavailable' };
  }
  const focusingIds = new Set(
    state.data.filter((member) => member.isFocusing === true).map((member) => member.userId),
  );
  const count = Array.from(new Set(memberIds)).reduce((total, id) => {
    return total + (focusingIds.has(id) ? 1 : 0);
  }, 0);
  return { status: state.status, count };
}

export interface GroupFocusPollingLifecycle {
  screenFocused: boolean;
  appActive: boolean;
  hasGroups: boolean;
}

export interface GroupFocusPollingOptions {
  store: GroupFocusStatusStore;
  userId: string;
  getDate?: () => string;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

/** 첫 back 뒤의 foreground 60초 수명을 화면/앱 수명과 분리해 검증 가능한 controller로 둔다. */
export class GroupFocusPollingController {
  private activated = false;
  private disposed = false;
  private lifecycle: GroupFocusPollingLifecycle = {
    screenFocused: false,
    appActive: false,
    hasGroups: false,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly getDate: () => string;
  private readonly intervalMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  constructor(private readonly options: GroupFocusPollingOptions) {
    this.getDate = options.getDate ?? todayStrKst;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  /** 사용자 첫 back과 코치마크 3→4가 공유하는 진입점. */
  activate(): void {
    if (this.disposed || this.activated) return;
    this.activated = true;
    if (!this.canRun()) return;
    this.options.store.ensure(this.options.userId, this.getDate());
    this.startTimer();
  }

  setLifecycle(next: GroupFocusPollingLifecycle): void {
    if (this.disposed) return;
    const wasRunning = this.canRun();
    this.lifecycle = next;
    const isRunning = this.canRun();
    if (!isRunning) {
      this.stopTimer();
      return;
    }
    if (!wasRunning) this.refresh();
    this.startTimer();
  }

  notifyFocusFlowReturn(): void {
    if (this.canRun()) this.refresh();
  }

  /** 사용자가 누른 명시적 새로고침은 60초 tick을 기다리지 않고 현재 focus cache를 갱신한다. */
  refreshNow(): Promise<GroupFocusStatusState> | null {
    return this.canRun() ? this.refresh() : null;
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
  }

  private canRun(): boolean {
    return (
      this.activated &&
      !this.disposed &&
      this.lifecycle.screenFocused &&
      this.lifecycle.appActive &&
      this.lifecycle.hasGroups
    );
  }

  private refresh(): Promise<GroupFocusStatusState> {
    return this.options.store.retry(this.options.userId, this.getDate());
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = this.setIntervalFn(() => {
      if (this.canRun()) this.refresh();
    }, this.intervalMs);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.clearIntervalFn(this.timer);
    this.timer = null;
  }
}

export const groupFocusStatusStore = new GroupFocusStatusStore((date) =>
  getMyRanking(undefined, date),
);
