import { useFocusCategory } from '@/hooks/useFocusCategory';
import { useUser } from '@/store/UserContext';
import { useSubjects } from '@/store/SubjectContext';
import { MY_USER_ID, RANKING, type RankedMember } from './mock';

// 리그 랭킹(mock) + 내 행 실데이터 보정·시간순 정렬 — 리그 화면과 홈 상단바가 공유.
// 내 행: 닉네임(UserContext)·시험(온보딩 focusCategory)·총 공부시간(과목 누적 합).
// TODO: 리그 API 연동 시 fetch 결과로 대체
export function useLeagueRanking() {
  const myCategory = useFocusCategory();
  const { nickname: myNickname } = useUser();
  const { subjects } = useSubjects();

  const myMinutes = Math.round(subjects.reduce((acc, sub) => acc + sub.accumulatedSeconds, 0) / 60);

  const ranking: RankedMember[] = RANKING.map((m) =>
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
  const myLeagueLabel = me?.exam ?? null;

  // 내 시험 리그 내 순위 (1-base) — 내 정보가 없으면 null
  const myLeagueRank =
    me != null && myLeagueLabel != null
      ? ranking.filter((m) => m.exam === myLeagueLabel).findIndex((m) => m.userId === MY_USER_ID) +
        1
      : null;

  return { ranking, me, myLeagueLabel, myMinutes, myLeagueRank };
}
