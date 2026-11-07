// 공개 웹 체험판 전용 계측. 실제 앱의 사용자·집중 이벤트와 이름 및 식별자를 분리한다.
type Properties = Record<string, string | number | boolean>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type DemoSnapshot = {
  route: string;
  session: { id: string; status: string } | null;
  result: { id: string; seconds: number; fish: number } | null;
};
export type DemoEvent = {
  uuid: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Properties;
};
export type DemoAnalytics = ReturnType<typeof createDemoAnalytics>;
const visitorKey = 'cattus:web-demo:visitor:v1';
const sessionKey = 'cattus:web-demo:session:v1';
const disabledKey = 'cattus:web-demo:analytics-disabled';
const idleMs = 30 * 60 * 1000;

export function createDemoAnalytics(input: {
  local: Storage;
  session: Storage;
  url: string;
  referrer: string;
  isAutomated: boolean;
  now: () => number;
  uuid: () => string;
  send: (event: DemoEvent) => void;
}) {
  const read = (storage: Storage, key: string) => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (storage: Storage, key: string, value: string | null) => {
    try {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    } catch {}
  };
  const url = new URL(input.url);
  let enabled = read(input.local, disabledKey) !== '1';
  let visitor = read(input.local, visitorKey);
  let hasPriorVisit = !!visitor;
  let visit: { id: string; at: number; attribution: Properties; returning: boolean } | null = null;
  try {
    visit = JSON.parse(read(input.session, sessionKey) || 'null');
  } catch {}
  if (
    !visit ||
    typeof visit.id !== 'string' ||
    typeof visit.at !== 'number' ||
    !visit.attribution ||
    typeof visit.returning !== 'boolean'
  )
    visit = null;
  const attribution: Properties = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = url.searchParams.get(key);
    // 이메일·전체 URL·임의 쿼리 문자열은 받지 않는다.
    if (value && /^[\p{L}\p{N} _./-]{1,100}$/u.test(value)) attribution[key] = value;
  }
  try {
    attribution.referrer_host = new URL(input.referrer).hostname;
  } catch {}
  const excluded = input.isAutomated || url.searchParams.get('analytics_test') === '1';
  let current: DemoSnapshot | null = null;
  let startedAt = input.now();
  let activeMs = 0;
  let visible = true;

  const capture = (name: string, properties: Properties = {}) => {
    if (!enabled || read(input.local, disabledKey) === '1') return;
    try {
      const now = input.now();
      if (!visitor) {
        visitor = `web-demo:${input.uuid()}`;
        write(input.local, visitorKey, visitor);
      }
      if (!visit || now - visit.at >= idleMs) {
        visit = { id: input.uuid(), at: now, attribution, returning: hasPriorVisit };
        hasPriorVisit = true;
      }
      visit.at = now;
      write(input.session, sessionKey, JSON.stringify(visit));
      input.send({
        uuid: input.uuid(),
        event: `web_demo_${name}`,
        distinct_id: visitor,
        timestamp: new Date(now).toISOString(),
        properties: {
          ...visit.attribution,
          ...properties,
          app_surface: 'web_demo',
          analytics_environment: 'production',
          analytics_schema_version: 1,
          analytics_excluded: excluded ? 1 : 0,
          returning_visitor: visit.returning,
          $session_id: visit.id,
          $process_person_profile: false,
          $geoip_disable: true,
          $host: url.host,
          $pathname: url.pathname,
          $current_url: url.origin + url.pathname,
        },
      });
    } catch {
      /* 분석 실패가 체험 동작을 막지 않는다. */
    }
  };
  return {
    capture,
    enabled: () => enabled && read(input.local, disabledKey) !== '1',
    setEnabled(value: boolean) {
      enabled = value;
      write(input.local, disabledKey, value ? null : '1');
      if (!value) {
        visitor = null;
        visit = null;
        hasPriorVisit = false;
        write(input.local, visitorKey, null);
        write(input.session, sessionKey, null);
      } else capture('analytics_enabled');
    },
    observe(next: DemoSnapshot) {
      if (!current) capture('experience_ready', { screen: next.route });
      if (next.route !== current?.route)
        capture('screen_viewed', {
          screen: next.route,
          previous_screen: current?.route ?? 'landing',
        });
      if (next.session && next.session.id !== current?.session?.id) {
        capture('focus_started', { focus_session_id: next.session.id });
      } else if (next.session && next.session.status !== current?.session?.status) {
        capture(next.session.status === 'paused' ? 'focus_paused' : 'focus_resumed', {
          focus_session_id: next.session.id,
        });
      }
      if (next.result && current && next.result.id !== current.result?.id)
        capture('focus_completed', {
          focus_session_id: next.result.id,
          duration_seconds: next.result.seconds,
          earned_fish: next.result.fish,
        });
      // 입력 본문이 든 원본 state 대신 필요한 스칼라만 복사한다.
      current = {
        route: next.route,
        session: next.session && { ...next.session },
        result: next.result && { ...next.result },
      };
    },
    visibility(isVisible: boolean) {
      if (visible === isVisible) return;
      if (!isVisible) {
        activeMs += input.now() - startedAt;
        capture('visit_paused', {
          active_seconds: Math.floor(activeMs / 1000),
          last_screen: current?.route ?? 'landing',
          focus_in_progress: !!current?.session,
        });
      } else {
        startedAt = input.now();
        capture('visit_resumed');
      }
      visible = isVisible;
    },
  };
}
