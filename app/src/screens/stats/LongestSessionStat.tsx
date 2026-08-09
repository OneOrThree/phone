// 최장 연속 집중(일·주·월) — 기간 내 가장 긴 세션(endedAt−startedAt, 방해시간 미차감)을 HH:MM:SS로.
// 기간 귀속은 앱의 '오늘' 규칙(홈 정산·타임테이블)과 동일하게 종료 시점 기준 — 기간 시작 하루 전부터
// 받아 endedAt으로 거른다. 월은 이달 1일부터('N월 주별'류의 주 정렬과 달리 달 자체의 기록이라 1일 기준).
import { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { StatsPeriod } from '@/types/dto/stats';
import { fetchTodayFocusSessions, sessionFocusSeconds } from '@/screens/focus/focusRestore';
import { getAllFocusSessions } from '@/services/focusApi';
import type { FocusSessionResponse } from '@/types/dto/focus';
import { hms } from '@/utils/timeFormat';
import { localDateStr } from '@/utils/localDate';
import { kstTodayDate } from './format';
import { LONGEST_BODY_H } from './constants';
import { CardBodyLoading } from './CardBodyLoading';
import { cs } from './cardStyles';

export function LongestSessionStat({ period }: { period: StatsPeriod }) {
  const [seconds, setSeconds] = useState<number | null>(null); // null=로딩 · 0=기록 없음

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 반영(타임테이블과 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        let sessions: FocusSessionResponse[];
        if (period === 'DAY') {
          sessions = await fetchTodayFocusSessions().catch(() => []);
        } else {
          // 기간 시작(KST 자정 '순간'): 주=이번 주 월요일, 월=이달 1일 — 같은 화면의 주간/월간
          // 총계(KST 집계)와 같은 창(GROMO-1236 P2 4라운드). 세션 자체의 표시는 타임스탬프 그대로.
          // +09:00 고정 오프셋은 KST가 DST 없는 존이라 안전(FirstStartChart와 동일).
          const now = new Date();
          const kstNow = kstTodayDate();
          const dow = kstNow.getDay(); // 0=일..6=토
          const startDay =
            period === 'WEEK'
              ? new Date(
                  kstNow.getFullYear(),
                  kstNow.getMonth(),
                  kstNow.getDate() + (dow === 0 ? -6 : 1 - dow),
                )
              : new Date(kstNow.getFullYear(), kstNow.getMonth(), 1);
          const start = new Date(`${localDateStr(startDay)}T00:00:00+09:00`);
          // 자정 걸친 세션 포함 위해 하루 전부터 받아 endedAt으로 거른다(fetchTodayFocusSessions와 동일 방식)
          const from = new Date(start.getTime() - 86_400_000);
          const all = await getAllFocusSessions(from.toISOString(), now.toISOString()).catch(
            () => [] as FocusSessionResponse[],
          );
          sessions = all.filter((x) => Date.parse(x.endedAt) >= start.getTime());
        }
        if (cancelled) return;
        setSeconds(sessions.reduce((mx, x) => Math.max(mx, sessionFocusSeconds(x)), 0));
      })();
      return () => {
        cancelled = true;
      };
    }, [period]),
  );

  if (seconds === null) {
    return <CardBodyLoading height={LONGEST_BODY_H} testID="stats.longest.loading" />;
  }
  if (seconds <= 0) {
    return <Text style={cs.emptyText}>아직 기록이 없어요</Text>;
  }
  return (
    <View>
      <Text style={cs.bigStat}>{hms(seconds)}</Text>
      <Text style={cs.grassHint}>한 번에 가장 오래 이어간 집중 세션이에요</Text>
    </View>
  );
}
