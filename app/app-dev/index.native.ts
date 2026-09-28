import { registerRootComponent } from 'expo';
import App from './src/App';
import { initDatadog } from './src/services/datadog';
import { initPostHog } from './src/services/posthog';

const { initializeKakaoSDK } =
  require('@react-native-kakao/core') as typeof import('@react-native-kakao/core');

initializeKakaoSDK('af3ff0c5b4fb9cd38b78428b88add65d');

initDatadog();
initPostHog();

registerRootComponent(App);
