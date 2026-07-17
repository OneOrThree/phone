import { useCallback, useRef } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getLastResult } from '@/services/leagueApi';
import type { V2RootStackParamList } from '@/navigation/types';

// 서버 result enum → 연출 타입 매핑. 모르는 값(추후 RELEGATE_WARNING 등 확장 대비)은
// 오연출(승격/강등)보다 안전한 유지로 폴백한다 (GROMO-831).
const RESULT_TYPE: Record<string, 'promote' | 'maintain' | 'demote'> = {
  PROMOTED: 'promote',
  STAY: 'maintain',
  RELEGATED: 'demote',
};

// 리그 탭 포커스마다 주간 마감 결과(GET /league/me/last-result)를 조회해,
// 미확인(hasResult && !acknowledged) 결과가 있으면 결과 연출 화면(LeagueResult)으로 진입한다.
// ack는 결과 화면이 닫힐 때 화면 쪽에서 보낸다. 같은 주차는 마운트 세션 내 1회만 —
// 결과 화면에서 돌아온 직후 재포커스 시 ack 반영이 아직 안 됐어도 재진입하지 않는다.
export function useLeagueLastResult() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const shownWeek = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const res = await getLastResult();
          if (cancelled || !res.hasResult || res.acknowledged) return;
          if (res.weekStartAt == null || shownWeek.current === res.weekStartAt) return;
          shownWeek.current = res.weekStartAt;
          navigation.navigate('LeagueResult', {
            type: RESULT_TYPE[res.result ?? ''] ?? 'maintain',
            fromLevel: res.previousTierLevel ?? 1,
            toLevel: res.newTierLevel ?? res.previousTierLevel ?? 1,
            weekHours: (res.focusSeconds ?? 0) / 3600,
            weekStartAt: res.weekStartAt,
          });
        } catch {
          // 조회 실패는 조용히 무시 — 결과 노출은 부가 기능이라 리그 화면을 막지 않고 다음 포커스에 재시도
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [navigation]),
  );
}
