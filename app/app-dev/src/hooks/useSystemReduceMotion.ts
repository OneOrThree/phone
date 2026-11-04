import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
export function useSystemReduceMotion() {
  const [osReduceMotion, setOsReduceMotion] = useState(false);

  useEffect(() => {
    // 변경 이벤트가 먼저 오면 늦게 끝난 첫 조회가 옛 값으로 덮지 않게 버린다
    let initialPending = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (initialPending) setOsReduceMotion(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      initialPending = false;
      setOsReduceMotion(value);
    });
    return () => {
      initialPending = false;
      subscription?.remove();
    };
  }, []);
  return osReduceMotion;
}
