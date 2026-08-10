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
  // 디스크 쓰기 실패 뒤에도 계정별 최신 화면 순서를 세션 동안 보존한다.
  const pendingByUserRef = useRef(new Map<string, string[]>());

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

      const pending = userId ? pendingByUserRef.current.get(userId) : undefined;
      const reconciled = reconcileGroupCardOrder(ids, pending ?? stored);
      orderRef.current = reconciled;
      setState({ identity, ids: reconciled, saveFailed: pending !== undefined });

      if (userId && pending) {
        // 새 그룹 append·탈퇴 prune을 실패한 최신 세션 순서에 합성한 뒤 즉시 재시도한다.
        pendingByUserRef.current.set(userId, reconciled);
        writeGroupCardOrder(userId, reconciled)
          .then(() => {
            const latest = pendingByUserRef.current.get(userId);
            if (!latest || !isSameGroupOrder(latest, reconciled)) return;
            pendingByUserRef.current.delete(userId);
            if (mounted.current && identityRef.current === identity) {
              setState((current) => current && { ...current, saveFailed: false });
            }
          })
          .catch(() => undefined);
        return;
      }

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
      pendingByUserRef.current.set(currentUser, next);
      writeGroupCardOrder(currentUser, next)
        .then(() => {
          const latest = pendingByUserRef.current.get(currentUser);
          if (!latest || !isSameGroupOrder(latest, next)) return;
          pendingByUserRef.current.delete(currentUser);
          if (mounted.current && identityRef.current === currentIdentity) {
            setState((current) => current && { ...current, saveFailed: false });
          }
        })
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
