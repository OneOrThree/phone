import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchPinnedFriends, pinFriend, unpinFriend } from '@/services/friendsApi';

// 핀한 유저 ID 집합 + 토글 — 리그 탭(포디움·랭킹 핀 아이콘, '핀한 사람만' 필터, 친구 그리드 배지)이 사용.
// 화면 포커스마다 서버(GET /pins)에서 재조회해 재진입·프로필 상세에서 바뀐 핀을 반영한다.
// 재조회와 토글이 겹칠 수 있어 두 가지 가드를 둔다:
//  - 유저별 in-flight 추적: 같은 유저 연타 시 앞 요청이 끝나기 전 재토글은 무시(POST/DELETE 순서 역전 방지)
//  - 재조회 버전 가드: 재조회 응답이 토글 전 스냅샷이면 버리고, 뮤테이션이 모두 끝난 뒤 다시 조회
export function usePinned() {
  const [pinned, setPinned] = useState<Set<string>>(() => new Set<string>());
  // 서버 핀 목록을 한 번이라도 받아왔는지 — 소비처에서 폴백(예: 친구 응답의 isPinned) 판단용
  const [loaded, setLoaded] = useState(false);
  // 진행 중인 핀 뮤테이션의 유저 ID — 연타 무시 + 재조회 응답 폐기 판단
  const inFlight = useRef<Set<string>>(new Set());
  // 토글 세대 — 재조회 시작 이후 토글이 있었으면 그 응답은 토글 전 스냅샷이므로 버린다
  const version = useRef(0);
  // 뮤테이션과 겹쳐 버린 재조회가 있으면, 마지막 뮤테이션 완료 후 한 번 다시 조회
  const refetchQueued = useRef(false);

  const refetch = useCallback(async () => {
    // 응답이 토글 전 스냅샷이면 낙관적 갱신을 덮지 않도록 버리고 다시 시도
    for (;;) {
      const startedVersion = version.current;
      let list;
      try {
        list = await fetchPinnedFriends();
      } catch {
        // 네트워크/인증 실패 시 기존 상태 유지 — 다음 포커스에서 재시도
        return;
      }
      if (inFlight.current.size > 0) {
        // 뮤테이션 진행 중 — 지금 응답은 결과 반영 전일 수 있다. 완료 후 재조회 예약.
        refetchQueued.current = true;
        return;
      }
      if (version.current !== startedVersion) {
        // 조회 도중 토글이 끝남 — 이 응답은 구 스냅샷일 수 있어 버리고 즉시 재조회
        continue;
      }
      setPinned(new Set(list.map((p) => p.userId)));
      setLoaded(true);
      return;
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
      // 같은 유저의 핀 요청이 아직 진행 중이면 무시 — 연타 시 POST/DELETE가 순서 보장 없이
      // 나가 마지막 탭과 반대 상태로 서버에 남는 경합 방지
      if (inFlight.current.has(userId)) return;
      inFlight.current.add(userId);
      version.current += 1;
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
      } finally {
        inFlight.current.delete(userId);
        if (inFlight.current.size === 0 && refetchQueued.current) {
          refetchQueued.current = false;
          refetch();
        }
      }
    },
    [pinned, refetch],
  );

  return { pinned, togglePin, refetch, loaded };
}
