import { requireOptionalNativeModule } from 'expo';

export interface AssetCacheNative {
  apiVersion: number;
  rootUri: string;
  downloadVerified(options: {
    url: string;
    jobId: string;
    expectedBytes: number;
    expectedSha256: string;
    allowedOrigins: string[];
    timeoutMs: number;
  }): Promise<{ uri: string; bytes: number; sha256: string }>;
  fetchMetadata(options: {
    url: string;
    allowedOrigins: string[];
    maxBytes: number;
    timeoutMs: number;
    etag?: string;
  }): Promise<{ status: number; text: string; etag?: string }>;
  cancelDownload(jobId: string): Promise<void>;
  inspectFile(uri: string): Promise<{ bytes: number; sha256: string }>;
  inspectPng(uri: string): Promise<{ width: number; height: number }>;
  publishObject(options: { uri: string; sha256: string; extension: 'png' }): Promise<string>;
  writeSnapshot(options: {
    seq: number;
    payload: string;
  }): Promise<{ uri: string; sha256: string }>;
}

export function getAssetCacheNative(): AssetCacheNative | null {
  const native = requireOptionalNativeModule<AssetCacheNative>('CatusAssetCache');
  if (
    native?.apiVersion !== 1 ||
    typeof native.rootUri !== 'string' ||
    !native.rootUri.startsWith('file://') ||
    ![
      'downloadVerified',
      'fetchMetadata',
      'cancelDownload',
      'inspectFile',
      'inspectPng',
      'publishObject',
      'writeSnapshot',
    ].every((method) => typeof native[method as keyof AssetCacheNative] === 'function')
  ) {
    return null;
  }
  return native;
}
