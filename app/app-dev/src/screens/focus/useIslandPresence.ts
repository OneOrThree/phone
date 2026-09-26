/**
 * 섬 주민 집중/휴식 실시간 상태 훅 (GROMO-2010).
 *
 * `active`+`islandId` 가 있을 때 STOMP 채널을 열고 스냅숏으로 복구한다.
 * 섬·계정(세션 세대)·응원 자격(세션 id)이 바뀌면 이전 채널을 해제하고 새로 연다.
 * 포그라운드 복귀 때는 소켓을 다시 열고 최신 스냅숏으로 재동기화한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { sessionGeneration } from '@/services/api/session';
import type { Color } from '@/services/model';
import {
  EMPTY_PRESENCE,
  startIslandRealtime,
  type IslandRealtime,
  type IslandPresenceTransition,
  type PresenceView,
} from '@/services/islandRealtime';

const COLORS: Color[] = ['black', 'ginger', 'cream', 'gray', 'white', 'calico'];
/** 서버 catColor → 앱 Color. 모르는 값은 회색으로 둔다. */
export const catColor = (v: unknown): Color =>
  COLORS.includes(v as Color) ? (v as Color) : 'gray';

export type IslandPresence = PresenceView & {
  /** STOMP SEND — 즉시 실패(미연결·세션 없음)면 false. 화면 표시는 브로드캐스트가 돌아올 때다. */
  sendEmote: (type: string) => boolean;
  retry: () => void;
};

export function useIslandPresence(
  opts: {
    active: boolean;
    islandId: string | null;
    /** 응원 자격이 되는 내 진행 중 서버 세션 id — 없으면 emotes 를 구독·발신하지 않는다. */
    emoteSessionId?: string | null;
    onSendError?: (message: string) => void;
    onTransition?: (transition: IslandPresenceTransition) => void;
  },
  start: typeof startIslandRealtime = startIslandRealtime,
): IslandPresence {
  const { active, islandId, emoteSessionId } = opts;
  const generation = sessionGeneration();
  const [view, setView] = useState<PresenceView>(EMPTY_PRESENCE);
  const [nonce, setNonce] = useState(0);
  const rt = useRef<IslandRealtime | null>(null);
  const onSendError = useRef(opts.onSendError);
  onSendError.current = opts.onSendError;
  const onTransition = useRef(opts.onTransition);
  onTransition.current = opts.onTransition;

  useEffect(() => {
    if (!active || !islandId) {
      setView(EMPTY_PRESENCE);
      return;
    }
    const gen = generation;
    const alive = () => gen === sessionGeneration();
    const session = start({
      islandId,
      emoteSessionId,
      alive,
      onView: setView,
      onTransition: (transition) => {
        if (alive()) onTransition.current?.(transition);
      },
      onSendError: (message) => {
        if (alive()) onSendError.current?.(message);
      },
    });
    rt.current = session;
    session.resync();
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && alive()) {
        session.reopen();
        session.resync('reconnect');
      }
    });
    return () => {
      appSub.remove();
      session.dispose();
      rt.current = null;
    };
    // nonce: retry — 채널을 통째로 버리고 새로 연다.
  }, [active, islandId, emoteSessionId, generation, nonce, start]);

  return {
    ...view,
    sendEmote: useCallback((type: string) => rt.current?.sendEmote(type) ?? false, []),
    retry: useCallback(() => setNonce((n) => n + 1), []),
  };
}
