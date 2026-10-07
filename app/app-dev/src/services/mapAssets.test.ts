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
    size: (p) => (files.get(p) ?? assert.fail(`no file ${p}`)).length,
    copy(from, to) {
      mk(parent(to));
      files.set(to, files.get(from) ?? assert.fail(`no file ${from}`));
    },
    move(from, to) {
      files.set(to, files.get(from) ?? assert.fail(`no file ${from}`));
      files.delete(from);
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

// 승격 때 검증을 통과하는 최소 모양 JSON
const VALID_JSON: Record<string, object> = {
  'tileset.json': { columns: 1, tilewidth: 1, tileheight: 1, margin: 0, spacing: 0, scale: 2 },
  'tilemap.json': {
    width: 1,
    tilewidth: 1,
    tileheight: 1,
    layers: [{ name: 'terrain', data: [1] }],
  },
  'nav.json': { columns: 1, rows: 1, walkable: '1', traversalCost: [8] },
  'objects.json': { objects: [] },
  'home.map.json': { imageWidth: 1, imageHeight: 1 },
};

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
        : JSON.stringify({ ...VALID_JSON[name], tag: state.tag }),
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

// 승격·스냅샷 테스트는 MAP_ASSETS_URL 이 켜진 새 모듈 인스턴스(전역 current/pending 격리)에서 돈다.
function freshModule() {
  process.env.EXPO_PUBLIC_MAP_ASSETS_URL = 'http://x';
  let m!: typeof import('@/services/mapAssets');
  jest.isolateModules(() => {
    m = require('@/services/mapAssets');
  });
  return m;
}
const tagOf = (m: ReturnType<typeof freshModule>, src: Parameters<typeof m.readMapJson>[2]) =>
  (m.readMapJson('nav.json', { tag: 'bundle' }, src) as { tag: string }).tag;

test('(g) 스냅샷: 마운트 뒤 전역 승격이 일어나도 이미 받은 소스는 같은 버전으로 읽힌다', async () => {
  const m = freshModule();
  const { fs } = memFs();
  const srv = fakeServer();
  await m.syncMapAssets('home', opts(fs, srv.fetchFn));
  const s1 = m.promoteMapAssets('home', fs); // 화면 A 마운트
  srv.state.version = 2;
  srv.state.tag = 'b';
  await m.syncMapAssets('home', opts(fs, srv.fetchFn));
  const s2 = m.promoteMapAssets('home', fs); // 화면 B 마운트(= 전역 승격)
  assert.equal(s2.kind === 'cache' && s2.mapVersion, 2);
  // A 의 렌더러(tileset/tilemap)·nav·layout 읽기는 모두 s1 인자로 v1 을 본다
  for (const n of ['tileset.json', 'tilemap.json', 'nav.json', 'home.map.json'] as const)
    assert.equal((m.readMapJson(n, { tag: 'x' }, s1) as { tag: string }).tag, 'a', n);
  assert.equal(tagOf(m, s2), 'b');
  assert.ok(m.tilesetUri(s1)?.includes('/v1/'));
  assert.ok(m.tilesetUri(s2)?.includes('/v2/'));
});

test('(h) JSON 하나라도 깨지면 소스 전체가 번들 — 새 버전이 깨지면 기존 활성 유지', async () => {
  const m = freshModule();
  const { fs } = memFs();
  const srv = fakeServer();
  await m.syncMapAssets('home', opts(fs, srv.fetchFn));
  fs.writeText('maps/home/v1/tilemap.json', '{"layers": 1}'); // 모양이 틀린 JSON
  assert.deepEqual(m.promoteMapAssets('home', fs), { kind: 'bundle' });
  assert.equal(fs.exists('maps/home/v1'), false); // 깨진 버전은 지워 다음 sync 가 다시 받는다

  const n = freshModule();
  const b = memFs();
  await n.syncMapAssets('home', opts(b.fs, srv.fetchFn));
  assert.equal(n.promoteMapAssets('home', b.fs).kind, 'cache');
  srv.state.version = 2;
  await n.syncMapAssets('home', opts(b.fs, srv.fetchFn));
  b.fs.writeText('maps/home/v2/nav.json', '{');
  const kept = n.promoteMapAssets('home', b.fs);
  assert.equal(kept.kind === 'cache' && kept.mapVersion, 1);
});

test('(i) 부팅 시 파일 크기가 state 기록과 다르면 번들, demoteToBundle 은 current 를 번들로', async () => {
  const m = freshModule();
  const a = memFs();
  const srv = fakeServer();
  await m.syncMapAssets('home', opts(a.fs, srv.fetchFn));
  a.fs.writeBytes('maps/home/v1/tileset@2x.png', new Uint8Array(3)); // 반쯤 쓰인 파일
  assert.deepEqual(freshModule().getActiveMapAssets('home', a.fs), { kind: 'bundle' });

  const b = memFs();
  await m.syncMapAssets('home', opts(b.fs, srv.fetchFn));
  assert.equal(m.promoteMapAssets('home', b.fs).kind, 'cache');
  m.demoteToBundle('home');
  assert.deepEqual(m.getActiveMapAssets('home', b.fs), { kind: 'bundle' });
});

test('(j) state.json 은 .tmp 를 거쳐 쓰고, 보관은 이전 활성 + 새 활성 둘뿐', async () => {
  const { fs } = memFs();
  const srv = fakeServer();
  for (const v of [1, 2, 3]) {
    srv.state.version = v;
    await syncMapAssets('home', opts(fs, srv.fetchFn));
  }
  assert.equal(fs.exists('maps/home/state.json.tmp'), false);
  assert.ok(fs.exists('maps/home/state.json'));
  assert.deepEqual(
    fs
      .list('maps/home')
      .filter((n) => /^v\d+$/.test(n))
      .sort(),
    ['v2', 'v3'],
  );
});
