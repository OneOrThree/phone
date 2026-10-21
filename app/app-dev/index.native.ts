import { registerRootComponent } from 'expo';
import { initDatadog } from './src/services/datadog';
import { initPostHog } from './src/services/posthog';

// 앱 모듈과 소셜 SDK의 초기화 오류도 JS 오류 수집기가 설치된 뒤에 발생하게 한다.
initPostHog();

const { initializeKakaoSDK } =
  require('@react-native-kakao/core') as typeof import('@react-native-kakao/core');

initializeKakaoSDK('1280641e9b639a279b7406f24b059703');

initDatadog();

const App = (require('./src/App') as typeof import('./src/App')).default;

registerRootComponent(App);
