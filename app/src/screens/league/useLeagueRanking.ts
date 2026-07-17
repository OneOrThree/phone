import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useFocusCategory } from '@/hooks/useFocusCategory';
import { useUser } from '@/store/UserContext';
import { getMyRanking, getGlobalRanking } from '@/services/leagueApi';
import { occupationForCategory } from '@/constants/focusCategories';
import type { LeagueMemberResponse } from '@/types/api';
import { MY_USER_ID, type RankedMember } from './mock';

// 서버는 초 단위(GROMO-665) — 화면/누적은 분 도메인이라 경계에서 분으로 내린다.
const secToMin = (seconds: number): number => Math.floor(seconds / 60);

// 서버 랭킹 응답(LeagueMemberResponse) → 화면 RankedMember.
// 직군 리그(useLeagueRanking)·전체 리그(useGlobalRanking)가 공유하는 단일 변환기.
// - 내 행은 화면 로직(=== MY_USER_ID)을 그대로 쓰도록 userId를 MY_USER_ID 센티널로 치환.
// - tierLevel은 서버가 주는 멤버별 실제 티어(GROMO-748) — 구 '내 티어 임시 부여' 제거.
// - exam(리그 라벨)은 호출부가 넘긴 label: 직군 랭킹이면 내 카테고리, 전역이면 null(혼합 직군 → '').
// - 프로필 상세 필드(달성률·스트릭·기록)는 랭킹 응답에 없어 0 — 프로필 조회(GROMO-539/557)에서 채운다.
export function toRankingMembers(
  res: LeagueMemberResponse[],
  userId: string,
  myNickname: string | null,
  label: string | null,
): RankedMember[] {
  return res.map((m) => {
    const isMe = m.userId === userId;
    return {
      rank: m.rank,
      userId: isMe ? MY_USER_ID : m.userId,
      nickname: isMe ? myNickname || m.nickname : m.nickname,
      tierLevel: m.tierLevel,
      totalFocusSeconds: m.totalFocusSeconds,
      // GROMO-824 라이브 필드(810·811·812) — /league/me/ranking은 항상 채워주고, 전역
      // 랭킹(/league/ranking)은 스코프 밖이라 기본값(false/0/null/null)이 온다
      isFocusing: m.isFocusing,
      focusTimeMinutes: m.focusTimeMinutes,
      focusStartedAt: m.focusStartedAt,
      focusTagName: m.focusTagName,
      exam: label ?? '',
      achievedRate: 0,
      friendCount: 0,
      streakDays: 0,
      bestRank: m.rank,
      bestWeekMinutes: secToMin(m.totalFocusSeconds),
    };
  });
}

// 내 이번 주 집중분 — 내 ACTIVE 아레나 로스터에서 뽑는 '권위 값'.
// 직군 top-100 리스트가 아니라 로스터에서 뽑는 이유: 활성 유저 많은 직군(수능·공무원 등)은 100위 밖이
// 흔한데, top-100에 내가 없으면 리스트로는 내 분이 0으로 떨어져 TierGuide 진행바·핀 격차가 조용히
// 틀어진다(GROMO-644 회귀). 아레나 로스터(getMyRanking() = findActiveMembership 기반)는 항상 나를
// 포함하므로 실제 분을 보장한다(내가 top-100 안이면 리스트의 내 분과 같은 값 — 같은 주간 집계라 일치).
// 미배정/게스트면 로스터가 비어 0. ※ getMyRank(/league/me/rank)는 호출마다 LEAGUE_RANK_VIEWED를 남겨
// 화면 포커스마다 부르면 계측이 오염되므로, 로깅 없는 getMyRanking을 재사용한다.
// 초 원본을 반환한다 — 리그 화면은 실초(HH:MM:SS) 격차/델타, 티어가이드는 파생 분(secToMin)을 쓴다.
function pickMySeconds(roster: LeagueMemberResponse[], userId: string): number {
  return roster.find((m) => m.userId === userId)?.totalFocusSeconds ?? 0;
}

// 직군 리그 랭킹 — 리그 화면 '직군' 탭·홈 상단바가 공유. 서버 실데이터 전용(GROMO-538, mock 폴백 없음).
// - 리스트(ranking): 직군 = 같은 Occupation 전역 상위 100명(GET /league/me/ranking?category=). category를
//   넘겨야 내 아레나가 아닌 직군 랭킹이 온다(GROMO-644). 비면(신규·직군 미설정) 전역으로 폴백하되
//   혼합 직군이라 라벨은 붙이지 않는다(GROMO-657). ※ '전체' 탭의 진짜 전역 랭킹은 별도 useGlobalRanking.
// - mySeconds/myMinutes: 위 top-100 리스트가 아니라 내 아레나 로스터에서 뽑는다(pickMySeconds) — top-100 밖 유저도
//   내 실제 주간분이 정확. myLeagueRank는 직군 리스트 내 위치(리그 탭과 동일 원천) — top-100 밖이면 null이라
//   순위는 '값 없음'으로 정직하게 비운다(홈 배지 숨김). 리그 탭도 나를 못 찾으므로 화면 간 이야기가 일치.
// - 멤버 tierLevel은 서버 응답의 실제 티어(GROMO-748).
export function useLeagueRanking() {
  const myCategory = useFocusCategory();
  const { nickname: myNickname, userId } = useUser();

  // 리스트(직군 top-100)·리그 라벨·내 권위 주간분을 원자적으로 함께 보관한다.
  // 전체가 null이면 미조회/게스트/실패 → 화면은 빈 상태.
  const [state, setState] = useState<{
    members: RankedMember[];
    label: string | null;
    mySeconds: number;
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
          // 직군 top-100(표시용 리스트)과 내 아레나 로스터(권위 있는 내 주간분)를 병렬 조회한다.
          // occupation 지정 시 res는 직군 top-100이라 나를 포함하지 않을 수 있어 아레나 로스터를 따로 받고,
          // 미지정 시엔 res가 곧 내 아레나 로스터라 그대로 재사용해 중복 호출을 피한다.
          const occupation = occupationForCategory(myCategory);
          const [occRanking, arenaRoster] = await Promise.all([
            getMyRanking(occupation ?? undefined),
            occupation != null
              ? getMyRanking()
              : Promise.resolve<LeagueMemberResponse[] | null>(null),
          ]);
          let res = occRanking;
          let label: string | null = occupation != null ? myCategory : null;
          const roster = arenaRoster ?? occRanking;
          // 직군 랭킹이 비면(신규·직군 미설정, GROMO-657) 전역 랭킹으로 폴백해 화면이 비지 않게 한다.
          // 전역 랭킹은 혼합 직군이라 라벨을 붙이지 않는다(전체 리그로 정직하게 표기).
          if (res.length === 0) {
            res = await getGlobalRanking();
            label = null;
          }
          if (cancelled) return;
          setState({
            label,
            members: toRankingMembers(res, userId, myNickname, label),
            mySeconds: pickMySeconds(roster, userId),
          });
        } catch {
          if (!cancelled) setState(null); // 네트워크/인증 실패 → 빈 상태
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [userId, myCategory, myNickname]),
  );

  // 데이터 없으면 빈 배열.
  const ranking: RankedMember[] = state?.members ?? [];

  const me = ranking.find((m) => m.userId === MY_USER_ID);
  const myLeagueLabel = state?.label ?? null;
  // 내 주간 집중은 아레나 로스터 기준(직군 top-100 밖이어도 정확). 미배정/게스트면 0.
  // 초 원본(mySeconds) + 파생 분(myMinutes) 둘 다 노출 — 리그 화면은 초, 티어가이드·홈은 분.
  const mySeconds = state?.mySeconds ?? 0;
  const myMinutes = secToMin(mySeconds);

  // 내 직군 리그 내 순위 (1-base) — 직군 랭킹을 받았고(label!=null) 내가 그 top-100 안에 있을 때만.
  // 전역 폴백/미배정/100위 밖은 '내 직군 순위'를 알 수 없어 null(홈 상단바는 null이면 순위 배지 숨김).
  const myLeagueRank =
    me != null && myLeagueLabel != null
      ? ranking.filter((m) => m.exam === myLeagueLabel).findIndex((m) => m.userId === MY_USER_ID) +
        1
      : null;

  return { ranking, me, myLeagueLabel, myMinutes, mySeconds, myLeagueRank };
}
