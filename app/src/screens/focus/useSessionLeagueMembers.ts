import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getMyRanking } from '@/services/leagueApi';
import type { LiveGridMember } from './components/LiveFocusGrid';

// 집중 세션 리그(811)·같은 시험(812) 그리드용 라이브 멤버 — GET /league/me/ranking(?category=).
// GROMO-824 가 라이브 필드를 채워주는 엔드포인트는 이것뿐이다(/league/ranking 은 라이브 미포함):
//   occupation 미지정 = 전역 주간 상위 100(811, 전체 리그와 같은 모수), 지정 = 같은 occupation 상위 100(812).
// 미배포 서버 응답(필드 없음)은 전원 미집중·0분 폴백.
// enabled=false(812에서 준비 시험 미설정)면 조회하지 않고 빈 목록을 유지한다.

const DEFAULT_POLL_MS = 60_000;
// 그리드가 세로 스크롤을 지원해도(GROMO-848) top-100 전체 렌더는 과해서 상위 일부만
const MAX_MEMBERS = 12;

export function useSessionLeagueMembers({
  occupation,
  excludeUserId,
  pinnedIds,
  enabled = true,
  pollMs = DEFAULT_POLL_MS,
}: {
  occupation?: string;
  /** 내 행 제외용 — 내 셀은 그리드가 로컬 타이머 기준으로 따로 렌더한다(GROMO-932) */
  excludeUserId?: string | null;
  /** 핀한 유저 ID 집합 — 상한 컷에 잘리지 않게 우선 포함(코덱스 리뷰) */
  pinnedIds?: ReadonlySet<string>;
  enabled?: boolean;
  pollMs?: number;
}) {
  const [members, setMembers] = useState<LiveGridMember[]>([]);

  const refetch = useCallback(async () => {
    try {
      const res = await getMyRanking(occupation);
      // 핀 멤버는 상한 컷 전에 선별(코덱스 리뷰) — 상한 밖 순위(13위~)의 핀이 슬라이스에
      // 잘려 그리드의 핀 우선 정렬이 무효가 되는 것 방지. [핀 전원, 나머지 상위권] 순으로
      // 합친 뒤 상한을 적용한다(최종 표시 순서는 그리드가 다시 정렬).
      const roster = res.filter((m) => m.userId !== excludeUserId);
      const pinned = roster.filter((m) => pinnedIds?.has(m.userId));
      const rest = roster.filter((m) => !pinnedIds?.has(m.userId));
      setMembers(
        [...pinned, ...rest].slice(0, MAX_MEMBERS).map((m) => ({
          userId: m.userId,
          nickname: m.nickname,
          focusTimeMinutes: m.focusTimeMinutes ?? 0,
          isFocusing: m.isFocusing ?? false,
          focusStartedAt: m.focusStartedAt ?? null,
          focusTagName: m.focusTagName ?? null,
        })),
      );
    } catch {
      // 네트워크 실패 시 기존 상태 유지 — 다음 폴링에서 재시도
    }
  }, [occupation, excludeUserId, pinnedIds]);

  // 세션이 길게 떠 있는 화면이라 인터벌 폴링 + 포그라운드 복귀 시 재조회 (useFocusFriends와 동일 패턴)
  // — ended_at이 채워진 멤버는 재조회에서 isFocusing=false로 내려와 오프로 전환된다.
  useEffect(() => {
    if (!enabled) return;
    refetch();
    const timer = setInterval(refetch, pollMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, refetch, pollMs]);

  return { members };
}
