import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getMyGroups, getGroupDetail } from '@/services/groupApi';
import { todayStr } from '@/utils/localDate';
import type { LiveGridMember } from './components/LiveFocusGrid';

// 집중 세션 '그룹' 페이지용 데이터(F2) — 내가 참여한 '그룹별로' 멤버 목록을 반환한다.
// 페이저가 그룹마다 한 페이지("그룹: {그룹명}")를 그리므로 합집합이 아니라 그룹 단위로 나눠 준다.
// 리그 훅(useSessionLeagueMembers)은 GET /league/me/ranking 이라 그룹으로 필터할 수 없어 재사용 불가:
//   getMyGroups() → 각 그룹 getGroupDetail(groupId, today)의 members[]로 그룹별로 모은다.
//
// ⚠️ 라이브성 한계(F2.8-②): group detail 멤버(GroupDetailMemberResponse)에는
//   isFocusing/focusStartedAt/focusTagName 이 없다 — '지금 집중중'(초록 틱업) 신호가 서버에 없어
//   오늘 집중분(focusTimeMinutes)만 정적으로 표기한다(전원 isFocusing=false). 내 셀만 그리드가
//   로컬 타이머로 라이브 렌더한다(me). 신선도는 60초 폴링 + 포그라운드 복귀(분 단위 스냅샷).

const DEFAULT_POLL_MS = 60_000;
// 한 그룹 그리드에 표기할 멤버 상한(그룹 정원 10 기준 넉넉히) — 과도한 렌더 방지.
const MAX_PER_GROUP = 12;

export interface SessionGroup {
  groupId: string;
  groupName: string;
  members: LiveGridMember[];
}

export function useSessionGroups({
  excludeUserId,
  pollMs = DEFAULT_POLL_MS,
}: {
  /** 각 그룹에서 내 행 제외 — 내 셀은 그리드가 로컬 타이머로 따로 렌더한다(me, GROMO-932) */
  excludeUserId?: string | null;
  pollMs?: number;
}) {
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  // 요청 세대 — 늦게 도착한 구세대 응답이 최신 결과를 덮지 않게 폐기.
  const requestSeqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    try {
      const myGroups = await getMyGroups();
      // 기준일은 한 번만 계산해 병렬 호출에 공유 — 자정 경계에서 그룹별 '오늘 집중분' 기준일이 어긋나지 않게.
      const today = todayStr();
      // 그룹별 상세 병렬 조회 — 일부 그룹 실패는 그 그룹만 건너뛰고 나머지는 살린다.
      const details = await Promise.allSettled(
        myGroups.map((g) => getGroupDetail(g.groupId, today)),
      );
      if (seq !== requestSeqRef.current) return;
      const next: SessionGroup[] = [];
      myGroups.forEach((g, i) => {
        const d = details[i];
        if (d.status !== 'fulfilled') return;
        const members: LiveGridMember[] = [];
        for (const m of d.value.members) {
          if (m.userId === excludeUserId) continue;
          if (members.length >= MAX_PER_GROUP) break;
          members.push({
            userId: m.userId,
            nickname: m.nickname,
            focusTimeMinutes: m.focusTimeMinutes ?? 0,
            // group detail 은 라이브 신호가 없다 — 정적 오늘 집중분만(상단 주석 한계).
            isFocusing: false,
            focusStartedAt: null,
            focusTagName: null,
          });
        }
        next.push({ groupId: g.groupId, groupName: g.name, members });
      });
      setGroups(next);
    } catch {
      // 네트워크 실패 시 기존 상태 유지 — 다음 폴링에서 재시도.
    }
  }, [excludeUserId]);

  // 세션이 길게 떠 있는 화면이라 인터벌 폴링 + 포그라운드 복귀 시 재조회 (리그·친구 훅과 동일 패턴).
  useEffect(() => {
    refetch();
    const timer = setInterval(refetch, pollMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refetch, pollMs]);

  return { groups };
}
