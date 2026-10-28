import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useUser } from '@/store/UserContext';
import { getGlobalRanking, getMyRank } from '@/services/leagueApi';
import { toRankingMembers } from './useLeagueRanking';
import { type RankedMember } from './mock';

// 전체 리그 랭킹 — 리그 화면 '전체' 탭 전용. 직군 무관 전역 랭킹(GET /league/ranking?scope=total, GROMO-611).
// 직군 리그(useLeagueRanking)와 별개로 진짜 전역 상위 100명을 받는다. '전체' 탭이 직군 리스트를
// 재사용하면 내 직군만 전체인 척 표시되는 버그(GROMO-644)라, 여기서 실제 전역 랭킹을 조회한다.
// 미조회/실패 시 빈 배열. 멤버 tierLevel은 서버 응답의 실제 티어(GROMO-748 — 구 '내 티어 임시 부여' 제거).
// 전역은 혼합 직군이라 리그 라벨은 붙이지 않는다(label=null).
export function useGlobalRanking() {
  const { nickname: myNickname, userId } = useUser();

  // 서버 멤버 원본. null이면 미조회/실패.
  const [members, setMembers] = useState<RankedMember[] | null>(null);
  // 내 전역 순위(1-base)와 그 시점의 내 주간 집중초 — top-100 밖에서도 정확한 값
  // (GET /league/me/rank, GROMO-1613에서 호출당 활동 로그를 제거해 화면 포커스마다 불러도
  // 계측이 부풀지 않는다). 순위와 시간은 같은 랭킹 쿼리 스냅샷에서 나오므로 **함께** 보관한다 —
  // 순위만 남기면 100위 밖 행이 다른 원천(세션 합산)의 시간과 짝지어져, 세션 조회 실패 조합에서
  // 정확한 순위 옆에 0/이전 시간이 붙는다(코덱스 리뷰).
  // null = 미배정/미조회/실패. 이 값만 실패해도 리스트는 정상 표시한다(refetch의 개별 catch).
  const [myRankInfo, setMyRankInfo] = useState<{ rank: number; seconds: number | null } | null>(
    null,
  );
  // 마지막 조회 실패 여부 — 실패가 "리그에 아무도 없음" 빈 상태로 오인되지 않게 UI에서 구분
  // (GROMO-922, 친구 목록 GROMO-621과 동일 패턴)
  const [error, setError] = useState(false);
  // 요청 시퀀스 — 당겨서 새로고침(GROMO-887)과 포커스 재조회가 겹칠 때, 늦게 온 이전 응답이
  // 최신 상태를 덮지 않게 최신 요청만 반영한다(useFriends 패턴).
  const requestSeqRef = useRef(0);

  // 전역 랭킹 재조회 — 포커스 effect와 당겨서 새로고침(GROMO-887)이 공유한다.
  const refetch = useCallback(async () => {
    if (!userId) {
      setMembers(null);
      setError(false); // 세션 없음(JWT 디코드 실패)은 조회 실패가 아니다 — 안내를 띄우지 않는다
      return;
    }
    const seq = ++requestSeqRef.current;
    try {
      // 내 전역 순위는 실패해도 리스트를 막지 않는다 — null로 눌러 '순위 없음' 표시로 격하.
      const [res, rankRes] = await Promise.all([getGlobalRanking(), getMyRank().catch(() => null)]);
      // 이 응답을 기다리는 동안 더 새로운 요청이 시작됐으면 stale 결과라 버린다
      if (seq !== requestSeqRef.current) return;
      setMembers(toRankingMembers(res, userId, myNickname, null));
      setMyRankInfo(
        rankRes?.assigned === true && rankRes.myRank != null
          ? { rank: rankRes.myRank, seconds: rankRes.totalFocusSeconds }
          : null,
      );
      setError(false);
    } catch {
      // 일시 실패 시 기존 랭킹 유지 — 당겨서 새로고침 실패로 보이던 목록이 사라지지 않게 한다
      // (useLeagueRanking과 동일 정책, 코드리뷰 반영). 이전 데이터가 없으면 그대로 빈 상태.
      if (seq === requestSeqRef.current) setError(true);
    }
  }, [userId, myNickname]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  // 데이터 없으면 빈 배열. refetch는 당겨서 새로고침(GROMO-887)용.
  return {
    ranking: members ?? [],
    myGlobalRank: myRankInfo?.rank ?? null,
    myGlobalSeconds: myRankInfo?.seconds ?? null,
    error,
    refetch,
  };
}
