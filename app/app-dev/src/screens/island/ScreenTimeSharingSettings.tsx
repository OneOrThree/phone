import { Toggle, Txt } from '@/design-system/patterns';
import { t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { SheetRow } from '@/screens/island/IslandSheet';
import { getSession } from '@/services/api/session';
import {
  getScreenTimeReportingConsent,
  setScreenTimeReportingConsent,
} from '@/services/screenTimeReporting';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function ScreenTimeSharingSettings({ e }: ScreenProps) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const owner = getSession()?.userId;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setEnabled(false);
    if (!owner) {
      setBusy(false);
      return;
    }
    getScreenTimeReportingConsent(owner)
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        if (active) e.notify(t('ui.misc.sharingLoadFailed'));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [owner]);
  const change = async (value: boolean) => {
    if (!owner || busy) return;
    setBusy(true);
    try {
      await setScreenTimeReportingConsent(owner, value);
      if (getSession()?.userId === owner) setEnabled(value);
    } catch {
      e.notify(t('ui.misc.sharingSaveFailed'));
    } finally {
      setBusy(false);
    }
  };
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  return (
    <>
      <SheetRow
        title={t('settings.usageSharing')}
        sub={t('settings.usageSharingSub')}
        tail={
          <Toggle
            label={t('settings.usageSharing')}
            value={enabled}
            disabled={busy || !owner}
            onChange={change}
          />
        }
      />
      {e.state.settings.screenTimeSyncError && (
        <Txt kind="meta">{t('settings.usageSharingError')}</Txt>
      )}
    </>
  );
}
