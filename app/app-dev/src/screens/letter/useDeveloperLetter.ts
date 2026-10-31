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
        // 응답을 기다리는 사이 게이트가 깨졌으면 저장도 표시도 하지 않고 다음 참일 때 다시 본다
        if (!latest.current.ready || latest.current.userId !== userId) {
          // 계정이 바뀐 경우는 [userId] effect 가 이미 올렸다 — 옛 응답이 새 요청의 due 를 덮지 않는다
          if (latest.current.userId === userId) due.current = true;
          return;
        }
        const decision = decideLetter(items, seen);
        if (!decision) return;
        if ('save' in decision) return await writeLetterSeen(userId, decision.save);
        setShown({ notice: decision.show, userId });
      } catch {
        // 실패는 조용히 넘기고 다음 게이트 변화(deps 가 바뀔 때만 effect 가 돈다 — 핫 루프 없음) 때 다시 본다
        if (latest.current.userId === userId) due.current = true;
      }
    })();
  }, [ready, userId, shown]);

  const notice = shown && shown.userId === userId ? shown.notice : null;
  const dismiss = useCallback(() => {
    if (!notice || !userId) return;
    setShown(null);
    // 편지가 떠 있는 동안 백그라운드를 다녀와 due 가 켜졌어도 내린다 — 재조회가 저장과 경합해 같은 편지가 다시 뜨지 않게
    due.current = false;
    void writeLetterSeen(userId, visibleAt(notice));
  }, [notice, userId]);
  return { notice, dismiss };
}
