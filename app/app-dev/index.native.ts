import { registerRootComponent } from 'expo';
import App from './src/App';
import { initDatadog } from './src/services/datadog';
import { initPostHog } from './src/services/posthog';

const { initializeKakaoSDK } =
  require('@react-native-kakao/core') as typeof import('@react-native-kakao/core');

initializeKakaoSDK(
  process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY || '1280641e9b639a279b7406f24b059703',
);

initDatadog();
initPostHog();

registerRootComponent(App);
