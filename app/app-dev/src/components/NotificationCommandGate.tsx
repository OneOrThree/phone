import { useEffect } from 'react';
import { AppState } from 'react-native';
import {
  flushNotificationCommands,
  reportNotificationLanguage,
} from '@/services/notificationCommands';
import { getLocale } from '@/i18n';

// 로그인 화면에서도 남은 logout/삭제 명령을 재전달한다.
export function NotificationCommandGate() {
  useEffect(() => {
    const flush = () => {
      if (AppState.currentState === 'active') {
        flushNotificationCommands().catch(() => {});
        reportNotificationLanguage(getLocale()).catch(() => {});
      }
    };
    flush();
    const timer = setInterval(flush, 30000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') flush();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, []);
  return null;
}
