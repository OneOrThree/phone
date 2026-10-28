import React, { useEffect, useState } from 'react';

/**
 * 지금 시각 — intervalMs(벽시계 경계에 맞춤)마다 이 컴포넌트만 다시 그린다. null 이면 타이머 없이
 * 그릴 때의 시각만 읽는다. App 은 분이 바뀔 때만 다시 그리므로 초 단위로 흐르는 표시는 이 훅을 쓴다(GROMO-2372).
 */
export function useNow(intervalMs: number | null = 1000): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (intervalMs == null) return;
    let id: ReturnType<typeof setTimeout>;
    const arm = () => {
      id = setTimeout(
        () => {
          setTick((n) => n + 1);
          arm();
        },
        intervalMs - (Date.now() % intervalMs),
      );
    };
    arm();
    return () => clearTimeout(id);
  }, [intervalMs]);
  return Date.now();
}

/** `at` 시각이 지나면 한 번 다시 그린다 — 매초 그리지 않고 경계(공사 단계 등)에서만 바뀌는 화면용. */
export function useWakeAt(at: number | null | undefined) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (at == null) return;
    // 1ms 늦게 깨워 경계 시각의 부동소수 반올림으로 아직 이전 단계로 계산되는 일을 막는다
    const id = setTimeout(() => setTick((n) => n + 1), Math.max(0, at - Date.now()) + 1);
    return () => clearTimeout(id);
  }, [at]);
}

/** 시각에 따라 바뀌는 글자·작은 조각만 ms 마다 다시 그리는 잎 컴포넌트. 부모는 다시 그리지 않는다. */
export function Ticking({
  ms = 1000,
  children,
}: {
  ms?: number | null;
  children: (now: number) => React.ReactNode;
}) {
  const now = useNow(ms);
  return <>{children(now)}</>;
}
