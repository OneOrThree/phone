import { AppState } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { PackLease } from '@/services/assets/contracts';
import { getAssetRepository } from '@/services/assets/repository';
/** 열린 화면은 획득한 버전을 유지하며 최초 빈 화면만 완성된 팩으로 전환한다. */
export function useAssetPack(packId: string | null) {
  const [lease, setLease] = useState<PackLease | null>(null);
  const held = useRef<PackLease | null>(null);
  const epoch = useRef(0);
  const recovering = useRef<number | null>(null);
  useEffect(() => {
    const repository = getAssetRepository();
    const current = ++epoch.current;
    setLease(null);
    const adopt = (candidate: PackLease | null) => {
      if (current !== epoch.current || recovering.current === current) {
        candidate?.release();
        return;
      }
      if (held.current !== candidate) held.current?.release();
      held.current = candidate;
      setLease(candidate);
    };
    let running = false;
    const synchronize = async () => {
      if (!repository || !packId || running || recovering.current === current) return;
      running = true;
      try {
        if (!held.current) adopt(await repository.acquirePack(packId));
        if (current !== epoch.current || recovering.current === current) return;
        await repository.ensurePack(packId);
        if (current !== epoch.current || held.current || recovering.current === current) return;
        adopt(await repository.acquirePack(packId));
      } finally {
        running = false;
      }
    };
    void synchronize().catch(() => {});
    const subscription =
      repository && packId
        ? AppState.addEventListener('change', (state) => {
            if (state === 'active') void synchronize().catch(() => {});
          })
        : null;
    return () => {
      subscription?.remove();
      epoch.current++;
      held.current?.release();
      held.current = null;
    };
  }, [packId]);
  return {
    lease: lease?.packId === packId ? lease : null,
    onError: () => {
      const repository = getAssetRepository();
      if (!lease || !repository || held.current !== lease || recovering.current === epoch.current)
        return;
      const current = epoch.current;
      recovering.current = current;
      setLease(null);
      held.current = null;
      void (async () => {
        try {
          await repository.reportDecodeFailure(lease);
        } finally {
          lease.release();
        }
        const previous = await repository.acquirePack(lease.packId);
        if (current !== epoch.current) {
          previous?.release();
          return;
        }
        if (held.current !== previous) held.current?.release();
        held.current = previous;
        setLease(previous);
      })()
        .catch(() => {})
        .finally(() => {
          if (recovering.current === current) recovering.current = null;
        });
    },
  };
}
