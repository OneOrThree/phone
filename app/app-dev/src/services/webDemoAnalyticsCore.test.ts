import { createDemoAnalytics, type DemoEvent } from './webDemoAnalyticsCore';

function fixture() {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const storage = (values: Map<string, string>) => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  let now = 1000,
    id = 0;
  const events: DemoEvent[] = [];
  const input = {
    local: storage(local),
    session: storage(session),
    url: 'https://try.oneorthree.world/?utm_source=metamoa&utm_campaign=launch&email=secret@example.com',
    referrer: 'https://metamoa.com/space/private?token=secret',
    isAutomated: false,
    now: () => now,
    uuid: () => `uuid-${++id}`,
    send: (event: DemoEvent) => events.push(event),
  };
  return {
    input,
    events,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('새로고침·체험은 같은 익명 방문으로 이어지고 새 방문과 재방문을 구분한다', () => {
  const { input, events } = fixture();
  createDemoAnalytics(input).capture('landing_viewed');
  createDemoAnalytics(input).capture('experience_started');
  expect(events[0].distinct_id).toBe(events[1].distinct_id);
  expect(events[0].properties.$session_id).toBe(events[1].properties.$session_id);
  expect(events.map((e) => e.properties.returning_visitor)).toEqual([false, false]);
  expect(events[0].uuid).not.toBe(events[1].uuid);
});

test('30분 비활동 후 방문 ID만 바뀌고 익명 사용자와 첫 유입은 유지한다', () => {
  const { input, events, advance } = fixture();
  const tracker = createDemoAnalytics(input);
  tracker.capture('landing_viewed');
  advance(30 * 60 * 1000);
  tracker.capture('experience_started');
  expect(events[0].distinct_id).toBe(events[1].distinct_id);
  expect(events[0].properties.$session_id).not.toBe(events[1].properties.$session_id);
  expect(events.map((e) => e.properties.returning_visitor)).toEqual([false, true]);
});

test('UTM·유입 도메인만 보관하며 URL 쿼리·경로·이메일은 전송하지 않는다', () => {
  const { input, events } = fixture();
  createDemoAnalytics(input).capture('landing_viewed');
  expect(events[0].properties).toMatchObject({
    utm_source: 'metamoa',
    referrer_host: 'metamoa.com',
    analytics_excluded: 0,
    $process_person_profile: false,
  });
  expect(JSON.stringify(events)).not.toContain('secret');
  expect(JSON.stringify(events)).not.toContain('/private');
  const rejected = fixture();
  rejected.input.url = 'https://try.oneorthree.world/?utm_source=person@example.com';
  createDemoAnalytics(rejected.input).capture('landing_viewed');
  expect(rejected.events[0].properties.utm_source).toBeUndefined();
});

test('화면 변경·집중 상태 변경을 한 번씩 보내고 입력한 과목은 수집하지 않는다', () => {
  const { input, events } = fixture();
  const tracker = createDemoAnalytics(input);
  const home = { route: 'home', session: null, result: null };
  tracker.observe(home);
  tracker.observe(home);
  tracker.observe({ route: 'focus', session: { id: 'focus-1', status: 'active' }, result: null });
  tracker.observe({ route: 'rest', session: { id: 'focus-1', status: 'paused' }, result: null });
  tracker.observe({ route: 'focus', session: { id: 'focus-1', status: 'active' }, result: null });
  const done = {
    route: 'focusResult',
    session: null,
    result: { id: 'focus-1', seconds: 12, fish: 0 },
  };
  tracker.observe(done);
  tracker.observe(done);
  for (const name of [
    'experience_ready',
    'focus_started',
    'focus_paused',
    'focus_resumed',
    'focus_completed',
  ])
    expect(events.filter((e) => e.event === `web_demo_${name}`)).toHaveLength(1);
  expect(events.find((e) => e.event === 'web_demo_focus_completed')?.properties).toMatchObject({
    duration_seconds: 12,
    earned_fish: 0,
  });
});

test('분석 끄기가 다음 방문에도 유지되고 다시 켜면 새 익명 식별자를 쓴다', () => {
  const { input, events } = fixture();
  const tracker = createDemoAnalytics(input);
  tracker.capture('landing_viewed');
  tracker.setEnabled(false);
  tracker.capture('store_clicked');
  const next = createDemoAnalytics(input);
  next.capture('landing_viewed');
  expect(events).toHaveLength(1);
  next.setEnabled(true);
  expect(events).toHaveLength(2);
  expect(events[1].distinct_id).not.toBe(events[0].distinct_id);
});

test('자동화·직접 표시한 QA 방문은 실제 방문 집계에서 제외한다', () => {
  const a = fixture();
  a.input.isAutomated = true;
  createDemoAnalytics(a.input).capture('landing_viewed');
  const b = fixture();
  b.input.url += '&analytics_test=1';
  createDemoAnalytics(b.input).capture('landing_viewed');
  expect(a.events[0].properties.analytics_excluded).toBe(1);
  expect(b.events[0].properties.analytics_excluded).toBe(1);
});

test('숨김·종료 이벤트 중복을 피하고 숨겨진 시간은 체류 시간에 넣지 않는다', () => {
  const { input, events, advance } = fixture();
  const tracker = createDemoAnalytics(input);
  advance(2000);
  tracker.visibility(false);
  tracker.visibility(false);
  advance(10000);
  tracker.visibility(true);
  advance(3000);
  tracker.visibility(false);
  expect(
    events
      .filter((e) => e.event === 'web_demo_visit_paused')
      .map((e) => e.properties.active_seconds),
  ).toEqual([2, 5]);
});

test('저장소·전송 실패에도 기능은 예외를 받지 않는다', () => {
  const { input } = fixture();
  input.local.getItem = () => {
    throw new Error('blocked');
  };
  input.local.setItem = () => {
    throw new Error('blocked');
  };
  input.send = () => {
    throw new Error('offline');
  };
  expect(() => createDemoAnalytics(input).capture('landing_viewed')).not.toThrow();
});
