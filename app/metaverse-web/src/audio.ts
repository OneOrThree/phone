export type AudioMode = "ambient" | "focus";
export type AudioSnapshot = {
  enabled: boolean;
  volume: number;
  state: "locked" | "loading" | "playing" | "muted" | "error";
  mode: AudioMode;
  error: string | null;
};

const SETTINGS = "cattus-island-audio-v1";
export const AUDIO_FILES = {
  ambient: `${import.meta.env?.BASE_URL ?? "/"}audio/forest-wind.m4a`,
  focus: `${import.meta.env?.BASE_URL ?? "/"}audio/campfire.m4a`,
};
const modes: AudioMode[] = ["ambient", "focus"];
const clamp = (value: number) => Math.min(1, Math.max(0, value));

type Dependencies = {
  createContext: () => AudioContext;
  fetch: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem">;
};

// 생성자에서는 브라우저 오디오 자원을 열거나 소리를 재생하지 않는다.
export class IslandAudio {
  private snapshot: AudioSnapshot;
  private listeners = new Set<() => void>();
  private context?: AudioContext;
  private master?: GainNode;
  private tracks = new Map<
    AudioMode,
    { source: AudioBufferSourceNode; gain: GainNode }
  >();
  private ramps = new Map<
    AudioMode,
    { from: number; to: number; start: number; end: number }
  >();
  private loading?: Promise<void>;
  private disposed = false;
  private abort = new AbortController();

  constructor(private deps: Dependencies) {
    let enabled = true;
    let volume = 0.35;
    try {
      const stored = JSON.parse(deps.storage?.getItem(SETTINGS) ?? "null");
      if (typeof stored?.enabled === "boolean") enabled = stored.enabled;
      if (typeof stored?.volume === "number" && Number.isFinite(stored.volume))
        volume = clamp(stored.volume);
    } catch {
      /* 저장소 제한이나 잘못된 설정은 기본값으로 복구한다. */
    }
    this.snapshot = {
      enabled,
      volume,
      state: enabled ? "locked" : "muted",
      mode: "ambient",
      error: null,
    };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<AudioSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private persist() {
    try {
      this.deps.storage?.setItem(
        SETTINGS,
        JSON.stringify({
          enabled: this.snapshot.enabled,
          volume: this.snapshot.volume,
        }),
      );
    } catch {
      /* 저장이 막혀도 현재 세션의 조작은 유지한다. */
    }
  }
  private report(error: unknown) {
    this.update({
      state: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  private refreshState() {
    if (this.snapshot.error) return;
    if (!this.snapshot.enabled || this.snapshot.volume === 0)
      this.update({ state: "muted" });
    else if (this.tracks.size === 2 && this.context?.state === "running")
      this.update({ state: "playing", error: null });
    else this.update({ state: this.loading ? "loading" : "locked" });
  }

  // 사용자 이벤트 스택 안에서 resume을 호출하고, 다운로드/디코드는 그 뒤에 기다린다.
  unlock = () => {
    if (this.disposed || !this.snapshot.enabled) return;
    if (
      this.context?.state === "running" &&
      this.tracks.size === 2 &&
      !this.snapshot.error
    ) {
      this.refreshState();
      return;
    }
    try {
      if (!this.context) {
        this.context = this.deps.createContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.snapshot.enabled
          ? this.snapshot.volume
          : 0;
        this.master.connect(this.context.destination);
        this.context.onstatechange = () => this.refreshState();
      }
      const resume = this.context.resume();
      this.update({ state: "loading", error: null });
      const load = this.load();
      void Promise.all([resume, load])
        .then(() => this.refreshState())
        .catch((error: unknown) => this.report(error));
    } catch (error) {
      this.report(error);
    }
  };

  private load() {
    if (this.loading) return this.loading;
    if (this.tracks.size === 2) return Promise.resolve();
    const context = this.context!;
    this.loading = Promise.all(
      modes.map(async (mode) => {
        const response = await this.deps.fetch(AUDIO_FILES[mode], {
          signal: this.abort.signal,
        });
        if (!response.ok)
          throw new Error(`음원 요청 실패 (${response.status}): ${mode}`);
        const buffer = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0)
          throw new Error(`음원 디코드 길이 오류: ${mode}`);
        return { mode, buffer };
      }),
    )
      .then((buffers) => {
        if (this.disposed) return;
        // 두 음원을 모두 디코드한 뒤 한 번만 시작한다. 모드 전환은 gain만 바꾼다.
        for (const { mode, buffer } of buffers) {
          const source = context.createBufferSource();
          const gain = context.createGain();
          source.buffer = buffer;
          source.loop = true;
          source.loopStart = 0;
          source.loopEnd = buffer.duration;
          gain.gain.value = mode === this.snapshot.mode ? 1 : 0;
          source.connect(gain);
          gain.connect(this.master!);
          this.tracks.set(mode, { source, gain });
          source.start();
        }
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  setFocusing = (focusing: boolean) => {
    const mode = focusing ? "focus" : "ambient";
    if (mode === this.snapshot.mode || this.disposed) return;
    this.update({ mode });
    const now = this.context?.currentTime ?? 0;
    for (const [key, track] of this.tracks) {
      const previous = this.ramps.get(key);
      const value = previous
        ? previous.from +
          (previous.to - previous.from) *
            clamp((now - previous.start) / (previous.end - previous.start))
        : track.gain.gain.value;
      track.gain.gain.cancelScheduledValues(now);
      track.gain.gain.setValueAtTime(value, now);
      const target = key === mode ? 1 : 0;
      track.gain.gain.linearRampToValueAtTime(target, now + 0.8);
      this.ramps.set(key, {
        from: value,
        to: target,
        start: now,
        end: now + 0.8,
      });
    }
  };
  private applyVolume() {
    if (this.master) {
      const now = this.context!.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(
        this.snapshot.enabled ? this.snapshot.volume : 0,
        now,
        0.01,
      );
    }
    this.persist();
    this.refreshState();
  }
  toggle = () => {
    if (this.disposed) return;
    this.update({ enabled: !this.snapshot.enabled });
    this.applyVolume();
    if (this.snapshot.enabled) this.unlock();
  };
  setVolume = (value: number) => {
    if (!Number.isFinite(value) || this.disposed) return;
    this.update({ volume: clamp(value) });
    this.applyVolume();
  };
  dispose = () => {
    this.disposed = true;
    this.abort.abort();
    this.listeners.clear();
    for (const { source, gain } of this.tracks.values()) {
      source.stop();
      source.disconnect();
      gain.disconnect();
    }
    this.tracks.clear();
    this.master?.disconnect();
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
  };
}
