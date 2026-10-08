/**
 * 맵 에셋(타일셋·nav·배치 JSON) 캐시 동기화 (GROMO-2233).
 *
 * 계약: docs/prd/fishcat/island-movement/map-assets.md §3(manifest·URL·캐시 헤더)·§5(로딩 순서·원자 교체·폴백).
 *   GET {EXPO_PUBLIC_MAP_ASSETS_URL}/static/maps/<mapId>/manifest.json   (ETag, 304)
 *   GET {EXPO_PUBLIC_MAP_ASSETS_URL}/static/maps/<mapId>/<manifest.files[*].path>
 *
 * 순서: manifest(ETag 304 면 끝) → 디스크 해시와 비교 → 바뀐 파일만 임시 디렉터리로 내려받고 sha256 재검증
 * (불일치면 버리고 1회 재시도) → 전부 준비되면 임시 디렉터리를 `v<n>` 으로 rename(원자 교체) → state.json 갱신.
 * 어느 단계가 실패해도 이전 활성 버전(없으면 번들)을 돌려준다 — 반쯤 받은 상태는 렌더러에 보이지 않는다.
 *
 * 디스크 레이아웃(Paths.cache 아래): maps/<mapId>/{state.json, v<n>/<6 files>, tmp-<n>-<t>/(진행 중)}.
 * 이전 활성 + 새 활성 두 버전만 보관한다(롤백 안전). state.json 은 .tmp 에 쓰고 rename 으로 교체한다.
 *
 * 스냅샷: 화면(FinalIsland)이 마운트 때 {@link promoteMapAssets} 로 받은 {@link MapAssetSource} 한 값을
 * 렌더러(타일셋 이미지·tilemap)·nav·layout 에 인자로 내려준다. 전역 current 는 「다음 마운트가 쓸 값」일 뿐이라
 * 마운트 중에 승격이 일어나도 그 화면의 세 곳은 같은 버전이다. 승격 시점에 캐시 JSON 5종을 한 번에 파싱·검증하고,
 * 하나라도 깨졌으면 소스 전체를 번들로 둔다(파일 단위 혼합 금지).
 *
 * 나쁜 해시 표식(state.bad): 캐시 PNG 디코드 실패나 승격 때 JSON 검증 실패가 나면 그 파일의 sha256 을 state.json 의
 * `bad`(파일명 → sha256) 에 남긴다. 표식이 걸린 버전은 부팅(sourceFromState)에서 쓰지 않고, sync 는 manifest 가
 * 같은 해시를 또 내려주면 그 버전을 채택하지 않는다 — 영구 손상 에셋으로 매 홈 진입 「빈 화면 → 강등」이 반복되지
 * 않는다. 해시가 바뀐 새 버전이 채택되면 state 가 새로 쓰여 `bad` 는 사라진다.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { sha256Hex } from '@/utils/sha256';

export const MAP_ASSETS_URL = process.env.EXPO_PUBLIC_MAP_ASSETS_URL ?? '';

export const MAP_FILES = [
  'tileset@2x.png',
  'tileset.json',
  'tilemap.json',
  'nav.json',
  'home.map.json',
] as const;
type MapFileName = (typeof MAP_FILES)[number];

export type MapAssetSource =
  | { kind: 'bundle' }
  // dir: 버전 디렉터리의 file:// URI, path: 파일시스템 추상 기준 상대 경로
  | { kind: 'cache'; mapVersion: number; dir: string; path: string };

const BUNDLE: MapAssetSource = { kind: 'bundle' };

/** 테스트 주입용 최소 동기 파일시스템. 경로는 캐시 루트 기준 `a/b/c`. */
export interface MapFs {
  uri(path: string): string;
  exists(path: string): boolean;
  readText(path: string): string;
  readBytes(path: string): Uint8Array;
  writeText(path: string, text: string): void;
  writeBytes(path: string, bytes: Uint8Array): void; // 상위 디렉터리를 만든다
  mkdir(path: string): void;
  remove(path: string): void; // 파일/디렉터리(재귀), 없으면 무시
  list(path: string): string[]; // 자식 이름, 없으면 []
  size(path: string): number; // 파일 바이트 수
  copy(from: string, to: string): void; // 네이티브 파일 복사(JS 로 읽었다 쓰지 않는다). 상위 디렉터리는 있어야 한다
  move(from: string, to: string): void; // 파일 이동, 대상이 있으면 덮어쓴다(state.json 교체용)
  renameDir(path: string, newName: string): void; // 같은 부모 안에서의 이름 변경 = 원자 교체
}

const seg = (p: string) => p.split('/');
export const expoMapFs: MapFs = {
  uri: (p) => new File(Paths.cache, ...seg(p)).uri,
  exists: (p) =>
    new File(Paths.cache, ...seg(p)).exists || new Directory(Paths.cache, ...seg(p)).exists,
  readText: (p) => new File(Paths.cache, ...seg(p)).textSync(),
  readBytes: (p) => new File(Paths.cache, ...seg(p)).bytesSync(),
  writeText(p, text) {
    const f = new File(Paths.cache, ...seg(p));
    f.create({ overwrite: true, intermediates: true });
    f.write(text);
  },
  writeBytes(p, bytes) {
    const f = new File(Paths.cache, ...seg(p));
    f.create({ overwrite: true, intermediates: true });
    f.write(bytes);
  },
  mkdir: (p) =>
    new Directory(Paths.cache, ...seg(p)).create({ intermediates: true, idempotent: true }),
  remove(p) {
    const d = new Directory(Paths.cache, ...seg(p));
    if (d.exists) return d.delete();
    const f = new File(Paths.cache, ...seg(p));
    if (f.exists) f.delete();
  },
  list: (p) => {
    const d = new Directory(Paths.cache, ...seg(p));
    return d.exists ? d.list().map((e) => e.name) : [];
  },
  size: (p) => new File(Paths.cache, ...seg(p)).size,
  copy: (from, to) =>
    new File(Paths.cache, ...seg(from)).copySync(new File(Paths.cache, ...seg(to)), {
      overwrite: true,
    }),
  move: (from, to) =>
    new File(Paths.cache, ...seg(from)).moveSync(new File(Paths.cache, ...seg(to)), {
      overwrite: true,
    }),
  renameDir: (p, newName) => new Directory(Paths.cache, ...seg(p)).rename(newName),
};

type State = {
  mapVersion: number;
  etag: string | null;
  files: Record<string, string>; // 파일명 → sha256
  bytes: Record<string, number>; // 파일명 → 바이트(부팅 때 크기만 대조해 반쯤 쓰인 파일을 거른다)
  bad?: Record<string, string>; // 파일명 → 쓸 수 없다고 판명된 sha256(없으면 표식 없음)
};
type Manifest = {
  mapVersion: number;
  files: Record<MapFileName, { path: string; sha256: string; bytes: number }>;
};

const root = (mapId: string) => `maps/${mapId}`;
const versionPath = (mapId: string, n: number) => `${root(mapId)}/v${n}`;

function readState(fs: MapFs, mapId: string): State | null {
  try {
    const s = JSON.parse(fs.readText(`${root(mapId)}/state.json`));
    return Number.isInteger(s?.mapVersion) && s.files && s.bytes ? s : null;
  } catch {
    return null;
  }
}

/** 활성 버전의 어떤 파일 해시가 bad 표식과 같으면 true. */
const hasBad = (s: State) => Object.entries(s.bad ?? {}).some(([name, h]) => s.files[name] === h);

/**
 * state.json 이 가리키는 버전 디렉터리를 cache 소스로 바꾼다. 판정 순서:
 * 1) state 가 없거나 모양이 틀리면 null  2) 활성 버전의 파일 해시가 bad 에 있으면 null
 * 3) 5개 파일이 모두 있고 크기가 기록과 같을 때만 cache. null 은 호출부가 bundle 로 둔다.
 */
function sourceFromState(fs: MapFs, mapId: string): MapAssetSource | null {
  const s = readState(fs, mapId);
  if (!s || hasBad(s)) return null;
  const path = versionPath(mapId, s.mapVersion);
  if (!MAP_FILES.every((f) => fs.exists(`${path}/${f}`) && fs.size(`${path}/${f}`) === s.bytes[f]))
    return null;
  return { kind: 'cache', mapVersion: s.mapVersion, dir: fs.uri(path), path };
}

function parseManifest(raw: unknown): Manifest {
  const m = raw as Manifest;
  if (!Number.isInteger(m?.mapVersion) || m.mapVersion < 1) throw new Error('manifest: mapVersion');
  for (const name of MAP_FILES) {
    const e = m.files?.[name];
    if (!e || typeof e.path !== 'string' || e.path.startsWith('/') || e.path.includes('..'))
      throw new Error(`manifest: ${name} path`);
    if (!/^[0-9a-f]{64}$/.test(e.sha256) || !Number.isInteger(e.bytes))
      throw new Error(`manifest: ${name} sha256/bytes`);
  }
  return m;
}

export type SyncOpts = {
  fetch?: typeof fetch;
  fs?: MapFs;
  now?: () => number;
  baseUrl?: string; // 테스트용. 기본은 EXPO_PUBLIC_MAP_ASSETS_URL
};

const inflight = new Map<string, Promise<MapAssetSource>>();
const current = new Map<string, MapAssetSource>();
const pending = new Map<string, MapAssetSource>();

type JsonName = Exclude<MapFileName, 'tileset@2x.png'>;
const num = (v: unknown): v is number => typeof v === 'number';
type MapJson = Record<JsonName, any>;
// 렌더러·nav·layout 이 실제로 읽는 필드만 본다 — 번들 JSON 과 같은 모양인지의 최소 검증. [검사 이름, 통과 조건].
const SHAPE: [JsonName, string, (j: MapJson) => boolean][] = [
  [
    'tileset.json',
    'fields',
    (j) =>
      ['columns', 'tilewidth', 'tileheight', 'margin', 'spacing', 'scale'].every((k) =>
        num(j['tileset.json']?.[k]),
      ),
  ],
  ['tileset.json', 'scale > 0', (j) => j['tileset.json'].scale > 0],
  ['tileset.json', 'columns >= 1', (j) => j['tileset.json'].columns >= 1],
  [
    'tilemap.json',
    'fields',
    (j) => {
      const t = j['tilemap.json'];
      return (
        num(t?.width) &&
        num(t.height) &&
        num(t.tilewidth) &&
        num(t.tileheight) &&
        Array.isArray(t.layers) &&
        t.layers.some((l: any) => l?.name === 'terrain' && Array.isArray(l.data))
      );
    },
  ],
  [
    'tilemap.json',
    'terrain.data.length === width*height',
    (j) => {
      const t = j['tilemap.json'];
      return t.layers.find((l: any) => l?.name === 'terrain').data.length === t.width * t.height;
    },
  ],
  [
    'nav.json',
    'fields',
    (j) => {
      const n = j['nav.json'];
      return (
        Number.isInteger(n?.columns) &&
        Number.isInteger(n.rows) &&
        typeof n.walkable === 'string' &&
        Array.isArray(n.traversalCost)
      );
    },
  ],
  [
    'nav.json',
    'columns*rows === walkable.length',
    (j) => j['nav.json'].columns * j['nav.json'].rows === j['nav.json'].walkable.length,
  ],
  [
    'nav.json',
    'columns*rows === traversalCost.length',
    (j) => j['nav.json'].columns * j['nav.json'].rows === j['nav.json'].traversalCost.length,
  ],
  // loadNav 가 비용 0 이하를 throw 하므로(탭 핸들러에서 터짐) 승격 단계에서 걸러 bad 표식으로 번들에 머물게 한다.
  [
    'nav.json',
    'traversalCost 전 셀 > 0',
    (j) => j['nav.json'].traversalCost.every((c: unknown) => typeof c === 'number' && c > 0),
  ],
  [
    'nav.json',
    'buildingCells·blockedEdges 형태(없거나 유효한 셀 index)',
    (j) => {
      const n = j['nav.json'];
      const size = n.columns * n.rows;
      const idx = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < size;
      const cellsOk =
        n.buildingCells === undefined ||
        (typeof n.buildingCells === 'object' &&
          Object.values(n.buildingCells as Record<string, unknown>).every(
            (a) => Array.isArray(a) && a.every(idx),
          ));
      const edgesOk =
        n.blockedEdges === undefined ||
        (Array.isArray(n.blockedEdges) &&
          n.blockedEdges.every((e: unknown) => Array.isArray(e) && e.length === 2 && e.every(idx)));
      return cellsOk && edgesOk;
    },
  ],
  [
    'home.map.json',
    'fields',
    (j) => {
      const h = j['home.map.json'];
      return (
        num(h?.imageWidth) &&
        num(h.imageHeight) &&
        num(h.nav?.columns) &&
        num(h.nav.rows) &&
        num(h.tiles?.columns) &&
        num(h.tiles.rows)
      );
    },
  ],
  // 교차 검증: 파일끼리 어긋난 반쪽 버전(예: nav 만 새것)을 막는다.
  [
    'home.map.json',
    'nav.columns/rows === nav.json',
    (j) =>
      j['home.map.json'].nav.columns === j['nav.json'].columns &&
      j['home.map.json'].nav.rows === j['nav.json'].rows,
  ],
  [
    'home.map.json',
    'tiles.columns*rows === tilemap.width*height',
    (j) =>
      j['home.map.json'].tiles.columns * j['home.map.json'].tiles.rows ===
      j['tilemap.json'].width * j['tilemap.json'].height,
  ],
];

/** 파싱된 JSON 4종을 검사한다. 통과면 null, 실패면 `<파일> <검사>` 메시지. 앞 검사가 실패하면 뒤 검사는 돌지 않는다. */
export function validateMapJson(j: MapJson): string | null {
  for (const [file, check, ok] of SHAPE) {
    let pass = false;
    try {
      pass = ok(j);
    } catch {
      /* 필드가 없어 던진 경우도 실패 */
    }
    if (!pass) return `${file} ${check}`;
  }
  return null;
}
const jsonMemo = new Map<string, unknown>();

/** 캐시 JSON 5종을 한 번에 파싱·검증해 메모에 올린다. 통과면 null, 실패하면 깨진 파일명(→ 호출부가 번들로). */
function loadJson(fs: MapFs, src: Extract<MapAssetSource, { kind: 'cache' }>): JsonName | null {
  const names = MAP_FILES.filter((f): f is JsonName => f !== 'tileset@2x.png');
  const parsed = {} as MapJson;
  for (const name of names) {
    try {
      parsed[name] = JSON.parse(fs.readText(`${src.path}/${name}`));
    } catch {
      return name;
    }
  }
  const why = validateMapJson(parsed);
  if (why) return why.split(' ')[0] as JsonName;
  for (const name of names) jsonMemo.set(`${src.path}/${name}`, parsed[name]);
  return null;
}

/** 실패한 파일의 해시를 state.bad 에 남긴다(그 파일이 활성 state 의 버전일 때만). 실패해도 이번 실행은 번들로 그린다. */
function markBad(fs: MapFs, mapId: string, version: number, name: string) {
  console.warn(`[mapAssets] ${mapId} v${version} ${name} 불량 표식`);
  try {
    const s = readState(fs, mapId);
    if (s && s.mapVersion === version && s.files[name])
      writeState(fs, mapId, { ...s, bad: { ...s.bad, [name]: s.files[name] } });
  } catch {
    /* 표식을 못 남기면 다음 실행에 한 번 더 강등될 뿐 */
  }
}

/** JSON 이 깨진 버전은 bad 표식을 남기고 디렉터리를 지운다. 표식 덕에 같은 해시는 다시 받지 않는다. */
function adopt(fs: MapFs, mapId: string, src: MapAssetSource): MapAssetSource {
  if (src.kind !== 'cache') return src;
  const broken = loadJson(fs, src);
  if (!broken) return src;
  markBad(fs, mapId, src.mapVersion, broken);
  try {
    fs.remove(src.path);
  } catch {
    /* 지우기 실패해도 이번 실행은 번들로 그린다 */
  }
  return BUNDLE;
}

/** 다음 마운트가 쓸 활성 소스(동기). 앱 시작 후 첫 호출에 state.json 을 읽고 JSON 5종을 검증한다. */
export function getActiveMapAssets(mapId = 'home', fs: MapFs = expoMapFs): MapAssetSource {
  if (!MAP_ASSETS_URL) return BUNDLE;
  let src = current.get(mapId);
  if (!src) {
    try {
      src = adopt(fs, mapId, sourceFromState(fs, mapId) ?? BUNDLE);
    } catch {
      src = BUNDLE;
    }
    current.set(mapId, src);
  }
  return src;
}

/**
 * 화면 마운트 때 1회: 백그라운드 sync 가 끝나 있던 새 버전을 올리고 이번 화면의 스냅샷으로 돌려준다.
 * 새 버전의 JSON 이 하나라도 깨졌으면 pending 을 버리고 기존 소스(없으면 번들)를 유지한다.
 */
export function promoteMapAssets(mapId = 'home', fs: MapFs = expoMapFs): MapAssetSource {
  const next = pending.get(mapId);
  pending.delete(mapId);
  if (next) {
    const ok = adopt(fs, mapId, next);
    if (ok.kind === 'cache') current.set(mapId, ok);
  }
  return getActiveMapAssets(mapId, fs);
}

/**
 * 타일셋 PNG 디코드 실패로 캐시 소스 전체를 포기한다: 전역 current 를 번들로 내리고 pending 을 버리며,
 * 활성 버전의 타일셋 해시를 state.bad 에 남긴다. 다음 시작은 즉시 번들이고, 같은 해시의 manifest 는 채택하지 않는다.
 */
export function demoteToBundle(mapId = 'home', fs: MapFs = expoMapFs) {
  const was = current.get(mapId);
  console.warn(`[mapAssets] ${mapId} tileset@2x.png 디코드 실패 — 번들로 강등`);
  current.set(mapId, BUNDLE);
  pending.delete(mapId);
  if (was?.kind === 'cache') markBad(fs, mapId, was.mapVersion, 'tileset@2x.png');
}

/** 스냅샷 소스의 JSON 파일. 번들이거나 캐시에서 못 읽으면 fallback(번들 정적 import). */
export function readMapJson<T>(name: JsonName, fallback: T, src: MapAssetSource): T {
  if (src.kind !== 'cache') return fallback;
  // 같은 객체를 돌려줘야 loadNav 의 WeakMap 캐시가 맞는다
  return (jsonMemo.get(`${src.path}/${name}`) as T | undefined) ?? fallback;
}

/** 스냅샷 소스의 타일셋 이미지: cache 면 file URI, 아니면 null(→ 호출부가 번들 require 사용). */
export function tilesetUri(src: MapAssetSource): string | null {
  return src.kind === 'cache' ? `${src.dir}/tileset@2x.png` : null;
}

/** 서버와 동기화한다. 실패하면 던지지 않고 이전 활성 소스(없으면 bundle)를 돌려준다. 같은 mapId 동시 호출은 합친다. */
export function syncMapAssets(mapId = 'home', opts: SyncOpts = {}): Promise<MapAssetSource> {
  const hit = inflight.get(mapId);
  if (hit) return hit;
  const p = doSync(mapId, opts).finally(() => inflight.delete(mapId));
  inflight.set(mapId, p);
  return p;
}

async function doSync(mapId: string, opts: SyncOpts): Promise<MapAssetSource> {
  const fs = opts.fs ?? expoMapFs;
  const fetchFn = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const baseUrl = (opts.baseUrl ?? MAP_ASSETS_URL).replace(/\/+$/, '');
  if (!baseUrl) return BUNDLE;

  let prevSource: MapAssetSource = BUNDLE;
  let tmp: string | null = null;
  try {
    prevSource = sourceFromState(fs, mapId) ?? BUNDLE;
    const state = readState(fs, mapId);
    // 이전 크래시가 남긴 임시 디렉터리 정리
    for (const name of fs.list(root(mapId)))
      if (name.startsWith('tmp-')) fs.remove(`${root(mapId)}/${name}`);

    const url = `${baseUrl}/static/maps/${mapId}`;
    const res = await fetchFn(`${url}/manifest.json`, {
      headers: {
        'Cache-Control': 'no-cache', // 중간 캐시가 오래된 manifest 를 주지 못하게(서버는 max-age=60)
        ...(prevSource.kind === 'cache' && state?.etag ? { 'If-None-Match': state.etag } : {}),
      },
    });
    if (res.status === 304 && prevSource.kind === 'cache') return remember(mapId, prevSource);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const manifest = parseManifest(await res.json());
    const etag = res.headers.get('ETag');
    const n = manifest.mapVersion;
    // 이전에 쓸 수 없다고 판명된 해시를 또 내려주면 받지 않는다(새 해시가 올 때까지 번들 유지).
    if (MAP_FILES.some((f) => state?.bad?.[f] === manifest.files[f].sha256)) return prevSource;

    const unchanged = (name: MapFileName) => state?.files[name] === manifest.files[name].sha256;
    if (prevSource.kind === 'cache' && state?.mapVersion === n && MAP_FILES.every(unchanged)) {
      writeState(fs, mapId, { ...state, etag });
      return remember(mapId, prevSource);
    }

    tmp = `${root(mapId)}/tmp-${n}-${now().toString(36)}`;
    fs.mkdir(tmp);
    for (const name of MAP_FILES) {
      const entry = manifest.files[name];
      if (prevSource.kind === 'cache' && unchanged(name)) {
        fs.copy(`${prevSource.path}/${name}`, `${tmp}/${name}`); // 바뀌지 않은 파일은 다시 안 받고 네이티브 복사
        continue;
      }
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        const r = await fetchFn(`${url}/${entry.path}`);
        if (!r.ok) throw new Error(`${name} ${r.status}`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        ok = bytes.length === entry.bytes && sha256Hex(bytes) === entry.sha256;
        if (ok) fs.writeBytes(`${tmp}/${name}`, bytes); // 검증 통과분만 디스크에 둔다
      }
      if (!ok) throw new Error(`${name} sha256 mismatch`);
    }

    // 원자 교체: 임시 → v<n>. ponytail: 같은 mapVersion 을 다른 내용으로 재발행하면 삭제~rename 사이 짧은 창이 있다
    // (서버 규약상 버전은 올리는 것). 필요하면 활성 버전 재발행을 거부한다.
    const finalPath = versionPath(mapId, n);
    if (fs.exists(finalPath)) fs.remove(finalPath);
    fs.renameDir(tmp, `v${n}`);
    tmp = null;
    writeState(fs, mapId, {
      mapVersion: n,
      etag,
      files: Object.fromEntries(MAP_FILES.map((f) => [f, manifest.files[f].sha256])),
      bytes: Object.fromEntries(MAP_FILES.map((f) => [f, manifest.files[f].bytes])),
    });
    prune(fs, mapId, [n, ...(prevSource.kind === 'cache' ? [prevSource.mapVersion] : [])]);
    return remember(mapId, sourceFromState(fs, mapId) ?? prevSource);
  } catch {
    if (tmp) {
      try {
        fs.remove(tmp);
      } catch {
        /* 다음 sync 시작 때 다시 정리한다 */
      }
    }
    return prevSource;
  }
}

const remember = (mapId: string, src: MapAssetSource) => {
  if (src.kind === 'cache') pending.set(mapId, src);
  return src;
};

// 원자 쓰기: .tmp 에 다 쓴 뒤 덮어쓰기 이동 — 쓰다 죽어도 이전 state.json 이 남는다.
function writeState(fs: MapFs, mapId: string, s: State) {
  const file = `${root(mapId)}/state.json`;
  fs.writeText(`${file}.tmp`, JSON.stringify(s));
  fs.move(`${file}.tmp`, file);
}

/** keep(이전 활성 + 새 활성)만 남기고 나머지 v<n> 삭제. */
function prune(fs: MapFs, mapId: string, keep: number[]) {
  for (const name of fs.list(root(mapId))) {
    const v = /^v(\d+)$/.exec(name)?.[1];
    if (v && !keep.includes(Number(v))) fs.remove(versionPath(mapId, Number(v)));
  }
}
