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

  const refetch = useCallback(async () => {
    try {
      const [friendList, requests] = await Promise.all([fetchFriends(), fetchReceivedRequests()]);
      setFriends(friendList);
      setReceivedCount(requests.length);
    } catch {
      // 네트워크/인증 실패 시 기존 상태 유지 — 다음 포커스에서 재시도
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  return { friends, receivedCount, loaded, refetch };
}
