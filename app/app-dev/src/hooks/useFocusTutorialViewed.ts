import { useEffect } from 'react';
import { captureProductEvent } from '@/services/posthog';

/** 집중 튜토리얼(단계 4~21) 각 단계 진입 시 1회 발행한다. 0~3 은 몽돌 안내, 22 이상은 완료·건너뛰기. */
export function useFocusTutorialViewed(step: number): void {
  useEffect(() => {
    if (step >= 4 && step <= 21) captureProductEvent('focus_tutorial_viewed', { step });
  }, [step]);
}
