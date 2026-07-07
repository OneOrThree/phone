import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useFocusCategory } from '@/hooks/useFocusCategory';
import { useUser } from '@/store/UserContext';
import { getMyRanking, getGlobalRanking } from '@/services/leagueApi';
import { occupationForCategory } from '@/constants/focusCategories';
import { MY_USER_ID, type RankedMember } from './mock';

// 리그 랭킹 — 리그 화면·홈 상단바가 공유. 서버(GET /league/me/ranking) 실데이터 전용(GROMO-538).
// 게스트/미배정/실패 시 빈 배열(mock 폴백 없음) — 화면은 빈 상태로 처리한다.
// - 멤버 tierLevel은 아레나가 동일 티어 집단이라 호출부가 넘긴 tierLevel(내 티어)을 부여한다
//   (랭킹 응답엔 멤버별 티어가 없음). 티어 조회는 useLeagueMeta 한 곳에서만 하고 여기로 내려받는다.
// - 내 행은 화면 로직(=== MY_USER_ID)을 그대로 쓰도록 userId를 MY_USER_ID 센티널로 치환.
// - 프로필 상세 필드(달성률·스트릭·기록)는 랭킹 응답에 없어 0 — 프로필 조회(GROMO-539/557)에서 채운다.
export function useLeagueRanking(tierLevel = 1) {
  const myCategory = useFocusCategory();
  const { nickname: myNickname, userId } = useUser();

  // 서버 멤버 원본(tierLevel 제외 — 렌더 시 파라미터로 주입). null이면 미조회/게스트/실패/미배정.
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
          // 직군 리그 = 같은 Occupation 전역 랭킹(?category=). category 미전달 시 서버가 내 아레나
          // 멤버를 돌려주므로(GROMO-644) 로컬 focusCategory(한글명)를 서버 enum으로 변환해 넘긴다.
          const occupation = occupationForCategory(myCategory);
          let res = await getMyRanking(occupation ?? undefined);
          // 아레나/직군 랭킹이 비면(신규·아레나 미배정 유저, GROMO-657) 전체 전역 랭킹으로 폴백해
          // 리그 화면이 완전히 비지 않도록 최소 한 번은 실데이터를 채운다.
          if (res.length === 0) res = await getGlobalRanking();
          if (cancelled) return;
          setMembers(
            res.map((m) => {
              const isMe = m.userId === userId;
              return {
                rank: m.rank,
                userId: isMe ? MY_USER_ID : m.userId,
                nickname: isMe ? myNickname || m.nickname : m.nickname,
                totalFocusMinutes: m.totalFocusMinutes,
                result: m.result,
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
          if (!cancelled) setMembers(null); // 네트워크/인증 실패 → 빈 상태
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [userId, myCategory, myNickname]),
  );

  // 멤버별 tierLevel 주입(아레나 동일 티어). 데이터 없으면 빈 배열.
  const ranking: RankedMember[] = members ? members.map((m) => ({ ...m, tierLevel })) : [];

  const me = ranking.find((m) => m.userId === MY_USER_ID);
  const myLeagueLabel = me?.exam ?? myCategory ?? null;
  const myMinutes = me?.totalFocusMinutes ?? 0;

  // 내 시험 리그 내 순위 (1-base) — 내 정보가 없으면 null
  const myLeagueRank =
    me != null && myLeagueLabel != null
      ? ranking.filter((m) => m.exam === myLeagueLabel).findIndex((m) => m.userId === MY_USER_ID) +
        1
      : null;

  return { ranking, me, myLeagueLabel, myMinutes, myLeagueRank };
}
