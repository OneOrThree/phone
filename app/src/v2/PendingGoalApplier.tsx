import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from '@/store/UserContext';
import { updateFocusTimeGoal, updateScreenTimeGoal } from '@/services/userApi';
import { STORAGE_KEYS } from '@/types/storage';

// 예약된 목표('내일부터 적용')를 발효일이 지나면 적용한다.
// GoalsScreen은 저장 시 컨텍스트·서버를 건드리지 않고 goalPending에만 예약을 남긴다
// (그래서 목표를 바꾼 '오늘'의 보상 기준은 그대로 유지된다). 여기서 앱이 뜰 때
// 발효일(effectiveDate <= 오늘)에 도달한 예약을 컨텍스트+서버에 반영하고 예약을 지운다.

interface PendingGoal {
  dailyFocusTimeGoalMinutes?: number;
  dailyScreenTimeGoalMinutes?: number;
  effectiveDate?: string; // 'YYYY-MM-DD'(로컬)
}

// Date → 'YYYY-MM-DD'(로컬 기준)
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function PendingGoalApplier() {
  const { setGoalSeconds, setScreenTimeGoalSeconds } = useUser();

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.goalPending);
      if (!raw) return;

      let pending: PendingGoal;
      try {
        pending = JSON.parse(raw) as PendingGoal;
      } catch {
        await AsyncStorage.removeItem(STORAGE_KEYS.goalPending); // 깨진 값은 정리
        return;
      }

      // 발효 전이면 그대로 둔다(ISO 날짜는 문자열 비교로 대소 판정이 정확).
      if (!pending.effectiveDate || pending.effectiveDate > toISODate(new Date())) return;

      // 발효 — 컨텍스트 즉시 반영 + 서버 반영 후 예약 삭제.
      if (typeof pending.dailyFocusTimeGoalMinutes === 'number') {
        setGoalSeconds(pending.dailyFocusTimeGoalMinutes * 60);
        try {
          await updateFocusTimeGoal({
            dailyFocusTimeGoalMinutes: pending.dailyFocusTimeGoalMinutes,
          });
        } catch {
          // 서버 반영 실패는 무시 — 다음 실행에서 재시도(예약은 아래에서 지우므로 캐치)
        }
      }
      if (typeof pending.dailyScreenTimeGoalMinutes === 'number') {
        setScreenTimeGoalSeconds(pending.dailyScreenTimeGoalMinutes * 60);
        try {
          await updateScreenTimeGoal({
            dailyScreenTimeGoalMinutes: pending.dailyScreenTimeGoalMinutes,
          });
        } catch {
          // 서버 반영 실패는 무시
        }
      }
      await AsyncStorage.removeItem(STORAGE_KEYS.goalPending);
    })();
  }, [setGoalSeconds, setScreenTimeGoalSeconds]);

  return null;
}
