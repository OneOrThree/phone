import { request } from './client';

/** 서버 공용 재생 상태. 앱은 trackId·playing·version만 쓴다 — 위치 필드는 서버 계약 유지용이고 재생 지점을 맞추지 않는다. */
export type PlaybackState = {
  trackId: string | null;
  playing: boolean;
  positionSeconds: number;
  effectiveAt: string;
  changedBy: string | null;
  version: number;
  serverNow: string;
  durationSeconds: number | null;
};

export type PlaybackPatch = {
  trackId?: string;
  playing?: boolean;
  expectedVersion: number;
};

const enc = encodeURIComponent;

export function getPlayback(islandId: string): Promise<PlaybackState> {
  return request<PlaybackState>(`/islands/${enc(islandId)}/playback`);
}

export function patchPlayback(
  islandId: string,
  body: PlaybackPatch,
  key: string,
): Promise<PlaybackState> {
  return request<PlaybackState>(`/islands/${enc(islandId)}/playback`, {
    method: 'PATCH',
    body,
    idempotencyKey: key,
  });
}
