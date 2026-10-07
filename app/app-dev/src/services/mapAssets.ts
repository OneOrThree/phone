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
 * 최근 2개 mapVersion 만 보관한다.
 *
 * 활성 소스는 렌더 중에 바뀌지 않는다: sync 결과는 pending 에 두고 {@link promoteMapAssets}(홈 진입 시 1회)에서
 * current 로 올린다 — 같은 화면 수명 동안 타일셋 이미지와 tilemap/nav JSON 이 서로 다른 버전이 되는 일이 없다.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { sha256Hex } from '@/utils/sha256';

export const MAP_ASSETS_URL = process.env.EXPO_PUBLIC_MAP_ASSETS_URL ?? '';

export const MAP_FILES = [
  'tileset@2x.png',
  'tileset.json',
  'tilemap.json',
  'nav.json',
  'objects.json',
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
  renameDir: (p, newName) => new Directory(Paths.cache, ...seg(p)).rename(newName),
};

type State = { mapVersion: number; etag: string | null; files: Record<string, string> };
type Manifest = {
  mapVersion: number;
  files: Record<MapFileName, { path: string; sha256: string; bytes: number }>;
};

const root = (mapId: string) => `maps/${mapId}`;
const versionPath = (mapId: string, n: number) => `${root(mapId)}/v${n}`;

function readState(fs: MapFs, mapId: string): State | null {
  try {
    const s = JSON.parse(fs.readText(`${root(mapId)}/state.json`));
    return Number.isInteger(s?.mapVersion) && s.files ? s : null;
  } catch {
    return null;
  }
}

/** state.json 이 가리키는 버전 디렉터리에 6개 파일이 모두 있을 때만 cache, 아니면 null(→ bundle). */
function sourceFromState(fs: MapFs, mapId: string): MapAssetSource | null {
  const s = readState(fs, mapId);
  if (!s) return null;
  const path = versionPath(mapId, s.mapVersion);
  if (!MAP_FILES.every((f) => fs.exists(`${path}/${f}`))) return null;
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

/** 현재 화면이 쓰는 활성 소스(동기). 앱 시작 후 첫 호출에 state.json 을 한 번 읽는다. */
export function getActiveMapAssets(mapId = 'home'): MapAssetSource {
  if (!MAP_ASSETS_URL) return BUNDLE;
  let src = current.get(mapId);
  if (!src) {
    try {
      src = sourceFromState(expoMapFs, mapId) ?? BUNDLE;
    } catch {
      src = BUNDLE;
    }
    current.set(mapId, src);
  }
  return src;
}

/** 홈 진입 시 1회: 백그라운드 sync 가 끝나 있던 새 버전을 이번 화면부터 쓴다(렌더 중 교체 금지). */
export function promoteMapAssets(mapId = 'home'): MapAssetSource {
  const next = pending.get(mapId);
  if (next) {
    current.set(mapId, next);
    pending.delete(mapId);
  }
  return getActiveMapAssets(mapId);
}

/** 활성 소스의 JSON 파일을 읽어 파싱한다. 번들이거나 읽기/파싱이 실패하면 fallback(번들 정적 import). */
export function readMapJson<T>(
  name: MapFileName,
  fallback: T,
  mapId = 'home',
  fs: MapFs = expoMapFs,
): T {
  const src = getActiveMapAssets(mapId);
  if (src.kind !== 'cache') return fallback;
  const key = `${src.path}/${name}`;
  if (jsonMemo.has(key)) return jsonMemo.get(key) as T; // 같은 객체를 돌려줘야 loadNav 의 WeakMap 캐시가 맞는다
  try {
    const parsed = JSON.parse(fs.readText(key)) as T;
    jsonMemo.set(key, parsed);
    return parsed;
  } catch {
    return fallback;
  }
}
const jsonMemo = new Map<string, unknown>();

/** 활성 소스의 타일셋 이미지: cache 면 file URI, 아니면 null(→ 호출부가 번들 require 사용). */
export function activeTilesetUri(mapId = 'home'): string | null {
  const src = getActiveMapAssets(mapId);
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
      headers: prevSource.kind === 'cache' && state?.etag ? { 'If-None-Match': state.etag } : {},
    });
    if (res.status === 304 && prevSource.kind === 'cache') return remember(mapId, prevSource);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const manifest = parseManifest(await res.json());
    const etag = res.headers.get('ETag');
    const n = manifest.mapVersion;

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
        fs.writeBytes(`${tmp}/${name}`, fs.readBytes(`${prevSource.path}/${name}`)); // 바뀌지 않은 파일은 다시 안 받는다
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
    });
    prune(fs, mapId, n);
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

function writeState(fs: MapFs, mapId: string, s: State) {
  fs.writeText(`${root(mapId)}/state.json`, JSON.stringify(s));
}

/** 최근 2개 mapVersion(+방금 활성화한 n)만 남기고 나머지 v<n> 삭제. */
function prune(fs: MapFs, mapId: string, active: number) {
  const versions = fs
    .list(root(mapId))
    .map((name) => /^v(\d+)$/.exec(name)?.[1])
    .filter((v): v is string => !!v)
    .map(Number)
    .sort((a, b) => b - a);
  const keep = new Set([...versions.slice(0, 2), active]);
  for (const v of versions) if (!keep.has(v)) fs.remove(versionPath(mapId, v));
}
