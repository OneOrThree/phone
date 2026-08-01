import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useUser } from '@/store/UserContext';
import { getGlobalRanking } from '@/services/leagueApi';
import { toRankingMembers } from './useLeagueRanking';
import { type RankedMember } from './mock';

// 전체 리그 랭킹 — 리그 화면 '전체' 탭 전용. 직군 무관 전역 랭킹(GET /league/ranking?scope=total, GROMO-611).
// 직군 리그(useLeagueRanking)와 별개로 진짜 전역 상위 100명을 받는다. '전체' 탭이 직군 리스트를
// 재사용하면 내 직군만 전체인 척 표시되는 버그(GROMO-644)라, 여기서 실제 전역 랭킹을 조회한다.
// 게스트/실패 시 빈 배열. 멤버 tierLevel은 서버 응답의 실제 티어(GROMO-748 — 구 '내 티어 임시 부여' 제거).
// 전역은 혼합 직군이라 리그 라벨은 붙이지 않는다(label=null).
export function useGlobalRanking() {
  const { nickname: myNickname, userId } = useUser();

  // 서버 멤버 원본. null이면 미조회/게스트/실패.
  const [members, setMembers] = useState<RankedMember[] | null>(null);
  // 요청 시퀀스 — 당겨서 새로고침(GROMO-887)과 포커스 재조회가 겹칠 때, 늦게 온 이전 응답이
  // 최신 상태를 덮지 않게 최신 요청만 반영한다(useFriends 패턴).
  const requestSeqRef = useRef(0);

  // 전역 랭킹 재조회 — 포커스 effect와 당겨서 새로고침(GROMO-887)이 공유한다.
  const refetch = useCallback(async () => {
    if (!userId) {
      setMembers(null);
      return;
    }
    const seq = ++requestSeqRef.current;
    try {
      const res = await getGlobalRanking();
      // 이 응답을 기다리는 동안 더 새로운 요청이 시작됐으면 stale 결과라 버린다
      if (seq !== requestSeqRef.current) return;
      setMembers(toRankingMembers(res, userId, myNickname, null));
    } catch {
      // 일시 실패 시 기존 랭킹 유지 — 당겨서 새로고침 실패로 보이던 목록이 사라지지 않게 한다
      // (useLeagueRanking과 동일 정책, 코드리뷰 반영). 이전 데이터가 없으면 그대로 빈 상태.
    }
  }, [userId, myNickname]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  // 데이터 없으면 빈 배열. refetch는 당겨서 새로고침(GROMO-887)용.
  return { ranking: members ?? [], refetch };
}
