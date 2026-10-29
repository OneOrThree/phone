import { Directory, File, Paths } from 'expo-file-system';
import { Image, Platform } from 'react-native';
import { MetadataTransport } from './channelClient';
import { getAssetCacheNative } from '../../../modules/catus-asset-cache';
export interface AssetPort {
  root: string;
  metadata?: MetadataTransport;
  list(): Promise<{ uri: string; bytes: number }[]>;
  read(uri: string): Promise<string>;
  remove(uri: string): Promise<void>;
  free(): Promise<number>;
  inspect(uri: string): Promise<{ bytes: number; sha256: string }>;
  download(options: {
    url: string;
    jobId: string;
    expectedBytes: number;
    expectedSha256: string;
    allowedOrigins: string[];
    timeoutMs: number;
  }): Promise<{ uri: string; bytes: number; sha256: string }>;
  publish(uri: string, sha256: string): Promise<string>;
  snapshot(seq: number, payload: string): Promise<{ uri: string; sha256: string }>;
  decode(uri: string, width: number, height: number): Promise<void>;
}
export function nativePort(): AssetPort | null {
  if (Platform.OS === 'web') return null;
  const native = getAssetCacheNative();
  if (!native || native.apiVersion !== 1 || !native.rootUri.startsWith('file://')) return null;
  const root = native.rootUri.replace(/\/$/, '');
  let requests = 0;
  const waiting: (() => void)[] = [];
  const network = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (requests >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
    else requests++;
    try {
      return await operation();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else requests--;
    }
  };
  const checked = (uri: string) => {
    if (!uri.startsWith(`${root}/`) || uri.slice(root.length).includes('..') || /[%?#]/.test(uri))
      throw new Error('cache path');
    return uri;
  };
  return {
    root,
    metadata: (options) => network(() => native.fetchMetadata(options)),
    async list() {
      const entries: { uri: string; bytes: number }[] = [];
      const walk = (d: Directory) => {
        if (!d.exists) return;
        for (const item of d.list()) {
          checked(item.uri);
          if (item instanceof Directory) walk(item);
          else entries.push({ uri: item.uri, bytes: item.size });
        }
      };
      walk(new Directory(root));
      return entries;
    },
    async read(uri) {
      const f = new File(checked(uri));
      if (f.size > 2 * 1024 ** 2) throw new Error('snapshot limit');
      return f.text();
    },
    async remove(uri) {
      const f = new File(checked(uri));
      if (f.exists) f.delete();
    },
    async free() {
      return Paths.availableDiskSpace;
    },
    inspect(uri) {
      return native.inspectFile(checked(uri));
    },
    download(options) {
      return network(() => native.downloadVerified(options)).then((result) => ({
        ...result,
        uri: checked(result.uri),
      }));
    },
    publish(uri, sha256) {
      return native.publishObject({ uri: checked(uri), sha256, extension: 'png' }).then(checked);
    },
    snapshot(seq, payload) {
      return native
        .writeSnapshot({ seq, payload })
        .then((result) => ({ ...result, uri: checked(result.uri) }));
    },
    decode(uri, width, height) {
      return new Promise((resolve, reject) =>
        Image.getSize(
          checked(uri),
          (w, h) =>
            w === width && h === height ? resolve() : reject(new Error('decode dimensions')),
          reject,
        ),
      );
    },
  };
}
