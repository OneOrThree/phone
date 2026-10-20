import { useCallback, useEffect, useRef, useState } from 'react';
import { readAccountGuides, saveAccountGuides, type AccountGuides } from '@/services/accountGuides';
import { getLastSessionUserId, sessionGeneration } from '@/services/api/session';
import type { State, Building } from '@/services/model';

export function useAccountGuides(
  owner: string | null,
  state: State,
  dispatch: (action: any) => void,
) {
  const generation = sessionGeneration();
  const [result, setResult] = useState<{
    owner: string;
    generation: number;
    data: AccountGuides;
  } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const current = useRef({ owner, generation });
  current.current = { owner, generation };
  const stateRef = useRef(state);
  stateRef.current = state;
  const alive = useCallback(
    (id: string, gen: number) =>
      current.current.owner === id &&
      current.current.generation === gen &&
      sessionGeneration() === gen,
    [],
  );
  useEffect(() => {
    if (!owner) return;
    let disposed = false;
    setResult(null);
    setError('');
    setSaving(false);
    const load = async () => {
      let data = await readAccountGuides(owner);
      if (disposed || !alive(owner, generation)) return;
      const snapshot = stateRef.current;
      // 이전 전체 저장본은 소유자가 확인된 계정에서만 이관한다.
      if (getLastSessionUserId() === owner) {
        const buildings: Building[] = [];
        if (snapshot.mailboxGuideSeenBy?.includes(owner)) buildings.push('mail');
        if (snapshot.shopGuideSeenBy?.includes(owner)) buildings.push('shop');
        const focusDone = snapshot.focusGuideDone || (snapshot.tutorial?.step ?? 0) >= 22;
        if ((focusDone && !data.focusDone) || buildings.some((b) => !data.buildings.includes(b))) {
          data = await saveAccountGuides(owner, { buildings, focusDone });
        }
      }
      if (disposed || !alive(owner, generation)) return;
      if (data.focusDone) dispatch({ type: 'FOCUS_GUIDE_RESTORED' });
      setResult({ owner, generation, data });
    };
    void load().catch(() => {
      if (!disposed && alive(owner, generation))
        setError('안내 이력을 불러오지 못했어요. 다시 시도해 주세요.');
    });
    return () => {
      disposed = true;
    };
  }, [owner, generation, revision, alive, dispatch]);
  const data = result?.owner === owner && result.generation === generation ? result.data : null;
  const done = async (update: Partial<AccountGuides>) => {
    if (!owner || !data || saving) return;
    setSaving(true);
    setError('');
    try {
      const next = await saveAccountGuides(owner, update);
      if (alive(owner, generation)) setResult({ owner, generation, data: next });
    } catch {
      if (alive(owner, generation)) setError('안내 이력을 저장하지 못했어요. 다시 눌러 주세요.');
    } finally {
      if (alive(owner, generation)) setSaving(false);
    }
  };
  return { data, error, saving, done, retry: () => setRevision((v) => v + 1) };
}
