import { AndroidAppPicker } from '@/components/AndroidAppPicker';
import { Btn, C } from '@/design-system/patterns';
import { t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { Route } from '@/services/model';
import { screenTime, selectionCount } from '@/services/screenTime';
import { getSession, sessionGeneration } from '@/services/api/session';
import { screenTimeMeasurementChanged } from '@/services/screenTimeEvents';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform } from 'react-native';
import { Sheet } from '../shared/ScreenSheet';

export function MeasuredAppPicker({ e }: ScreenProps) {
  if (Platform.OS === 'android') {
    const parts = String(e.detail).split('|');
    const finish = () => {
      if (parts[0] === 'board-first') {
        e.dispatch({ type: 'SETTING', key: 'screenTimeBoardPromptSeen', value: true });
        e.replace((parts[1] || 'board') as Route, decodeURIComponent(parts[2] || ''));
      } else e.back();
    };
    return (
      <Sheet
        e={e}
        title={t('settings.permissions.measuredApps.title')}
        onBack={finish}
        onClose={finish}
      >
        <AndroidAppPicker mode="measured" notify={e.notify} onDone={finish} />
      </Sheet>
    );
  }
  return <IOSMeasuredAppPicker e={e} />;
}

function IOSMeasuredAppPicker({ e }: ScreenProps) {
  const [busy, setBusy] = useState(true);
  const pickerInFlight = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gateParts = String(e.detail).split('|');
  const boardFirst = gateParts[0] === 'board-first';
  const gateRoute = (gateParts[1] || 'board') as Route;
  const gateDetail = decodeURIComponent(gateParts[2] || '');
  const finish = () => {
    if (boardFirst) {
      e.dispatch({ type: 'SETTING', key: 'screenTimeBoardPromptSeen', value: true });
      e.replace(gateRoute, gateDetail);
    } else {
      e.back();
    }
  };
  const openPicker = async () => {
    if (pickerInFlight.current) return;
    const owner = getSession()?.userId;
    const generation = sessionGeneration();
    const current = () => getSession()?.userId === owner && sessionGeneration() === generation;
    pickerInFlight.current = true;
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    setBusy(true);
    try {
      const picked = await screenTime.presentAppPicker();
      if (!current()) return;
      if (!picked) {
        finish();
        return;
      }
      const count = selectionCount(picked);
      if (picked.appliesImmediately) {
        const activated = await screenTime.promoteSelection();
        if (!current()) return;
        if (!activated) throw new Error('measurement selection activation failed');
        const unconfirmedDays = await screenTime.getUnconfirmedUsageBucketDays();
        if (!current()) return;
        e.dispatch({ type: 'SCREEN_TIME_UNCONFIRMED', days: unconfirmedDays });
        const minutes = await screenTime.getTodayUsageBucketMinutes();
        if (!current()) return;
        e.dispatch({ type: 'SETTING', key: 'screenTimeMeasurementReady', value: true });
        e.dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: true });
        e.dispatch({ type: 'SCREEN_TIME', value: minutes });
        e.notify(t('settings.permissions.errors.appliedNow', { count }));
      } else {
        e.notify(t('settings.permissions.errors.appliedTomorrow', { count }));
      }
      screenTimeMeasurementChanged();
      finish();
    } catch {
      e.notify(t('settings.permissions.errors.pickerOpen'));
    } finally {
      pickerInFlight.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    // 이전 시스템 권한창·앱 화면 전환이 닫힌 뒤 한 번만 네이티브 선택기를 띄운다.
    autoTimer.current = setTimeout(openPicker, 450);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, []);
  return (
    <Sheet
      e={e}
      title={t('settings.permissions.measuredApps.title')}
      onBack={boardFirst ? finish : undefined}
      onClose={boardFirst ? finish : undefined}
    >
      {busy ? (
        <ActivityIndicator color={C.ink} />
      ) : (
        <Btn title={t('settings.permissions.measuredApps.pick')} onPress={openPicker} />
      )}
    </Sheet>
  );
}
