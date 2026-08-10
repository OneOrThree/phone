import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useUser } from '@/store/UserContext';
import { useCoins } from '@/store/CoinContext';
import { consumeBackgroundFocusCommit, flushPendingFocusUploads } from './pendingFocusUploads';
import { flushPendingMarkerCancels } from './pendingMarkerCancels';

// 업로드 실패로 대기열에 남은 집중 세션 재전송(GROMO-614) — 앱 시작 1회 + 포그라운드 복귀마다.
// (PendingGoalApplier와 같은 트리거. flush 내부에서 실패분은 대기열에 남아 다음 기회에 재시도.)
// 현재 로그인 userId를 넘겨 다른 계정이 적립한 항목은 업로드하지 않고 버리게 한다.
export function PendingFocusUploader() {
  const { userId } = useUser();
  const { refresh: refreshCoins } = useCoins();

  useEffect(() => {
    // 대기열이 실제로 저장을 커밋했으면 서버 잔액을 다시 받는다(GROMO-1049) — 예전엔 응답을
    // 버려서, 늦게 올라간 세션의 지급이 다음 잔액 조회 전까지 화면에 나타나지 않았다.
    // 백그라운드(사일런트 푸시) flush가 남긴 커밋 마커도 같이 본다(codex 리뷰 P2) — 그쪽이
    // 이미 큐를 비웠으면 여기 flush는 '커밋 없음'을 돌려주므로, 마커가 없으면 백그라운드에서
    // 늘어난 잔액이 영영 화면에 오지 않는다. 둘 중 하나라도 커밋이면 다시 받는다
    // (중복 호출 무해 — 서버 재조회일 뿐이고 refresh는 throw하지 않는다).
    // 마커는 **프로세스가 죽었다 살아난 경우**를 받는다 — 살아 있는 프로세스에서는
    // pushBackground가 커밋 시점에 coinRefreshSignal로 CoinProvider를 직접 깨우므로,
    // 이 자리의 폴링이 겹침 구간(백그라운드 flush 진행 중 active 전환)을 놓쳐도 잔액은 맞는다.
    const flush = () => {
      Promise.all([
        flushPendingFocusUploads(userId).catch(() => false),
        consumeBackgroundFocusCommit(),
      ])
        .then(([committed, backgroundCommitted]) => {
          if (committed || backgroundCommitted) refreshCoins();
        })
        .catch(() => {});
      // 취소 실패로 열린 채 남은 라이브 마커도 같은 시점에 닫는다(GROMO-1214 코드리뷰) — 화면(세션)은
      // 이미 떠났으므로 여기 말고는 재시도할 곳이 없고, 방치하면 친구 화면에 12h(서버 스윕)까지 '집중 중'.
      // 대기열과 같은 계정 스코프 — 다른 계정이 남긴 취소는 보내지 않고 그 계정이 돌아올 때까지 보존한다.
      flushPendingMarkerCancels(userId).catch(() => {});
    };
    flush();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flush();
    });
    return () => sub.remove();
  }, [userId, refreshCoins]);

  return null;
}
