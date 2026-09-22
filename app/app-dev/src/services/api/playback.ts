import { request } from './client';

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
