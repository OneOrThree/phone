import { useCallback, useRef, useState } from 'react';
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
  // 요청 시퀀스 — 재시도 연타 시 늦게 도착한 이전 요청의 결과가 최신 상태를 덮지 않게 최신 요청만 반영
  const requestSeqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++requestSeqRef.current;

    const [friendsResult, requestsResult] = await Promise.allSettled([
      fetchFriends(),
      fetchReceivedRequests(),
    ]);

    // 이 응답을 기다리는 동안 더 새로운 refetch가 시작됐으면 stale 결과라 버린다
    if (seq !== requestSeqRef.current) return;

    if (friendsResult.status === 'fulfilled') {
      setFriends(friendsResult.value);
      setError(false);
    } else {
      // 네트워크/인증 실패 시 기존 목록은 유지 — 다음 포커스/재시도 버튼에서 재조회
      setError(true);
    }

    // 요청 카운트는 배지 표시용 — 실패해도 친구 목록과 무관하므로 에러로 올리지 않고 기존 값 유지
    if (requestsResult.status === 'fulfilled') {
      setReceivedCount(requestsResult.value.length);
    }

    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  return { friends, receivedCount, loaded, error, refetch };
}
