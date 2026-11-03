import { Txt } from '@/design-system/patterns';
import { t } from '@/i18n';
import { screenTime } from '@/services/screenTime';
import { Linking, Platform } from 'react-native';

export async function openScreenTimeSettings(notify: (message: string) => void) {
  try {
    if (Platform.OS === 'android') {
      if (!(await screenTime.openUsageAccessSettings())) throw new Error('SETTINGS_UNAVAILABLE');
    } else {
      await Linking.openSettings();
    }
  } catch {
    notify(t('settings.permissions.errors.settingsOpen'));
  }
}

export function ScreenTimePermissionHelp() {
  return (
    <Txt kind="meta">
      {Platform.OS === 'android'
        ? t('settings.permissions.help.android')
        : t('settings.permissions.help.ios')}
    </Txt>
  );
}
