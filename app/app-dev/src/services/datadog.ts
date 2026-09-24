/**
 * 활성 2.0 앱의 Datadog RUM 진입점.
 *
 * 모든 서버 호출은 전역 fetch를 사용하는 `services/api/client.ts`를 지나므로
 * `trackResources`와 first-party host 설정만으로 현재 RUM 화면과 백엔드 APM trace가 연결된다.
 * 네이티브 모듈이 없는 개발 빌드와 키가 없는 로컬 환경에서는 조용히 no-op 한다.
 */

const APPLICATION_ID = process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID;
const CLIENT_TOKEN = process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN;

let initialized: Promise<boolean> | null = null;
let activeViewKey: string | null = null;

export function initDatadog(): void {
  if (!APPLICATION_ID || !CLIENT_TOKEN) return;

  initialized = (async () => {
    try {
      const dd =
        require('@datadog/mobile-react-native') as typeof import('@datadog/mobile-react-native');
      await dd.DdSdkReactNative.initialize(
        new dd.CoreConfiguration(
          CLIENT_TOKEN,
          process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'dev' : 'prod'),
          dd.TrackingConsent.GRANTED,
          {
            site: 'US5',
            service: 'gromo-app-v2',
            rumConfiguration: new dd.RumConfiguration(APPLICATION_ID, true, true, false, {
              sessionSampleRate: 100,
              firstPartyHosts: [
                {
                  match: 'api.oneorthree.world',
                  propagatorTypes: [dd.PropagatorType.DATADOG],
                },
                {
                  match: 'oneorthree.dev.mooo.com',
                  propagatorTypes: [dd.PropagatorType.DATADOG],
                },
              ],
            }),
          },
        ),
      );
      return true;
    } catch {
      return false;
    }
  })();
}

/** 커스텀 라우터의 현재 화면을 RUM view로 기록한다. */
export function trackDatadogView(route: string, title: string): () => void {
  const viewKey = `route:${route}:${Date.now()}`;
  let stopped = false;

  void initialized?.then(async (ok) => {
    if (!ok || stopped) return;
    try {
      const { DdRum } =
        require('@datadog/mobile-react-native') as typeof import('@datadog/mobile-react-native');
      if (activeViewKey) await DdRum.stopView(activeViewKey);
      activeViewKey = viewKey;
      await DdRum.startView(viewKey, title, { route });
    } catch {
      // 관측 실패가 화면 전환을 막으면 안 된다.
    }
  });

  return () => {
    stopped = true;
    void initialized?.then(async (ok) => {
      if (!ok || activeViewKey !== viewKey) return;
      try {
        const { DdRum } =
          require('@datadog/mobile-react-native') as typeof import('@datadog/mobile-react-native');
        await DdRum.stopView(viewKey);
        activeViewKey = null;
      } catch {
        // no-op
      }
    });
  };
}
