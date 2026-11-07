import test from "node:test";
import assert from "node:assert/strict";
import { IslandAudio, AUDIO_FILES } from "../src/audio";

function fixture(
  options: {
    failResume?: boolean;
    failDecode?: boolean;
    stored?: string;
    delayed?: boolean;
  } = {},
) {
  const sources: any[] = [];
  const gains: any[] = [];
  const requests: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const context = {
    state: "suspended",
    currentTime: 12,
    destination: {},
    onstatechange: null,
    resumes: 0,
    closed: false,
    resume() {
      this.resumes++;
      if (options.failResume)
        return Promise.reject(new Error("gesture rejected"));
      this.state = "running";
      return Promise.resolve();
    },
    close() {
      this.closed = true;
      return Promise.resolve();
    },
    async decodeAudioData() {
      if (options.failDecode) throw new Error("unsupported AAC");
      return { duration: 90 };
    },
    createGain() {
      const gain = {
        gain: {
          value: 0,
          events: [] as any[],
          cancelScheduledValues(t: number) {
            this.events.push(["cancel", t]);
          },
          setValueAtTime(v: number, t: number) {
            this.events.push(["value", v, t]);
          },
          linearRampToValueAtTime(v: number, t: number) {
            this.events.push(["ramp", v, t]);
          },
          setTargetAtTime(v: number) {
            this.value = v;
          },
        },
        connect() {},
        disconnect() {},
      };
      gains.push(gain);
      return gain;
    },
    createBufferSource() {
      const source = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        started: 0,
        stopped: 0,
        connect() {},
        disconnect() {},
        start() {
          this.started++;
        },
        stop() {
          this.stopped++;
        },
      };
      sources.push(source);
      return source;
    },
  };
  const audio = new IslandAudio({
    createContext: () => context as unknown as AudioContext,
    fetch: (async (url: string) => {
      requests.push(url);
      if (options.delayed) await pending;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
    }) as unknown as typeof fetch,
    storage: { getItem: () => options.stored ?? null, setItem() {} },
  });
  return { audio, context, sources, gains, requests, release };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("직접 unlock 전 잠김, 동기 resume 뒤 두 로컬 음원을 한 번씩 루프 재생", async () => {
  const f = fixture();
  assert.equal(f.audio.getSnapshot().state, "locked");
  assert.equal(f.context.resumes, 0);
  f.audio.unlock();
  assert.equal(f.context.resumes, 1);
  await settle();
  assert.deepEqual(f.requests, [AUDIO_FILES.ambient, AUDIO_FILES.focus]);
  assert.equal(f.audio.getSnapshot().state, "playing");
  assert.ok(
    f.sources.every((s) => s.loop && s.loopEnd === 90 && s.started === 1),
  );
  for (let i = 0; i < 20; i++) {
    f.audio.unlock();
    f.audio.setFocusing(i % 2 === 0);
  }
  assert.equal(f.sources.length, 2);
  assert.equal(f.gains[1].gain.events.at(-1)[2], 12.8);
  f.audio.dispose();
  assert.ok(f.sources.every((s) => s.stopped === 1));
  assert.ok(f.context.closed);
});

test("로드 중 음소거·모드·볼륨 경합은 이전 모드나 소리를 부활시키지 않는다", async () => {
  const f = fixture({ delayed: true });
  f.audio.unlock();
  f.audio.setFocusing(true);
  f.audio.toggle();
  f.audio.setVolume(9);
  f.release();
  await settle();
  assert.equal(f.audio.getSnapshot().state, "muted");
  assert.equal(f.audio.getSnapshot().mode, "focus");
  assert.equal(f.audio.getSnapshot().volume, 1);
  assert.equal(f.gains[0].gain.value, 0);
  assert.equal(f.gains[1].gain.value, 0);
  assert.equal(f.gains[2].gain.value, 1);
  f.audio.unlock();
  assert.equal(f.context.resumes, 1);
  f.audio.toggle();
  await settle();
  assert.equal(f.audio.getSnapshot().state, "playing");
  assert.equal(f.sources.length, 2);
  f.audio.setVolume(-2);
  assert.equal(f.audio.getSnapshot().state, "muted");
  f.audio.setVolume(NaN);
  assert.equal(f.audio.getSnapshot().volume, 0);
  f.audio.dispose();
});

test("저장한 음소거는 일반 gesture로 해제되지 않는다", () => {
  const f = fixture({ stored: '{"enabled":false,"volume":0.2}' });
  f.audio.unlock();
  f.audio.setFocusing(true);
  assert.equal(f.audio.getSnapshot().state, "muted");
  assert.equal(f.context.resumes, 0);
  f.audio.dispose();
});

test("resume 및 AAC 디코드 오류를 노출한다", async () => {
  for (const options of [{ failResume: true }, { failDecode: true }]) {
    const f = fixture(options);
    f.audio.unlock();
    await settle();
    assert.equal(f.audio.getSnapshot().state, "error");
    assert.ok(f.audio.getSnapshot().error);
    f.audio.dispose();
  }
});

test("unmount 뒤 늦게 끝난 로드는 source를 시작하지 않는다", async () => {
  const f = fixture({ delayed: true });
  f.audio.unlock();
  f.audio.dispose();
  f.release();
  await settle();
  assert.equal(f.sources.length, 0);
});
