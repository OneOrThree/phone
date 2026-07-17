import { useCallback, useRef } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ackLastResult, getLastResult } from '@/services/leagueApi';
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
// ack는 결과 화면이 닫힐 때 화면 쪽에서 보낸다. 같은 주차는 마운트 세션 내 1회만 노출 —
// 리그 화면은 탭 하위라 언마운트되지 않아 shownWeek이 앱 세션 동안 유지된다.
// 이미 보여준 주차가 여전히 미확인으로 조회되면(닫힘 시점 ack 실패·반영 지연) 재노출하지
// 않고 여기서 ack를 조용히 재시도한다 — 서버가 멱등이라 반영 지연과의 중복 전송도 안전.
export function useLeagueLastResult() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const shownWeek = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const res = await getLastResult();
          if (cancelled || !res.hasResult || res.acknowledged || res.weekStartAt == null) return;
          if (shownWeek.current === res.weekStartAt) {
            // 이미 노출한 주차가 아직 미확인 — 화면 닫힘 시점의 ack가 실패했거나 반영 전.
            // 유저에게 같은 연출을 또 보여주는 대신 확인 처리만 재시도한다.
            ackLastResult(res.weekStartAt).catch(() => {});
            return;
          }
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
