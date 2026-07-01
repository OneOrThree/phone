import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import ScreenTimeModule from '@/services/ScreenTimeModule';

// 오늘의 폰 사용량(분)을 30분 버킷으로 반환.
// - 마운트 시 버킷 모니터링 1회 등록(측정 대상 선택돼 있어야 실제 발화)
// - getTodayUsageBucketMinutes를 30초 폴링 + 앱 포그라운드 복귀 시 갱신
// 실기기 iOS16+에서만 실값. 그 외/미측정은 0. 값은 30분 단위 근사(도달 최고 눈금).
export function useScreenTimeUsage(goalMinutes: number): number {
  const [usageMinutes, setUsageMinutes] = useState(0);
  // 등록은 1회만 — 재등록이 당일 누적을 리셋할 수 있어(실기기 확인사항) 최초 goal로 고정.
  const goalRef = useRef(goalMinutes);

  // 버킷 모니터링 등록 (목표 + 여유 3시간, 네이티브가 720분/24개로 상한)
  useEffect(() => {
    const maxMinutes = Math.min(720, Math.max(30, Math.ceil(goalRef.current / 30) * 30 + 180));
    ScreenTimeModule.startUsageBucketMonitoring(maxMinutes).catch(() => {});
  }, []);

  // 사용량 폴링 + 포그라운드 복귀 시 즉시 갱신
  useEffect(() => {
    let alive = true;
    const fetchUsage = async () => {
      const m = await ScreenTimeModule.getTodayUsageBucketMinutes();
      if (alive) setUsageMinutes(m);
    };
    fetchUsage();
    const timer = setInterval(fetchUsage, 30000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchUsage();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  return usageMinutes;
}
