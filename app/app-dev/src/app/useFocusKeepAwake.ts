import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useId, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

/** 카메라와 독립적으로, 전경의 활성 집중 동안 자동 잠금을 막는다. */
export function useFocusKeepAwake(enabled: boolean) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const owner = useId();
  const generation = useRef(0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) =>
      setForeground(next === 'active'),
    );
    setForeground(AppState.currentState === 'active');
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!enabled || !foreground || Platform.OS === 'web') return;
    // 늦게 끝난 이전 활성화의 해제가 재개한 집중·AI 카메라의 태그를 건드리지 않게 한다.
    const tag = `cattus-focus-${owner}-${++generation.current}`;
    let disposed = false;
    const release = async () => {
      try {
        await deactivateKeepAwake(tag);
      } catch {
        // Android Activity가 이미 정리된 경우에도 화면 이탈을 막지 않는다.
      }
    };
    void (async () => {
      try {
        await activateKeepAwakeAsync(tag);
        if (disposed) await release();
      } catch {
        // 일시적인 Activity 부재는 다음 전경 진입 때 다시 요청한다.
      }
    })();
    return () => {
      disposed = true;
      void release();
    };
  }, [enabled, foreground, owner]);
}
