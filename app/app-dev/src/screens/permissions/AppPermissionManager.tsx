import { AndroidScreenTimeSetup } from './AndroidScreenTimeSetup';
import { getSession, sessionGeneration } from '@/services/api/session';
import { syncFocusShield } from '@/services/focusShield';
import { Btn, Group, Row, Toggle, Txt } from '@/design-system/patterns';
import { t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { screenTimeNative } from '@/services/ScreenTimeModule';
import { type PushPermission, pushPermissionStatus, requestPushPermission } from '@/services/push';
import {
  ScreenTimeAuthorization,
  ScreenTimeSelection,
  isScreenTimeAvailable,
  screenTime,
  selectionCount,
} from '@/services/screenTime';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
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
  // 알림 권한(GROMO-2526) — iOS 이고 푸시 브리지가 든 바이너리에서만 `unavailable` 이 아니다. 아니면 알림 섹션을 그리지 않는다.
  const [pushPermission, setPushPermission] = useState<PushPermission>('unavailable');
  // 알림 행은 알림을 다시 켜는 자리다 — 권한이 허용됐는데 앱 설정 「알림」이 꺼져 있으면 함께 켠다(꺼진 채로는 푸시 동기화가
  // 등록하지 않는다). 팝업·시스템 설정을 다녀온 뒤(앞선 렌더의 클로저)에도 최신 값을 보도록 설정 값은 ref 로 읽는다.
  const pushSettingOff = useRef(false);
  pushSettingOff.current = e.state.settings.notifications === false;
  // 알림 행에서 시스템 설정으로 나갔는가 — 돌아와 다시 읽은 권한이 허용이면 앱 설정도 켠다(한 번뿐, 어느 쪽이든 지운다).
  const pushSettingsOpened = useRef(false);
  // 권한 읽기마다 번호를 매긴다(읽기를 시작할 때 올린다) — 표시는 가장 새 읽기의 결과만 정한다(옛 결과는 버린다). 눌러서 시스템
  // 설정으로 나간 때의 번호도 적어 두고, 그보다 새로 시작한 읽기만 「나감」 표시를 소비한다 — 나가기 전에 시작한 읽기가 나가
  // 있는 동안 늦게 끝나도(거부) 표시를 지우지 못해, 돌아와 읽은 허용이 앱 설정을 켠다.
  const pushReadSeq = useRef(0);
  const pushOpenedAtSeq = useRef(0);
  const enablePushSetting = () => {
    if (pushSettingOff.current) e.dispatch({ type: 'SETTING', key: 'notifications', value: true });
  };
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
  const pushDescription =
    pushPermission === 'granted'
      ? t('settings.permissions.notifications.granted')
      : pushPermission === 'denied'
        ? t('settings.permissions.notifications.denied')
        : pushPermission === 'error'
          ? t('settings.permissions.notifications.error')
          : t('settings.permissions.notifications.undetermined');
  // 누르면 일어날 일(changePush 와 같은 갈래) — 제목·부제만으로는 안 읽히니 힌트로 덧붙인다.
  const pushHint =
    pushPermission === 'undetermined'
      ? t('settings.permissions.notifications.hint.ask')
      : pushPermission === 'granted' && e.state.settings.notifications === false
        ? t('settings.permissions.notifications.hint.enable')
        : pushPermission === 'granted' || pushPermission === 'denied'
          ? t('settings.permissions.notifications.hint.openSettings')
          : pushPermission === 'error'
            ? t('settings.permissions.notifications.hint.recheck')
            : undefined;
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
      const readSeq = ++pushReadSeq.current;
      void pushPermissionStatus().then((next) => {
        if (!active) return;
        if (readSeq === pushReadSeq.current) setPushPermission(next);
        // 확인하지 못한 읽기('error')·브리지 없음은 결과가 아니다 — 「나감」 표시를 소비하지 않고 다음 읽기에 넘긴다.
        if (next === 'error' || next === 'unavailable') return;
        if (!pushSettingsOpened.current || readSeq <= pushOpenedAtSeq.current) return;
        pushSettingsOpened.current = false;
        if (next === 'granted') enablePushSetting();
      });
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

  // 아직 안 물음이면 시스템 팝업, 이미 허용인데 앱 설정 「알림」만 꺼져 있으면 바로 켠다. 그 밖(거부, 끄려는 허용)은 시스템
  // 설정으로 보낸다 — 이미 정해진 알림 권한은 앱에서 바꿀 수 없다. 읽지 못했던('error') 권한은 먼저 다시 읽고, 읽힌 값으로
  // 위를 그대로 이어 간다(그래도 못 읽으면 아무것도 하지 않는다).
  const changePush = async () => {
    let current = pushPermission;
    if (current === 'error') {
      const readSeq = ++pushReadSeq.current;
      current = await pushPermissionStatus();
      if (readSeq === pushReadSeq.current) setPushPermission(current);
    }
    if (current === 'undetermined') {
      const readSeq = ++pushReadSeq.current;
      const next = await requestPushPermission();
      if (readSeq === pushReadSeq.current) setPushPermission(next);
      if (next === 'granted') enablePushSetting();
      return;
    }
    if (current === 'granted' && pushSettingOff.current) {
      enablePushSetting();
      return;
    }
    if (current !== 'granted' && current !== 'denied') return;
    pushOpenedAtSeq.current = pushReadSeq.current;
    pushSettingsOpened.current = true;
    // 알림은 Android 의 사용 정보 접근 설정과 별개다. 앱 알림 권한 화면으로 연다.
    await Linking.openSettings().catch(() =>
      e.notify(t('settings.permissions.errors.settingsOpen')),
    );
  };

  const openMeasuredApps = async () => {
    if (!(approved || (await requestConnection()))) return;
    e.go('screenTimeApps', 'settings');
  };

  if (supportsFocusShield && allowedPicker)
    return (
      <Sheet e={e} title={t('settings.permissions.sheet.allowedApps')}>
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
    <Sheet e={e} title={t('settings.permissionManage')}>
      <Txt kind="section">{t('settings.permissions.screenTime.title')}</Txt>
      <Group>
        <Row
          title={t('settings.permissions.screenTime.connect')}
          sub={t('settings.permissions.screenTime.sub', { description: permissionDescription })}
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
        <Row
          title={t('settings.permissions.measuredApps.title')}
          sub={selectionDescription}
          accessibilityLabel={t('settings.permissions.measuredApps.a11y', {
            description: selectionDescription,
          })}
          chevron
          onPress={openMeasuredApps}
        />
      </Group>
      <Txt kind="meta">{t('settings.permissions.disconnectNote')}</Txt>
      {supportsFocusShield && (
        <>
          <Txt kind="section">{t('settings.permissions.allowed.section')}</Txt>
          <Group>
            <Row
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
              <Row
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
          </Group>
        </>
      )}
      {Platform.OS === 'android' && supportsFocusShield && (
        <Group>
          <Row
            title={t('screenTimeSetup.accessManage')}
            sub={t(focusGranted ? 'screenTimeSetup.accessOn' : 'screenTimeSetup.accessOff')}
            chevron
            onPress={() => setAllowedPicker(true)}
          />
          {focusGranted && (
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
        </Group>
      )}
      {pushPermission !== 'unavailable' && (
        <>
          <Txt kind="section">{t('settings.notifications')}</Txt>
          <Group>
            <Row
              title={t('settings.permissions.notifications.title')}
              sub={pushDescription}
              accessibilityLabel={t('settings.permissions.notifications.a11y', {
                description: pushDescription,
              })}
              accessibilityHint={pushHint}
              chevron
              onPress={changePush}
            />
          </Group>
        </>
      )}
    </Sheet>
  );
}
