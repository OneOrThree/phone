import { Channel, Manifest, digest, parseChannel, parseManifest } from './contracts';
import { POLICY } from './policy';
export type ChannelState = {
  channel?: Channel;
  manifest?: Manifest;
  etag?: string;
  lastSuccess: number;
  failureCount: number;
  nextRetry: number;
};
export type MetadataTransport = (options: {
  url: string;
  allowedOrigins: string[];
  maxBytes: number;
  timeoutMs: number;
  etag?: string;
}) => Promise<{ status: number; text: string; etag?: string }>;
export class ChannelClient {
  constructor(
    private base: string,
    private environment: 'dev' | 'prod',
    private fetcher: typeof fetch = fetch,
    private transport?: MetadataTransport,
  ) {
    const u = new URL(base);
    if (
      u.protocol !== 'https:' ||
      u.pathname !== '/' ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw new Error('CDN origin');
  }
  get origin() {
    return new URL(this.base).origin;
  }
  url(path: string) {
    return `${this.base.replace(/\/$/, '')}/${path}`;
  }
  private async get(path: string, limit: number, etag?: string) {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        if (this.transport) {
          const response = await this.transport({
            url: this.url(path),
            allowedOrigins: [this.origin],
            maxBytes: limit,
            timeoutMs: 10000,
            etag,
          });
          if (response.status === 304) return response;
          if (response.status < 200 || response.status >= 300) {
            if (response.status >= 500 && attempt === 0) continue;
            throw new Error(`http ${response.status}`);
          }
          if (new TextEncoder().encode(response.text).length > limit)
            throw new Error('metadata limit');
          return response;
        }
        const r = await this.fetcher(this.url(path), {
          headers: etag ? { 'If-None-Match': etag } : {},
          redirect: 'error',
          signal: controller.signal,
        });
        if (r.url && new URL(r.url).origin !== this.origin) throw new Error('redirect');
        if (r.status === 304) return { status: 304, text: '', etag };
        if (!r.ok) {
          if (r.status >= 500 && attempt === 0) continue;
          throw new Error(`http ${r.status}`);
        }
        if (Number(r.headers.get('Content-Length')) > limit) throw new Error('metadata limit');
        const text = await r.text();
        if (new TextEncoder().encode(text).length > limit) throw new Error('metadata limit');
        return { status: r.status, text, etag: r.headers.get('ETag') ?? undefined };
      } catch (error) {
        if (
          attempt === 0 &&
          !(error instanceof Error && /http 4|metadata|redirect/.test(error.message))
        )
          continue;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  async refresh(state: ChannelState, now: number): Promise<ChannelState> {
    const path = `channels/${this.environment}/1.json`;
    let response = await this.get(path, POLICY.channelBytes, state.etag);
    if (response.status === 304 && (!state.manifest || !state.channel))
      response = await this.get(path, POLICY.channelBytes);
    if (response.status === 304) {
      if (!state.manifest) throw new Error('missing manifest');
      return { ...state, lastSuccess: now, failureCount: 0, nextRetry: 0 };
    }
    const channel = parseChannel(JSON.parse(response.text));
    if (state.channel && channel.generation < state.channel.generation)
      return { ...state, lastSuccess: now, failureCount: 0, nextRetry: 0 };
    if (
      state.channel &&
      channel.generation === state.channel.generation &&
      channel.manifestSha256 !== state.channel.manifestSha256
    )
      throw new Error('generation collision');
    let body = await this.get(channel.manifestPath, POLICY.manifestBytes);
    const intact = () =>
      new TextEncoder().encode(body.text).length === channel.manifestBytes &&
      digest(body.text) === channel.manifestSha256;
    if (!intact()) body = await this.get(channel.manifestPath, POLICY.manifestBytes);
    if (!intact()) throw new Error('manifest integrity');
    const manifest = parseManifest(JSON.parse(body.text));
    if (manifest.releaseId !== channel.releaseId) throw new Error('release mismatch');
    return {
      channel,
      manifest,
      etag: response.etag,
      lastSuccess: now,
      failureCount: 0,
      nextRetry: 0,
    };
  }
}
