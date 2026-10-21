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

// 개발 빌드에서 EXPO_PUBLIC_MAGAZINE_PREVIEW=1(또는 auto) 로 Metro 를 띄우면 잡지 칸 미리보기만, editor 면 홍보 쓰기 대본 미리보기만,
// home 이면 우체통 없는 섬의 잡지 배달·물건만 띄운다(글 넘침·손가락 조작 확인용). __DEV__ 분기 안에서 require 해야 운영 번들에
// 미리보기가 실리지 않는다(Metro 는 쓰지 않는 import 도 번들에 넣는다)
const magazinePreview = process.env.EXPO_PUBLIC_MAGAZINE_PREVIEW ?? '';
registerRootComponent(
  __DEV__ && ['1', 'auto', 'editor', 'home'].includes(magazinePreview)
    ? (
        require('@/screens/magazine/MagazinePreview') as typeof import('@/screens/magazine/MagazinePreview')
      )[
        magazinePreview === 'editor'
          ? 'MagazineEditorPreview'
          : magazinePreview === 'home'
            ? 'MagazineHomePreview'
            : 'MagazinePreview'
      ]
    : App,
);
