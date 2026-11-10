import { registerRootComponent } from 'expo';
import { createLazyRoot, type ScreenLoader } from '@/app/LazyRoot';
import { captureWebDemoEvent, initWebDemoAnalytics } from '@/services/webDemoAnalytics';

// 루트 화면은 import()로 나눠, 연 주소에 필요한 화면 코드만 받는다(GROMO-2788).
// 공개 웹 소개 화면(PublicWebDemo)은 앱 전체를 받지 않고, 체험 iframe(experience.html)만 App을 받는다.
// 조건에는 process.env.EXPO_PUBLIC_WEB_DEMO를 직접 쓴다. 빌드 때 상수로 바뀌어 공개 웹 빌드에서는
// 검토용 미리보기와 PostHog 초기화 분기가 번들에서 빠진다(함수로 감싸면 빠지지 않는다).

// 웹에서 ?interiors 로 열면 건물 내부 화면 하나만, ?gallery 로 열면 원본 구경용 페이지를 띄워 픽셀 비교한다
const query = new URLSearchParams(window.location.search);
const googleLogin =
  process.env.EXPO_PUBLIC_WEB_DEMO === '1' && window.location.pathname === '/google-login.html';
if (!googleLogin) initWebDemoAnalytics();
if (
  process.env.EXPO_PUBLIC_WEB_DEMO !== '1' &&
  !query.has('gallery') &&
  !query.has('interiors') &&
  !query.has('motion') &&
  !query.has('construction-motion') &&
  !query.has('sea') &&
  !query.has('magazine') &&
  !query.has('onboarding') &&
  !query.has('harbor')
)
  // 화면을 그리기 전에 초기화하던 순서를 지키려고 동기 require로 둔다.
  require('./src/services/posthog').initPostHog();
const load: ScreenLoader =
  process.env.EXPO_PUBLIC_WEB_DEMO === '1'
    ? googleLogin
      ? () => import('@/screens/web-demo/GoogleWebLogin')
      : window.location.pathname === '/experience.html'
        ? () => import('./src/App')
        : () => import('@/screens/web-demo/PublicWebDemo')
    : query.has('harbor')
      ? () => import('@/screens/world/HarborPreview').then((m) => ({ default: m.HarborPreview }))
      : query.has('onboarding')
        ? () =>
            import('@/screens/onboarding/OnboardingPreview').then((m) => ({
              default: m.OnboardingPreview,
            }))
        : query.has('sea')
          ? () => import('@/screens/sea/SeaPreview').then((m) => ({ default: m.SeaPreview }))
          : query.has('construction-motion')
            ? () =>
                import('@/screens/island/ConstructionMotionPreview').then((m) => ({
                  default: m.ConstructionMotionPreview,
                }))
            : query.has('motion')
              ? () =>
                  import('@/screens/character/CatMotionPreview').then((m) => ({
                    default: m.CatMotionPreview,
                  }))
              : query.has('gallery')
                ? () =>
                    import('@/screens/interiors/InteriorsGallery').then((m) => ({
                      default: m.InteriorsGalleryReview,
                    }))
                : query.has('interiors')
                  ? () =>
                      import('@/screens/interiors/BuildingInteriors').then((m) => ({
                        default: m.InteriorsReview,
                      }))
                  : query.has('magazine')
                    ? () =>
                        import('@/screens/magazine/MagazinePreview').then((m) => ({
                          default:
                            query.get('magazine') === 'reader'
                              ? m.MagazineReaderPreview
                              : m.MagazinePreview,
                        }))
                    : () => import('./src/App');
registerRootComponent(
  createLazyRoot(load, {
    // 번들을 받지 못한 경우(chunk)와 화면이 그리다 실패한 경우(render)를 나눠 남긴다. 메시지는 보내지 않는다.
    onError: (failure, error) =>
      captureWebDemoEvent('screen_load_failed', {
        path: window.location.pathname,
        error_kind: failure,
        error_name: error instanceof Error ? error.name : 'unknown',
      }),
    reload: () => window.location.reload(),
  }),
);
