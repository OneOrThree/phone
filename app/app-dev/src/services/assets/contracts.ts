import { sha256Hex } from '@/utils/sha256';
import { POLICY } from './policy';
export type AssetFile = {
  path: string;
  sha256: string;
  bytes: number;
  mediaType: 'image/png';
  width: number;
  height: number;
};
export type AssetPack = { version: string; files: Record<string, AssetFile> };
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
    for (const [asset, f] of Object.entries(p.files)) {
      if (
        !token(asset) ||
        !f ||
        !hash(f.sha256) ||
        f.path !== `assets/${f.sha256}.png` ||
        f.mediaType !== 'image/png' ||
        !integer(f.bytes, POLICY.fileBytes) ||
        !integer(f.width, 4096) ||
        !integer(f.height, 4096) ||
        f.width * f.height > 16777216
      )
        throw new Error('file schema');
      bytes += f.bytes;
      count++;
    }
    if (bytes > 32 * 1024 ** 2 || count > 4096) throw new Error('manifest limit');
  }
  return m;
}
