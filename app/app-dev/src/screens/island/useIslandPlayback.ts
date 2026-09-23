import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, CLIENT_NETWORK_ERROR, CLIENT_TIMEOUT, uuid } from '@/services/api/client';
import {
  getPlayback,
  patchPlayback,
  type PlaybackPatch,
  type PlaybackState,
} from '@/services/api/playback';
import { sessionGeneration } from '@/services/api/session';
import { stompIslandChannel, type IslandChannel } from '@/services/islandRealtime';

export type IslandPlayback = {
  state: PlaybackState | null;
  loading: boolean;
  error: ApiError | null;
  update: (patch: Omit<PlaybackPatch, 'expectedVersion'>) => Promise<PlaybackState>;
  retry: () => void;
};

const validEvent = (raw: unknown, islandId: string): PlaybackState | null => {
  const envelope = raw as Record<string, unknown> | null;
  const payload = envelope?.payload as PlaybackState | null;
  if (
    envelope?.schemaVersion !== 1 ||
    envelope.type !== 'playback.updated' ||
    envelope.islandId !== islandId ||
    typeof envelope.aggregateVersion !== 'number' ||
    !payload ||
    payload.version !== envelope.aggregateVersion ||
    !Number.isSafeInteger(payload.version) ||
    payload.version < 0 ||
    !(payload.trackId === null || typeof payload.trackId === 'string') ||
    typeof payload.playing !== 'boolean' ||
    typeof payload.positionSeconds !== 'number' ||
    typeof payload.effectiveAt !== 'string' ||
    typeof payload.serverNow !== 'string'
  )
    return null;
  return payload;
};

export function useIslandPlayback({
  active,
  islandId,
  dispatch,
}: {
  active: boolean;
  islandId: string | null;
  dispatch: (action: { type: string; [key: string]: unknown }) => void;
}): IslandPlayback {
  const [state, setState] = useState<PlaybackState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const stateRef = useRef<PlaybackState | null>(null);
  const channel = useRef<IslandChannel | null>(null);
  const epoch = useRef(0);
  const writing = useRef<Promise<PlaybackState> | null>(null);

  const apply = useCallback(
    (next: PlaybackState, source: 'snapshot' | 'event') => {
      const current = stateRef.current;
      if (
        current &&
        (next.version < current.version || (source === 'event' && next.version === current.version))
      )
        return;
      stateRef.current = next;
      setState(next);
      if (islandId)
        dispatch({ type: 'PLAYBACK_SYNC', islandId, playback: next, observedAtMs: Date.now() });
    },
    [dispatch, islandId],
  );

  const resync = useCallback(async () => {
    if (!active || !islandId) return;
    const ownEpoch = epoch.current;
    const generation = sessionGeneration();
    setLoading(stateRef.current === null);
    try {
      const next = await getPlayback(islandId);
      if (ownEpoch !== epoch.current || generation !== sessionGeneration()) return;
      apply(next, 'snapshot');
      setError(null);
    } catch (thrown) {
      if (ownEpoch !== epoch.current || generation !== sessionGeneration()) return;
      setError(thrown as ApiError);
    } finally {
      if (ownEpoch === epoch.current && generation === sessionGeneration()) setLoading(false);
    }
  }, [active, apply, islandId]);

  useEffect(() => {
    epoch.current += 1;
    stateRef.current = null;
    setState(null);
    setError(null);
    writing.current = null;
    if (!active || !islandId) return;
    const ownEpoch = epoch.current;
    const generation = sessionGeneration();
    const alive = () => ownEpoch === epoch.current && generation === sessionGeneration();
    const conn = stompIslandChannel({
      islandId,
      presence: false,
      playback: true,
      emote: false,
      onEvent: (raw) => {
        if (!alive()) return;
        const next = validEvent(raw, islandId);
        if (next) apply(next, 'event');
      },
      onOpen: () => {
        if (alive()) resync();
      },
      onError: () => {},
    });
    channel.current = conn;
    resync();
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && alive()) {
        conn.reopen();
        resync();
      }
    });
    return () => {
      appSub.remove();
      conn.close();
      if (channel.current === conn) channel.current = null;
    };
  }, [active, apply, islandId, nonce, resync]);

  const update = useCallback(
    (patch: Omit<PlaybackPatch, 'expectedVersion'>): Promise<PlaybackState> => {
      if (!active || !islandId || !stateRef.current)
        return Promise.reject(
          new ApiError(
            'CLIENT_INACTIVE',
            '재생 정보를 아직 못 읽었어요. 잠시 후 다시 시도해 주세요.',
            0,
          ),
        );
      const ownEpoch = epoch.current;
      const generation = sessionGeneration();
      const previous = writing.current;
      const flight = (previous ? previous.catch(() => undefined) : Promise.resolve())
        .then(async () => {
          const current = stateRef.current;
          if (!current || ownEpoch !== epoch.current || generation !== sessionGeneration())
            throw new ApiError('CLIENT_STALE_SESSION', '로그인 정보가 바뀌었어요.', 0);
          const body: PlaybackPatch = { ...patch, expectedVersion: current.version };
          const key = uuid();
          try {
            return await patchPlayback(islandId, body, key);
          } catch (thrown) {
            const retryable =
              thrown instanceof ApiError &&
              (thrown.retryable ||
                thrown.code === CLIENT_NETWORK_ERROR ||
                thrown.code === CLIENT_TIMEOUT);
            if (!retryable) throw thrown;
            return patchPlayback(islandId, body, key);
          }
        })
        .then((next) => {
          if (ownEpoch !== epoch.current || generation !== sessionGeneration())
            throw new ApiError('CLIENT_STALE_SESSION', '로그인 정보가 바뀌었어요.', 0);
          apply(next, 'snapshot');
          return next;
        })
        .catch(async (thrown) => {
          if (thrown instanceof ApiError && thrown.status === 409) await resync();
          throw thrown;
        })
        .finally(() => {
          if (writing.current === flight) writing.current = null;
        });
      writing.current = flight;
      return flight;
    },
    [active, apply, islandId, resync],
  );

  return { state, loading, error, update, retry: () => setNonce((value) => value + 1) };
}
