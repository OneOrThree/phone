import { AndroidScreenTimeSetup } from './AndroidScreenTimeSetup';
import { getSession, sessionGeneration } from '@/services/api/session';
import { syncFocusShield } from '@/services/focusShield';
import { Btn, Toggle, Txt } from '@/design-system/patterns';
import { t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { screenTimeNative } from '@/services/ScreenTimeModule';
import {
  ScreenTimeAuthorization,
  ScreenTimeSelection,
  isScreenTimeAvailable,
  screenTime,
  selectionCount,
} from '@/services/screenTime';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { SheetGroup, SheetRow, st } from '../island/IslandSheet';
import { Sheet } from '../shared/ScreenSheet';
import { openScreenTimeSettings } from './screenTimeHelp';

export function AppPermissionManager({ e }: ScreenProps) {
  const supportsFocusShield =
    Platform.OS !== 'android' || !!screenTimeNative?.getAndroidFocusAccess;
  const [status, setStatus] = useState<ScreenTimeAuthorization | 'loading'>('loading');
  const [selection, setSelection] = useState<ScreenTimeSelection | null>(null);
  const [selectionStatus, setSelectionStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [allowSafari, setAllowSafari] = useState(false);
  const [allowedCount, setAllowedCount] = useState(0);
  const [allowedPicker, setAllowedPicker] = useState(false);
  const [focusGranted, setFocusGranted] = useState(false);
  const unavailable = !isScreenTimeAvailable || status === 'unavailable';
  const approved = status === 'approved';
  const selectedCount = selectionCount(selection);
  const selectionDescription =
    selectionStatus === 'loading'
      ? t('settings.permissions.status.checking')
      : selectionStatus === 'error'
        ? t('settings.permissions.status.failed')
        : selection?.allApps
          ? t(
              selection.pending
                ? 'settings.permissions.status.allAppsPending'
                : 'settings.permissions.status.allApps',
            )
          : selectedCount
            ? t(
                selection?.pending
                  ? 'settings.permissions.status.selectedCountPending'
                  : 'settings.permissions.status.selectedCount',
                { count: selectedCount },
              )
            : t('settings.permissions.status.none');
  const permissionDescription =
    status === 'loading'
      ? t('settings.permissions.status.permissionChecking')
      : approved
        ? t('settings.permissions.connected')
        : unavailable
          ? t('settings.permissions.unavailable')
          : t('settings.permissions.needed');

  const refreshFocusAccess = async () => {
    const owner = getSession()?.userId;
    const generation = sessionGeneration();
    if (!owner) return;
    const access = await screenTimeNative?.getAndroidFocusAccess?.(owner);
    if (owner !== getSession()?.userId || generation !== sessionGeneration()) return;
    setFocusGranted(
      !!(access?.consented && access.configured && access.connected && access.enabled),
    );
    setAllowedCount(selectionCount(await screenTime.getAllowedSelectionCounts()));
  };

  useEffect(() => {
    let active = true;
    const syncPermissionState = () => {
      if (Platform.OS === 'android' && supportsFocusShield) {
        void refreshFocusAccess().catch(() => {});
      }
      screenTime
        .getAuthorizationStatus()
        .then((nextStatus) => {
          if (!active) return;
          setStatus(nextStatus);
          e.dispatch({ type: 'SETTING', key: 'permission', value: nextStatus === 'approved' });
        })
        .catch(() => active && setStatus('unavailable'));
      setSelectionStatus('loading');
      screenTime
        .getMeasurementSelectionForEditing()
        .then((nextSelection) => {
          if (!active) return;
          setSelection(nextSelection);
          setSelectionStatus('ready');
        })
        .catch(() => active && setSelectionStatus('error'));
    };
    if (supportsFocusShield) {
      void screenTime
        .getFocusAllowSafariWeb()
        .then((value) => {
          if (active) setAllowSafari(value);
        })
        .catch(() => {
          if (active) e.notify(t('settings.permissions.errors.safariCheck'));
        });
      void screenTime
        .getAllowedSelectionCounts()
        .then((value) => {
          if (active) setAllowedCount(selectionCount(value));
        })
        .catch(() => {
          if (active) e.notify(t('settings.permissions.errors.allowedCheck'));
        });
    }
    syncPermissionState();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') syncPermissionState();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const requestConnection = async () => {
    if (approved) return true;
    if (unavailable) {
      e.notify(t('settings.permissions.errors.unavailable'));
      return false;
    }
    if (busy) return;
    setBusy(true);
    try {
      await screenTime.requestAuthorization();
      const nextStatus = await screenTime.getAuthorizationStatus();
      setStatus(nextStatus);
      e.dispatch({ type: 'SETTING', key: 'permission', value: nextStatus === 'approved' });
      if (nextStatus !== 'approved')
        e.notify(
          Platform.OS === 'android'
            ? t('settings.permissions.errors.grantAndroid')
            : t('settings.permissions.errors.grantIos'),
        );
      return nextStatus === 'approved';
    } catch {
      e.notify(t('settings.permissions.errors.requestFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeConnection = async (next: boolean) => {
    if (next) {
      if (await requestConnection()) e.go('screenTimeApps', 'settings-auto');
      return;
    }
    // Family Controls 권한은 앱에서 직접 철회할 수 없어 시스템 설정으로 보낸다.
    await openSystemSettings();
  };

  const openSystemSettings = () => openScreenTimeSettings(e.notify);

  const openMeasuredApps = async () => {
    if (!(approved || (await requestConnection()))) return;
    e.go('screenTimeApps', 'settings');
  };

  // 바다에서 열면 바다 배경이다 — 다른 설정 화면(accountBg)과 같다
  const bg = e.fromSea ? 'sea' : 'dock';
  if (supportsFocusShield && allowedPicker)
    return (
      <Sheet e={e} bg={bg} title={t('settings.permissions.sheet.allowedApps')}>
        <AndroidScreenTimeSetup
          allowedOnly
          onClose={() => {
            setAllowedPicker(false);
            void refreshFocusAccess().catch(() => {});
          }}
          onConfigured={async () => {
            if (!(await syncFocusShield(e.state.session, e.state.color, true)))
              throw new Error('FOCUS_RETURN_FAILED');
          }}
        />
      </Sheet>
    );
  return (
    <Sheet e={e} bg={bg} title={t('settings.permissionManage')}>
      <Txt kind="section" style={st.sec}>
        {t('settings.permissions.screenTime.title')}
      </Txt>
      <SheetGroup flat>
        <SheetRow
          title={t('settings.permissions.screenTime.connect')}
          // 켜짐·꺼짐은 토글이 보인다. 이 기기에서 못 쓸 때만 까닭을 적는다
          sub={unavailable ? permissionDescription : undefined}
          tail={
            <Toggle
              label={t('settings.permissions.screenTime.connect')}
              value={approved}
              disabled={busy || status === 'loading' || unavailable}
              onChange={(next: boolean) => {
                void changeConnection(next);
              }}
            />
          }
        />
        <SheetRow
          title={t('settings.permissions.measuredApps.title')}
          sub={selectionDescription}
          label={t('settings.permissions.measuredApps.a11y', {
            description: selectionDescription,
          })}
          chevron
          onPress={openMeasuredApps}
        />
      </SheetGroup>
      <Txt kind="meta">{t('settings.permissions.measuredApps.reporting')}</Txt>
      {e.state.settings.screenTimeSyncError && (
        <Txt kind="meta">{t('settings.usageSyncError')}</Txt>
      )}
      {supportsFocusShield && (
        <>
          <Txt kind="section" style={st.sec}>
            {t('settings.permissions.allowed.section')}
          </Txt>
          <SheetGroup flat>
            <SheetRow
              title={t('settings.permissions.allowed.title')}
              sub={t('settings.permissions.allowed.count', { count: allowedCount })}
              chevron
              disabled={busy}
              onPress={async () => {
                if (Platform.OS === 'android') {
                  setAllowedPicker(true);
                  return;
                }
                if (!(approved || (await requestConnection()))) return;
                setBusy(true);
                try {
                  const picked = await screenTime.presentAllowedAppManager();
                  if (picked) setAllowedCount(selectionCount(picked));
                } catch {
                  e.notify(t('settings.permissions.errors.allowedChange'));
                } finally {
                  setBusy(false);
                }
              }}
            />
            {Platform.OS === 'ios' && (
              <SheetRow
                title={t('settings.permissions.safari.title')}
                sub={t('settings.permissions.safari.sub')}
                tail={
                  <Toggle
                    label={t('settings.permissions.safari.a11y')}
                    value={allowSafari}
                    disabled={busy || !approved}
                    onChange={async (value: boolean) => {
                      setBusy(true);
                      try {
                        await screenTime.setFocusAllowSafariWeb(value);
                        setAllowSafari(value);
                      } catch {
                        e.notify(t('settings.permissions.errors.safariChange'));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                }
              />
            )}
            {Platform.OS === 'android' && (
              <SheetRow
                title={t('screenTimeSetup.accessManage')}
                sub={t(focusGranted ? 'screenTimeSetup.accessOn' : 'screenTimeSetup.accessOff')}
                chevron
                onPress={() => setAllowedPicker(true)}
              />
            )}
          </SheetGroup>
          {Platform.OS === 'android' && focusGranted && (
            <Btn
              kind="ghost"
              title={t('screenTimeSetup.accessDisable')}
              onPress={async () => {
                const owner = getSession()?.userId;
                if (!owner) return;
                try {
                  await screenTimeNative?.setAndroidFocusConsent?.(owner, false);
                  await refreshFocusAccess();
                } catch {
                  e.notify(t('settings.permissions.errors.requestFailed'));
                }
              }}
            />
          )}
        </>
      )}
    </Sheet>
  );
}
