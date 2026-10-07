import assert from 'node:assert/strict';
import { MAP_FILES, syncMapAssets, type MapFs } from '@/services/mapAssets';
import { sha256Hex } from '@/utils/sha256';

// 메모리 파일시스템 — 파일은 Map, 디렉터리는 Set. renameDir 은 접두사 치환(원자 교체 흉내).
function memFs() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const enc = new TextEncoder(),
    dec = new TextDecoder();
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/'));
  const mk = (p: string) => {
    for (let q = p; q; q = parent(q)) dirs.add(q);
  };
  const fs: MapFs = {
    uri: (p) => `file:///cache/${p}`,
    exists: (p) => files.has(p) || dirs.has(p),
    readText: (p) => dec.decode(files.get(p) ?? assert.fail(`no file ${p}`)),
    readBytes: (p) => files.get(p) ?? assert.fail(`no file ${p}`),
    writeText: (p, t) => fs.writeBytes(p, enc.encode(t)),
    writeBytes(p, b) {
      mk(parent(p));
      files.set(p, b);
    },
    mkdir: mk,
    remove(p) {
      dirs.delete(p);
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
      for (const d of [...dirs]) if (d.startsWith(`${p}/`)) dirs.delete(d);
    },
    list: (p) => [
      ...new Set(
        [...files.keys(), ...dirs]
          .filter((k) => k.startsWith(`${p}/`))
          .map((k) => k.slice(p.length + 1).split('/')[0]),
      ),
    ],
    renameDir(p, newName) {
      const to = `${parent(p)}/${newName}`;
      for (const [k, v] of [...files])
        if (k.startsWith(`${p}/`)) {
          files.delete(k);
          files.set(to + k.slice(p.length), v);
        }
      for (const d of [...dirs])
        if (d === p || d.startsWith(`${p}/`)) {
          dirs.delete(d);
          dirs.add(to + d.slice(p.length));
        }
    },
  };
  return { fs, files, dirs };
}

// 가짜 서버: 버전별 파일 내용을 갖고 manifest/ETag/304 를 흉내 낸다. 요청 로그를 남긴다.
function fakeServer(version = 1, tag = 'a') {
  const state = {
    version,
    tag,
    failManifest: false,
    failTileset: false,
    failLayout: false,
    corrupt: 0,
  };
  const log: string[] = [];
  const body = (name: string) =>
    new TextEncoder().encode(
      name.endsWith('.png')
        ? `png-${name}-${state.version}-${state.tag}`
        : JSON.stringify({ name, tag: state.tag }),
    );
  const manifest = () =>
    JSON.stringify({
      mapId: 'home',
      mapVersion: state.version,
      files: Object.fromEntries(
        MAP_FILES.map((n) => [
          n,
          { path: `v${state.version}/${n}`, sha256: sha256Hex(body(n)), bytes: body(n).length },
        ]),
      ),
    });
  const etag = () => `"${sha256Hex(new TextEncoder().encode(manifest())).slice(0, 16)}"`;
  const fetchFn = (async (input: string, init?: { headers?: Record<string, string> }) => {
    const path = new URL(input).pathname.replace('/static/maps/home/', '');
    log.push(path);
    const res = (
      status: number,
      data?: Uint8Array | string,
      headers: Record<string, string> = {},
    ) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => headers[k] ?? null },
      json: async () => JSON.parse(data as string),
      arrayBuffer: async () => (data as Uint8Array).slice().buffer,
    });
    if (path === 'manifest.json') {
      if (state.failManifest) return res(500);
      if (init?.headers?.['If-None-Match'] === etag()) return res(304);
      return res(200, manifest(), { ETag: etag() });
    }
    const name = path.replace(/^v\d+\//, '');
    if (name === 'tileset@2x.png' ? state.failTileset : state.failLayout) return res(500);
    const data = body(name);
    if (state.corrupt > 0) {
      state.corrupt--;
      return res(200, new Uint8Array(data.length)); // 내용이 깨진 응답
    }
    return res(200, data);
  }) as unknown as typeof fetch;
  return { state, log, fetchFn };
}

const opts = (fs: MapFs, fetchFn: typeof fetch) => ({
  fs,
  fetch: fetchFn,
  baseUrl: 'http://x',
  now: () => 1,
});
const downloads = (log: string[]) => log.filter((p) => p !== 'manifest.json');
const assertIntact = (fs: MapFs, src: Awaited<ReturnType<typeof syncMapAssets>>) => {
  if (src.kind === 'cache') for (const n of MAP_FILES) assert.ok(fs.exists(`${src.path}/${n}`), n);
};

test('(a) 콜드 스타트: manifest + 6파일 다운로드, 활성 = cache v1, 임시 디렉터리 없음', async () => {
  const { fs, dirs } = memFs();
  const srv = fakeServer();
  const src = await syncMapAssets('home', opts(fs, srv.fetchFn));
  assert.equal(src.kind, 'cache');
  assert.equal(src.kind === 'cache' && src.mapVersion, 1);
  assert.equal(downloads(srv.log).length, 6);
  assertIntact(fs, src);
  assert.deepEqual(
    [...dirs].filter((d) => d.includes('tmp-')),
    [],
  );
});

test('(b) 두 번째 실행: manifest 304 한 번, 파일 다운로드 0건', async () => {
  const { fs } = memFs();
  const srv = fakeServer();
  await syncMapAssets('home', opts(fs, srv.fetchFn));
  srv.log.length = 0;
  const src = await syncMapAssets('home', opts(fs, srv.fetchFn));
  assert.equal(src.kind, 'cache');
  assert.deepEqual(srv.log, ['manifest.json']);
});

test('(b2) 일부 파일만 바뀐 새 버전: 바뀐 파일만 받고 나머지는 이전 버전에서 복사', async () => {
  const { fs } = memFs();
  const srv = fakeServer();
  await syncMapAssets('home', opts(fs, srv.fetchFn));
  srv.log.length = 0;

  srv.state.version = 2;
  const src = await syncMapAssets('home', opts(fs, srv.fetchFn));
  assert.equal(src.kind === 'cache' && src.mapVersion, 2);
  assert.deepEqual(downloads(srv.log), ['v2/tileset@2x.png']); // 타일셋만 바뀜
});

test('(c) sha256 불일치 → 버리고 1회 재시도로 성공, 재시도도 깨지면 이전 버전 유지', async () => {
  const a = memFs();
  const s1 = fakeServer();
  s1.state.corrupt = 1; // 첫 응답만 깨짐
  const ok = await syncMapAssets('home', opts(a.fs, s1.fetchFn));
  assert.equal(ok.kind, 'cache');
  assert.equal(downloads(s1.log).length, 7); // 6 + 재시도 1

  s1.state.version = 2;
  s1.state.corrupt = 2; // 같은 파일이 두 번 연속 깨짐
  const kept = await syncMapAssets('home', opts(a.fs, s1.fetchFn));
  assert.equal(kept.kind === 'cache' && kept.mapVersion, 1);
  assertIntact(a.fs, kept);
  assert.deepEqual(
    a.fs.list('maps/home').filter((n) => n.startsWith('tmp-')),
    [],
  );
  assert.equal(a.fs.exists('maps/home/v2'), false);
});

test('(d) 실패 토글 8조합: 항상 bundle 또는 온전한 cache, 반쪽 버전 디렉터리 없음', async () => {
  for (let mask = 0; mask < 8; mask++) {
    const { fs } = memFs();
    const srv = fakeServer();
    Object.assign(srv.state, {
      failManifest: !!(mask & 1),
      failTileset: !!(mask & 2),
      failLayout: !!(mask & 4),
    });
    const src = await syncMapAssets('home', opts(fs, srv.fetchFn));
    assert.equal(src.kind, mask === 0 ? 'cache' : 'bundle', `mask=${mask}`);
    assertIntact(fs, src);
    assert.deepEqual(
      fs.list('maps/home').filter((n) => n !== 'state.json' && n !== 'v1'),
      [],
      `mask=${mask}`,
    );
    if (mask !== 0) assert.equal(fs.exists('maps/home/v1'), false, `mask=${mask}`);
  }
});

test('(d2) 캐시가 있는 상태에서 8조합: 실패하면 이전 cache v1 을 그대로 돌려준다(layout 만 실패는 재사용으로 성공)', async () => {
  for (let mask = 1; mask < 8; mask++) {
    const { fs } = memFs();
    const srv = fakeServer();
    await syncMapAssets('home', opts(fs, srv.fetchFn));
    srv.state.version = 2;
    Object.assign(srv.state, {
      failManifest: !!(mask & 1),
      failTileset: !!(mask & 2),
      failLayout: !!(mask & 4),
    });
    const src = await syncMapAssets('home', opts(fs, srv.fetchFn));
    // layout 만 실패(mask 4)면 v2 의 layout 은 v1 과 같아 다시 받지 않으므로 성공한다
    assert.equal(src.kind === 'cache' && src.mapVersion, mask === 4 ? 2 : 1, `mask=${mask}`);
    assertIntact(fs, src);
  }
});

test('(e) 3번째 mapVersion 도착 시 가장 오래된 디렉터리 삭제 — 최근 2개만 보관', async () => {
  const { fs } = memFs();
  const srv = fakeServer();
  for (const v of [1, 2, 3]) {
    srv.state.version = v;
    await syncMapAssets('home', opts(fs, srv.fetchFn));
  }
  assert.deepEqual(
    fs
      .list('maps/home')
      .filter((n) => /^v\d+$/.test(n))
      .sort(),
    ['v2', 'v3'],
  );
});

test('(f) 서버 없음(fetch reject) → bundle, 비활성(baseUrl 빈 값)도 bundle', async () => {
  const { fs } = memFs();
  const down = (async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;
  assert.deepEqual(await syncMapAssets('home', opts(fs, down)), { kind: 'bundle' });
  assert.deepEqual(await syncMapAssets('home', { fs, fetch: down, baseUrl: '' }), {
    kind: 'bundle',
  });
});
