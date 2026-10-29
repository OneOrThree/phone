/**
 * 활성 2.0 앱의 Datadog RUM 진입점.
 *
 * 모든 서버 호출은 전역 fetch를 사용하는 `services/api/client.ts`를 지나므로
 * `trackResources`와 first-party host 설정만으로 현재 RUM 화면과 백엔드 APM trace가 연결된다.
 * 네이티브 모듈이 없는 개발 빌드와 키가 없는 로컬 환경에서는 조용히 no-op 한다.
 */

const APPLICATION_ID = process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID?.trim();
const CLIENT_TOKEN = process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN?.trim();
// 로컬 환경변수에 남은 1.x 설정도 cattus 데이터를 gromo로 보내지 못하게 한다.
const LEGACY_APPLICATION_ID = '44a4f021-ed4d-4134-b59d-63a40e37c2ff';

let initialized: Promise<boolean> | null = null;
let activeViewKey: string | null = null;

export function initDatadog(): void {
  if (initialized || !APPLICATION_ID || !CLIENT_TOKEN || APPLICATION_ID === LEGACY_APPLICATION_ID)
    return;

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
            service: 'cattus-app',
            // 2번째 인자(터치 추적)는 끈다. 켜면 React.createElement 를 감싸 모든 렌더에 비용이 붙는다
            rumConfiguration: new dd.RumConfiguration(APPLICATION_ID, false, true, false, {
              sessionSampleRate: 100,
              firstPartyHosts: [
                {
                  match: 'catus-api.oneorthree.world',
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

/** 서버 명령과 상태 반영까지의 처리시간. 화면 렌더 시간·집중한 시간과는 별개다. */
export async function measureDatadogOperation<T>(
  operation: 'focus_start' | 'focus_finish' | 'focus_sea_start',
  run: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  let outcome: 'success' | 'failure' = 'failure';
  try {
    const result = await run();
    outcome = 'success';
    return result;
  } finally {
    const durationMs = Math.max(0, performance.now() - started);
    void initialized
      ?.then(async (ok) => {
        if (!ok) return;
        const { DdRum, RumActionType } =
          require('@datadog/mobile-react-native') as typeof import('@datadog/mobile-react-native');
        await DdRum.addAction(RumActionType.CUSTOM, operation, {
          operation,
          outcome,
          duration_ms: durationMs,
        });
      })
      .catch(() => {
        // 수집 실패가 서버 명령의 반환값이나 오류를 바꾸면 안 된다.
      });
  }
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
