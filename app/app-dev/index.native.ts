import { registerRootComponent } from 'expo';
import App from './src/App';
import { MagazinePreview } from '@/screens/magazine/MagazinePreview';
import { initDatadog } from './src/services/datadog';
import { initPostHog } from './src/services/posthog';

const { initializeKakaoSDK } =
  require('@react-native-kakao/core') as typeof import('@react-native-kakao/core');

initializeKakaoSDK('1280641e9b639a279b7406f24b059703');

initDatadog();
initPostHog();

// 개발 빌드에서 EXPO_PUBLIC_MAGAZINE_PREVIEW=1(또는 auto) 로 Metro 를 띄우면 잡지 칸 미리보기만 띄운다(글 넘침 확인용)
registerRootComponent(__DEV__ && process.env.EXPO_PUBLIC_MAGAZINE_PREVIEW ? MagazinePreview : App);
