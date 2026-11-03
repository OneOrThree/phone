import { Btn, C, Group, Pic, Row, Txt } from '@/design-system/patterns';
import { t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { sessionGeneration } from '@/services/api/session';
import { Route } from '@/services/model';
import { ScreenTimeAuthorization, isScreenTimeAvailable, screenTime } from '@/services/screenTime';
import { syncAndroidScreenTime } from '@/services/screentimeSync';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import { Sheet } from '../shared/ScreenSheet';
import { ScreenTimePermissionHelp, openScreenTimeSettings } from './screenTimeHelp';

export function ScreenTimePermission({ e }: ScreenProps) {
  const [status, setStatus] = useState<ScreenTimeAuthorization | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [requestAttempted, setRequestAttempted] = useState(false);
  const gateParts = String(e.detail).split('|');
  const boardFirst = gateParts[0] === 'board-first';
  const gateRoute = (gateParts[1] || 'board') as Route;
  const gateDetail = decodeURIComponent(gateParts[2] || '');
  const measuredApps = e.detail === 'measured-apps';
  const finish = () => {
    if (boardFirst) {
      e.replace('screenTimeApps', e.detail);
    } else {
      e.replace('screenTimeApps', 'settings-auto');
    }
  };
  const skip = () => {
    if (boardFirst) {
      e.dispatch({ type: 'SETTING', key: 'screenTimeBoardPromptSeen', value: true });
      e.replace(gateRoute, gateDetail);
    } else {
      e.back();
    }
  };
  const syncStatus = async () => {
    const generation = sessionGeneration();
    const next = await screenTime.getAuthorizationStatus();
    if (generation !== sessionGeneration()) return 'unavailable';
    setStatus(next);
    e.dispatch({ type: 'SETTING', key: 'permission', value: next === 'approved' });
    if (Platform.OS === 'android') {
      e.dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: false });
      const snapshot = await syncAndroidScreenTime();
      if (generation !== sessionGeneration()) return 'unavailable';
      e.dispatch({ type: 'SCREEN_TIME_SNAPSHOT', snapshot, now: Date.now() });
      setStatus(snapshot.approved ? 'approved' : next === 'approved' ? 'denied' : next);
      return snapshot.approved ? 'approved' : next === 'approved' ? 'denied' : next;
    }
    return next;
  };
  useEffect(() => {
    let active = true;
    screenTime
      .getAuthorizationStatus()
      .then((next) => {
        if (!active) return;
        setStatus(next);
        e.dispatch({ type: 'SETTING', key: 'permission', value: next === 'approved' });
        if (boardFirst && next === 'approved') finish();
      })
      .catch(() => active && setStatus('unavailable'));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      syncStatus()
        .then((next) => {
          if (next === 'approved' && boardFirst) finish();
        })
        .catch(() => {});
    });
    return () => subscription.remove();
  }, []);
  const request = async () => {
    if (busy) return;
    setBusy(true);
    setRequestAttempted(true);
    try {
      await screenTime.requestAuthorization();
      const next = await syncStatus();
      if (next === 'approved') finish();
    } catch {
      e.notify(t('settings.permissions.errors.requestFailed'));
    } finally {
      setBusy(false);
    }
  };
  if (status === 'loading')
    return (
      <Sheet
        e={e}
        title={t('settings.permissions.gate.title')}
        onBack={boardFirst ? skip : undefined}
        onClose={boardFirst ? skip : undefined}
      >
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator color={C.ink} />
        </View>
      </Sheet>
    );
  const unavailable = !isScreenTimeAvailable || status === 'unavailable';
  return (
    <Sheet
      e={e}
      title={t('settings.permissions.gate.title')}
      onBack={boardFirst ? skip : undefined}
      onClose={boardFirst ? skip : undefined}
    >
      <Pic id="cat/black/sitting" w={82} />
      <Txt kind="h17">{t('settings.permissions.gate.heading')}</Txt>
      <Txt>{t('settings.permissions.gate.sub')}</Txt>
      <Group flat>
        <Row
          title={t('settings.permissions.gate.row')}
          sub={
            unavailable
              ? t('settings.permissions.gate.rowUnavailable')
              : status === 'approved'
                ? t('settings.permissions.connected')
                : status === 'denied'
                  ? t('settings.permissions.gate.rowDenied')
                  : t('settings.permissions.gate.rowNone')
          }
        />
      </Group>
      {Platform.OS === 'android' && status === 'approved' && (
        <Btn
          title={t('settings.permissions.gate.openUsage')}
          kind="sec"
          onPress={async () => {
            if (!(await screenTime.openUsageAccessSettings()))
              e.notify(t('settings.permissions.errors.usageOpenFailed'));
          }}
        />
      )}
      {status === 'approved' ? (
        <Btn
          title={
            boardFirst
              ? t('settings.permissions.measuredApps.pick')
              : measuredApps
                ? t('settings.permissions.gate.continue')
                : t('settings.permissions.gate.done')
          }
          onPress={finish}
        />
      ) : !unavailable && (status === 'denied' || requestAttempted) ? (
        <>
          <ScreenTimePermissionHelp />
          <Btn
            title={
              busy
                ? t('settings.permissions.gate.requesting')
                : t('settings.permissions.gate.retry')
            }
            disabled={busy}
            onPress={request}
          />
          <Btn
            title={t('settings.permissions.gate.openSystem')}
            kind="sec"
            disabled={busy}
            onPress={() => openScreenTimeSettings(e.notify)}
          />
          <Btn
            title={boardFirst ? t('settings.permissions.gate.laterBoard') : t('common.later')}
            kind="ghost"
            onPress={skip}
          />
        </>
      ) : unavailable ? (
        <Btn
          title={boardFirst ? t('settings.permissions.gate.openBoard') : t('common.ok')}
          onPress={skip}
        />
      ) : (
        <>
          <Btn
            title={
              busy
                ? t('settings.permissions.gate.requesting')
                : t('settings.permissions.gate.connectBtn')
            }
            disabled={busy}
            onPress={request}
          />
          {boardFirst && (
            <Btn title={t('settings.permissions.gate.laterBoard')} kind="ghost" onPress={skip} />
          )}
        </>
      )}
      <Txt kind="meta">{t('settings.permissions.gate.note')}</Txt>
    </Sheet>
  );
}
