jest.mock('./nativeAdapter', () => ({ nativePort: () => null }));
import { AssetRepository } from './repository';
import { ChannelClient } from './channelClient';
import { AssetPort } from './nativeAdapter';
import { canonical, digest, parseManifest } from './contracts';
import { POLICY } from './policy';
function fixture() {
  let now = 1000000000;
  const files = new Map<string, string>();
  let generation = 1,
    release = 'release1',
    body = 'image-one',
    requests = 0,
    downloads = 0,
    fail = false,
    failSnapshot = false,
    free = 1024 ** 3;
  const root = 'file:///cache/image-cdn/v1';
  let extras: Record<string, any> = {};
  const manifest = () => {
    const sha = digest(body);
    const entry = {
      path: `assets/${sha}.png`,
      sha256: sha,
      bytes: body.length,
      mediaType: 'image/png',
      width: 1,
      height: 1,
    };
    const assets = { background: entry };
    return {
      schemaVersion: 1,
      assetApiVersion: 1,
      releaseId: release,
      packs: { 'interior-hall': { version: digest(canonical(assets)), files: assets }, ...extras },
    };
  };
  const fetcher = jest.fn(async (url: string, options?: RequestInit) => {
    requests++;
    const m = canonical(manifest());
    if (url.includes('/channels/')) {
      if (
        options?.headers &&
        'If-None-Match' in options.headers &&
        (options.headers as any)['If-None-Match'] === `etag${generation}`
      )
        return { status: 304, ok: false, url, headers: new Headers(), text: async () => '' };
      return {
        status: 200,
        ok: true,
        url,
        headers: new Headers({ ETag: `etag${generation}` }),
        text: async () =>
          JSON.stringify({
            schemaVersion: 1,
            assetApiVersion: 1,
            generation,
            releaseId: release,
            manifestPath: `releases/${release}/manifest.json`,
            manifestSha256: digest(m),
            manifestBytes: m.length,
          }),
      };
    }
    return { status: 200, ok: true, url, headers: new Headers(), text: async () => m };
  }) as unknown as typeof fetch;
  const port: AssetPort = {
    root,
    list: async () => [...files].map(([uri, text]) => ({ uri, bytes: text.length })),
    read: async (uri) => {
      if (!files.has(uri)) throw Error('missing');
      return files.get(uri)!;
    },
    remove: async (uri) => {
      files.delete(uri);
    },
    free: async () => free,
    inspect: async (uri) => {
      const text = files.get(uri);
      if (text === undefined) throw Error('missing');
      return { bytes: text.length, sha256: digest(text) };
    },
    download: async (opts) => {
      downloads++;
      if (fail) throw Error('network');
      const uri = `${root}/staging/${opts.jobId}.partial`;
      files.set(uri, body);
      return { uri, bytes: body.length, sha256: digest(body) };
    },
    publish: async (uri, sha) => {
      const to = `${root}/objects/${sha}.png`;
      files.set(to, files.get(uri)!);
      files.delete(uri);
      return to;
    },
    snapshot: async (seq, payload) => {
      if (failSnapshot) throw Error('write');
      const sha = digest(payload),
        uri = `${root}/indexes/${seq}.${sha}.json`;
      files.set(uri, payload);
      return { uri, sha256: sha };
    },
    decode: async () => {},
  };
  const create = () =>
    new AssetRepository(
      port,
      new ChannelClient('https://cdn.example', 'dev', fetcher),
      'dev',
      () => now,
    );
  return {
    files,
    port,
    manifest,
    create,
    root,
    fetcher,
    advance: (n: number) => {
      now += n;
    },
    set: (options: {
      body?: string;
      generation?: number;
      release?: string;
      fail?: boolean;
      failSnapshot?: boolean;
      free?: number;
      extras?: Record<string, any>;
    }) => {
      body = options.body ?? body;
      generation = options.generation ?? generation;
      release = options.release ?? release;
      fail = options.fail ?? fail;
      failSnapshot = options.failSnapshot ?? failSnapshot;
      free = options.free ?? free;
      extras = options.extras ?? extras;
    },
    counts: () => ({ requests, downloads }),
  };
}
test('첫 수신 후 재방문은 본문 0회, 6시간 경계는 채널만 확인한다', async () => {
  const f = fixture(),
    r = f.create();
  expect((await r.ensurePack('interior-hall')).status).toBe('ready');
  expect(f.counts().downloads).toBe(1);
  const lease = await r.acquirePack('interior-hall');
  expect(lease?.assets.background.uri).toContain('/objects/');
  lease?.release();
  await r.ensurePack('interior-hall');
  expect(f.counts()).toEqual({ requests: 2, downloads: 1 });
  f.advance(POLICY.channelAge);
  await r.onForeground();
  expect(f.counts()).toEqual({ requests: 3, downloads: 1 });
});
test('버전 교체 후 열린 lease는 유지하고 손상 활성 파일은 직전 정상본으로 복구한다', async () => {
  const f = fixture(),
    r = f.create();
  await r.ensurePack('interior-hall');
  const first = (await r.acquirePack('interior-hall'))!;
  f.set({ body: 'image-two', generation: 2, release: 'release2' });
  f.advance(POLICY.channelAge);
  await r.ensurePack('interior-hall');
  const second = (await r.acquirePack('interior-hall'))!;
  expect(second.version).not.toBe(first.version);
  expect(first.assets.background.uri).not.toBe(second.assets.background.uri);
  f.files.set(second.assets.background.uri, 'corrupt');
  const recovered = await f.create().acquirePack('interior-hall');
  expect(recovered?.version).toBe(first.version);
});
test('최신 snapshot 손상은 직전 정상본 복구, 손상 seq보다 큰 번호로 기록한다', async () => {
  const f = fixture(),
    r = f.create();
  await r.ensurePack('interior-hall');
  await r.acquirePack('interior-hall');
  const latest = [...f.files.keys()]
    .filter((k) => k.includes('/indexes/'))
    .sort(
      (a, b) =>
        Number(b.split('/').pop()!.split('.')[0]) - Number(a.split('/').pop()!.split('.')[0]),
    )[0];
  f.files.set(latest, 'broken');
  f.files.set(`${f.root}/indexes/999.${'a'.repeat(64)}.json`, 'broken');
  const recovered = f.create();
  expect(await recovered.acquirePack('interior-hall')).not.toBeNull();
  expect([...f.files.keys()].some((k) => k.includes('/indexes/1000.'))).toBe(true);
});
test('실패 백오프는 채널 성공과 분리되고 만료 때 6시간 이내 롤백을 발견한다', async () => {
  const f = fixture(),
    r = f.create();
  f.set({ fail: true });
  expect((await r.ensurePack('interior-hall')).status).toBe('failed');
  expect(f.counts().downloads).toBe(2);
  expect(await r.ensurePack('interior-hall')).toEqual({ status: 'deferred', reason: 'backoff' });
  f.advance(60000);
  f.set({ fail: false, generation: 2, release: 'rollback', body: 'restored' });
  expect((await r.ensurePack('interior-hall')).status).toBe('ready');
  expect(f.counts().requests).toBe(4);
});
test('동시 ensure와 공유 SHA는 한 번만 수신한다', async () => {
  const f = fixture();
  const p = f.manifest().packs['interior-hall'];
  f.set({ extras: { other: p } });
  const r = f.create();
  const result = await Promise.all([
    r.ensurePack('interior-hall'),
    r.ensurePack('interior-hall'),
    r.ensurePack('other'),
  ]);
  expect(result.every((x) => x.status === 'ready')).toBe(true);
  expect(f.counts().downloads).toBe(1);
});
test('여유 공간 부족은 수신 전에 보류하고 snapshot 쓰기 실패로 기존 팩을 잃지 않는다', async () => {
  const f = fixture(),
    r = f.create();
  await r.ensurePack('interior-hall');
  const old = (await r.acquirePack('interior-hall'))!;
  f.set({ body: 'new-image', generation: 2, free: POLICY.freeBytes });
  f.advance(POLICY.channelAge);
  expect(await r.ensurePack('interior-hall')).toEqual({ status: 'deferred', reason: 'space' });
  expect(f.counts().downloads).toBe(1);
  f.set({ failSnapshot: true });
  expect((await r.acquirePack('interior-hall'))?.version).toBe(old.version);
});
test('30일 정리는 lease를 보존하고 해제 후 정리한다', async () => {
  const f = fixture(),
    r = f.create();
  await r.ensurePack('interior-hall');
  const lease = (await r.acquirePack('interior-hall'))!;
  f.advance(POLICY.unusedAge);
  await r.collect();
  expect(f.files.has(lease.assets.background.uri)).toBe(true);
  lease.release();
  f.advance(POLICY.collectAge);
  await r.collect();
  expect(f.files.has(lease.assets.background.uri)).toBe(false);
  expect(await r.acquirePack('interior-hall')).toBeNull();
});
test('디코드 불량 SHA는 재시작 이후에도 다시 활성화하지 않는다', async () => {
  const f = fixture(),
    r = f.create();
  await r.ensurePack('interior-hall');
  const lease = (await r.acquirePack('interior-hall'))!;
  await r.reportDecodeFailure(lease);
  expect(await f.create().acquirePack('interior-hall')).toBeNull();
  expect(await r.ensurePack('interior-hall')).toEqual({ status: 'failed', reason: 'decode' });
});
test('manifest 경로 탈출과 파일 한도 위반을 거부한다', () => {
  const f = fixture();
  const m = f.manifest();
  m.packs['interior-hall'].files.background.path = '../escape.png';
  m.packs['interior-hall'].version = digest(canonical(m.packs['interior-hall'].files));
  expect(() => parseManifest(m)).toThrow('file schema');
});
test('직전 버전은 7일 경계에서 정리하며 새 활성은 유지한다', async () => {
  const f = fixture(),
    r = f.create();
  await r.ensurePack('interior-hall');
  const old = (await r.acquirePack('interior-hall'))!;
  old.release();
  f.set({ body: 'image-two', generation: 2 });
  f.advance(POLICY.channelAge);
  await r.ensurePack('interior-hall');
  f.advance(POLICY.previousAge - 1);
  await r.collect();
  expect(f.files.has(old.assets.background.uri)).toBe(true);
  f.advance(POLICY.collectAge);
  await r.collect();
  expect(f.files.has(old.assets.background.uri)).toBe(false);
  expect(await r.acquirePack('interior-hall')).not.toBeNull();
});
test('객체 예산 248MiB를 넘는 다운로드는 여유 디스크가 커도 거부한다', async () => {
  const f = fixture();
  const list = f.port.list;
  f.port.list = async () => [
    ...(await list()),
    { uri: `${f.root}/staging/undeletable.partial`, bytes: POLICY.imageBytes },
  ];
  const r = f.create();
  expect(await r.ensurePack('interior-hall')).toEqual({ status: 'deferred', reason: 'space' });
  expect(f.counts().downloads).toBe(0);
});
test('디코드 실패의 staging은 같은 실행에서 정리한다', async () => {
  const f = fixture();
  f.port.decode = async () => {
    throw Error('decode');
  };
  const r = f.create();
  expect((await r.ensurePack('interior-hall')).status).toBe('failed');
  expect([...f.files.keys()].some((uri) => uri.includes('/staging/'))).toBe(false);
});
test('시계 역행은 채널 재확인을 한 번 허용한다', async () => {
  const f = fixture(),
    r = f.create();
  await r.ensurePack('interior-hall');
  f.advance(-1000);
  await r.onForeground();
  expect(f.counts().requests).toBe(3);
  await r.onForeground();
  expect(f.counts().requests).toBe(3);
});
test('네이티브 404 code는 메시지에 숫자가 없어도 추가 다운로드하지 않는다', async () => {
  const f = fixture();
  const download = jest.fn(async () => {
    throw Object.assign(Error('not found'), { code: 'E_HTTP_404' });
  });
  f.port.download = download;
  const r = f.create();
  expect((await r.ensurePack('interior-hall')).status).toBe('failed');
  expect(download).toHaveBeenCalledTimes(1);
});
test('같은 SHA 경로의 손상 객체는 재다운로드로 복구하되 열린 lease 동안 교체하지 않는다', async () => {
  const f = fixture(),
    r = f.create();
  await r.ensurePack('interior-hall');
  const lease = (await r.acquirePack('interior-hall'))!;
  f.files.set(lease.assets.background.uri, 'corrupt');
  expect((await r.ensurePack('interior-hall')).status).toBe('failed');
  expect(f.files.get(lease.assets.background.uri)).toBe('corrupt');
  lease.release();
  f.advance(60000);
  expect((await r.ensurePack('interior-hall')).status).toBe('ready');
  expect(f.files.get(lease.assets.background.uri)).toBe('image-one');
});
test('서로 다른 팩의 다운로드는 최대 2개, 디코드 검사는 1개씩 실행한다', async () => {
  const f = fixture();
  const content = new Map<string, string>();
  const packs: Record<string, any> = {};
  for (const [id, body] of [
    ['other1', 'image-two'],
    ['other2', 'image-three'],
  ]) {
    f.set({ body });
    packs[id] = f.manifest().packs['interior-hall'];
    content.set(digest(body), body);
  }
  f.set({ body: 'image-one', extras: packs });
  content.set(digest('image-one'), 'image-one');
  let downloads = 0,
    maxDownloads = 0,
    decodes = 0,
    maxDecodes = 0;
  f.port.download = async (options) => {
    downloads++;
    maxDownloads = Math.max(maxDownloads, downloads);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const body = content.get(options.expectedSha256)!;
    const uri = `${f.root}/staging/${options.jobId}.partial`;
    f.files.set(uri, body);
    downloads--;
    return { uri, bytes: body.length, sha256: digest(body) };
  };
  f.port.decode = async () => {
    decodes++;
    maxDecodes = Math.max(maxDecodes, decodes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    decodes--;
  };
  const r = f.create();
  const results = await Promise.all(
    ['interior-hall', 'other1', 'other2'].map((id) => r.ensurePack(id)),
  );
  expect(results.every((result) => result.status === 'ready')).toBe(true);
  expect(maxDownloads).toBeLessThanOrEqual(2);
  expect(maxDecodes).toBe(1);
});
test('동일 활성 버전 재방문은 직전 정상본을 지우거나 보존 시각을 연장하지 않는다', async () => {
  const f = fixture(),
    r = f.create();
  await r.ensurePack('interior-hall');
  const old = (await r.acquirePack('interior-hall'))!;
  old.release();
  f.set({ body: 'image-two', generation: 2 });
  f.advance(POLICY.channelAge);
  await r.ensurePack('interior-hall');
  await r.ensurePack('interior-hall');
  const current = (await r.acquirePack('interior-hall'))!;
  current.release();
  f.files.set(current.assets.background.uri, 'corrupt');
  expect((await f.create().acquirePack('interior-hall'))?.version).toBe(old.version);
});
test('GC 삭제와 ensure가 경합해도 존재하는 완성 객체만 활성화한다', async () => {
  const f = fixture(),
    r = f.create();
  await r.ensurePack('interior-hall');
  f.advance(POLICY.unusedAge);
  const remove = f.port.remove;
  let entered!: () => void, proceed!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  f.port.remove = async (uri) => {
    if (uri.includes('/objects/')) {
      entered();
      await gate;
    }
    await remove(uri);
  };
  const collection = r.collect();
  await enteredPromise;
  const ensure = r.ensurePack('interior-hall');
  proceed();
  await collection;
  expect((await ensure).status).toBe('ready');
  const lease = await r.acquirePack('interior-hall');
  expect(lease).not.toBeNull();
  expect(f.files.has(lease!.assets.background.uri)).toBe(true);
});

test('이전 버전 수신 실패는 새 버전 성공 후 복귀의 6시간 제한을 우회하지 않는다', async () => {
  const f = fixture(),
    r = f.create();
  f.set({ fail: true });
  expect((await r.ensurePack('interior-hall')).status).toBe('failed');
  f.advance(60000);
  f.set({ fail: false, generation: 2, release: 'release2', body: 'image-two' });
  expect((await r.ensurePack('interior-hall')).status).toBe('ready');
  const requests = f.counts().requests;
  for (let n = 0; n < 3; n++) {
    f.advance(60000);
    await r.onForeground();
  }
  expect(f.counts().requests).toBe(requests);
  const restarted = f.create();
  await restarted.onForeground();
  expect(f.counts().requests).toBe(requests);
  f.advance(POLICY.channelAge);
  await restarted.onForeground();
  expect(f.counts().requests).toBe(requests + 1);
});
