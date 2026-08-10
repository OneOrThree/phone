import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isSameGroupOrder,
  readGroupCardOrder,
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

// 저장 실패 뒤에도 현재 실행의 최신 낙관 순서를 계정별로 보존한다. 화면 remount나
// serverKey 변경 hydration이 저장소의 오래된 값을 다시 덮어쓰지 않게 하는 런타임 정본이다.
const pendingOrders = new Map<string, string[]>();

export function __resetPendingGroupCardOrdersForTest(): void {
  pendingOrders.clear();
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

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const serverKey = serverGroupIds === null ? null : JSON.stringify(serverGroupIds);
  const identity = `${userId ?? 'anonymous'}:${serverKey ?? 'unavailable'}`;

  useEffect(() => {
    if (serverGroupIds === null) return;
    let canceled = false;
    const ids = [...serverGroupIds];

    void (async () => {
      // userId 미확정 상태는 계정 bucket을 읽거나 쓰지 않고 서버 순서만 사용한다.
      const stored = userId ? await readGroupCardOrder(userId) : null;
      if (canceled || !mounted.current) return;

      const pending = userId ? pendingOrders.get(userId) : undefined;
      const reconciled = reconcileGroupCardOrder(ids, pending ?? stored);
      if (userId && pending) pendingOrders.set(userId, reconciled);
      orderRef.current = reconciled;
      setState({ identity, ids: reconciled, saveFailed: pending !== undefined });

      // stale/중복 prune은 성공한 전체 목록을 받은 이 경로에서만 수행한다.
      if (userId && pending) {
        // 실패했던 최신 순서를 새 서버 목록과 합친 뒤 다시 저장한다. 더 최신 commit이 생기면
        // 이 완료가 해당 pending이나 실패 상태를 지우지 않는다.
        writeGroupCardOrder(userId, reconciled)
          .then(() => {
            if (!isSameGroupOrder(pendingOrders.get(userId) ?? [], reconciled)) return;
            pendingOrders.delete(userId);
            if (mounted.current && userRef.current === userId) {
              setState((current) =>
                current?.identity === identity ? { ...current, saveFailed: false } : current,
              );
            }
          })
          .catch(() => undefined);
      } else if (userId && stored && !isSameGroupOrder(stored, reconciled)) {
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
    orderRef.current = next;
    setState((current) => (current ? { ...current, ids: next, saveFailed: false } : current));
    if (currentUser) {
      pendingOrders.set(currentUser, next);
      void writeGroupCardOrder(currentUser, next)
        .then(() => {
          if (!isSameGroupOrder(pendingOrders.get(currentUser) ?? [], next)) return;
          pendingOrders.delete(currentUser);
          if (mounted.current && userRef.current === currentUser) {
            setState((current) => current && { ...current, saveFailed: false });
          }
        })
        .catch(() => {
          if (!isSameGroupOrder(pendingOrders.get(currentUser) ?? [], next)) return;
          if (mounted.current && userRef.current === currentUser) {
            setState((current) => current && { ...current, saveFailed: true });
          }
        });
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
