import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useUser } from '@/store/UserContext';
import { getGlobalRanking } from '@/services/leagueApi';
import { toRankingMembers } from './useLeagueRanking';
import { type RankedMember } from './mock';

// 전체 리그 랭킹 — 리그 화면 '전체' 탭 전용. 직군 무관 전역 랭킹(GET /league/ranking?scope=total, GROMO-611).
// 직군 리그(useLeagueRanking)와 별개로 진짜 전역 상위 100명을 받는다. '전체' 탭이 직군 리스트를
// 재사용하면 내 직군만 전체인 척 표시되는 버그(GROMO-644)라, 여기서 실제 전역 랭킹을 조회한다.
// 게스트/실패 시 빈 배열. 멤버 tierLevel은 응답에 없어 호출부의 내 티어를 임시 부여(전역은 교차 티어라
// 근사 — 멤버별 티어 노출은 백엔드 확장 후 TODO). 전역은 혼합 직군이라 리그 라벨은 붙이지 않는다(label=null).
export function useGlobalRanking(tierLevel = 1) {
  const { nickname: myNickname, userId } = useUser();

  // 서버 멤버 원본(tierLevel 제외 — 렌더 시 주입). null이면 미조회/게스트/실패.
  const [members, setMembers] = useState<Omit<RankedMember, 'tierLevel'>[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setMembers(null);
        return;
      }
      let cancelled = false;
      (async () => {
        try {
          const res = await getGlobalRanking();
          if (cancelled) return;
          setMembers(toRankingMembers(res, userId, myNickname, null));
        } catch {
          if (!cancelled) setMembers(null); // 네트워크/인증 실패 → 빈 상태
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [userId, myNickname]),
  );

  // 멤버별 tierLevel 주입. 데이터 없으면 빈 배열.
  return members ? members.map((m) => ({ ...m, tierLevel })) : [];
}
