import { isPublicWebDemo } from './demoMode';
import { createDemoAnalytics, type DemoAnalytics, type DemoSnapshot } from './webDemoAnalyticsCore';

// 앱과 같은 Catus 프로젝트의 공개 수집 토큰이다. 관리 API 키를 브라우저에 넣지 않는다.
const token = process.env.EXPO_PUBLIC_WEB_DEMO_POSTHOG_TOKEN ?? '';
const endpoint = 'https://us.i.posthog.com/i/v0/e/';
type AnalyticsWindow = Window & { __cattusDemoAnalytics?: DemoAnalytics };
let analytics: DemoAnalytics | undefined;

export function initWebDemoAnalytics() {
  if (!isPublicWebDemo() || typeof window === 'undefined' || analytics || !token) return;
  try {
    // 같은 출처 iframe은 부모 인스턴스를 재사용한다. 진입과 체험이 한 익명 방문으로 이어진다.
    const parent = window.parent as AnalyticsWindow;
    if (parent !== window && parent.location.origin === window.location.origin)
      analytics = parent.__cattusDemoAnalytics;
    if (!analytics) {
      // 저장소가 차단된 브라우저에서는 메모리 안에서만 방문을 연결한다.
      const memory = new Map<string, string>();
      const fallback = {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => {
          memory.set(k, v);
        },
        removeItem: (k: string) => {
          memory.delete(k);
        },
      };
      const storage = (name: 'localStorage' | 'sessionStorage') => {
        try {
          return window[name];
        } catch {
          return fallback;
        }
      };
      analytics = createDemoAnalytics({
        local: storage('localStorage'),
        session: storage('sessionStorage'),
        url: window.location.href,
        referrer: document.referrer,
        isAutomated:
          navigator.webdriver ||
          ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname),
        now: Date.now,
        uuid: () => crypto.randomUUID(),
        send: (event) => {
          fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: token, ...event }),
            keepalive: true,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
          }).catch(() => {});
        },
      });
      (window as AnalyticsWindow).__cattusDemoAnalytics = analytics;
      analytics.capture('landing_viewed', {
        entry: window.location.pathname === '/experience.html' ? 'direct_experience' : 'landing',
      });
      document.addEventListener('visibilitychange', () => analytics?.visibility(!document.hidden));
      window.addEventListener('pagehide', () => analytics?.visibility(false));
      window.addEventListener('pageshow', () => analytics?.visibility(true));
    }
    // 텍스트·입력 값·접근성 이름 대신 코드가 붙인 정적인 버튼 ID만 수집한다.
    window.addEventListener('error', () =>
      analytics?.capture('error', { error_kind: 'javascript' }),
    );
    window.addEventListener('unhandledrejection', () =>
      analytics?.capture('error', { error_kind: 'unhandled_rejection' }),
    );
    document.addEventListener('click', (event) => {
      const element =
        event.target instanceof Element ? event.target.closest('[data-testid]') : null;
      const id = element?.getAttribute('data-testid');
      if (
        id &&
        (/^(fi-|home-|hud-|nav-|result-)[a-z0-9_-]{1,70}$/.test(id) ||
          [
            'focus-start',
            'start-focus',
            'pause-focus',
            'end-focus',
            'leave-fishing-arrival',
            'fishing-map',
            'fishing-raft',
            'fishing-gram',
          ].includes(id))
      ) {
        analytics?.capture('control_clicked', { control_id: id });
      }
    });
  } catch {
    /* 계측 초기화 실패는 화면 진입과 독립이다. */
  }
}

export function captureWebDemoEvent(
  name: string,
  properties?: Record<string, string | number | boolean>,
) {
  if (isPublicWebDemo()) analytics?.capture(name, properties);
}
export function observeWebDemo(snapshot: DemoSnapshot) {
  if (isPublicWebDemo()) analytics?.observe(snapshot);
}
export function webDemoAnalyticsEnabled() {
  return analytics?.enabled() ?? false;
}
export function setWebDemoAnalyticsEnabled(enabled: boolean) {
  analytics?.setEnabled(enabled);
}
