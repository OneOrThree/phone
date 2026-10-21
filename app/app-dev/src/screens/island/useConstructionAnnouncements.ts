import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getConstructionOptions, type BuildingId } from '@/services/api/home';
import { sessionGeneration } from '@/services/api/session';

/** 단순한 완공 목록 증가는 기여 증거가 아니다. 서버가 확인한 대상만 표시한다. */
export function useConstructionAnnouncements(
  owner: string | null,
  islandId: string | null,
  built: string,
  active: boolean,
) {
  const generation = sessionGeneration();
  const scope = `${owner}:${generation}:${islandId}:${built}`;
  const [result, setResult] = useState<{ scope: string; buildings: BuildingId[] } | null>(null);
  useEffect(() => {
    if (!owner || !islandId || !active) return;
    let disposed = false;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const options = await getConstructionOptions(islandId);
        if (disposed || request !== sequence || sessionGeneration() !== generation) return;
        setResult({
          scope,
          buildings: (options.contributedCompletions ?? []).filter((b) =>
            built.split(',').includes(b),
          ),
        });
      } catch {
        if (!disposed && request === sequence) setResult(null);
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
      else {
        sequence += 1;
        setResult(null);
      }
    });
    return () => {
      disposed = true;
      subscription.remove();
    };
  }, [owner, islandId, built, active, generation, scope]);
  return active && result?.scope === scope ? result.buildings : [];
}
