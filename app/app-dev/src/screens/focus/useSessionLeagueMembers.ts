import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getMyRanking } from '@/services/leagueApi';
import type { LiveGridMember } from './components/LiveFocusGrid';

// 집중 세션 리그(811)·같은 시험(812) 그리드용 라이브 멤버 — GET /league/me/ranking(?category=).
// GROMO-824 가 라이브 필드를 채워주는 엔드포인트는 이것뿐이다(/league/ranking 은 라이브 미포함):
//   occupation 미지정 = 전역 주간 상위 100(811, 전체 리그와 같은 모수), 지정 = 같은 occupation 상위 100(812).
// 미배포 서버 응답(필드 없음)은 전원 미집중·0분 폴백.
// enabled=false(812에서 준비 시험 미설정)면 조회하지 않고 빈 목록을 유지한다.

const DEFAULT_POLL_MS = 60_000;

export function useSessionLeagueMembers({
  occupation,
  excludeUserId,
  enabled = true,
  pollMs = DEFAULT_POLL_MS,
}: {
  occupation?: string;
  /** 내 행 제외용 — 내 셀은 그리드가 로컬 타이머 기준으로 따로 렌더한다(GROMO-932) */
  excludeUserId?: string | null;
  enabled?: boolean;
  pollMs?: number;
}) {
  const [members, setMembers] = useState<LiveGridMember[]>([]);
  // 요청 세대 — 폴링·포그라운드 복귀·occupation 변경으로 요청이 겹칠 때 늦게 도착한
  // 구세대 응답이 최신 결과를 덮어쓰지 않게 폐기한다(코덱스 리뷰)
  const requestSeqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    try {
      const res = await getMyRanking(occupation);
      if (seq !== requestSeqRef.current) return;
      // 서버가 준 top-100을 자르지 않고 전부 넘긴다 — 종전엔 상위 12명만 남겼는데, 서버 순서가
      // '주간 랭킹'이라 지금 집중 중인 사람이 13위~에 몰려 통째로 잘려 나갔다(배너 인원도 같이
      // 과소집계). 렌더 비용은 그리드가 가상화(FlatList)·셀 memo·페이지 밖 시계 정지로 감당한다.
      // 표시 순서(핀 → 집중중 → 시간순)는 그리드가 잡으므로 여기선 선별만 한다.
      setMembers(
        res
          .filter((m) => m.userId !== excludeUserId)
          .map((m) => ({
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
  }, [occupation, excludeUserId]);

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
