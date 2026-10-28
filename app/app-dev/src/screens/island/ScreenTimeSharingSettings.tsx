import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { getSession } from '@/services/api/session';
import {
  getScreenTimeReportingConsent,
  setScreenTimeReportingConsent,
} from '@/services/screenTimeReporting';
import { Toggle, Txt } from '@/design-system/patterns';
import { SheetRow } from '@/screens/island/IslandSheet';
import { t } from '@/i18n';

export function ScreenTimeSharingSettings({ e }: any) {
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
        if (active) e.notify('공유 설정을 확인하지 못했어요.');
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
      e.notify('공유 설정을 저장하지 못했어요. 다시 시도해 주세요.');
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
