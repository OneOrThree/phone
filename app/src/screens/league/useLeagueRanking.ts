import { useCallback, useRef, useState } from 'react';
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
      // GROMO-1630 서버 판정 친구 여부 — 미배포 서버 호환(undefined)은 소비처의 ?? false가 흡수
      isFriend: m.isFriend,
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

// 이번 리그 주 시작(월요일 00:00 KST) — 서버 리그 주(LeagueWeek, Asia/Seoul 고정)와 같은 기준.
// 기기 로컬로 계산하면 해외 타임존에서 주 경계가 서버와 몇 시간씩 어긋난다(PR 291 코덱스 리뷰).
// KST는 서머타임이 없어 고정 오프셋(UTC+9) 계산으로 충분하다.
const KST_OFFSET_MS = 9 * 3600 * 1000;
function leagueWeekStart(): Date {
  const kst = new Date(Date.now() + KST_OFFSET_MS); // UTC 필드가 KST 벽시계를 가리키도록 이동
  kst.setUTCHours(0, 0, 0, 0);
  kst.setUTCDate(kst.getUTCDate() - ((kst.getUTCDay() + 6) % 7)); // getUTCDay(): 0=일 … 1=월
  return new Date(kst.getTime() - KST_OFFSET_MS); // 이동분을 되돌려 실제 시각(epoch)으로 복원
}

// 내 이번 주 집중초 — 내 세션 합산으로 직접 구하는 '권위 값'.
// 랭킹 리스트에서 뽑지 않는 이유: /league/me/ranking은 category 유무와 무관하게 '상위 100명'
// 리스트라 나를 포함한다는 보장이 없다(GROMO-818에서 아레나 로스터 응답이 사라져 구 가정
// "getMyRanking() = 내 아레나, 항상 나 포함"이 깨짐 — PR 285 Codex 리뷰 반영). top-100 밖이면
// 내 분이 0으로 떨어져 TierGuide 진행바·핀 격차가 조용히 틀어진다.
// 서버 주간 집계(DailyFocusStat)도 방해(일시정지) 초를 뺀 순수 집중 시간이라 정의가 일치한다
// — sessionFocusSeconds가 같은 공식으로 깎는다(GROMO-1214 코드리뷰 ⑥). 안 깎으면 일시정지가
// 낀 주에 내 시간만 부풀어 서버 랭킹 값과 어긋난다.
// ※ getMyRank(/league/me/rank)의 호출당 LEAGUE_RANK_VIEWED 계측은 서버에서 제거돼 이제 화면에서도
//   쓸 수 있다 — 단 전역(전체 리그) 순위만 준다. 여기 주간분은 세션 합산 정의라 기존 방식 유지.
// 초 원본을 반환한다 — 리그 화면은 실초(HH:MM:SS) 격차/델타, 티어가이드는 파생 분(secToMin)을 쓴다.
async function fetchMyWeekSeconds(): Promise<number> {
  const weekStart = leagueWeekStart();
  // 서버 조회 필터는 startedAt 기준이라 일요일 밤에 시작해 월요일에 끝난 세션이 주 시작 이후
  // 조회에서 통째로 빠진다 — 서버 주간 집계는 endedAt 날짜 버킷이라 그 세션도 새 주에 포함된다.
  // 주 시작 24시간 전부터 받아 endedAt이 주 시작 이후인 세션만 합산한다(PR 291 리뷰 반영,
  // 24시간을 넘겨 경계를 걸치는 단일 세션은 현실적으로 없음).
  const fetchFrom = new Date(weekStart.getTime() - 24 * 3600 * 1000);
  const sessions = await getAllFocusSessions(fetchFrom.toISOString(), new Date().toISOString());
  return sessions
    .filter((s) => Date.parse(s.endedAt) >= weekStart.getTime())
    .reduce((acc, s) => acc + sessionFocusSeconds(s), 0);
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
  // 전체가 null이면 미조회/실패 → 화면은 빈 상태.
  // forCategory: 이 데이터를 조회한 시점의 내 카테고리 — 실패 시 유지/폐기 판단 기준(아래 catch).
  const [state, setState] = useState<{
    members: RankedMember[];
    label: string | null;
    mySeconds: number;
    forCategory: string | null;
  } | null>(null);
  // 마지막 조회 실패 여부 — 실패가 "리그에 아무도 없음" 빈 상태로 오인되지 않게 UI에서 구분
  // (GROMO-922, 친구 목록 GROMO-621과 동일 패턴)
  const [error, setError] = useState(false);
  // 요청 시퀀스 — 당겨서 새로고침(GROMO-887)과 포커스 재조회가 겹칠 때, 늦게 온 이전 응답이
  // 최신 상태를 덮지 않게 최신 요청만 반영한다(useFriends 패턴).
  const requestSeqRef = useRef(0);

  // 직군 랭킹·내 주간분 재조회 — 포커스 effect와 당겨서 새로고침(GROMO-887)이 공유한다.
  const refetch = useCallback(async () => {
    if (!userId) {
      setState(null);
      setError(false); // 세션 없음(JWT 디코드 실패)은 조회 실패가 아니다 — 안내를 띄우지 않는다
      return;
    }
    // 카테고리 저장값을 아직 읽는 중(undefined) — 확정(null/string) 후 한 번만 조회한다.
    // 로딩 순간을 무직군으로 오판해 전역 랭킹을 먼저 그렸다가 다시 그리는 이중 조회 방지.
    if (myCategory === undefined) return;
    const seq = ++requestSeqRef.current;
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
      // 이 응답을 기다리는 동안 더 새로운 요청이 시작됐으면 stale 결과라 버린다
      if (seq !== requestSeqRef.current) return;
      setState({
        label,
        members: toRankingMembers(res, userId, myNickname, label),
        mySeconds: myWeekSeconds,
        forCategory: myCategory ?? null,
      });
      setError(false);
    } catch {
      // 일시 실패 시 기존 랭킹 유지 — 당겨서 새로고침 실패로 보이던 목록이 사라지지 않게 한다
      // (친구 목록과 동일 정책, 코드리뷰 반영). 단 같은 카테고리로 받은 데이터일 때만 —
      // 시험(카테고리) 변경 후 첫 조회가 실패하면 이전 카테고리 리그가 '내 리그'로 계속 보이므로
      // 비운다(코드리뷰 반영). 이전 데이터가 없으면 그대로 빈 상태.
      if (seq === requestSeqRef.current) {
        setState((prev) =>
          prev != null && prev.forCategory !== (myCategory ?? null) ? null : prev,
        );
        setError(true);
      }
    }
  }, [userId, myCategory, myNickname]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
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

  // 조회 '의도' 라벨 — 카테고리에서 직접 파생하므로 조회 성패와 무관하게 확정된다. 실패로
  // myLeagueLabel을 못 받았을 때도 화면이 '내 리그'가 무엇인지 알 수 있게 노출한다(GROMO-922
  // 코드리뷰 반영). 빈 성공의 전역 폴백(GROMO-657) label=null과 달리 직군 미배정일 때만 null.
  const intendedLeagueLabel =
    occupationForCategory(myCategory) != null ? (myCategory ?? null) : null;

  return {
    ranking,
    me,
    myLeagueLabel,
    intendedLeagueLabel,
    myMinutes,
    mySeconds,
    myLeagueRank,
    error,
    refetch,
  };
}
