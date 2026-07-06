import { useEffect } from 'react';
import { AppState } from 'react-native';
import { flushPendingFocusUploads } from './pendingFocusUploads';

// 업로드 실패로 대기열에 남은 집중 세션 재전송(GROMO-614) — 앱 시작 1회 + 포그라운드 복귀마다.
// (PendingGoalApplier와 같은 트리거. flush 내부에서 실패분은 대기열에 남아 다음 기회에 재시도.)
export function PendingFocusUploader() {
  useEffect(() => {
    flushPendingFocusUploads().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flushPendingFocusUploads().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  return null;
}
