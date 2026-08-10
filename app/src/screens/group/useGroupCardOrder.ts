import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearPendingGroupCardOrder,
  getPendingGroupCardOrder,
  isSameGroupOrder,
  readGroupCardOrderState,
  reconcileGroupCardOrder,
  setPendingGroupCardOrder,
  updatePendingGroupCardOrderStatus,
  writeGroupCardOrder,
} from './groupCardOrderStore';

interface Params {
  /** null은 목록 loading/error/부분 응답이다. 이때는 절대 reconcile/prune하지 않는다. */
  serverGroupIds: readonly string[] | null;
  userId: string | null;
  /** 성공한 전체 목록 응답마다 증가한다. ID가 같아도 실패한 세션 쓰기를 다시 시도한다. */
  successfulListVersion?: number;
}

interface GroupCardOrderState {
  orderedGroupIds: string[];
  hydrated: boolean;
  saveFailed: boolean;
  commitOrder: (groupIds: readonly string[]) => boolean;
}

export function useGroupCardOrder({
  serverGroupIds,
  userId,
  successfulListVersion = 0,
}: Params): GroupCardOrderState {
  const [state, setState] = useState<{
    identity: string;
    ids: string[];
    saveFailed: boolean;
  } | null>(null);
  const mounted = useRef(true);
  const orderRef = useRef<string[]>([]);
  const identityRef = useRef('');
  const hydratedUserRef = useRef<string | null>(null);

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

      const pending = userId ? getPendingGroupCardOrder(userId) : undefined;
      const memoryOrder = hydratedUserRef.current === userId ? orderRef.current : null;
      const reconciled = reconcileGroupCardOrder(
        ids,
        pending?.ids ?? (read.readFailed ? memoryOrder : stored),
      );
      orderRef.current = reconciled;
      hydratedUserRef.current = userId;
      setState({ identity, ids: reconciled, saveFailed: pending?.status === 'failed' });

      if (userId && pending?.status === 'failed') {
        // 새 그룹 append·탈퇴 prune을 실패한 최신 세션 순서에 합성한 뒤 즉시 재시도한다.
        const retry = setPendingGroupCardOrder(userId, reconciled, 'inflight');
        writeGroupCardOrder(userId, reconciled)
          .then(() => {
            if (!clearPendingGroupCardOrder(userId, retry.version)) return;
            if (mounted.current && identityRef.current === identity) {
              setState((current) => current && { ...current, saveFailed: false });
            }
          })
          .catch(() => {
            if (!updatePendingGroupCardOrderStatus(userId, retry.version, 'failed')) return;
            if (mounted.current && identityRef.current === identity) {
              setState((current) => current && { ...current, saveFailed: true });
            }
          });
        return;
      }

      // stale/중복 prune은 성공한 전체 목록을 받은 이 경로에서만 수행한다.
      if (
        userId &&
        !read.readFailed &&
        (read.needsRepair || (stored !== null && !isSameGroupOrder(stored, reconciled)))
      ) {
        const repair = setPendingGroupCardOrder(userId, reconciled, 'inflight');
        writeGroupCardOrder(userId, reconciled)
          .then(() => {
            clearPendingGroupCardOrder(userId, repair.version);
          })
          .catch(() => {
            if (!updatePendingGroupCardOrderStatus(userId, repair.version, 'failed')) return;
            if (mounted.current && identityRef.current === identity) {
              setState((current) => current && { ...current, saveFailed: true });
            }
          });
      }
    })();

    return () => {
      canceled = true;
    };
    // serverKey가 배열의 값 동일성을 대표한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, serverKey, successfulListVersion, userId]);

  const commitOrder = useCallback(
    (candidate: readonly string[]): boolean => {
      // 이 callback을 만든 계정/목록이 이미 교체됐거나 hydration 전이면 늦은 제스처를 거부한다.
      if (identityRef.current !== identity || state?.identity !== identity) return false;
      const next = reconcileGroupCardOrder(orderRef.current, candidate);
      if (isSameGroupOrder(next, orderRef.current)) return false;

      orderRef.current = next;
      setState((current) => (current ? { ...current, ids: next, saveFailed: false } : current));
      if (userId) {
        const write = setPendingGroupCardOrder(userId, next, 'inflight');
        writeGroupCardOrder(userId, next)
          .then(() => {
            if (!clearPendingGroupCardOrder(userId, write.version)) return;
            if (mounted.current && identityRef.current === identity) {
              setState((current) => current && { ...current, saveFailed: false });
            }
          })
          .catch(() => {
            if (!updatePendingGroupCardOrderStatus(userId, write.version, 'failed')) return;
            if (mounted.current && identityRef.current === identity) {
              setState((current) => current && { ...current, saveFailed: true });
            }
          });
      }
      return true;
    },
    [identity, state?.identity, userId],
  );

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
