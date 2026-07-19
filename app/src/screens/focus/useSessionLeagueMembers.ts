import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getMyRanking } from '@/services/leagueApi';
import type { LiveGridMember } from './components/LiveFocusGrid';

// 집중 세션 리그(811)·같은 시험(812) 그리드용 라이브 멤버 — GET /league/me/ranking(?category=).
// GROMO-824 가 라이브 필드를 채워주는 엔드포인트는 이것뿐이다(/league/ranking 은 라이브 미포함):
//   occupation 미지정 = 전역 주간 상위 100(811, 전체 리그와 같은 모수), 지정 = 같은 occupation 상위 100(812).
// 미배포 서버 응답(필드 없음)은 전원 미집중·0분 폴백.
// enabled=false(812에서 준비 시험 미설정)면 조회하지 않고 빈 목록을 유지한다.

const DEFAULT_POLL_MS = 60_000;
// 그리드가 세로 스크롤을 지원해도(GROMO-848) top-100 전체 렌더는 과해서 상위 일부만
const MAX_MEMBERS = 12;

export function useSessionLeagueMembers({
  occupation,
  excludeUserId,
  enabled = true,
  pollMs = DEFAULT_POLL_MS,
}: {
  occupation?: string;
  /** 내 행 제외용 — 내 집중 모습은 캐릭터 페이지가 담당 */
  excludeUserId?: string | null;
  enabled?: boolean;
  pollMs?: number;
}) {
  const [members, setMembers] = useState<LiveGridMember[]>([]);

  const refetch = useCallback(async () => {
    try {
      const res = await getMyRanking(occupation);
      setMembers(
        res
          .filter((m) => m.userId !== excludeUserId)
          .slice(0, MAX_MEMBERS)
          .map((m) => ({
            userId: m.userId,
            nickname: m.nickname,
            focusTimeMinutes: m.focusTimeMinutes ?? 0,
            isFocusing: m.isFocusing ?? false,
            focusStartedAt: m.focusStartedAt ?? null,
            focusTagName: m.focusTagName ?? null,
          })),
      );
    } catch {
      // 네트워크 실패 시 기존 상태 유지 — 다음 폴링에서 재시도
    }
  }, [occupation, excludeUserId]);

  // 세션이 길게 떠 있는 화면이라 인터벌 폴링 + 포그라운드 복귀 시 재조회 (useFocusFriends와 동일 패턴)
  // — ended_at이 채워진 멤버는 재조회에서 isFocusing=false로 내려와 오프로 전환된다.
  useEffect(() => {
    if (!enabled) return;
    refetch();
    const timer = setInterval(refetch, pollMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, refetch, pollMs]);

  return { members };
}
