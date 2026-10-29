import {
  AssetFile,
  AssetPack,
  EnsureResult,
  PackLease,
  canonical,
  digest,
  parseManifest,
} from './contracts';
import { ChannelClient, ChannelState } from './channelClient';
import { AssetPort, nativePort } from './nativeAdapter';
import { POLICY, retryDelay } from './policy';
type PackRecord = AssetPack & {
  packId: string;
  adoptedAt: number;
  lastUsedAt?: number;
  previousSince?: number;
};
type Failure = { failureCount: number; nextRetry: number };
type Index = {
  schemaVersion: 1;
  assetApiVersion: 1;
  environment: string;
  seq: number;
  channel: ChannelState;
  packs: Record<string, PackRecord>;
  active: Record<string, string>;
  bad: string[];
  failures: Record<string, Failure>;
  lastCollect: number;
};
const empty = (environment: string): Index => ({
  schemaVersion: 1,
  assetApiVersion: 1,
  environment,
  seq: 0,
  channel: { lastSuccess: 0, failureCount: 0, nextRetry: 0 },
  packs: {},
  active: {},
  bad: [],
  failures: {},
  lastCollect: 0,
});
const key = (id: string, version: string) => `${id}:${version}`;
export class AssetRepository {
  private state: Index;
  private queue: Promise<unknown> = Promise.resolve();
  private initialized?: Promise<void>;
  private snapshots: { uri: string; state: Index }[] = [];
  private seq = 0;
  private serial = 0;
  private leases = new Map<string, string>();
  private reservations = new Map<string, number>();
  private jobs = new Map<string, Promise<string>>();
  private packPins = new Map<string, number>();
  private inflight = new Map<string, Promise<EnsureResult>>();
  private refreshing?: Promise<boolean>;
  private slots = 0;
  private decoding: Promise<unknown> = Promise.resolve();
  private waiters: (() => void)[] = [];
  constructor(
    private port: AssetPort,
    private client: ChannelClient,
    environment = 'dev',
    private now = Date.now,
  ) {
    this.state = empty(environment);
  }
  private locked<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }
  private uri(hash: string) {
    return `${this.port.root}/objects/${hash}.png`;
  }
  private async valid(record: PackRecord) {
    for (const f of Object.values(record.files)) {
      if (this.state.bad.includes(f.sha256)) return false;
      try {
        const stat = await this.port.inspect(this.uri(f.sha256));
        if (stat.bytes !== f.bytes || stat.sha256 !== f.sha256) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  initialize() {
    return (this.initialized ??= this.locked(async () => {
      const files = await this.port.list();
      const candidates = files
        .filter((f) => /\/indexes\/\d+\.[a-f0-9]{64}\.json$/.test(f.uri))
        .sort(
          (a, b) =>
            Number(b.uri.split('/').pop()!.split('.')[0]) -
            Number(a.uri.split('/').pop()!.split('.')[0]),
        );
      for (const file of candidates) {
        const [seq, sha] = file.uri.split('/').pop()!.split('.');
        this.seq = Math.max(this.seq, Number(seq));
        try {
          const text = await this.port.read(file.uri);
          if (digest(text) !== sha) continue;
          const s = JSON.parse(text) as Index;
          if (
            s.seq !== Number(seq) ||
            s.schemaVersion !== 1 ||
            s.assetApiVersion !== 1 ||
            s.environment !== this.state.environment ||
            !s.packs ||
            !s.active ||
            !Array.isArray(s.bad) ||
            !s.failures ||
            !s.channel
          )
            continue;
          if (s.channel.manifest) parseManifest(s.channel.manifest);
          for (const p of Object.values(s.packs))
            parseManifest({
              schemaVersion: 1,
              assetApiVersion: 1,
              releaseId: 'snapshot',
              packs: { [p.packId]: { version: p.version, files: p.files } },
            });
          this.snapshots.push({ uri: file.uri, state: s });
          if (this.snapshots.length === 2) break;
        } catch {
          /* 손상 snapshot은 직전 정상본으로 복구한다. */
        }
      }
      if (this.snapshots[0]) this.state = this.snapshots[0].state;
      // 작업 소유자가 없는 staging만 정리한다. 삭제 실패 파일은 다음 실사용 집계에 남는다.
      for (const file of files.filter((f) => f.uri.includes('/staging/')))
        await this.port.remove(file.uri).catch(() => {});
    }));
  }
  private async commit(next: Index) {
    const state = { ...next, seq: ++this.seq };
    const payload = canonical(state);
    if (new TextEncoder().encode(payload).length > 2 * 1024 ** 2) throw new Error('snapshot limit');
    const disk = await this.port.list();
    if (
      disk.reduce((n, f) => n + f.bytes, 0) +
        new TextEncoder().encode(payload).length +
        this.remaining(disk) >
      POLICY.totalBytes
    )
      throw new Error('snapshot space');
    const file = await this.port.snapshot(state.seq, payload);
    if (file.sha256 !== digest(payload) || (await this.port.read(file.uri)) !== payload)
      throw new Error('snapshot integrity');
    this.state = state;
    this.snapshots.unshift({ uri: file.uri, state });
    this.snapshots = this.snapshots.slice(0, 2);
    const keep = new Set(this.snapshots.map((s) => s.uri));
    for (const f of await this.port.list())
      if (f.uri.includes('/indexes/') && !keep.has(f.uri))
        await this.port.remove(f.uri).catch(() => {});
  }
  private remaining(files: { uri: string; bytes: number }[]) {
    let n = 0;
    for (const [job, bytes] of this.reservations)
      n += Math.max(
        0,
        bytes - (files.find((f) => f.uri.endsWith(`/staging/${job}.partial`))?.bytes ?? 0),
      );
    return n;
  }
  async acquirePack(packId: string): Promise<PackLease | null> {
    await this.initialize();
    return this.locked(async () => {
      const active = this.state.active[packId];
      const candidates = Object.values(this.state.packs)
        .filter((p) => p.packId === packId)
        .sort(
          (a, b) =>
            Number(b.version === active) - Number(a.version === active) ||
            b.adoptedAt - a.adoptedAt,
        );
      for (const p of candidates) {
        if (!(await this.valid(p))) continue;
        const id = `lease-${++this.serial}`;
        const k = key(packId, p.version);
        this.leases.set(id, k);
        try {
          await this.commit({
            ...this.state,
            packs: { ...this.state.packs, [k]: { ...p, lastUsedAt: this.now() } },
          });
        } catch {
          /* 표시 가능한 캐시는 메타 쓰기 실패에도 lease로 보호한다. */
        }
        let released = false;
        return {
          id,
          packId,
          version: p.version,
          assets: Object.freeze(
            Object.fromEntries(
              Object.entries(p.files).map(([name, f]) => [
                name,
                Object.freeze({
                  mediaType: f.mediaType,
                  uri: this.uri(f.sha256),
                  width: f.width,
                  height: f.height,
                }),
              ]),
            ),
          ),
          release: () => {
            if (released) return;
            released = true;
            void this.locked(async () => {
              this.leases.delete(id);
            });
          },
        };
      }
      return null;
    });
  }
  private refresh(force: boolean) {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const state = this.state.channel;
      const now = this.now();
      if (now < state.nextRetry && now >= state.lastSuccess) return false;
      if (
        !force &&
        state.manifest &&
        now >= state.lastSuccess &&
        now - state.lastSuccess < POLICY.channelAge
      )
        return true;
      try {
        const channel = await this.client.refresh(state, now);
        await this.locked(() => this.commit({ ...this.state, channel }));
        return true;
      } catch {
        await this.locked(async () => {
          const failureCount = this.state.channel.failureCount + 1;
          await this.commit({
            ...this.state,
            channel: {
              ...this.state.channel,
              failureCount,
              nextRetry: now + retryDelay(failureCount),
            },
          });
        }).catch(() => {});
        return false;
      }
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  ensurePack(packId: string): Promise<EnsureResult> {
    const hit = this.inflight.get(packId);
    if (hit) return hit;
    const task = this.ensure(packId).finally(() => this.inflight.delete(packId));
    this.inflight.set(packId, task);
    return task;
  }
  private async ensure(packId: string): Promise<EnsureResult> {
    await this.initialize();
    const old = this.state.channel.manifest?.packs[packId];
    const failure = old && this.state.failures[key(packId, old.version)];
    const now = this.now();
    if (failure && now < failure.nextRetry) return { status: 'deferred', reason: 'backoff' };
    const missing = await this.locked(async () => {
      const active = this.state.packs[key(packId, this.state.active[packId])];
      return !active || !(await this.valid(active));
    });
    await this.refresh(missing || !!failure);
    const pack = this.state.channel.manifest?.packs[packId];
    if (!pack) return { status: 'deferred', reason: 'offline' };
    if (now < this.state.channel.nextRetry) return { status: 'deferred', reason: 'backoff' };
    const k = key(packId, pack.version);
    if (Object.values(pack.files).some((f) => this.state.bad.includes(f.sha256)))
      return { status: 'failed', reason: 'decode' };
    await this.locked(async () => {
      for (const f of Object.values(pack.files))
        this.packPins.set(f.sha256, (this.packPins.get(f.sha256) ?? 0) + 1);
    });
    try {
      for (const f of Object.values(pack.files)) await this.object(f);
      await this.locked(async () => {
        if (this.state.channel.manifest?.packs[packId]?.version !== pack.version)
          throw new Error('stale generation');
        const packs = { ...this.state.packs };
        if (this.state.active[packId] !== pack.version) {
          let previous: string | undefined;
          const normalCandidates = Object.values(packs)
            .filter((p) => p.packId === packId && p.version !== pack.version)
            .sort(
              (a, b) =>
                Number(b.version === this.state.active[packId]) -
                  Number(a.version === this.state.active[packId]) || b.adoptedAt - a.adoptedAt,
            );
          for (const candidate of normalCandidates) {
            if (await this.valid(candidate)) {
              previous = candidate.version;
              break;
            }
          }
          for (const [pk, p] of Object.entries(packs)) {
            if (
              p.packId === packId &&
              p.version !== pack.version &&
              p.version !== previous &&
              ![...this.leases.values()].includes(pk)
            )
              delete packs[pk];
          }
          if (previous)
            packs[key(packId, previous)] = {
              ...packs[key(packId, previous)],
              previousSince: this.now(),
            };
        }
        packs[k] = {
          ...pack,
          packId,
          adoptedAt: packs[k]?.adoptedAt ?? this.now(),
          lastUsedAt: packs[k]?.lastUsedAt,
        };
        const failures = { ...this.state.failures };
        delete failures[k];
        await this.commit({
          ...this.state,
          packs,
          active: { ...this.state.active, [packId]: pack.version },
          failures,
        });
      });
      return { status: 'ready', version: pack.version };
    } catch (error) {
      await this.locked(async () => {
        const failureCount = (this.state.failures[k]?.failureCount ?? 0) + 1;
        await this.commit({
          ...this.state,
          failures: {
            ...this.state.failures,
            [k]: { failureCount, nextRetry: this.now() + retryDelay(failureCount) },
          },
        });
      }).catch(() => {});
      return error instanceof Error && error.message === 'space'
        ? { status: 'deferred', reason: 'space' }
        : { status: 'failed', reason: 'integrity' };
    } finally {
      await this.locked(async () => {
        for (const f of Object.values(pack.files)) {
          const remaining = (this.packPins.get(f.sha256) ?? 1) - 1;
          if (remaining) this.packPins.set(f.sha256, remaining);
          else this.packPins.delete(f.sha256);
        }
      });
    }
  }
  private object(file: AssetFile): Promise<string> {
    const hit = this.jobs.get(file.sha256);
    if (hit) return hit;
    const task = this.receive(file).finally(() => this.jobs.delete(file.sha256));
    this.jobs.set(file.sha256, task);
    return task;
  }
  private async receive(file: AssetFile) {
    try {
      const stat = await this.port.inspect(this.uri(file.sha256));
      if (stat.bytes === file.bytes && stat.sha256 === file.sha256) return this.uri(file.sha256);
    } catch {
      /* 누락 파일만 수신한다. */
    }
    if (this.slots >= 2) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.slots++;
    const job = `asset-${this.now()}-${++this.serial}`;
    try {
      await this.collect(true, file.bytes);
      await this.locked(async () => {
        const disk = await this.port.list();
        const used = disk
          .filter((f) => !f.uri.includes('/indexes/'))
          .reduce((n, f) => n + f.bytes, 0);
        if (
          used + this.remaining(disk) + file.bytes > POLICY.imageBytes ||
          (await this.port.free()) - this.remaining(disk) - file.bytes < POLICY.freeBytes
        )
          throw new Error('space');
        this.reservations.set(job, file.bytes);
      });
      let uri = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await this.port.download({
            url: this.client.url(file.path),
            jobId: job,
            expectedBytes: file.bytes,
            expectedSha256: file.sha256,
            allowedOrigins: [this.client.origin],
            timeoutMs: 60000,
          });
          if (result.bytes !== file.bytes || result.sha256 !== file.sha256)
            throw new Error('integrity');
          uri = result.uri;
          break;
        } catch (error) {
          if (
            attempt ||
            (error instanceof Error &&
              /403|404|schema/.test(
                `${error.message} ${(error as Error & { code?: string }).code ?? ''}`,
              ))
          )
            throw error;
        }
      }
      try {
        const decoded = this.decoding.then(() => this.port.decode(uri, file.width, file.height));
        this.decoding = decoded.catch(() => {});
        await decoded;
      } catch (error) {
        await this.locked(() =>
          this.commit({ ...this.state, bad: [...new Set([...this.state.bad, file.sha256])] }),
        );
        throw error;
      }
      return await this.locked(async () => {
        const pinned = [...this.leases.values()].some((k) =>
          Object.values(this.state.packs[k]?.files ?? {}).some((f) => f.sha256 === file.sha256),
        );
        if (pinned) {
          const existing = await this.port.inspect(this.uri(file.sha256)).catch(() => null);
          if (!existing || existing.bytes !== file.bytes || existing.sha256 !== file.sha256)
            throw new Error('leased corrupt object');
        }
        return this.port.publish(uri, file.sha256);
      });
    } finally {
      await this.locked(async () => {
        this.reservations.delete(job);
        await this.port.remove(`${this.port.root}/staging/${job}.partial`).catch(() => {});
      });
      const next = this.waiters.shift();
      if (next) next();
      else this.slots--;
    }
  }
  async reportDecodeFailure(lease: PackLease) {
    await this.initialize();
    await this.locked(async () => {
      const p = this.state.packs[key(lease.packId, lease.version)];
      if (!p) return;
      await this.commit({
        ...this.state,
        bad: [...new Set([...this.state.bad, ...Object.values(p.files).map((f) => f.sha256)])],
      });
    });
    lease.release();
  }
  async collect(pressure = false, incoming = 0) {
    await this.initialize();
    const now = this.now();
    const candidates = await this.locked(async () => {
      if (
        !pressure &&
        now >= this.state.lastCollect &&
        now - this.state.lastCollect < POLICY.collectAge
      )
        return null;
      await this.unlinkUnreferenced();
      const files = await this.port.list();
      const used = files.reduce((n, f) => n + f.bytes, 0) + this.remaining(files);
      const free = await this.port.free().catch(() => 0);
      if (
        pressure &&
        used + incoming <= POLICY.imageBytes &&
        free - this.remaining(files) - incoming >= POLICY.freeBytes
      )
        return null;
      const rank = (p: PackRecord) =>
        Object.values(p.files).some((f) => this.state.bad.includes(f.sha256))
          ? 0
          : p.previousSince !== undefined && now - p.previousSince >= POLICY.previousAge
            ? 1
            : now - (p.lastUsedAt ?? p.adoptedAt) >= POLICY.unusedAge
              ? 2
              : 3;
      return Object.entries(this.state.packs)
        .sort(
          ([, a], [, b]) =>
            rank(a) - rank(b) || (a.lastUsedAt ?? a.adoptedAt) - (b.lastUsedAt ?? b.adoptedAt),
        )
        .map(([k]) => k);
    });
    if (!candidates) return;
    // 후보마다 큐를 반환해 기다리던 화면의 acquire가 다음 후보를 pin할 수 있다.
    for (const k of candidates) {
      const enough = await this.locked(async () => {
        const p = this.state.packs[k];
        if (
          !p ||
          [...this.leases.values()].includes(k) ||
          Object.values(p.files).some((f) => this.packPins.has(f.sha256))
        )
          return false;
        const expired =
          (p.previousSince !== undefined && now - p.previousSince >= POLICY.previousAge) ||
          now - (p.lastUsedAt ?? p.adoptedAt) >= POLICY.unusedAge ||
          Object.values(p.files).some((f) => this.state.bad.includes(f.sha256));
        if (!pressure && !expired) return false;
        const packs = { ...this.state.packs };
        const active = { ...this.state.active };
        delete packs[k];
        if (active[p.packId] === p.version) delete active[p.packId];
        // 두 복구 지점에서 참조를 지운 뒤에만 실제 객체를 회수한다.
        await this.commit({ ...this.state, packs, active, lastCollect: now });
        await this.commit({ ...this.state });
        await this.unlinkUnreferenced();
        const files = await this.port.list();
        return (
          pressure &&
          files.reduce((n, f) => n + f.bytes, 0) + this.remaining(files) + incoming <=
            POLICY.targetBytes &&
          (await this.port.free()) - this.remaining(files) - incoming >= POLICY.freeBytes
        );
      });
      if (enough) break;
    }
    await this.locked(async () => {
      await this.commit({ ...this.state, lastCollect: now });
      await this.unlinkUnreferenced();
    });
  }
  private async unlinkUnreferenced() {
    const hashes = new Set([...this.jobs.keys(), ...this.packPins.keys()]);
    for (const snapshot of this.snapshots)
      for (const p of Object.values(snapshot.state.packs))
        for (const f of Object.values(p.files)) hashes.add(f.sha256);
    for (const k of this.leases.values()) {
      const p = this.state.packs[k];
      if (p) for (const f of Object.values(p.files)) hashes.add(f.sha256);
    }
    for (const f of await this.port.list()) {
      const staging = /\/staging\/([^/]+)\.partial$/.exec(f.uri);
      if (staging && !this.reservations.has(staging[1]))
        await this.port.remove(f.uri).catch(() => {});
      const match = /\/objects\/([a-f0-9]{64})\.png$/.exec(f.uri);
      if (match && !hashes.has(match[1])) await this.port.remove(f.uri).catch(() => {});
    }
  }
  async onForeground() {
    await this.initialize();
    const retryDue = Object.values(this.state.failures).some((f) => this.now() >= f.nextRetry);
    await this.refresh(retryDue);
    await this.collect();
  }
}
let singleton: AssetRepository | null | undefined;
export function getAssetRepository() {
  if (singleton !== undefined) return singleton;
  singleton = null;
  if (
    process.env.EXPO_PUBLIC_IMAGE_ASSETS_ENABLED !== 'true' ||
    !process.env.EXPO_PUBLIC_IMAGE_ASSETS_URL
  )
    return null;
  try {
    const port = nativePort();
    const env = process.env.EXPO_PUBLIC_IMAGE_ASSETS_ENV;
    if (port && (env === 'dev' || env === 'prod'))
      singleton = new AssetRepository(
        port,
        new ChannelClient(process.env.EXPO_PUBLIC_IMAGE_ASSETS_URL, env, fetch, port.metadata),
        env,
      );
  } catch {
    /* 미지원 바이너리와 설정 누락은 번들로 표시한다. */
  }
  return singleton;
}
