import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useUser } from '@/store/UserContext';
import { syncScreenTimeUsage } from '@/services/screentimeSync';
import { mirrorNotificationPreferencesToNative } from '@/services/ScreenTimeModule';

// 스크린타임 사용량 서버 동기화 배선(GROMO-633) — 앱 시작 1회 + 포그라운드 복귀마다.
// (PendingFocusUploader·PendingGoalApplier와 같은 트리거.) 네이티브 15분 버킷 측정값을
// POST /screen-time으로 올려 통계 화면 폰 사용량 지표를 채운다. 실패는 조용히 무시 —
// 서버 upsert가 멱등이라 다음 복귀 때 최신값으로 다시 시도된다.
export function ScreenTimeSyncer() {
  // 목표초는 어제분 마감의 달성 판정('버킷 사용시간 ≤ 목표', GROMO-942)에 쓴다 — 변경 시 재동기화.
  const { userId, screenTimeGoalSeconds } = useUser();

  useEffect(() => {
    // 포그라운드 이벤트 연타 시 동시 실행 방지 — 진행 중이면 이번 트리거는 건너뛴다.
    let inFlight = false;
    const run = () => {
      // 인앱 알림 설정을 네이티브로 미러(GROMO-997 코드리뷰) — 안드로이드 목표 초과 워커가
      // notify 전에 '알림 받기'·'소리'·'심야 방해 금지'를 존중하게. 사용량 동기화와 독립이라
      // (게스트·권한 미허용에도 무해한 no-op) inFlight 가드 밖에서 매 트리거마다 호출한다.
      mirrorNotificationPreferencesToNative().catch(() => {});
      if (inFlight) return;
      inFlight = true;
      syncScreenTimeUsage(userId, screenTimeGoalSeconds)
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
  }, [userId, screenTimeGoalSeconds]);

  return null;
}
