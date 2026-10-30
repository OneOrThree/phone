import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import { getAppRequirements } from '@/services/api/developerNotices';
import { isAppVersion, isBelowMinVersion } from '@/services/developerLetter';

export type ForceUpdate = { title: string; body: string; publishedAt: string | null };

/**
 * 강제 업데이트(GROMO-2617) — 마운트 직후 1회와 백그라운드에서 돌아올 때 1회 최소 버전을 조회한다. 부트를 막지 않는다.
 * 조회 실패·이상한 응답은 상태를 바꾸지 않는다(처음이면 통과, 이미 막혔으면 그대로). 늦게 온 응답은 순번으로 버린다.
 */
export function useForceUpdateLetter({ enabled }: { enabled: boolean }): ForceUpdate | null {
  const [requirement, setRequirement] = useState<ForceUpdate | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
    const platform = Platform.OS;
    const check = () => {
      const mine = ++seq.current;
      Promise.resolve()
        .then(() => getAppRequirements(platform))
        .then((res) => {
          if (mine !== seq.current) return;
          // 해제(공지 없음·충족)와 응답 이상을 가른다 — 이상한 응답은 상태를 바꾸지 않는다
          if (!res || typeof res !== 'object') return;
          const current = Application.nativeApplicationVersion;
          if (res.minVersion === null || !isAppVersion(current)) return setRequirement(null);
          if (!isAppVersion(res.minVersion)) return;
          if (!isBelowMinVersion(current, res.minVersion)) return setRequirement(null);
          if (typeof res.title !== 'string' || typeof res.body !== 'string') return;
          setRequirement({
            title: res.title,
            body: res.body,
            publishedAt: typeof res.publishedAt === 'string' ? res.publishedAt : null,
          });
        })
        .catch(() => {});
    };
    check();
    let wasBackground = false;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') wasBackground = true;
      else if (next === 'active' && wasBackground) {
        wasBackground = false;
        check();
      }
    });
    return () => {
      seq.current++;
      subscription.remove();
    };
  }, [enabled]);
  return enabled ? requirement : null;
}
