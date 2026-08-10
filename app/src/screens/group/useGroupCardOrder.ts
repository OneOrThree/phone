import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isSameGroupOrder,
  readGroupCardOrderState,
  reconcileGroupCardOrder,
  writeGroupCardOrder,
} from './groupCardOrderStore';

interface Params {
  /** null은 목록 loading/error/부분 응답이다. 이때는 절대 reconcile/prune하지 않는다. */
  serverGroupIds: readonly string[] | null;
  userId: string | null;
}

interface GroupCardOrderState {
  orderedGroupIds: string[];
  hydrated: boolean;
  saveFailed: boolean;
  commitOrder: (groupIds: readonly string[]) => boolean;
}

export function useGroupCardOrder({ serverGroupIds, userId }: Params): GroupCardOrderState {
  const [state, setState] = useState<{
    identity: string;
    ids: string[];
    saveFailed: boolean;
  } | null>(null);
  const mounted = useRef(true);
  const orderRef = useRef<string[]>([]);
  const userRef = useRef(userId);
  userRef.current = userId;
  const identityRef = useRef('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const serverKey = serverGroupIds === null ? null : JSON.stringify(serverGroupIds);
  const identity = `${userId ?? 'anonymous'}:${serverKey ?? 'unavailable'}`;
  identityRef.current = identity;

  useEffect(() => {
    if (serverGroupIds === null) return;
    let canceled = false;
    const ids = [...serverGroupIds];

    void (async () => {
      // userId 미확정 상태는 계정 bucket을 읽거나 쓰지 않고 서버 순서만 사용한다.
      const read = userId
        ? await readGroupCardOrderState(userId)
        : { order: null, needsRepair: false, readFailed: false };
      const stored = read.order;
      if (canceled || !mounted.current) return;

      const reconciled = reconcileGroupCardOrder(ids, stored);
      orderRef.current = reconciled;
      setState({ identity, ids: reconciled, saveFailed: false });

      // stale/중복 prune은 성공한 전체 목록을 받은 이 경로에서만 수행한다.
      if (
        userId &&
        !read.readFailed &&
        (read.needsRepair || (stored !== null && !isSameGroupOrder(stored, reconciled)))
      ) {
        void writeGroupCardOrder(userId, reconciled).catch(() => undefined);
      }
    })();

    return () => {
      canceled = true;
    };
    // serverKey가 배열의 값 동일성을 대표한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, serverKey, userId]);

  const commitOrder = useCallback((candidate: readonly string[]): boolean => {
    const next = reconcileGroupCardOrder(orderRef.current, candidate);
    if (isSameGroupOrder(next, orderRef.current)) return false;

    const currentUser = userRef.current;
    const currentIdentity = identityRef.current;
    orderRef.current = next;
    setState((current) => (current ? { ...current, ids: next, saveFailed: false } : current));
    if (currentUser) {
      void writeGroupCardOrder(currentUser, next)
        .then(
          () =>
            mounted.current &&
            identityRef.current === currentIdentity &&
            setState((current) => current && { ...current, saveFailed: false }),
        )
        .catch(
          () =>
            mounted.current &&
            identityRef.current === currentIdentity &&
            setState((current) => current && { ...current, saveFailed: true }),
        );
    }
    return true;
  }, []);

  // 계정 또는 서버 목록이 바뀐 직후에는 이전 identity의 값을 노출하지 않는다.
  return useMemo(
    () => ({
      orderedGroupIds: state?.identity === identity ? state.ids : [],
      hydrated: state?.identity === identity,
      saveFailed: state?.identity === identity ? state.saveFailed : false,
      commitOrder,
    }),
    [commitOrder, identity, state],
  );
}
