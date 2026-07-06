import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { fetchFriends, fetchPinnedFriends } from './friendsApi';

// 집중 세션 친구 그리드용 라이브 상태 — 대상은 친구 전체(GET /friends). 핀과 무관.
// GET /friends 응답엔 아직 오늘 집중분·집중중 여부가 없어(BE 확장 협의 필요),
// 핀 응답(GET /pins)에 있는 친구만 라이브 값을 임시 보강한다.
// TODO: BE가 /friends에 focusTimeMinutes·isFocusing을 추가하면 단일 호출로 교체.

export interface SessionFriend {
  userId: string;
  nickname: string;
  focusTimeMinutes: number; // 오늘 누적 집중 분
  isFocusing: boolean; // 현재 집중 세션 진행 중 여부
}

const DEFAULT_POLL_MS = 60_000;

export function useFocusFriends(pollMs: number = DEFAULT_POLL_MS) {
  const [friends, setFriends] = useState<SessionFriend[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const [roster, pinned] = await Promise.all([fetchFriends(), fetchPinnedFriends()]);
      const liveById = new Map(pinned.map((p) => [p.userId, p]));
      setFriends(
        roster.map((f) => ({
          userId: f.userId,
          nickname: f.nickname,
          focusTimeMinutes: liveById.get(f.userId)?.focusTimeMinutes ?? 0,
          isFocusing: liveById.get(f.userId)?.isFocusing ?? false,
        })),
      );
    } catch {
      // 네트워크 실패 시 기존 상태 유지 — 다음 폴링에서 재시도
    } finally {
      setLoaded(true);
    }
  }, []);

  // 세션이 길게 떠 있는 화면이라 인터벌 폴링 + 포그라운드 복귀 시 재조회로 집중여부 갱신
  useEffect(() => {
    refetch();
    const timer = setInterval(refetch, pollMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refetch, pollMs]);

  return { friends, loaded, refetch };
}
