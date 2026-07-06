import { useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from '@/store/UserContext';
import { updateFocusTimeGoal, updateScreenTimeGoal } from '@/services/userApi';
import { STORAGE_KEYS } from '@/types/storage';

// 예약된 목표('내일부터 적용')를 발효일이 지나면 적용한다.
// GoalsScreen은 저장 시 컨텍스트·서버를 건드리지 않고 goalPending에만 예약을 남긴다
// (그래서 목표를 바꾼 '오늘'의 보상 기준은 그대로 유지된다). 여기서:
//  - 예약한 계정(userId)이 현재 계정과 다르면 적용하지 않는다(디바이스 전역 키라 계정 스코프 필요).
//  - 발효일(effectiveDate <= 오늘)에 도달하면 서버에 먼저 반영하고, 성공한 목표만 컨텍스트에
//    반영한다. 실패한 목표를 선반영하면 로컬(신값)·서버(구값)가 어긋나 앱 재시작 시 서버 구값으로
//    롤백돼 보이고, 목표 화면이 '현재 목표와 동일'로 오판해 예약을 취소하면 변경이 유실된다.
//  - 서버가 모두 성공했을 때만 예약을 지운다(실패 시 다음 실행에서 재시도).
//  - 앱을 켜둔 채 자정을 넘긴 경우 대비 — 포그라운드 복귀(AppState active)마다 재검사한다.

interface PendingGoal {
  userId?: string | null; // 예약한 계정
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
  const { userId, setGoalSeconds, setScreenTimeGoalSeconds } = useUser();

  useEffect(() => {
    let cancelled = false;

    const applyIfDue = async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.goalPending);
      if (!raw || cancelled) return;

      let pending: PendingGoal;
      try {
        pending = JSON.parse(raw) as PendingGoal;
      } catch {
        await AsyncStorage.removeItem(STORAGE_KEYS.goalPending); // 깨진 값은 정리
        return;
      }

      // 다른 계정의 예약이면 적용하지 않는다(로그아웃 시 정리되지만 방어적으로 한 번 더 확인).
      if (pending.userId && pending.userId !== userId) return;

      // 발효 전이면 그대로 둔다(ISO 날짜는 문자열 비교로 대소 판정이 정확).
      if (!pending.effectiveDate || pending.effectiveDate > toISODate(new Date())) return;

      // 발효 — 서버 반영이 성공한 목표만 컨텍스트에 반영. 서버가 모두 성공한 경우에만 예약을 지운다.
      let allSynced = true;
      if (typeof pending.dailyFocusTimeGoalMinutes === 'number') {
        try {
          await updateFocusTimeGoal({
            dailyFocusTimeGoalMinutes: pending.dailyFocusTimeGoalMinutes,
          });
          setGoalSeconds(pending.dailyFocusTimeGoalMinutes * 60);
        } catch {
          allSynced = false; // 서버 실패 → 컨텍스트 미반영 + 예약 유지(재시도)
        }
      }
      if (typeof pending.dailyScreenTimeGoalMinutes === 'number') {
        try {
          await updateScreenTimeGoal({
            dailyScreenTimeGoalMinutes: pending.dailyScreenTimeGoalMinutes,
          });
          setScreenTimeGoalSeconds(pending.dailyScreenTimeGoalMinutes * 60);
        } catch {
          allSynced = false;
        }
      }
      if (allSynced) await AsyncStorage.removeItem(STORAGE_KEYS.goalPending);
    };

    applyIfDue(); // 마운트 시 1회
    // 앱을 켜둔 채 자정을 넘긴 경우 대비 — 포그라운드 복귀마다 재검사.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') applyIfDue();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [userId, setGoalSeconds, setScreenTimeGoalSeconds]);

  return null;
}
