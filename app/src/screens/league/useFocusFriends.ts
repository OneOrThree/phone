import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { fetchFriends, fetchPinnedFriends } from '@/services/friendsApi';

// 집중 세션 친구 그리드용 라이브 상태 — 대상은 친구 전체(GET /friends). 핀과 무관.
// GROMO-658: /friends 가 라이브 필드(오늘 집중분·집중중·시작시각·태그명)를 주면 그대로 쓰고,
// 확장 배포 전 서버(필드 없음)에서는 종전대로 핀 응답(GET /pins)의 값으로 보강한다.
// TODO: BE 확장 배포 후 /pins 보강 경로 제거하고 단일 호출로 교체.

export interface SessionFriend {
  userId: string;
  nickname: string;
  focusTimeMinutes: number; // 오늘 누적 집중 분 (완료 세션 집계 — 진행 중 경과는 미포함)
  isFocusing: boolean; // 현재 집중 세션 진행 중 여부
  focusStartedAt: string | null; // 진행 중 세션 시작 시각(ISO) — 초 단위 틱업 기준. 미집중이면 null
  focusTagName: string | null; // 진행 중 세션 태그명(집중 과목). 미집중·무태그면 null
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
          focusTimeMinutes: f.focusTimeMinutes ?? liveById.get(f.userId)?.focusTimeMinutes ?? 0,
          isFocusing: f.isFocusing ?? liveById.get(f.userId)?.isFocusing ?? false,
          focusStartedAt: f.focusStartedAt ?? liveById.get(f.userId)?.focusStartedAt ?? null,
          focusTagName: f.focusTagName ?? liveById.get(f.userId)?.focusTagName ?? null,
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
