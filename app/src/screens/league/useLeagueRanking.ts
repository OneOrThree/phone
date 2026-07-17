import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useFocusCategory } from '@/hooks/useFocusCategory';
import { useUser } from '@/store/UserContext';
import { getMyRanking, getGlobalRanking } from '@/services/leagueApi';
import { getAllFocusSessions } from '@/services/focusApi';
import { sessionFocusSeconds } from '@/screens/focus/focusRestore';
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

// 이번 리그 주 시작(월요일 00:00, 기기 로컬) — 서버 리그 주(월요일 시작)와 같은 기준.
function leagueWeekStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // getDay(): 0=일 … 1=월
  return d;
}

// 내 이번 주 집중초 — 내 세션 합산으로 직접 구하는 '권위 값'.
// 랭킹 리스트에서 뽑지 않는 이유: /league/me/ranking은 category 유무와 무관하게 '상위 100명'
// 리스트라 나를 포함한다는 보장이 없다(GROMO-818에서 아레나 로스터 응답이 사라져 구 가정
// "getMyRanking() = 내 아레나, 항상 나 포함"이 깨짐 — PR 285 Codex 리뷰 반영). top-100 밖이면
// 내 분이 0으로 떨어져 TierGuide 진행바·핀 격차가 조용히 틀어진다.
// 서버 주간 집계(DailyFocusStat)도 세션의 순수 경과초(endedAt−startedAt) 누적이라 정의가 일치한다.
// (서버는 endedAt 날짜 버킷, 여기는 startedAt 기간 필터라 자정을 걸친 세션만 미세하게 어긋날 수 있음.)
// ※ getMyRank(/league/me/rank)는 호출마다 LEAGUE_RANK_VIEWED 계측을 남겨 화면 포커스마다 못 쓴다.
// 초 원본을 반환한다 — 리그 화면은 실초(HH:MM:SS) 격차/델타, 티어가이드는 파생 분(secToMin)을 쓴다.
async function fetchMyWeekSeconds(): Promise<number> {
  const sessions = await getAllFocusSessions(
    leagueWeekStart().toISOString(),
    new Date().toISOString(),
  );
  return sessions.reduce((acc, s) => acc + sessionFocusSeconds(s), 0);
}

// 직군 리그 랭킹 — 리그 화면 '직군' 탭·홈 상단바가 공유. 서버 실데이터 전용(GROMO-538, mock 폴백 없음).
// - 리스트(ranking): 직군 = 같은 Occupation 전역 상위 100명(GET /league/me/ranking?category=). category를
//   넘겨야 내 아레나가 아닌 직군 랭킹이 온다(GROMO-644). 비면(신규·직군 미설정) 전역으로 폴백하되
//   혼합 직군이라 라벨은 붙이지 않는다(GROMO-657). ※ '전체' 탭의 진짜 전역 랭킹은 별도 useGlobalRanking.
// - mySeconds/myMinutes: 위 top-100 리스트가 아니라 내 세션 합산에서 구한다(fetchMyWeekSeconds) — top-100 밖
//   유저도 내 실제 주간분이 정확. myLeagueRank는 직군 리스트 내 위치(리그 탭과 동일 원천) — top-100 밖이면 null이라
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
      // 카테고리 저장값을 아직 읽는 중(undefined) — 확정(null/string) 후 한 번만 조회한다.
      // 로딩 순간을 무직군으로 오판해 전역 랭킹을 먼저 그렸다가 다시 그리는 이중 조회 방지.
      if (myCategory === undefined) return;
      let cancelled = false;
      (async () => {
        try {
          // 직군 top-100(표시용 리스트)과 내 주간 집중초(세션 합산 권위 값)를 병렬 조회한다.
          const occupation = occupationForCategory(myCategory);
          const [occRanking, myWeekSeconds] = await Promise.all([
            getMyRanking(occupation ?? undefined),
            fetchMyWeekSeconds(),
          ]);
          let res = occRanking;
          let label: string | null = occupation != null ? (myCategory ?? null) : null;
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
            mySeconds: myWeekSeconds,
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
  // 내 주간 집중은 내 세션 합산 기준(직군 top-100 밖이어도 정확). 세션 없으면 0.
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
