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

/** 서버 anchor를 응답 관측 시점의 실제 재생 위치로 환산한다. */
export function playbackSeekSeconds(state: PlaybackState): number {
  if (state.trackId === null) return 0;
  const effectiveAt = Date.parse(state.effectiveAt);
  const serverNow = Date.parse(state.serverNow);
  const elapsed =
    state.playing && Number.isFinite(effectiveAt) && Number.isFinite(serverNow)
      ? Math.max(0, (serverNow - effectiveAt) / 1000)
      : 0;
  const position = Math.max(0, state.positionSeconds + elapsed);
  return state.durationSeconds && state.durationSeconds > 0
    ? position % state.durationSeconds
    : position;
}

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
