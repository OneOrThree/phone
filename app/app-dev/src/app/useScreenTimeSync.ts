import { t } from '@/i18n';
import { syncAndroidFocus, syncAndroidMeasurement } from '@/services/androidScreenTime';
import { getSession, sessionGeneration } from '@/services/api/session';
import { shouldReportShieldFailure, syncFocusShield } from '@/services/focusShield';
import { syncIOSScreenTime } from '@/services/iosScreenTimeSync';
import { dayKey, type Action, type State } from '@/services/model';
import { captureProductEvent } from '@/services/posthog';
import { screenTime } from '@/services/screenTime';
import { screenTimeNative } from '@/services/ScreenTimeModule';
import { reportScreenTime } from '@/services/screenTimeReporting';
import { subscribeScreenTimeMeasurement } from '@/services/screenTimeEvents';
import { useEffect, type Dispatch, type RefObject } from 'react';
import { AppState, Platform } from 'react-native';
interface MeasurementInput {
  loaded: boolean;
  hasServerSession: boolean;
  storageOwnerReady: boolean;
  storageOwnerReadyRef: RefObject<boolean>;
  dispatch: Dispatch<Action>;
  review: boolean;
  demo: boolean;
}

export function useScreenTimeSync({
  loaded,
  hasServerSession,
  storageOwnerReady,
  storageOwnerReadyRef,
  dispatch,
  review,
  demo,
}: MeasurementInput) {
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    let request = 0;
    const syncPermission = async () => {
      if (Platform.OS === 'android') {
        if (!storageOwnerReadyRef.current || !getSession() || review || demo) return;
        const current = ++request;
        const generation = sessionGeneration();
        dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: false });
        try {
          const snapshot = await syncAndroidMeasurement();
          if (active && current === request && generation === sessionGeneration()) {
            dispatch({ type: 'SCREEN_TIME_SNAPSHOT', snapshot, now: Date.now() });
            dispatch({ type: 'SETTING', key: 'screenTimeSyncError', value: snapshot.reportFailed });
            // 하루 스크린타임 스냅샷 확정 — 측정값이 있을 때 스냅샷 dispatch당 1회
            if (snapshot.minutes !== null)
              captureProductEvent('screen_time_daily', { minutes: snapshot.minutes });
          }
        } catch {
          const status = await screenTime.getAuthorizationStatus().catch(() => 'unavailable');
          if (active && current === request && generation === sessionGeneration())
            dispatch({
              type: 'SCREEN_TIME_SNAPSHOT',
              snapshot: {
                approved: status === 'approved',
                date: dayKey(),
                minutes: null,
                history: [],
                unconfirmedDays: [],
              },
              now: Date.now(),
            });
        }
        return;
      }
      if (Platform.OS !== 'ios') {
        if (!review && !demo) {
          dispatch({ type: 'SETTING', key: 'permission', value: false });
          dispatch({ type: 'SETTING', key: 'screenTimeMeasurementReady', value: false });
        }
        dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: true });
        return;
      }
      if (!storageOwnerReadyRef.current || !getSession() || review || demo) return;
      const current = ++request;
      const generation = sessionGeneration();
      const isCurrent = () => active && current === request && generation === sessionGeneration();
      let measured = false;
      dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: false });
      try {
        const result = await syncIOSScreenTime(getSession()!.userId);
        if (!isCurrent()) return;
        dispatch({ type: 'SCREEN_TIME_SNAPSHOT', snapshot: result.snapshot, now: Date.now() });
        measured = true;
        // 하루 스크린타임 스냅샷 확정 — 측정값이 있을 때 스냅샷 dispatch당 1회
        if (result.snapshot.minutes !== null)
          captureProductEvent('screen_time_daily', { minutes: result.snapshot.minutes });
        await reportScreenTime(result.authorization, result.timeline, generation);
        if (isCurrent()) dispatch({ type: 'SETTING', key: 'screenTimeSyncError', value: false });
      } catch {
        if (isCurrent()) {
          if (!measured)
            dispatch({ type: 'SETTING', key: 'screenTimeMeasurementReady', value: false });
          dispatch({ type: 'SETTING', key: 'screenTimeSyncError', value: true });
          dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: true });
        }
      }
    };
    void syncPermission();
    const unsubscribeMeasurement = subscribeScreenTimeMeasurement(() => void syncPermission());
    let syncedDay = dayKey();
    const dayChangeTimer = setInterval(() => {
      const currentDay = dayKey();
      if (currentDay === syncedDay) return;
      syncedDay = currentDay;
      void syncPermission();
    }, 1000);
    const usageTimer =
      Platform.OS === 'android' || Platform.OS === 'ios'
        ? setInterval(() => {
            if (AppState.currentState === 'active') void syncPermission();
          }, 60000)
        : undefined;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void syncPermission();
    });
    return () => {
      active = false;
      request++;
      unsubscribeMeasurement();
      clearInterval(usageTimer);
      clearInterval(dayChangeTimer);
      subscription.remove();
    };
  }, [loaded, hasServerSession, storageOwnerReady]);
}

interface ShieldInput {
  loaded: boolean;
  storageOwnerReady: boolean;
  hasServerSession: boolean;
  authGeneration: number;
  state: State;
  stateRef: RefObject<State>;
  notify: (message: string) => void;
}
export function useFocusShieldSync({
  loaded,
  storageOwnerReady,
  hasServerSession,
  authGeneration,
  state,
  stateRef,
  notify,
}: ShieldInput) {
  const focusShieldOwner = getSession()?.userId;

  useEffect(() => {
    if (!loaded || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
    // 로그아웃·계정 채택 중에는 저장소 gate와 무관하게 이전 Android 임대를 먼저 끊는다.
    if (Platform.OS === 'android' && (!storageOwnerReady || !hasServerSession)) {
      void syncAndroidFocus(null, stateRef.current.color).catch(() => {});
      return;
    }
    if (!storageOwnerReady) return;
    let active = true;
    let foreground = AppState.currentState === 'active';
    let request = 0;
    let retryDelay = 2000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // 같은 사용자 ID의 회원 전환도 이전 재시도를 정리하고 새 인증 세대로 동기화한다.
    const generation = authGeneration;
    const current = () =>
      active && generation === sessionGeneration() && focusShieldOwner === getSession()?.userId;
    const clearRetry = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    };
    const retry = () => {
      if (!current() || !foreground || !hasServerSession) return;
      clearRetry();
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void sync(false);
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    };
    const sync = async (reportFailure = true) => {
      if (!current()) return;
      const sequence = ++request;
      const latest = () => current() && sequence === request;
      clearRetry();
      const session = hasServerSession ? stateRef.current.session : null;
      try {
        const applied = await (Platform.OS === 'android'
          ? syncAndroidFocus(session, stateRef.current.color, true, latest)
          : syncFocusShield(session, stateRef.current.color, true, latest));
        if (!latest()) return;
        if (applied) {
          retryDelay = 2000;
          return;
        }
        if (
          reportFailure &&
          session?.status === 'active' &&
          (await shouldReportShieldFailure()) &&
          latest()
        )
          notify(t('ui.screenTime.blockFailed'));
        if (latest()) retry();
      } catch {
        if (!latest()) return;
        if (reportFailure && (await shouldReportShieldFailure()) && latest())
          notify(t('ui.screenTime.blockChangeFailed'));
        if (latest()) retry();
      }
    };
    void sync();
    // 앱 밖에서 임대가 만료된 뒤 비허용 앱을 열면 네이티브가 정본 확인을 요청한다.
    const nativeSubscription =
      Platform.OS === 'android'
        ? screenTimeNative?.addListener?.('onFocusReturnCheck', () => {
            void sync(false);
          })
        : undefined;
    const refreshTimer =
      Platform.OS === 'android'
        ? setInterval(() => {
            if (foreground && current() && stateRef.current.session?.status === 'active')
              void sync(false);
          }, 45_000)
        : undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      foreground = next === 'active';
      if (foreground) void sync();
      else clearRetry();
    });
    return () => {
      active = false;
      clearRetry();
      subscription.remove();
      nativeSubscription?.remove();
      clearInterval(refreshTimer);
    };
  }, [
    loaded,
    storageOwnerReady,
    hasServerSession,
    authGeneration,
    focusShieldOwner,
    state.settings.permission,
    state.session?.id,
    state.session?.version,
    state.session?.status,
    state.session?.subject,
    state.color,
  ]);
}
