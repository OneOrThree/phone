import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useUser } from '@/store/UserContext';
import { syncScreenTimeUsage } from './screentimeSync';

// 스크린타임 사용량 서버 동기화 배선(GROMO-633) — 앱 시작 1회 + 포그라운드 복귀마다.
// (PendingFocusUploader·PendingGoalApplier와 같은 트리거.) 네이티브 30분 버킷 측정값을
// POST /screen-time으로 올려 통계 화면 폰 사용량 지표를 채운다. 실패는 조용히 무시 —
// 서버 upsert가 멱등이라 다음 복귀 때 최신값으로 다시 시도된다.
export function ScreenTimeSyncer() {
  const { userId } = useUser();

  useEffect(() => {
    // 포그라운드 이벤트 연타 시 동시 실행 방지 — 진행 중이면 이번 트리거는 건너뛴다.
    let inFlight = false;
    const run = () => {
      if (inFlight) return;
      inFlight = true;
      syncScreenTimeUsage(userId)
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    };
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [userId]);

  return null;
}
