import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { AndroidAppPicker } from '@/components/AndroidAppPicker';
import { Btn, Txt } from '@/design-system/patterns';
import { semanticTokens as s } from '@/design-system/tokens';
import { t } from '@/i18n';
import { getSession, sessionGeneration } from '@/services/api/session';
import { screenTime } from '@/services/screenTime';
import { screenTimeNative } from '@/services/ScreenTimeModule';
import { duringSystemPrompt } from '../focus/focusLeave';
import type { ScreenTimeSetupProps } from './useScreenTimeSetup';

/** 측정 저장과 허용 목록 저장을 구분하고, 접근성 고지는 별도의 명시적 동의로 받는다. */
export function AndroidScreenTimeSetup({
  onClose,
  onPermissionChange,
  onConfigured,
  mode = 'setup',
  allowedOnly = false,
}: ScreenTimeSetupProps & { allowedOnly?: boolean }) {
  const [step, setStep] = useState<'loading' | 'usage' | 'measured' | 'allowed' | 'access'>(
    'loading',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [owner] = useState(() => getSession()?.userId);
  const [generation] = useState(sessionGeneration);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const current = () =>
    mounted.current &&
    !!owner &&
    owner === getSession()?.userId &&
    generation === sessionGeneration();
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current || !current()) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch {
      if (current()) setMessage(t('settings.permissions.errors.requestFailed'));
    } finally {
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  };
  const load = async () => {
    if (!owner) throw new Error('ACCOUNT_REQUIRED');
    await screenTime.bindMeasurementOwner(owner);
    if (!current()) return;
    const selection = await screenTimeNative?.getAndroidSelection?.();
    if (!current()) return;
    if (allowedOnly || (mode !== 'measurement' && selection?.configured)) {
      setStep('allowed');
      return;
    }
    const status = await screenTime.getAuthorizationStatus();
    if (!current()) return;
    onPermissionChange?.(status === 'approved');
    setStep(status === 'approved' ? 'measured' : 'usage');
  };
  useEffect(() => {
    mounted.current = true;
    void run(load);
    return () => {
      mounted.current = false;
    };
    // 설정 도중 계정이 바뀌면 응답을 버리고 새 계정의 흐름을 자동으로 시작하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = async () => {
    await onConfigured?.();
    if (current()) onClose();
  };
  const allowSaved = () =>
    void run(async () => {
      const access = await screenTimeNative?.getAndroidFocusAccess?.(owner!);
      if (!current()) return;
      if (access?.consented && access.connected && access.enabled) await finish();
      else setStep('access');
    });
  const requestAccess = () =>
    void run(async () => {
      // 이 버튼을 누르기 전까지 동의 값을 쓰거나 시스템 접근성 설정을 열지 않는다.
      await screenTimeNative?.setAndroidFocusConsent?.(owner!, true);
      if (!current()) return;
      await duringSystemPrompt(
        () => screenTimeNative?.requestAndroidFocusAccess?.() ?? Promise.resolve(false),
      );
      if (!current()) return;
      const access = await screenTimeNative?.getAndroidFocusAccess?.(owner!);
      if (!current()) return;
      if (access?.connected && access.enabled && access.consented) await finish();
      else setMessage(t('screenTimeSetup.accessNotReady'));
    });
  return (
    <View style={{ gap: s.spacing.component, paddingTop: s.spacing.section }}>
      {step === 'loading' && (
        <Btn
          title={t(busy ? 'settings.permissions.androidPicker.loading' : 'common.retry')}
          disabled={busy}
          onPress={() => void run(load)}
        />
      )}
      {step === 'usage' && (
        <>
          <Txt kind="section">{t('screenTimeSetup.usageTitle')}</Txt>
          <Txt>{t('screenTimeSetup.usageBody')}</Txt>
          <Btn
            title={t('screenTimeSetup.usageAction')}
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await duringSystemPrompt(() => screenTime.requestAuthorization());
                if (!current()) return;
                const approved = (await screenTime.getAuthorizationStatus()) === 'approved';
                if (!current()) return;
                onPermissionChange?.(approved);
                if (approved) setStep('measured');
                else setMessage(t('screenTimeSetup.usageDenied'));
              })
            }
          />
          <Btn
            kind="ghost"
            title={t('screenTimeSetup.blockingOnly')}
            disabled={busy}
            onPress={() => setStep('allowed')}
          />
        </>
      )}
      {(step === 'measured' || step === 'allowed') && (
        <AndroidAppPicker
          key={step}
          mode={step}
          notify={setMessage}
          onCancel={onClose}
          onDone={
            step === 'allowed'
              ? allowSaved
              : () =>
                  void run(async () => {
                    const allowed = await screenTime.getAllowedSelectionCounts();
                    if (!current()) return;
                    if (mode === 'measurement' && allowed !== null) onClose();
                    else setStep('allowed');
                  })
          }
        />
      )}
      {step === 'access' && (
        <>
          <Txt kind="section">{t('screenTimeSetup.accessTitle')}</Txt>
          <Txt>{t('screenTimeSetup.accessBody')}</Txt>
          <Txt>{t('screenTimeSetup.accessPrivacy')}</Txt>
          <Txt>{t('screenTimeSetup.accessSettings')}</Txt>
          <Btn title={t('screenTimeSetup.accessAgree')} disabled={busy} onPress={requestAccess} />
          <Btn
            title={t('screenTimeSetup.accessDecline')}
            kind="ghost"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await screenTimeNative?.setAndroidFocusConsent?.(owner!, false);
                if (current()) onClose();
              })
            }
          />
        </>
      )}
      {!!message && <Txt accessibilityRole="alert">{message}</Txt>}
    </View>
  );
}
