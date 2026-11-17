/** 로컬 수집기 전용 Release 진단 entry. 1회 nativeCrash 후 재실행해 저장된 크래시를 확인한다. */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { initSentry, recordSentryScreen, recordSentryCameraState } from '../../src/services/sentry';
import { VerificationSession } from '../../src/screens/focus/VerificationSession';

if (!/^http:\/\/[^@]+@127\.0\.0\.1:\d+\/\d+$/.test(process.env.EXPO_PUBLIC_SENTRY_DSN ?? ''))
  throw new Error('진단 entry는 명시한 로컬 Sentry 수집기에서만 실행할 수 있습니다.');
initSentry();
recordSentryScreen('focus');
const marker = 'sentry-observability-native-probe-v1';
function Probe() {
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    AsyncStorage.getItem(marker).then((done) => {
      if (cancelled) return;
      if (done) {
        setCompleted(true);
        return;
      }
      timer = setTimeout(async () => {
        await AsyncStorage.setItem(marker, 'crash-requested');
        await Sentry.flush();
        if (cancelled) return;
        recordSentryCameraState({ capture_status: 'interrupted' });
        Sentry.nativeCrash();
      }, 12000);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return (
    <View>
      <Text>{completed ? '진단 크래시 재실행 완료' : '로컬 오류 수집 검사'}</Text>
      {!completed && <VerificationSession sessionId="local-diagnostic" enabled previewVisible />}
    </View>
  );
}
registerRootComponent(Probe);
