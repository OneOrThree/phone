import { sha256Hex } from '@/utils/sha256';
import { POLICY } from './policy';
// 발행기(scripts/assets-cdn/core.mjs validateManifest)가 한 manifest 에 싣는 파일은 두 종류다.
export type PngFile = {
  path: string;
  sha256: string;
  bytes: number;
  mediaType: 'image/png';
  width: number;
  height: number;
};
// rig JSON 에는 치수가 없다. 발행기도 JSON 에 width·height 가 있으면 거부한다.
export type JsonFile = {
  path: string;
  sha256: string;
  bytes: number;
  mediaType: 'application/json';
};
export type AssetFile = PngFile | JsonFile;
export type AssetPack<F extends AssetFile = AssetFile> = {
  version: string;
  files: Record<string, F>;
};
// 이 앱의 네이티브 캐시는 PNG 만 저장한다(publishObject). JSON 이 든 팩은 받지 않는다.
export const onlyPng = (pack: AssetPack): pack is AssetPack<PngFile> =>
  Object.values(pack.files).every((f) => f.mediaType === 'image/png');
export type Manifest = {
  schemaVersion: 1;
  assetApiVersion: 1;
  releaseId: string;
  packs: Record<string, AssetPack>;
};
export type Channel = {
  schemaVersion: 1;
  assetApiVersion: 1;
  generation: number;
  releaseId: string;
  manifestPath: string;
  manifestSha256: string;
  manifestBytes: number;
};
export type PackLease = {
  id: string;
  packId: string;
  version: string;
  assets: Readonly<
    Record<string, { mediaType: 'image/png'; uri: string; width: number; height: number }>
  >;
  release(): void;
};
export type EnsureResult =
  | { status: 'ready'; version: string }
  | { status: 'deferred'; reason: 'offline' | 'backoff' | 'space' | 'incompatible' }
  | { status: 'failed'; reason: 'network' | 'integrity' | 'decode' | 'storage' };
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const digest = (text: string) => sha256Hex(new TextEncoder().encode(text));
const token = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= max;
const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const STATIC_PATH =
  /^static\/customization\/(?:decor|head|neck|shoes|raft|rigs)\/[A-Za-z0-9_-]+\.([a-f0-9]{8})\.(png|json)$/;
// 경로는 정규식으로 고정한다: 내용 해시 경로, 또는 꾸미기 정적 경로(파일명 가운데 8자리가 내용 해시 앞부분이고
// 확장자가 mediaType 과 같아야 한다). 상위 경로·절대 경로·query·인코딩은 어느 쪽에도 들어갈 자리가 없다.
function pathAllowed(path: unknown, sha256: string, extension: string) {
  if (path === `assets/${sha256}.${extension}`) return true;
  const match = typeof path === 'string' ? STATIC_PATH.exec(path) : null;
  return !!match && match[1] === sha256.slice(0, 8) && match[2] === extension;
}
export function parseChannel(raw: unknown): Channel {
  const c = raw as Channel;
  if (
    !c ||
    c.schemaVersion !== 1 ||
    c.assetApiVersion !== 1 ||
    !integer(c.generation, Number.MAX_SAFE_INTEGER) ||
    !token(c.releaseId) ||
    c.manifestPath !== `releases/${c.releaseId}/manifest.json` ||
    !hash(c.manifestSha256) ||
    !integer(c.manifestBytes, POLICY.manifestBytes)
  )
    throw new Error('channel schema');
  return c;
}
export function parseManifest(raw: unknown): Manifest {
  const m = raw as Manifest;
  if (
    !m ||
    m.schemaVersion !== 1 ||
    m.assetApiVersion !== 1 ||
    !token(m.releaseId) ||
    !record(m.packs) ||
    Object.keys(m.packs).length > 512
  )
    throw new Error('manifest schema');
  let count = 0;
  for (const [id, p] of Object.entries(m.packs)) {
    if (
      !token(id) ||
      !p ||
      !hash(p.version) ||
      !record(p.files) ||
      !Object.keys(p.files).length ||
      Object.keys(p.files).length > 128 ||
      digest(canonical(p.files)) !== p.version
    )
      throw new Error('pack schema');
    let bytes = 0;
    for (const [asset, f] of Object.entries(p.files as Record<string, Record<string, any>>)) {
      const extension =
        f?.mediaType === 'image/png' ? 'png' : f?.mediaType === 'application/json' ? 'json' : '';
      if (
        !token(asset) ||
        !extension ||
        !hash(f.sha256) ||
        !pathAllowed(f.path, f.sha256, extension) ||
        !integer(f.bytes, POLICY.fileBytes) ||
        (extension === 'png'
          ? !integer(f.width, 4096) || !integer(f.height, 4096) || f.width * f.height > 16777216
          : f.width !== undefined || f.height !== undefined)
      )
        throw new Error('file schema');
      bytes += f.bytes;
      count++;
    }
    if (bytes > 32 * 1024 ** 2 || count > 4096) throw new Error('manifest limit');
  }
  return m;
}
