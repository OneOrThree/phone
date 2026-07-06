import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { FriendResponse } from '@/types/api';
import { fetchFriends, fetchReceivedRequests } from './friendsApi';

// 친구 목록 + 받은 요청 수 — 리그 친구 탭(그리드·요청 배지)이 사용.
// 화면 포커스마다 재조회해 친구 추가/수락/끊기 후 돌아왔을 때 최신 상태를 반영한다.
export function useFriends() {
  const [friends, setFriends] = useState<FriendResponse[]>([]);
  const [receivedCount, setReceivedCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // 마지막 조회 실패 여부 — 실패가 "친구 0명" 빈 상태로 오인되지 않게 UI에서 구분 (GROMO-621)
  const [error, setError] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const [friendList, requests] = await Promise.all([fetchFriends(), fetchReceivedRequests()]);
      setFriends(friendList);
      setReceivedCount(requests.length);
      setError(false);
    } catch {
      // 네트워크/인증 실패 시 기존 목록은 유지 — 다음 포커스/재시도 버튼에서 재조회
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  return { friends, receivedCount, loaded, error, refetch };
}
