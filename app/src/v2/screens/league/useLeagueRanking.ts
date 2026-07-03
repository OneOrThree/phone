import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useFocusCategory } from '@/hooks/useFocusCategory';
import { useUser } from '@/store/UserContext';
import { useSubjects } from '@/store/SubjectContext';
import { getMyRanking, getMyTier } from '@/services/leagueApi';
import { MY_USER_ID, RANKING, type RankedMember } from './mock';

// 리그 랭킹 — 리그 화면·홈 상단바가 공유.
// 서버(GET /league/me/ranking + /league/me/tier) 실데이터 우선, 실패/게스트/미배정 시 mock 폴백(GROMO-538).
// - 아레나는 동일 티어 집단이라 멤버 tierLevel엔 내 티어를 부여(랭킹 응답엔 멤버별 티어가 없음).
// - 내 행은 화면 로직(=== MY_USER_ID)을 그대로 쓰도록 userId를 MY_USER_ID 센티널로 치환.
// - 프로필 상세 필드(달성률·스트릭·기록)는 랭킹 응답에 없어 0 — 프로필 조회(GROMO-539/557)에서 채운다.
export function useLeagueRanking() {
  const myCategory = useFocusCategory();
  const { nickname: myNickname, userId } = useUser();
  const { subjects } = useSubjects();

  const myMinutes = Math.round(subjects.reduce((acc, sub) => acc + sub.accumulatedSeconds, 0) / 60);

  // 서버 랭킹(RankedMember로 매핑됨). null이면 미조회/게스트/실패/미배정 → mock 폴백.
  const [serverRanking, setServerRanking] = useState<RankedMember[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setServerRanking(null);
        return;
      }
      let cancelled = false;
      (async () => {
        try {
          const [members, tier] = await Promise.all([getMyRanking(), getMyTier()]);
          if (cancelled) return;
          if (members.length === 0) {
            setServerRanking(null); // 아레나 미배정(빈 배열) → mock 폴백
            return;
          }
          const myTierLevel = tier.tierLevel ?? 1;
          setServerRanking(
            members.map((m) => {
              const isMe = m.userId === userId;
              return {
                rank: m.rank,
                userId: isMe ? MY_USER_ID : m.userId,
                nickname: isMe ? myNickname || m.nickname : m.nickname,
                totalFocusMinutes: m.totalFocusMinutes,
                result: m.result,
                tierLevel: myTierLevel,
                exam: myCategory ?? '',
                achievedRate: 0,
                friendCount: 0,
                streakDays: 0,
                bestRank: m.rank,
                bestWeekMinutes: m.totalFocusMinutes,
              };
            }),
          );
        } catch {
          if (!cancelled) setServerRanking(null); // 네트워크/인증 실패 → mock 폴백
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [userId, myCategory, myNickname]),
  );

  // 서버 데이터가 있으면 그대로(이미 정렬·내 행 포함), 없으면 mock + 내 행 실데이터 보정.
  const ranking: RankedMember[] =
    serverRanking ??
    RANKING.map((m) =>
      m.userId === MY_USER_ID
        ? {
            ...m,
            nickname: myNickname || m.nickname,
            exam: myCategory ?? m.exam,
            totalFocusMinutes: myMinutes,
          }
        : m,
    ).sort((a, b) => b.totalFocusMinutes - a.totalFocusMinutes);

  const me = ranking.find((m) => m.userId === MY_USER_ID);
  const myLeagueLabel = me?.exam ?? myCategory ?? null;
  // 내 총 집중(분): 서버 랭킹이면 서버 값, mock이면 과목 누적.
  const effectiveMyMinutes = serverRanking ? (me?.totalFocusMinutes ?? myMinutes) : myMinutes;

  // 내 시험 리그 내 순위 (1-base) — 내 정보가 없으면 null
  const myLeagueRank =
    me != null && myLeagueLabel != null
      ? ranking.filter((m) => m.exam === myLeagueLabel).findIndex((m) => m.userId === MY_USER_ID) +
        1
      : null;

  return { ranking, me, myLeagueLabel, myMinutes: effectiveMyMinutes, myLeagueRank };
}
