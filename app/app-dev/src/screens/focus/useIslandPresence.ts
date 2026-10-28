import { useMemberLooks, memberLooks, ensureMemberLooks } from '@/services/memberLooks';
/**
 * 섬 주민 집중/휴식 실시간 상태 훅 (GROMO-2010).
 *
 * `active`+`islandId` 가 있을 때 STOMP 채널을 열고 스냅숏으로 복구한다.
 * 섬·계정(세션 세대)이 바뀌면 이전 채널을 해제하고 새로 연다.
 * 응원 자격(세션 id)은 focus/rest 소켓을 끊지 않고 emotes 구독만 갱신한다.
 * 포그라운드 복귀 때는 소켓을 다시 열고 최신 스냅숏으로 재동기화한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { sessionGeneration } from '@/services/api/session';
import { useBlockedUserIds } from '@/services/blockedUsers';
import type { Color } from '@/services/model';
import { newerLook, parseLook, type MemberLook } from '@/services/memberAppearance';
import {
  EMPTY_PRESENCE,
  startIslandRealtime,
  type IslandRealtime,
  type IslandPresenceTransition,
  type LiveEmote,
  type GoldenFishEvent,
  type MemberArrivedEvent,
  type PresenceView,
} from '@/services/islandRealtime';

const COLORS: Color[] = ['black', 'ginger', 'cream', 'gray', 'white', 'calico'];
/** 서버 catColor → 앱 Color. 모르는 값은 회색으로 둔다. */
export const catColor = (v: unknown): Color =>
  COLORS.includes(v as Color) ? (v as Color) : 'gray';

const NO_LOOKS: Record<string, MemberLook> = {};

export type IslandPresence = PresenceView & {
  /** STOMP SEND — 즉시 실패(미연결·세션 없음)면 false. 화면 표시는 브로드캐스트가 돌아올 때다. */
  sendEmote: (type: string) => boolean;
  retry: () => void;
  /** 소켓은 그대로 두고 스냅숏만 다시 읽는다 — 이벤트가 안 오는 방문 화면의 주기 갱신용. */
  resync: () => void;
  /** 실시간으로 받은 주민 외양(GROMO-2390) — 스냅숏 appearance 와 version 으로 합쳐 쓴다. */
  looks: Record<string, MemberLook>;
};

export function useIslandPresence(
  opts: {
    active: boolean;
    islandId: string | null;
    /** 응원 자격이 되는 내 진행 중 서버 세션 id — 없으면 emotes 를 구독·발신하지 않는다. */
    emoteSessionId?: string | null;
    /** 서버 계약 호환용 — 앱 화면은 넘기지 않는다(2026-10-16). 방문자 모드(GROMO-2259): 세션 없이 응원을 보낸다. */
    visitor?: boolean;
    /** 방문자가 보낸 응원을 받았다(주민 화면). */
    onVisitorEmote?: (emote: LiveEmote) => void;
    onSendError?: (message: string) => void;
    onTransition?: (transition: IslandPresenceTransition) => void;
    onGoldenFish?: (event: GoldenFishEvent) => void;
    /** 주민 소식(GROMO-2311) — 현재 소속 섬의 주민 화면에서만 `events` 를 켠다. */
    events?: boolean;
    onMemberArrived?: (event: MemberArrivedEvent) => void;
  },
  start: typeof startIslandRealtime = startIslandRealtime,
): IslandPresence {
  const { active, islandId, emoteSessionId, visitor } = opts;
  const generation = sessionGeneration();
  const [nonce, setNonce] = useState(0);
  const scope = `${generation}:${active ? islandId : ''}:${nonce}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [snapshot, setSnapshot] = useState({ scope, view: EMPTY_PRESENCE });
  const [looksState, setLooksState] = useState<{
    scope: string;
    looks: Record<string, MemberLook>;
  }>({ scope, looks: {} });
  const rt = useRef<IslandRealtime | null>(null);
  const onSendError = useRef(opts.onSendError);
  onSendError.current = opts.onSendError;
  const onTransition = useRef(opts.onTransition);
  onTransition.current = opts.onTransition;
  const onVisitorEmote = useRef(opts.onVisitorEmote);
  onVisitorEmote.current = opts.onVisitorEmote;
  const onGoldenFish = useRef(opts.onGoldenFish);
  onGoldenFish.current = opts.onGoldenFish;
  const onMemberArrived = useRef(opts.onMemberArrived);
  onMemberArrived.current = opts.onMemberArrived;

  useEffect(() => {
    if (!active || !islandId) {
      return;
    }
    const gen = generation;
    let live = true;
    const alive = () => live && scopeRef.current === scope && gen === sessionGeneration();
    const session = start({
      islandId,
      emoteSessionId,
      visitor,
      events: opts.events,
      alive,
      onView: (view) => {
        if (alive()) {
          setSnapshot({ scope, view });
          for (const member of [...view.focus, ...view.rest]) {
            const appearance = parseLook(member.appearance);
            if (appearance) memberLooks.accept(member.userId, appearance);
          }
          void ensureMemberLooks([...view.focus, ...view.rest].map((member) => member.userId));
        }
      },
      onTransition: (transition) => {
        if (alive()) onTransition.current?.(transition);
      },
      onVisitorEmote: (emote) => {
        if (alive()) onVisitorEmote.current?.(emote);
      },
      onGoldenFish: (event) => {
        if (alive()) onGoldenFish.current?.(event);
      },
      onMemberArrived: (event) => {
        if (alive()) onMemberArrived.current?.(event);
      },
      onMemberAppearance: (userId, look) => {
        if (!alive()) return;
        memberLooks.accept(userId, look);
        setLooksState((prev) => {
          const current = prev.scope === scope ? prev.looks : NO_LOOKS;
          const next = newerLook(current[userId], look)!;
          return next === current[userId] ? prev : { scope, looks: { ...current, [userId]: next } };
        });
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
      live = false;
      appSub.remove();
      session.dispose();
      rt.current = null;
    };
    // nonce: retry — 채널을 통째로 버리고 새로 연다.
  }, [active, islandId, generation, nonce, start, scope]);

  useEffect(() => {
    rt.current?.setEmoteSessionId(emoteSessionId ?? null);
  }, [emoteSessionId]);

  // 차단을 풀면(GROMO-2470 D1) 스냅숏을 다시 읽는다 — 서버가 차단 중 가렸던 집중 주민 이름(「차단한 주민」)을
  // 정본으로 되돌린다. 숨김 자체는 장면이 차단 목록으로 그리기만 빼므로 차단할 때는 다시 읽지 않는다.
  const blockedIds = useBlockedUserIds(false);
  const previousBlocked = useRef({ generation, ids: blockedIds });
  useEffect(() => {
    const previous = previousBlocked.current;
    previousBlocked.current = { generation, ids: blockedIds };
    // 계정이 바뀌어 목록이 비는 것은 해제가 아니다 — 채널은 위 effect 가 새로 연다
    if (previous.generation !== generation) return;
    if ([...previous.ids].some((id) => !blockedIds.has(id))) rt.current?.resync('manual');
  }, [blockedIds, generation]);

  const view = snapshot.scope === scope ? snapshot.view : EMPTY_PRESENCE;
  const cached = useMemberLooks(
    [...view.focus, ...view.rest].map((member) => member.userId),
    active,
  );
  const enriched = useMemo(() => {
    const enrich = <T extends { userId: string; catColor?: string | null; appearance?: unknown }>(
      member: T,
    ): T => {
      const look = cached[member.userId];
      return look
        ? {
            ...member,
            catColor: look.catColor,
            appearance: look.hidden
              ? null
              : newerLook(parseLook(member.appearance), look.appearance),
          }
        : member;
    };
    return { focus: view.focus.map(enrich), rest: view.rest.map(enrich) };
  }, [view.focus, view.rest, cached]);
  return {
    ...view,
    ...enriched,
    sendEmote: useCallback((type: string) => rt.current?.sendEmote(type) ?? false, []),
    retry: useCallback(() => setNonce((n) => n + 1), []),
    resync: useCallback(() => rt.current?.resync('manual'), []),
    looks: looksState.scope === scope ? looksState.looks : NO_LOOKS,
  };
}
