import { getAnnouncements, getChallenges, getGroupDetail } from '@/services/groupApi';
import type {
  GroupAnnouncementResponse,
  GroupChallengeResponse,
  GroupDetailResponse,
} from '@/types/dto/group';

export type DependencyState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: unknown };

export type FocusDependencyState<T> =
  | DependencyState<T>
  | { status: 'coverage-unknown' }
  | { status: 'stale'; data: T; error: unknown };

export interface SharedFocusDependency<T> {
  getState(userId: string, date: string): FocusDependencyState<T>;
  ensure(userId: string, date: string): Promise<unknown>;
  retry(userId: string, date: string): Promise<unknown>;
  subscribe(listener: Listener): () => void;
}

interface CacheEntry<T> {
  state: DependencyState<T>;
  inFlight: Promise<DependencyState<T>> | null;
}

type Listener = () => void;

/**
 * 한 dependency의 key별 상태와 진행 중 요청을 보관한다.
 *
 * invalidate된 entry의 늦은 응답은 Map의 현재 entry와 동일한지 확인한 뒤 버린다. 따라서
 * 탈퇴한 그룹이나 날짜가 지난 카드의 응답이 새 scope에 섞이지 않는다.
 */
export class KeyedDependencyCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly load: (key: string) => Promise<T>) {}

  getState(key: string): DependencyState<T> {
    return this.entries.get(key)?.state ?? { status: 'idle' };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ensure(key: string): Promise<DependencyState<T>> {
    const entry = this.entries.get(key);
    if (!entry) return this.start(key);
    if (entry.inFlight) return entry.inFlight;
    return Promise.resolve(entry.state);
  }

  retry(key: string): Promise<DependencyState<T>> {
    const entry = this.entries.get(key);
    if (!entry) return this.start(key);
    if (entry.inFlight) return entry.inFlight;
    if (entry.state.status !== 'error') return Promise.resolve(entry.state);
    return this.start(key);
  }

  retain(isValid: (key: string) => boolean, notify = true): boolean {
    let changed = false;
    for (const key of this.entries.keys()) {
      if (isValid(key)) continue;
      this.entries.delete(key);
      changed = true;
    }
    if (changed && notify) this.emit();
    return changed;
  }

  private start(key: string): Promise<DependencyState<T>> {
    const entry: CacheEntry<T> = { state: { status: 'loading' }, inFlight: null };
    this.entries.set(key, entry);
    this.emit();

    const request = this.load(key).then(
      (data): DependencyState<T> => ({ status: 'ready', data }),
      (error): DependencyState<T> => ({ status: 'error', error }),
    );

    entry.inFlight = request.then((state) => {
      if (this.entries.get(key) !== entry) return state;
      entry.state = state;
      entry.inFlight = null;
      this.emit();
      return state;
    });
    return entry.inFlight;
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export interface GroupCardSummaryScope {
  userId: string;
  date: string;
  groupIds: readonly string[];
}

export interface GroupCardSummarySnapshot<TFocus> {
  detail: DependencyState<GroupDetailResponse>;
  announcements: DependencyState<GroupAnnouncementResponse[]>;
  challenges: DependencyState<GroupChallengeResponse[]>;
  focus: FocusDependencyState<TFocus>;
}

export interface GroupCardSummaryLoaders {
  detail(groupId: string, date: string): Promise<GroupDetailResponse>;
  announcements(groupId: string): Promise<GroupAnnouncementResponse[]>;
  challenges(groupId: string, date: string): Promise<GroupChallengeResponse[]>;
}

const defaultLoaders: GroupCardSummaryLoaders = {
  detail: getGroupDetail,
  announcements: getAnnouncements,
  challenges: getChallenges,
};

type GroupDependency = 'detail' | 'announcements' | 'challenges' | 'focus';

const keyed = (groupId: string, date: string) => `${groupId}\u0000${date}`;
const groupOnly = (key: string) => key.split('\u0000', 1)[0];
const dateOnly = (key: string) => key.slice(key.indexOf('\u0000') + 1);

/**
 * 카드 뒷면이 사용할 기존 read API 조합기다. 생성만으로 요청하지 않으며, ensureBack은 현재
 * scope의 idle dependency만 시작한다. 화면 코치마크 3→4도 사용자 flip과 같은 메서드를 호출한다.
 */
export class GroupCardSummaryAdapter<TFocus> {
  private scope: GroupCardSummaryScope | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly snapshots = new Map<string, GroupCardSummarySnapshot<TFocus>>();
  private readonly detail: KeyedDependencyCache<GroupDetailResponse>;
  private readonly announcements: KeyedDependencyCache<GroupAnnouncementResponse[]>;
  private readonly challenges: KeyedDependencyCache<GroupChallengeResponse[]>;
  private readonly unsubscribeDependencies: Array<() => void>;

  constructor(
    private readonly focus: SharedFocusDependency<TFocus>,
    loaders: GroupCardSummaryLoaders = defaultLoaders,
  ) {
    this.detail = new KeyedDependencyCache((key) => {
      const separator = key.indexOf('\u0000');
      return loaders.detail(key.slice(0, separator), key.slice(separator + 1));
    });
    this.announcements = new KeyedDependencyCache(loaders.announcements);
    this.challenges = new KeyedDependencyCache((key) => {
      const separator = key.indexOf('\u0000');
      return loaders.challenges(key.slice(0, separator), key.slice(separator + 1));
    });

    const notify = () => this.notifySubscribers();
    this.unsubscribeDependencies = [
      this.detail.subscribe(notify),
      this.announcements.subscribe(notify),
      this.challenges.subscribe(notify),
      this.focus.subscribe(notify),
    ];
  }

  setScope(scope: GroupCardSummaryScope | null): void {
    const accountChanged = this.scope?.userId !== scope?.userId;
    this.scope = scope;
    this.snapshots.clear();
    const groupIds = new Set(scope?.groupIds ?? []);
    const date = scope?.date;
    // 세 dependency를 모두 정리하기 전에 중간 snapshot을 알리면 새 계정의 focus와 이전 계정의
    // group cache가 한 렌더에서 섞인다. retain 알림을 억제하고 완성된 scope를 한 번만 발행한다.
    this.detail.retain(
      (key) => !accountChanged && groupIds.has(groupOnly(key)) && dateOnly(key) === date,
      false,
    );
    this.challenges.retain(
      (key) => !accountChanged && groupIds.has(groupOnly(key)) && dateOnly(key) === date,
      false,
    );
    this.announcements.retain((groupId) => !accountChanged && groupIds.has(groupId), false);
    this.emit();
  }

  getSnapshot(groupId: string): GroupCardSummarySnapshot<TFocus> | null {
    const scope = this.validScope(groupId);
    if (!scope) return null;
    const cached = this.snapshots.get(groupId);
    if (cached) return cached;
    const datedKey = keyed(groupId, scope.date);
    const snapshot = {
      detail: this.detail.getState(datedKey),
      announcements: this.announcements.getState(groupId),
      challenges: this.challenges.getState(datedKey),
      focus: this.focus.getState(scope.userId, scope.date),
    };
    this.snapshots.set(groupId, snapshot);
    return snapshot;
  }

  async ensureBack(groupId: string): Promise<void> {
    const scope = this.validScope(groupId);
    if (!scope) return;
    const datedKey = keyed(groupId, scope.date);
    const focusState = this.focus.getState(scope.userId, scope.date);
    await Promise.all([
      this.detail.ensure(datedKey),
      this.announcements.ensure(groupId),
      this.challenges.ensure(datedKey),
      focusState.status === 'idle'
        ? this.focus.ensure(scope.userId, scope.date)
        : Promise.resolve(focusState),
    ]);
  }

  async retry(groupId: string, dependency: GroupDependency): Promise<void> {
    const scope = this.validScope(groupId);
    if (!scope) return;
    const datedKey = keyed(groupId, scope.date);
    switch (dependency) {
      case 'detail':
        await this.detail.retry(datedKey);
        return;
      case 'announcements':
        await this.announcements.retry(groupId);
        return;
      case 'challenges':
        await this.challenges.retry(datedKey);
        return;
      case 'focus':
        await this.focus.retry(scope.userId, scope.date);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.unsubscribeDependencies.splice(0).forEach((unsubscribe) => unsubscribe());
    this.scope = null;
    this.snapshots.clear();
    this.listeners.clear();
  }

  private notifySubscribers(): void {
    this.snapshots.clear();
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private validScope(groupId: string): GroupCardSummaryScope | null {
    if (!this.scope?.groupIds.includes(groupId)) return null;
    return this.scope;
  }
}
