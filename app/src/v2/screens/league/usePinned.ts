import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchPinnedFriends, pinFriend, unpinFriend } from './friendsApi';

// 핀한 유저 ID 집합 + 토글 — 리그 탭(포디움·랭킹 핀 아이콘, '핀한 사람만' 필터)이 사용.
// 화면 포커스마다 서버(GET /pins)에서 재조회해 재진입·프로필 상세·친구 탭에서 바뀐 핀을 반영한다.
export function usePinned() {
  const [pinned, setPinned] = useState<Set<string>>(() => new Set<string>());

  const refetch = useCallback(async () => {
    try {
      const list = await fetchPinnedFriends();
      setPinned(new Set(list.map((p) => p.userId)));
    } catch {
      // 네트워크/인증 실패 시 기존 상태 유지 — 다음 포커스에서 재시도
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  // 핀 토글 — 낙관적 갱신, 실패 시 롤백(FriendProfile 핀 토글과 동일 패턴. 서버는 멱등이라 중복 탭 안전)
  const togglePin = useCallback(
    async (userId: string) => {
      const wasPinned = pinned.has(userId);
      const apply = (on: boolean) =>
        setPinned((prev) => {
          const next = new Set(prev);
          if (on) next.add(userId);
          else next.delete(userId);
          return next;
        });
      apply(!wasPinned);
      try {
        if (wasPinned) await unpinFriend(userId);
        else await pinFriend(userId);
      } catch {
        apply(wasPinned);
        Alert.alert('핀 변경 실패', '잠시 후 다시 시도해주세요.');
      }
    },
    [pinned],
  );

  return { pinned, togglePin, refetch };
}
