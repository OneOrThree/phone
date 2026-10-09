import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { request } from './api/client';
import { getSession, sessionGeneration } from './api/session';
import type { Color, Session } from './model';

type PushToken = {
  sessionId: string;
  activityId: string;
  pushToken: string;
  environment: 'development' | 'production';
};

/** 토큰 회전은 즉시 등록하고 누락 이벤트·일시 실패는 포그라운드에서 재확인한다. */
export function startLiveActivityPushSync(
  current: () => { session: Session | null; color: Color },
): () => void {
  const native = Platform.OS === 'ios' ? NativeModules.LiveActivityModule : undefined;
  if (!native?.getPushTokens) return () => {};
  const generation = sessionGeneration();
  let stopped = false;
  const registered = new Map<string, string>();
  let queue: Promise<unknown> = Promise.resolve();
  const active = () => !stopped && generation === sessionGeneration() && !!getSession();
  const register = (token: PushToken) => {
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        if (!active()) return;
        const { session, color } = current();
        if (!session || session.version == null || session.id !== token.sessionId) return;
        const fingerprint = `${token.pushToken}:${token.environment}:${color}`;
        if (registered.get(token.activityId) === fingerprint) return;
        await request<void>(`/focus-sessions/${encodeURIComponent(session.id)}/live-activity`, {
          method: 'PUT',
          generation,
          body: {
            activityId: token.activityId,
            pushToken: token.pushToken,
            environment: token.environment,
            catColor: color,
          },
        });
        if (active()) {
          registered.clear();
          registered.set(token.activityId, fingerprint);
        }
      });
    // 실패가 집중을 중단하지 않는다. 다음 조회에서 같은 토큰을 재시도한다.
    void queue.catch(() => undefined);
  };
  const refresh = async () => {
    if (!active() || AppState.currentState !== 'active') return;
    try {
      const tokens: PushToken[] = await native.getPushTokens();
      if (active()) tokens.forEach(register);
    } catch {
      // 네이티브 조회 실패도 다음 포그라운드/타이머에서 재시도한다.
    }
  };
  const emitter = new NativeEventEmitter(native);
  const tokenSubscription = emitter.addListener('LiveActivityPushToken', register);
  const appSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') void refresh();
  });
  const timer = setInterval(() => void refresh(), 15_000);
  void refresh();
  return () => {
    stopped = true;
    clearInterval(timer);
    tokenSubscription.remove();
    appSubscription.remove();
  };
}
