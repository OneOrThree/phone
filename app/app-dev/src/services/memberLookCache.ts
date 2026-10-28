import type { MemberLook } from './memberAppearance';

export type CachedMemberLook = {
  catColor: string | null;
  appearance: MemberLook | null;
  hidden: boolean;
};
export type MemberLookBatch = {
  members: { userId: string; catColor: string | null; appearance: MemberLook }[];
  hiddenUserIds: string[];
};
type Entry = { value: CachedMemberLook; expiresAt: number };
type Job = { promise: Promise<void>; done: () => void };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 화면 간 재사용·동시 요청 병합·계정 격리·늦은 응답 처리를 한곳에서 한다. 디스크에는 저장하지 않는다. */
export class MemberLookCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Job>();
  private queue = new Set<string>();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private scheduled = false;
  private revision = 0;
  private retryAfter = 0;

  constructor(
    private readonly fetchBatch: (ids: string[]) => Promise<MemberLookBatch>,
    private readonly now: () => number = Date.now,
    private readonly capacity = 512,
    private readonly ttl = 5 * 60_000,
  ) {}

  get = (id: string): CachedMemberLook | undefined => {
    const entry = this.entries.get(id);
    // 초기 조회 전에 받은 이벤트는 병합용으로만 보관한다. 아직 모르는 털색을 null로 확정하지 않는다.
    return entry?.expiresAt === 0 ? undefined : entry?.value;
  };
  snapshot = (): number => this.revision;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
  }

  clear = () => {
    this.epoch += 1;
    this.entries.clear();
    this.pending.forEach((job) => job.done());
    this.pending.clear();
    this.queue.clear();
    this.retryAfter = 0;
    this.emit();
  };

  private put(id: string, value: CachedMemberLook, expiresAt: number) {
    this.entries.delete(id);
    this.entries.set(id, { value, expiresAt });
    while (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
  }

  accept = (id: string, appearance: MemberLook) => {
    const entry = this.entries.get(id);
    if (entry?.value.hidden || !Number.isSafeInteger(appearance.version) || appearance.version! < 0)
      return;
    if (
      entry?.value.appearance?.version != null &&
      appearance.version! <= entry.value.appearance.version
    )
      return;
    // 외양 이벤트로 차단·탈퇴·털색의 정본 확인 시각을 연장하지 않는다.
    this.put(
      id,
      { catColor: null, hidden: false, ...entry?.value, appearance },
      entry?.expiresAt ?? 0,
    );
    this.emit();
  };

  ensure = async (ids: readonly string[], force = false): Promise<void> => {
    const jobs: Promise<void>[] = [];
    for (const id of new Set(ids)) {
      if (!UUID.test(id)) continue;
      const current = this.pending.get(id);
      if (current) {
        jobs.push(current.promise);
        continue;
      }
      if (this.now() < this.retryAfter) continue;
      if (!force && (this.entries.get(id)?.expiresAt ?? -Infinity) > this.now()) continue;
      let done!: () => void;
      const promise = new Promise<void>((resolve) => {
        done = resolve;
      });
      this.pending.set(id, { promise, done });
      this.queue.add(id);
      jobs.push(promise);
    }
    if (this.queue.size && !this.scheduled) {
      this.scheduled = true;
      void Promise.resolve().then(() => this.flush());
    }
    await Promise.all(jobs);
  };

  private async flush() {
    // 한 번에 50명, 한 요청씩. 큰 목록이 등장해도 동시 HTTP 요청 수가 증가하지 않는다.
    while (this.queue.size) {
      const ids = [...this.queue].slice(0, 50);
      ids.forEach((id) => this.queue.delete(id));
      const jobs = ids.map((id) => this.pending.get(id)!);
      const epoch = this.epoch;
      try {
        const result = await this.fetchBatch(ids);
        if (epoch !== this.epoch) continue;
        const hidden = new Set(result.hiddenUserIds);
        const rows = new Map(result.members.map((member) => [member.userId, member]));
        for (const id of ids) {
          const row = rows.get(id);
          if (hidden.has(id) || !row) {
            this.put(id, { catColor: null, appearance: null, hidden: true }, this.now() + 30_000);
            continue;
          }
          const old = this.entries.get(id)?.value.appearance;
          const appearance =
            old?.version != null &&
            row.appearance.version != null &&
            old.version > row.appearance.version
              ? old
              : row.appearance;
          this.put(
            id,
            { catColor: row.catColor, appearance, hidden: false },
            this.now() + this.ttl,
          );
        }
        this.emit();
      } catch {
        // 장애 때 렌더링·주기 갱신으로 재요청 폭주가 생기지 않게 잠시 쉰다.
        if (epoch === this.epoch) this.retryAfter = this.now() + 30_000;
      } finally {
        ids.forEach((id, index) => {
          if (this.pending.get(id) === jobs[index]) this.pending.delete(id);
          jobs[index].done();
        });
      }
    }
    this.scheduled = false;
  }
}
