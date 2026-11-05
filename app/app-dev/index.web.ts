import { registerRootComponent } from 'expo';
import App from './src/App';
import { OnboardingPreview } from '@/screens/onboarding/OnboardingPreview';
import { InteriorsReview } from '@/screens/interiors/BuildingInteriors';
import { InteriorsGalleryReview } from '@/screens/interiors/InteriorsGallery';
import { initPostHog } from './src/services/posthog';
import { CatMotionPreview } from '@/screens/character/CatMotionPreview';
import { ConstructionMotionPreview } from '@/screens/island/ConstructionMotionPreview';
import { SeaPreview } from '@/screens/sea/SeaPreview';
import { MagazinePreview } from '@/screens/magazine/MagazinePreview';
import { HarborPreview } from '@/screens/world/HarborPreview';
import { isPublicWebDemo } from '@/services/demoMode';
import PublicWebDemo from '@/screens/web-demo/PublicWebDemo';
import { initWebDemoAnalytics } from '@/services/webDemoAnalytics';
import GoogleWebLogin from '@/screens/web-demo/GoogleWebLogin';

// 웹에서 ?interiors 로 열면 건물 내부 화면 하나만, ?gallery 로 열면 원본 구경용 페이지를 띄워 픽셀 비교한다
const query = new URLSearchParams(window.location.search);
const googleLogin = isPublicWebDemo() && window.location.pathname === '/google-login.html';
if (!googleLogin) initWebDemoAnalytics();
if (
  !isPublicWebDemo() &&
  !query.has('gallery') &&
  !query.has('interiors') &&
  !query.has('motion') &&
  !query.has('construction-motion') &&
  !query.has('sea') &&
  !query.has('magazine') &&
  !query.has('onboarding') &&
  !query.has('harbor')
)
  initPostHog();
registerRootComponent(
  isPublicWebDemo()
    ? googleLogin
      ? GoogleWebLogin
      : window.location.pathname === '/experience.html'
        ? App
        : PublicWebDemo
    : query.has('harbor')
      ? HarborPreview
      : query.has('onboarding')
        ? OnboardingPreview
        : query.has('sea')
          ? SeaPreview
          : query.has('construction-motion')
            ? ConstructionMotionPreview
            : query.has('motion')
              ? CatMotionPreview
              : query.has('gallery')
                ? InteriorsGalleryReview
                : query.has('interiors')
                  ? InteriorsReview
                  : query.has('magazine')
                    ? MagazinePreview
                    : App,
);
