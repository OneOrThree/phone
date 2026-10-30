import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { listDeveloperNotices, type DeveloperNotice } from '@/services/api/developerNotices';
import {
  decideLetter,
  readLetterSeen,
  visibleAt,
  writeLetterSeen,
} from '@/services/developerLetter';

/**
 * 운영진의 편지(GROMO-2615) 연결 훅. `ready`(App 의 letterReady)가 참일 때만 조회한다: 앱 시작 뒤 처음 1회, 백그라운드에서
 * 돌아온 뒤 1회. 응답을 기다리는 사이 조건이 깨지거나 계정이 바뀌면 결과를 버리고 다음 참일 때 다시 본다. 조회 실패는 조용히 넘긴다.
 * 띄운 편지는 `ready` 가 풀려도 닫을 때까지 남고, 닫는 순간 그 공지의 visibleAt 을 저장한다.
 */
export function useDeveloperLetter({ ready, userId }: { ready: boolean; userId: string | null }) {
  const [shown, setShown] = useState<{ notice: DeveloperNotice; userId: string } | null>(null);
  const latest = useRef({ ready, userId });
  latest.current = { ready, userId };
  const due = useRef(true);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') due.current = true;
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    due.current = true;
    setShown(null);
  }, [userId]);
  useEffect(() => {
    if (!ready || !userId || !due.current || shown) return;
    due.current = false;
    (async () => {
      try {
        const seen = await readLetterSeen(userId);
        const { items } = await listDeveloperNotices();
        const decision = decideLetter(items, seen);
        if (!decision) return;
        if ('save' in decision) return await writeLetterSeen(userId, decision.save);
        if (!latest.current.ready || latest.current.userId !== userId) {
          due.current = true;
          return;
        }
        setShown({ notice: decision.show, userId });
      } catch {}
    })();
  }, [ready, userId, shown]);

  const notice = shown && shown.userId === userId ? shown.notice : null;
  const dismiss = useCallback(() => {
    if (!notice || !userId) return;
    setShown(null);
    void writeLetterSeen(userId, visibleAt(notice));
  }, [notice, userId]);
  return { notice, dismiss };
}
