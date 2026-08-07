import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useUser } from '@/store/UserContext';
import { useCoins } from '@/store/CoinContext';
import { flushPendingFocusUploads } from './pendingFocusUploads';

// 업로드 실패로 대기열에 남은 집중 세션 재전송(GROMO-614) — 앱 시작 1회 + 포그라운드 복귀마다.
// (PendingGoalApplier와 같은 트리거. flush 내부에서 실패분은 대기열에 남아 다음 기회에 재시도.)
// 현재 로그인 userId를 넘겨 다른 계정이 적립한 항목은 업로드하지 않고 버리게 한다.
export function PendingFocusUploader() {
  const { userId } = useUser();
  const { refresh: refreshCoins } = useCoins();

  useEffect(() => {
    // 대기열이 실제로 저장을 커밋했으면 서버 잔액을 다시 받는다(GROMO-1049) — 예전엔 응답을
    // 버려서, 늦게 올라간 세션의 지급이 다음 잔액 조회 전까지 화면에 나타나지 않았다.
    const flush = () => {
      flushPendingFocusUploads(userId)
        .then((committed) => {
          if (committed) refreshCoins();
        })
        .catch(() => {});
    };
    flush();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flush();
    });
    return () => sub.remove();
  }, [userId, refreshCoins]);

  return null;
}
