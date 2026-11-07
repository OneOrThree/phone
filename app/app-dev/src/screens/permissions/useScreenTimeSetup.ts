import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { t } from '@/i18n';
import { getSession, sessionGeneration } from '@/services/api/session';
import { saveAccountGuides } from '@/services/accountGuides';
import { isScreenTimeAvailable, screenTime, type ScreenTimeSelection } from '@/services/screenTime';
import {
  configureIOSScreenTime,
  SCREEN_TIME_GUIDE_VERSION,
  type MeasurementReady,
  type ScreenTimeSetupMode,
} from '@/services/screenTimeSetup';
import { duringSystemPrompt } from '../focus/focusLeave';

export type ScreenTimeSetupProps = {
  onClose: () => void;
  onPermissionChange?: (approved: boolean) => void;
  onMeasurementReady?: MeasurementReady;
  onMeasurementSaved?: (selection: ScreenTimeSelection) => void;
  onConfigured?: () => Promise<void>;
  onAndroidSetup?: () => void;
  mode?: ScreenTimeSetupMode;
};

/** 안내 노출, 응답 이력, 실제 권한·앱 선택을 각각 관리한다. */
export function useScreenTimeSetup({
  onClose,
  onPermissionChange,
  onMeasurementReady,
  onMeasurementSaved,
  onConfigured,
  onAndroidSetup,
  mode = 'setup',
}: ScreenTimeSetupProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const owner = getSession()?.userId;
  const generation = sessionGeneration();
  const current = useCallback(
    () => mounted.current && getSession()?.userId === owner && sessionGeneration() === generation,
    [owner, generation],
  );
  useEffect(() => {
    mounted.current = true;
    if (owner)
      void saveAccountGuides(owner, {
        screenTimeGuideShownVersion: SCREEN_TIME_GUIDE_VERSION,
      }).catch(() => {
        if (current()) setError(t('app.storageCheck'));
      });
    return () => {
      mounted.current = false;
    };
  }, [owner, generation, current]);
  const acknowledge = async () => {
    if (owner)
      await saveAccountGuides(owner, {
        screenTimeGuideAcknowledgedVersion: SCREEN_TIME_GUIDE_VERSION,
      });
  };
  const close = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await acknowledge();
      if (current()) onClose();
    } catch {
      if (current()) setError(t('app.storageCheck'));
    } finally {
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  };
  const setup = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await acknowledge();
      if (!current()) return;
      if (Platform.OS === 'android') {
        onAndroidSetup?.();
        return;
      }
      if (Platform.OS !== 'ios' || !isScreenTimeAvailable) {
        setError(t('settings.permissions.errors.unavailable'));
        return;
      }
      await duringSystemPrompt(async () => {
        if (owner) await screenTime.bindMeasurementOwner(owner);
        if (!current()) return;
        let status = await screenTime.getAuthorizationStatus();
        if (!current()) return;
        if (status !== 'approved') {
          await screenTime.requestAuthorization();
          if (!current()) return;
          status = await screenTime.getAuthorizationStatus();
          if (!current()) return;
          onPermissionChange?.(status === 'approved');
          if (status !== 'approved') {
            setError(t('settings.permissions.errors.grantIos'));
            return;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 450));
        } else onPermissionChange?.(true);
        if (!current()) return;
        const complete = await configureIOSScreenTime({
          mode,
          current,
          onMeasurementReady,
          onMeasurementSaved,
        });
        if (current() && complete) {
          await onConfigured?.();
          if (current()) onClose();
        }
      });
    } catch {
      if (current()) setError(t('settings.permissions.errors.requestFailed'));
    } finally {
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  };
  return { busy, error, setup, close };
}
