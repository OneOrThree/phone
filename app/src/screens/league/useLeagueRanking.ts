import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useFocusCategory } from '@/hooks/useFocusCategory';
import { useUser } from '@/store/UserContext';
import { getMyRanking, getGlobalRanking } from '@/services/leagueApi';
import { occupationForCategory } from '@/constants/focusCategories';
import type { LeagueMemberResponse } from '@/types/api';
import { MY_USER_ID, type RankedMember } from './mock';

// 서버 랭킹 응답(LeagueMemberResponse) → 화면 RankedMember 원본(tierLevel 제외 — 렌더 시 주입).
// 직군 리그(useLeagueRanking)·전체 리그(useGlobalRanking)가 공유하는 단일 변환기.
// - 내 행은 화면 로직(=== MY_USER_ID)을 그대로 쓰도록 userId를 MY_USER_ID 센티널로 치환.
// - exam(리그 라벨)은 호출부가 넘긴 label: 직군 랭킹이면 내 카테고리, 전역이면 null(혼합 직군 → '').
// - 프로필 상세 필드(달성률·스트릭·기록)는 랭킹 응답에 없어 0 — 프로필 조회(GROMO-539/557)에서 채운다.
export function toRankingMembers(
  res: LeagueMemberResponse[],
  userId: string,
  myNickname: string | null,
  label: string | null,
): Omit<RankedMember, 'tierLevel'>[] {
  return res.map((m) => {
    const isMe = m.userId === userId;
    return {
      rank: m.rank,
      userId: isMe ? MY_USER_ID : m.userId,
      nickname: isMe ? myNickname || m.nickname : m.nickname,
      totalFocusMinutes: m.totalFocusMinutes,
      result: m.result,
      exam: label ?? '',
      achievedRate: 0,
      friendCount: 0,
      streakDays: 0,
      bestRank: m.rank,
      bestWeekMinutes: m.totalFocusMinutes,
    };
  });
}

// 직군 리그 랭킹 — 리그 화면 '직군' 탭·홈 상단바가 공유. 서버(GET /league/me/ranking) 실데이터 전용(GROMO-538).
// 게스트/미배정/실패 시 빈 배열(mock 폴백 없음) — 화면은 빈 상태로 처리한다.
// - 직군 리그 = 같은 Occupation 전역 랭킹(?category=). category를 넘겨야 내 아레나가 아닌 직군 랭킹이
//   온다(GROMO-644). 응답엔 멤버별 직군·티어가 없어, 직군 랭킹을 실제로 받은 경우에 한해 리그 라벨을
//   내 카테고리로 확정하고(같은 직군 집단), 혼합 직군인 전역 폴백(GROMO-657)엔 라벨을 붙이지 않는다
//   (모든 멤버를 내 카테고리로 덮어쓰면 전역 랭킹이 '내 직군 리그'로 둔갑 — 그게 곧 GROMO-644).
//   ※ '전체' 탭의 진짜 전역 랭킹은 별도 useGlobalRanking 이 담당한다(직군 리스트 재사용 금지).
// - 멤버 tierLevel은 응답에 없어 호출부가 넘긴 tierLevel(내 티어)을 임시로 부여한다(직군 리그는 실제론
//   교차 티어라 근사값 — 멤버별 티어 노출은 백엔드 확장 후 TODO).
export function useLeagueRanking(tierLevel = 1) {
  const myCategory = useFocusCategory();
  const { nickname: myNickname, userId } = useUser();

  // 서버 멤버 원본(tierLevel 제외 — 렌더 시 파라미터로 주입)과 리그 라벨을 원자적으로 함께 보관한다.
  // label: 직군 랭킹을 실제로 받았을 때만 내 카테고리, 전역 폴백/직군 미설정이면 null(=전체 리그).
  // 전체 값이 null이면 미조회/게스트/실패/미배정 → 화면은 빈 상태.
  const [state, setState] = useState<{
    members: Omit<RankedMember, 'tierLevel'>[];
    label: string | null;
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setState(null);
        return;
      }
      let cancelled = false;
      (async () => {
        try {
          // 직군 리그 = 같은 Occupation 전역 랭킹(?category=). 로컬 focusCategory(한글)를 서버 enum으로
          // 변환해 넘긴다. 미전달 시 서버가 내 아레나 멤버를 돌려줘 '아레나로 표시'되는 버그(GROMO-644).
          const occupation = occupationForCategory(myCategory);
          let res = await getMyRanking(occupation ?? undefined);
          // 직군 랭킹을 실제로 받아온 경우에만 리그 라벨을 내 카테고리로 확정한다.
          let label: string | null = occupation != null ? myCategory : null;
          // 직군 랭킹이 비면(신규·직군 미설정, GROMO-657) 전역 랭킹으로 폴백해 화면이 비지 않게 한다.
          // 전역 랭킹은 혼합 직군이라 라벨을 붙이지 않는다(전체 리그로 정직하게 표기).
          if (res.length === 0) {
            res = await getGlobalRanking();
            label = null;
          }
          if (cancelled) return;
          setState({ label, members: toRankingMembers(res, userId, myNickname, label) });
        } catch {
          if (!cancelled) setState(null); // 네트워크/인증 실패 → 빈 상태
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [userId, myCategory, myNickname]),
  );

  // 멤버별 tierLevel 주입(직군 리그는 교차 티어라 내 티어 근사). 데이터 없으면 빈 배열.
  const ranking: RankedMember[] = state ? state.members.map((m) => ({ ...m, tierLevel })) : [];

  const me = ranking.find((m) => m.userId === MY_USER_ID);
  const myLeagueLabel = state?.label ?? null;
  const myMinutes = me?.totalFocusMinutes ?? 0;

  // 내 직군 리그 내 순위 (1-base) — 직군 랭킹을 받았고(label!=null) 내가 그 안에 있을 때만.
  // 전역 폴백/미배정은 '내 직군 리그'가 없으므로 null(홈 상단바는 null이면 순위 배지 숨김).
  const myLeagueRank =
    me != null && myLeagueLabel != null
      ? ranking.filter((m) => m.exam === myLeagueLabel).findIndex((m) => m.userId === MY_USER_ID) +
        1
      : null;

  return { ranking, me, myLeagueLabel, myMinutes, myLeagueRank };
}
