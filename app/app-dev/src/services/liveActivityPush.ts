import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { request } from './api/client';
import { getSession, sessionGeneration } from './api/session';
import type { Color, Session } from './model';
import { screenTimeNative } from './ScreenTimeModule';

type PushToken = {
  sessionId: string;
  activityId: string;
  pushToken: string;
  environment: 'development' | 'production' | 'android';
};

/** 토큰 회전은 즉시 등록하고 누락 이벤트·일시 실패는 포그라운드에서 재확인한다. */
export function startLiveActivityPushSync(
  current: () => { session: Session | null; color: Color },
): () => void {
  if (Platform.OS === 'android' && screenTimeNative?.supportsFocusShield === false) return () => {};
  const native = Platform.OS === 'ios' ? NativeModules.LiveActivityModule : undefined;
  if (!native?.getPushTokens && !(Platform.OS === 'android' && screenTimeNative?.getFocusPushToken))
    return () => {};
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
  const refresh = async (initial = false) => {
    if (!active() || (!initial && AppState.currentState !== 'active')) return;
    try {
      const session = current().session;
      const tokens: PushToken[] =
        Platform.OS === 'android'
          ? session
            ? [
                {
                  sessionId: session.id,
                  activityId: session.id,
                  pushToken: await screenTimeNative!.getFocusPushToken!(),
                  environment: 'android',
                },
              ]
            : []
          : await native.getPushTokens();
      if (active()) tokens.forEach(register);
    } catch {
      // 네이티브 조회 실패도 다음 포그라운드/타이머에서 재시도한다.
    }
  };
  const tokenSubscription = native
    ? new NativeEventEmitter(native).addListener('LiveActivityPushToken', register)
    : null;
  const appSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') void refresh();
  });
  const timer = setInterval(() => void refresh(), 15_000);
  // 세션 시작 응답 직후 배경으로 이동해도 최초 등록은 타이머를 기다리지 않는다.
  void refresh(true);
  return () => {
    stopped = true;
    clearInterval(timer);
    tokenSubscription?.remove();
    appSubscription.remove();
  };
}
