import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import App from './src/App';
import { initDatadog } from './src/services/datadog';
import { initPostHog } from './src/services/posthog';

const { initializeKakaoSDK } =
  require('@react-native-kakao/core') as typeof import('@react-native-kakao/core');

initializeKakaoSDK(
  Platform.select({
    android: 'af3ff0c5b4fb9cd38b78428b88add65d',
    ios: '1280641e9b639a279b7406f24b059703',
    default: '1280641e9b639a279b7406f24b059703',
  })!,
);

initDatadog();
initPostHog();

registerRootComponent(App);
