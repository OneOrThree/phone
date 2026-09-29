/**
 * 섬 실시간 프로젝션·세션 (GROMO-2010) — 스냅숏 정본, 워터마크 중복·역순 방어,
 * 모르는 주민 재조회, 응원 dedupe·TTL, STOMP 목적지·인증 헤더.
 */
import assert from 'node:assert/strict';
import { ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  friendlyRealtimeErrorMessage,
  IslandProjection,
  isGoldenFishParticipant,
  parseGoldenFishEvent,
  realtimeWsUrl,
  startIslandRealtime,
  stompIslandChannel,
  type IslandChannelOpts,
  type IslandPresenceTransition,
  type GoldenFishEvent,
  type PresenceView,
} from '@/services/islandRealtime';
import type { FocusMember, ProjectionWatermark, RestMember } from '@/services/api/islands';
import { Client } from '@stomp/stompjs';

jest.mock('@stomp/stompjs', () => {
  class FakeClient {
    static instances: FakeClient[] = [];
    connected = false;
    connectHeaders: Record<string, string> = {};
    subs: { dest: string; cb: (m: { body: string }) => void }[] = [];
    published: { destination: string; body: string }[] = [];
    deactivated = 0;
    opts: Record<string, any>;
    constructor(o: Record<string, any>) {
      this.opts = o;
      FakeClient.instances.push(this);
    }
    activate() {
      this.opts.beforeConnect?.(this);
      this.connected = true;
      this.opts.onConnect?.({} as never);
    }
    subscribe(dest: string, cb: (m: { body: string }) => void) {
      this.subs.push({ dest, cb });
      return {
        unsubscribe: () => {
          if (!this.connected) throw new TypeError('There is no underlying STOMP connection');
        },
      };
    }
    publish(p: { destination: string; body: string }) {
      this.published.push(p);
    }
    deactivate() {
      this.deactivated += 1;
      this.connected = false;
      return Promise.resolve();
    }
  }
  return { Client: FakeClient };
});

const NOW = '2026-09-24T12:00:00.000Z';
const wm = (
  projection: ProjectionWatermark['projection'],
  aggregateId: string,
  version: number,
): ProjectionWatermark => ({
  projection,
  islandId: 'i1',
  aggregateId,
  version,
});
const focusItem = (userId: string, over: object = {}): FocusMember => ({
  userId,
  name: `이름-${userId}`,
  catColor: 'ginger',
  appearance: null,
  sessionId: `s-${userId}`,
  subject: '수학',
  activeSeconds: 60,
  status: 'active',
  ...over,
});
const focusSnap = (items: FocusMember[], watermarks: ProjectionWatermark[] = []) => ({
  items,
  serverNow: NOW,
  watermarks,
});
const restSnap = (items: RestMember[], watermarks: ProjectionWatermark[] = []) => ({
  items,
  serverNow: NOW,
  watermarks,
});
const focusEvent = (userId: string, version: number, payload: object = {}, env: object = {}) => ({
  eventId: `e-${userId}-${version}`,
  schemaVersion: 1,
  type: 'focus.member.updated',
  islandId: 'i1',
  aggregateVersion: version,
  occurredAt: NOW,
  payload: {
    userId,
    sessionId: `s-${userId}`,
    status: 'active',
    subject: '영어',
    activeSeconds: 120,
    serverNow: NOW,
    sessionVersion: version,
    ...payload,
  },
  ...env,
});
const restEvent = (userId: string, version: number, payload: object = {}, env: object = {}) => ({
  eventId: `r-${userId}-${version}`,
  schemaVersion: 1,
  type: 'rest.member.updated',
  islandId: 'i1',
  aggregateVersion: version,
  occurredAt: NOW,
  payload: {
    userId,
    sessionId: `s-${userId}`,
    status: 'paused',
    restStartedAt: NOW,
    restSeat: 2,
    serverNow: NOW,
    sessionVersion: version,
    ...payload,
  },
  ...env,
});
const emoteEvent = (eventId: string, over: object = {}) => ({
  eventId,
  schemaVersion: 1,
  type: 'focus.emote',
  islandId: 'i1',
  aggregateVersion: null,
  occurredAt: NOW,
  payload: {
    userId: 'u1',
    sessionId: 's-u1',
    type: 'cheer',
    // 서버 시계 기준 3초 — 스냅숏의 serverNow(NOW)에서 재는다.
    expiresAt: new Date(Date.parse(NOW) + 3000).toISOString(),
    ...over,
  },
});
const goldenEvent = (eventId = 'golden-i1-1', over: object = {}) => ({
  eventId,
  schemaVersion: 1,
  type: 'focus.golden',
  islandId: 'i1',
  aggregateVersion: 1,
  occurredAt: NOW,
  payload: {
    islandId: 'i1',
    drawnAt: NOW,
    reward: 50,
    sharePerMember: 25,
    members: [
      {
        userId: '11111111-1111-4111-8111-111111111111',
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        userId: '22222222-2222-4222-8222-222222222222',
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ],
    ...over,
  },
});

beforeEach(async () => {
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

describe('IslandProjection', () => {
  test('스냅숏이 정본이다 — 목록을 통째로 교체하고 워터마크를 심는다', () => {
    const p = new IslandProjection('i1');
    p.loadFocus(
      focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 3), wm('focus.member', 'u2', 7)]),
    );
    assert.equal(p.focus().length, 1);
    assert.equal(p.focus()[0].name, '이름-u1');
  });

  test('알려진 주민의 높은 버전 이벤트는 반영하고 이름·색은 스냅숏 것을 유지한다', () => {
    const p = new IslandProjection('i1');
    p.loadFocus(focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]));
    assert.equal(p.apply(focusEvent('u1', 2)), true);
    const m = p.focus()[0];
    assert.equal(m.subject, '영어');
    assert.equal(m.activeSeconds, 120);
    assert.equal(m.name, '이름-u1');
    assert.equal(m.catColor, 'ginger');
  });

  test('같은·낮은 버전 이벤트는 중복·역순으로 버린다', () => {
    const p = new IslandProjection('i1');
    p.loadFocus(focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 3)]));
    assert.equal(p.apply(focusEvent('u1', 3)), false);
    assert.equal(p.apply(focusEvent('u1', 2)), false);
    assert.equal(p.focus()[0].subject, '수학');
  });

  test('모르는 주민 이벤트는 만들지 않고 정본 재조회를 요구한다', () => {
    const p = new IslandProjection('i1');
    p.loadFocus(focusSnap([], []));
    assert.equal(p.apply(focusEvent('ghost', 1)), false);
    assert.equal(p.resyncNeeded, true);
    assert.equal(p.focus().length, 0);
  });

  test('completed 는 focus 목록에서 지운다', () => {
    const p = new IslandProjection('i1');
    p.loadFocus(focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]));
    assert.equal(p.apply(focusEvent('u1', 2, { status: 'completed' })), true);
    assert.equal(p.focus().length, 0);
  });

  test('완료 전이는 이전 주민 데이터를 보존한다', () => {
    const p = new IslandProjection('i1');
    p.loadFocus(focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]));
    const result = p.applyWithTransition(focusEvent('u1', 2, { status: 'completed' }));
    assert.equal(result.changed, true);
    assert.equal(result.transition?.kind, 'focus');
    assert.equal(result.transition?.previous?.userId, 'u1');
    assert.equal(result.transition?.current, null);
  });

  test('rest 이벤트: paused 는 앉히고 active/completed 는 거둔다', () => {
    const p = new IslandProjection('i1');
    p.loadRest(restSnap([], [wm('rest.member', 'u1', 1)]));
    assert.equal(p.apply(restEvent('u1', 2)), true);
    assert.equal(p.rest().length, 1);
    assert.equal(p.rest()[0].restSeat, 2);
    assert.equal(p.apply(restEvent('u1', 3, { status: 'active' })), true);
    assert.equal(p.rest().length, 0);
  });

  test('모르는 schemaVersion·type·다른 섬 이벤트는 버리고 워터마크도 진행하지 않는다', () => {
    const p = new IslandProjection('i1');
    p.loadFocus(focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]));
    assert.equal(p.apply(focusEvent('u1', 5, {}, { schemaVersion: 2 })), false);
    assert.equal(p.apply(focusEvent('u1', 6, {}, { islandId: 'other' })), false);
    assert.equal(p.apply({ ...focusEvent('u1', 7), type: 'island.updated' }), false);
    // 버전이 소비되지 않아 2번 이벤트가 그대로 적용된다.
    assert.equal(p.apply(focusEvent('u1', 2)), true);
  });

  test('응원은 eventId 중복을 거르고 만료된 것은 띄우지 않는다', () => {
    const p = new IslandProjection('i1');
    p.loadFocus(focusSnap([], [wm('focus.member', 'u1', 1)]));
    assert.equal(p.apply(emoteEvent('em1')), true);
    assert.equal(p.apply(emoteEvent('em1')), false);
    assert.equal(p.emotes().length, 1);
    assert.equal(
      p.apply(emoteEvent('em2', { expiresAt: new Date(Date.parse(NOW) - 1000).toISOString() })),
      false,
    );
    assert.equal(p.emotes().length, 1);
  });
});

describe('황금 물고기 실시간 사건', () => {
  test('서버가 확정한 focus.golden 봉투와 참여 주민만 컷신 대상으로 인정한다', () => {
    const event = parseGoldenFishEvent(goldenEvent(), 'i1');
    assert.ok(event);
    assert.equal(
      isGoldenFishParticipant(
        event,
        '11111111-1111-4111-8111-111111111111',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
      true,
    );
    assert.equal(isGoldenFishParticipant(event, 'u3', 's-u3'), false);
    assert.equal(parseGoldenFishEvent({ ...goldenEvent(), islandId: 'other' }, 'i1'), null);
    assert.equal(
      parseGoldenFishEvent({ ...goldenEvent(), type: 'focus.member.updated' }, 'i1'),
      null,
    );
  });

  test('손상된 보상·참여자 payload와 세션이 다른 주민은 거부한다', () => {
    assert.equal(
      parseGoldenFishEvent(goldenEvent('bad-reward', { reward: -Infinity }), 'i1'),
      null,
    );
    assert.equal(
      parseGoldenFishEvent(
        goldenEvent('one-member', { members: [{ userId: 'u1', sessionId: 's-u1' }] }),
        'i1',
      ),
      null,
    );
    assert.equal(
      parseGoldenFishEvent(
        goldenEvent('missing-session', { members: [{ userId: 'u1' }, null] }),
        'i1',
      ),
      null,
    );
    assert.equal(parseGoldenFishEvent(goldenEvent('bad-date', { drawnAt: 'later' }), 'i1'), null);
    assert.equal(
      parseGoldenFishEvent(goldenEvent('date-without-instant', { drawnAt: '2026-09-28' }), 'i1'),
      null,
    );
    assert.equal(parseGoldenFishEvent(goldenEvent('bad-island', { islandId: 'i2' }), 'i1'), null);
    assert.equal(parseGoldenFishEvent(goldenEvent('zero-reward', { reward: 0 }), 'i1'), null);
    assert.equal(
      parseGoldenFishEvent(goldenEvent('bad-share', { sharePerMember: 24 }), 'i1'),
      null,
    );
    assert.equal(
      parseGoldenFishEvent(
        goldenEvent('duplicate-members', {
          members: [
            {
              userId: '11111111-1111-4111-8111-111111111111',
              sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            },
            {
              userId: '11111111-1111-4111-8111-111111111111',
              sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            },
          ],
        }),
        'i1',
      ),
      null,
    );
    assert.equal(
      parseGoldenFishEvent(
        goldenEvent('invalid-member-id', {
          members: [
            { userId: 'not-a-uuid', sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
            {
              userId: '22222222-2222-4222-8222-222222222222',
              sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            },
          ],
        }),
        'i1',
      ),
      null,
    );
    assert.equal(
      parseGoldenFishEvent(
        goldenEvent('invalid-third-member', {
          reward: 75,
          members: [
            {
              userId: '11111111-1111-4111-8111-111111111111',
              sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            },
            {
              userId: '22222222-2222-4222-8222-222222222222',
              sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            },
            { userId: 'broken', sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
          ],
        }),
        'i1',
      ),
      null,
    );
    const valid = parseGoldenFishEvent(goldenEvent(), 'i1');
    assert.ok(valid);
    assert.equal(
      isGoldenFishParticipant(valid, '11111111-1111-4111-8111-111111111111', 'other-session'),
      false,
    );
    assert.equal(isGoldenFishParticipant(valid, '11111111-1111-4111-8111-111111111111'), true);
    assert.equal(isGoldenFishParticipant(valid, null), false);
  });
});

type FakeChannel = {
  opts: IslandChannelOpts | null;
  sent: { destination: string; body: unknown }[];
  reopened: number;
  closed: number;
  connected: boolean;
  emoteEnabled: boolean[];
};
const fakeChannel = (): FakeChannel => ({
  opts: null,
  sent: [],
  reopened: 0,
  closed: 0,
  connected: true,
  emoteEnabled: [],
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function start(
  deps: {
    islandId: string;
    emoteSessionId?: string | null;
    snapshots?: { focus: ReturnType<typeof focusSnap>; rest: ReturnType<typeof restSnap> };
    loadSnapshots?: () => Promise<{
      focus: ReturnType<typeof focusSnap>;
      rest: ReturnType<typeof restSnap>;
    }>;
    loadError?: unknown;
    views?: PresenceView[];
    transitions?: IslandPresenceTransition[];
    golden?: GoldenFishEvent[];
    sendError?: string[];
  },
  channel: FakeChannel,
) {
  let loads = 0;
  const rt = startIslandRealtime({
    islandId: deps.islandId,
    emoteSessionId: deps.emoteSessionId,
    onView: (v) => deps.views?.push(v),
    onTransition: (transition) => deps.transitions?.push(transition),
    onGoldenFish: (event) => deps.golden?.push(event),
    onSendError: (m) => deps.sendError?.push(m),
    alive: () => true,
    connect: (opts) => {
      channel.opts = opts;
      return {
        send: (d, b) => {
          if (!channel.connected) return false;
          channel.sent.push({ destination: d, body: b });
          return true;
        },
        setEmoteEnabled: (enabled) => {
          channel.emoteEnabled.push(enabled);
        },
        reopen: () => {
          channel.reopened += 1;
        },
        close: () => {
          channel.closed += 1;
        },
      };
    },
    loadSnapshots: async () => {
      loads += 1;
      if (deps.loadError) throw deps.loadError;
      if (deps.loadSnapshots) return deps.loadSnapshots();
      return deps.snapshots ?? { focus: focusSnap([]), rest: restSnap([]) };
    },
  });
  return { rt, loads: () => loads };
}

describe('startIslandRealtime', () => {
  test('같은 서버 이벤트를 받은 두 앱은 각각 한 번만 컷신 신호를 받고 중복 봉투는 버린다', () => {
    const firstChannel = fakeChannel();
    const secondChannel = fakeChannel();
    const first: GoldenFishEvent[] = [];
    const second: GoldenFishEvent[] = [];
    start({ islandId: 'i1', golden: first }, firstChannel);
    start({ islandId: 'i1', golden: second }, secondChannel);
    const event = goldenEvent();
    firstChannel.opts?.onEvent(event);
    firstChannel.opts?.onEvent(event);
    secondChannel.opts?.onEvent(event);
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0].eventId, event.eventId);
  });

  test('응원 세션은 presence 재연결 없이 구독과 발신 자격을 갱신한다', () => {
    const channel = fakeChannel();
    const { rt } = start({ islandId: 'i1' }, channel);
    rt.setEmoteSessionId('s-me');
    assert.deepEqual(channel.emoteEnabled, [true]);
    assert.equal(rt.sendEmote('cheer'), true);
    assert.deepEqual(channel.sent[0].body, { sessionId: 's-me', type: 'cheer' });

    rt.setEmoteSessionId(null);
    assert.deepEqual(channel.emoteEnabled, [true, false]);
    assert.equal(rt.sendEmote('cheer'), false);
    assert.equal(channel.reopened, 0);
  });

  test('resync 는 스냅숏을 싣고 ready 를 발행한다', async () => {
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const { rt } = start(
      {
        islandId: 'i1',
        views,
        snapshots: {
          focus: focusSnap([focusItem('u1')]),
          rest: restSnap([]),
        },
      },
      channel,
    );
    rt.resync();
    await flush();
    assert.equal(views.at(-1)?.status, 'ready');
    assert.equal(views.at(-1)?.focus[0].userId, 'u1');
  });

  test('초기·재연결 스냅숏은 전이를 내지 않고 unknown-user gap 재조회는 확인된 신규 주민을 낸다', async () => {
    const channel = fakeChannel();
    const transitions: IslandPresenceTransition[] = [];
    const deps = {
      islandId: 'i1',
      transitions,
      snapshots: {
        focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
        rest: restSnap([]),
      },
    };
    const { rt } = start(deps, channel);
    rt.resync();
    await flush();
    channel.opts?.onOpen();
    await flush();
    assert.equal(transitions.length, 0);

    deps.snapshots = {
      focus: focusSnap(
        [focusItem('u1'), focusItem('ghost')],
        [wm('focus.member', 'u1', 1), wm('focus.member', 'ghost', 1)],
      ),
      rest: restSnap([]),
    };
    channel.opts?.onEvent(focusEvent('ghost', 2));
    await flush();
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].source, 'event-gap');
    assert.equal(transitions[0].userId, 'ghost');
    assert.equal(transitions[0].previous, null);
    assert.equal(transitions[0].current?.userId, 'ghost');
  });

  test('알려진 상태 이벤트는 뷰 발행 뒤 상태 경계 전이를 낸다', async () => {
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const transitions: IslandPresenceTransition[] = [];
    const { rt } = start(
      {
        islandId: 'i1',
        views,
        transitions,
        snapshots: {
          focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
          rest: restSnap([]),
        },
      },
      channel,
    );
    rt.resync();
    await flush();
    channel.opts?.onEvent(focusEvent('u1', 2, { status: 'paused' }));
    assert.equal(views.at(-1)?.focus[0].status, 'paused');
    const transition = transitions.at(-1);
    assert.ok(transition?.kind === 'focus');
    assert.equal(transition.source, 'event');
    assert.equal(transition.previous?.status, 'active');
    assert.equal(transition.current?.status, 'paused');
  });

  test('상태가 active로 같아도 sessionId가 바뀌면 세션 교체 전이를 낸다', async () => {
    const channel = fakeChannel();
    const transitions: IslandPresenceTransition[] = [];
    const { rt } = start(
      {
        islandId: 'i1',
        transitions,
        snapshots: {
          focus: focusSnap([focusItem('u1', { sessionId: 'old' })], [wm('focus.member', 'u1', 1)]),
          rest: restSnap([]),
        },
      },
      channel,
    );
    rt.resync();
    await flush();

    channel.opts?.onEvent(focusEvent('u1', 2, { sessionId: 'new', status: 'active' }));

    assert.equal(transitions.length, 1);
    const transition = transitions[0];
    assert.equal(transition.kind, 'focus');
    if (transition.kind !== 'focus') throw new Error('focus 전이가 필요하다');
    assert.equal(transition.previous?.sessionId, 'old');
    assert.equal(transition.current?.sessionId, 'new');
  });

  test('재연결 조회 중 도착한 최신 이벤트를 늦은 스냅숏이 되감지 않는다', async () => {
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const transitions: IslandPresenceTransition[] = [];
    const deps: Parameters<typeof start>[0] = {
      islandId: 'i1',
      views,
      transitions,
      snapshots: {
        focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
        rest: restSnap([]),
      },
    };
    const { rt } = start(deps, channel);
    rt.resync();
    await flush();

    let resolveSnapshot!: (value: {
      focus: ReturnType<typeof focusSnap>;
      rest: ReturnType<typeof restSnap>;
    }) => void;
    deps.loadSnapshots = () => new Promise((resolve) => (resolveSnapshot = resolve));
    rt.resync('reconnect');
    channel.opts?.onEvent(focusEvent('u1', 2, { status: 'paused' }));
    resolveSnapshot({
      focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
      rest: restSnap([]),
    });
    await flush();

    assert.equal(views.at(-1)?.focus[0].status, 'paused');
    assert.deepEqual(views.at(-1)?.snapshotTransitions, transitions);
    assert.equal(transitions[0]?.kind, 'focus');
    if (transitions[0]?.kind !== 'focus') throw new Error('focus 전이가 필요하다');
    assert.equal(transitions[0].previous?.status, 'active');
    assert.equal(transitions[0].current?.status, 'paused');
  });

  test('버퍼 이벤트와 같은 watermark의 스냅숏도 active→paused 전이를 보존한다', async () => {
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const transitions: IslandPresenceTransition[] = [];
    const deps: Parameters<typeof start>[0] = {
      islandId: 'i1',
      views,
      transitions,
      snapshots: {
        focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
        rest: restSnap([]),
      },
    };
    const { rt } = start(deps, channel);
    rt.resync();
    await flush();

    let resolveSnapshot!: (value: {
      focus: ReturnType<typeof focusSnap>;
      rest: ReturnType<typeof restSnap>;
    }) => void;
    deps.loadSnapshots = () => new Promise((resolve) => (resolveSnapshot = resolve));
    rt.resync('reconnect');
    channel.opts?.onEvent(focusEvent('u1', 2, { status: 'paused' }));
    resolveSnapshot({
      focus: focusSnap([focusItem('u1', { status: 'paused' })], [wm('focus.member', 'u1', 2)]),
      rest: restSnap([]),
    });
    await flush();

    assert.equal(views.at(-1)?.focus[0].status, 'paused');
    assert.equal(views.at(-1)?.snapshotTransitions?.length, 1);
    assert.equal(transitions.length, 1);
    const transition = transitions[0];
    assert.ok(transition?.kind === 'focus');
    if (transition.kind !== 'focus') throw new Error('focus 전이가 필요하다');
    assert.equal(transition.previous?.status, 'active');
    assert.equal(transition.current?.status, 'paused');
  });

  test('첫 스냅숏에 이미 반영된 버퍼 이벤트는 입장 전이로 복구하지 않는다', async () => {
    const channel = fakeChannel();
    const transitions: IslandPresenceTransition[] = [];
    let resolveSnapshot!: (value: {
      focus: ReturnType<typeof focusSnap>;
      rest: ReturnType<typeof restSnap>;
    }) => void;
    const { rt } = start(
      {
        islandId: 'i1',
        transitions,
        loadSnapshots: () => new Promise((resolve) => (resolveSnapshot = resolve)),
      },
      channel,
    );

    rt.resync();
    channel.opts?.onEvent(focusEvent('u1', 2, { status: 'paused' }));
    resolveSnapshot({
      focus: focusSnap([focusItem('u1', { status: 'paused' })], [wm('focus.member', 'u1', 2)]),
      rest: restSnap([]),
    });
    await flush();

    assert.equal(transitions.length, 0);
  });

  test('재연결 조회가 실패해도 그 사이 도착한 상태 이벤트를 마지막 정상 뷰에 반영한다', async () => {
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const deps: Parameters<typeof start>[0] = {
      islandId: 'i1',
      views,
      snapshots: {
        focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
        rest: restSnap([]),
      },
    };
    const { rt } = start(deps, channel);
    rt.resync();
    await flush();

    deps.loadSnapshots = () => Promise.reject(new ApiError('NETWORK', '재연결 실패', 0));
    rt.resync('reconnect');
    channel.opts?.onEvent(focusEvent('u1', 2, { status: 'paused' }));
    await flush();

    assert.equal(views.at(-1)?.status, 'ready');
    assert.equal(views.at(-1)?.focus[0].status, 'paused');
  });

  test('재연결 조회 실패 중 처음 본 주민 이벤트는 후속 정본 조회로 복구한다', async () => {
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const deps: Parameters<typeof start>[0] = {
      islandId: 'i1',
      views,
      snapshots: {
        focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
        rest: restSnap([]),
      },
    };
    const { rt } = start(deps, channel);
    rt.resync();
    await flush();

    let attempt = 0;
    deps.loadSnapshots = () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new ApiError('NETWORK', '재연결 실패', 0));
      return Promise.resolve({
        focus: focusSnap(
          [focusItem('u1'), focusItem('ghost')],
          [wm('focus.member', 'u1', 1), wm('focus.member', 'ghost', 1)],
        ),
        rest: restSnap([]),
      });
    };
    rt.resync('reconnect');
    channel.opts?.onEvent(focusEvent('ghost', 2));
    await flush();
    await flush();

    assert.equal(attempt, 2);
    assert.ok(views.at(-1)?.focus.some((member) => member.userId === 'ghost'));
  });

  test('두 번의 조회 실패는 정본 미반영으로 세지 않고 다음 성공 조회까지 이벤트를 보존한다', async () => {
    jest.useFakeTimers();
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const deps: Parameters<typeof start>[0] = {
      islandId: 'i1',
      views,
      snapshots: {
        focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
        rest: restSnap([]),
      },
    };
    const { rt } = start(deps, channel);
    rt.resync();
    await Promise.resolve();

    let attempt = 0;
    deps.loadSnapshots = () => {
      attempt += 1;
      if (attempt <= 2) return Promise.reject(new ApiError('NETWORK', '일시 실패', 0));
      return Promise.resolve({
        focus: focusSnap(
          [focusItem('u1'), focusItem('ghost')],
          [wm('focus.member', 'u1', 1), wm('focus.member', 'ghost', 2)],
        ),
        rest: restSnap([]),
      });
    };
    channel.opts?.onEvent(focusEvent('ghost', 2));
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    assert.equal(attempt, 3);
    assert.ok(views.at(-1)?.focus.some((member) => member.userId === 'ghost'));
    rt.dispose();
    jest.useRealTimers();
  });

  test('event-gap 조회 중 도착한 또 다른 신규 주민도 후속 정본 조회로 복구한다', async () => {
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const deps: Parameters<typeof start>[0] = {
      islandId: 'i1',
      views,
      snapshots: {
        focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
        rest: restSnap([]),
      },
    };
    const { rt } = start(deps, channel);
    rt.resync();
    await flush();

    let resolveFirst!: (value: {
      focus: ReturnType<typeof focusSnap>;
      rest: ReturnType<typeof restSnap>;
    }) => void;
    let attempt = 0;
    deps.loadSnapshots = () => {
      attempt += 1;
      if (attempt === 1) return new Promise((resolve) => (resolveFirst = resolve));
      return Promise.resolve({
        focus: focusSnap(
          [focusItem('u1'), focusItem('a'), focusItem('b')],
          [wm('focus.member', 'u1', 1), wm('focus.member', 'a', 2), wm('focus.member', 'b', 2)],
        ),
        rest: restSnap([]),
      });
    };
    channel.opts?.onEvent(focusEvent('a', 2));
    channel.opts?.onEvent(focusEvent('b', 2));
    resolveFirst({
      focus: focusSnap(
        [focusItem('u1'), focusItem('a')],
        [wm('focus.member', 'u1', 1), wm('focus.member', 'a', 2)],
      ),
      rest: restSnap([]),
    });
    await flush();
    await flush();

    assert.equal(attempt, 2);
    assert.ok(views.at(-1)?.focus.some((member) => member.userId === 'b'));
  });

  test('후속 event-gap 조회 중 다시 들어온 신규 주민은 backoff 재조회로 복구한다', async () => {
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const deps: Parameters<typeof start>[0] = {
      islandId: 'i1',
      views,
      snapshots: {
        focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
        rest: restSnap([]),
      },
    };
    const { rt } = start(deps, channel);
    rt.resync();
    await flush();

    let resolveFirst!: (value: {
      focus: ReturnType<typeof focusSnap>;
      rest: ReturnType<typeof restSnap>;
    }) => void;
    let resolveSecond!: typeof resolveFirst;
    let attempt = 0;
    deps.loadSnapshots = () => {
      attempt += 1;
      if (attempt === 1) return new Promise((resolve) => (resolveFirst = resolve));
      if (attempt === 2) return new Promise((resolve) => (resolveSecond = resolve));
      return Promise.resolve({
        focus: focusSnap(
          [focusItem('u1'), focusItem('a'), focusItem('b'), focusItem('c')],
          [
            wm('focus.member', 'u1', 1),
            wm('focus.member', 'a', 2),
            wm('focus.member', 'b', 2),
            wm('focus.member', 'c', 2),
          ],
        ),
        rest: restSnap([]),
      });
    };
    channel.opts?.onEvent(focusEvent('a', 2));
    channel.opts?.onEvent(focusEvent('b', 2));
    resolveFirst({
      focus: focusSnap(
        [focusItem('u1'), focusItem('a')],
        [wm('focus.member', 'u1', 1), wm('focus.member', 'a', 2)],
      ),
      rest: restSnap([]),
    });
    await flush();

    channel.opts?.onEvent(focusEvent('c', 2));
    resolveSecond({
      focus: focusSnap(
        [focusItem('u1'), focusItem('a'), focusItem('b')],
        [wm('focus.member', 'u1', 1), wm('focus.member', 'a', 2), wm('focus.member', 'b', 2)],
      ),
      rest: restSnap([]),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flush();

    assert.equal(attempt, 3);
    assert.ok(views.at(-1)?.focus.some((member) => member.userId === 'c'));
    rt.dispose();
  });

  test('재동기화 중 받은 응원은 replay하지 않는다', async () => {
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const deps: Parameters<typeof start>[0] = {
      islandId: 'i1',
      views,
      snapshots: {
        focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
        rest: restSnap([]),
      },
    };
    const { rt } = start(deps, channel);
    rt.resync();
    await flush();

    let resolveSnapshot!: (value: {
      focus: ReturnType<typeof focusSnap>;
      rest: ReturnType<typeof restSnap>;
    }) => void;
    deps.loadSnapshots = () => new Promise((resolve) => (resolveSnapshot = resolve));
    rt.resync('reconnect');
    channel.opts?.onEvent(
      emoteEvent('buffered-emote', { expiresAt: new Date(Date.parse(NOW) + 30).toISOString() }),
    );
    resolveSnapshot(deps.snapshots!);
    await flush();
    assert.equal(views.at(-1)?.emotes.length, 0);
  });

  test('두 번의 정본 조회에도 없는 지연 이벤트는 폐기하고 재조회를 멈춘다', async () => {
    jest.useFakeTimers();
    const channel = fakeChannel();
    const { rt, loads } = start(
      {
        islandId: 'i1',
        snapshots: {
          focus: focusSnap([focusItem('u1')], [wm('focus.member', 'u1', 1)]),
          rest: restSnap([]),
        },
      },
      channel,
    );
    rt.resync();
    await Promise.resolve();
    channel.opts?.onEvent(focusEvent('finished-long-ago', 9));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(loads(), 3);

    await jest.advanceTimersByTimeAsync(10_000);
    assert.equal(loads(), 3);
    rt.dispose();
    jest.useRealTimers();
  });

  test('스냅숏 실패는 error 상태로 올린다 — 가짜 빈 성공이 아니다', async () => {
    const channel = fakeChannel();
    const views: PresenceView[] = [];
    const err = new ApiError('MEMBER_ONLY', '섬 주민만 볼 수 있어요', 403);
    const { rt } = start({ islandId: 'i1', views, loadError: err }, channel);
    rt.resync();
    await flush();
    assert.equal(views.at(-1)?.status, 'error');
    assert.equal(views.at(-1)?.error?.code, 'MEMBER_ONLY');
  });

  test('채널이 열리면 재동기화하고, 모르는 주민 이벤트도 재동기화를 부른다', async () => {
    const channel = fakeChannel();
    const { rt, loads } = start({ islandId: 'i1' }, channel);
    rt.resync();
    await flush();
    assert.equal(loads(), 1);
    channel.opts?.onOpen();
    await flush();
    assert.equal(loads(), 2);
    channel.opts?.onEvent(focusEvent('ghost', 9));
    await flush();
    // 첫 정본이 아직 신규 주민을 포함하지 않으면 전파 지연을 고려해 한 번 더 확인한다.
    assert.equal(loads(), 4);
    rt.dispose();
  });

  test('sendEmote 는 기존 STOMP SEND 계약으로만 보낸다', async () => {
    const channel = fakeChannel();
    const { rt } = start({ islandId: 'i1', emoteSessionId: 's-me' }, channel);
    assert.equal(rt.sendEmote('cheer'), true);
    assert.equal(channel.sent[0].destination, '/app/islands/i1/focus/emotes');
    assert.deepEqual(channel.sent[0].body, { sessionId: 's-me', type: 'cheer' });
    assert.equal(rt.sendEmote('bogus'), false);
    assert.equal(channel.sent.length, 1);
  });

  test('세션 없이는 응원을 보내지 않고, 끊기면 false 를 돌린다 — 가짜 성공 없음', async () => {
    const channel = fakeChannel();
    const { rt } = start({ islandId: 'i1' }, channel);
    assert.equal(rt.sendEmote('cheer'), false);
    const withSession = start({ islandId: 'i1', emoteSessionId: 's-me' }, channel);
    channel.connected = false;
    assert.equal(withSession.rt.sendEmote('cheer'), false);
    assert.equal(channel.sent.length, 0);
  });

  test('reopen 은 채널을 다시 열고 dispose 는 닫는다', async () => {
    const channel = fakeChannel();
    const { rt } = start({ islandId: 'i1' }, channel);
    rt.reopen();
    assert.equal(channel.reopened, 1);
    rt.dispose();
    assert.equal(channel.closed, 1);
  });
});

describe('stompIslandChannel', () => {
  const client = () => (Client as any).instances.at(-1);

  beforeEach(() => {
    (Client as any).instances.length = 0;
  });

  test('인증 STOMP 계약: /ws/realtime 에 Bearer CONNECT 헤더, 섬 채널·emotes·오류 큐 구독', () => {
    const opened: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: true,
      onEvent: () => {},
      onOpen: () => opened.push('open'),
      onError: () => {},
    });
    const c = client();
    assert.equal(c.opts.brokerURL, realtimeWsUrl());
    assert.equal(c.connectHeaders.Authorization, 'Bearer AT');
    assert.deepEqual(
      c.subs.map((s: { dest: string }) => s.dest),
      [
        '/topic/islands/i1/focus',
        '/topic/islands/i1/rest',
        '/user/queue/errors',
        '/topic/islands/i1/emotes',
      ],
    );
    assert.equal(opened.length, 1);
  });

  test('진행 세션이 없으면 emotes 채널은 구독하지 않는다 — 서버가 거절한다', () => {
    stompIslandChannel({
      islandId: 'i1',
      emote: false,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    assert.deepEqual(
      client().subs.map((s: { dest: string }) => s.dest),
      ['/topic/islands/i1/focus', '/topic/islands/i1/rest', '/user/queue/errors'],
    );
  });

  test('presence 연결을 유지한 채 emotes 구독을 켜고 끈다', () => {
    const channel = stompIslandChannel({
      islandId: 'i1',
      emote: false,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    const c = client();
    channel.setEmoteEnabled(true);
    assert.equal(c.subs.at(-1).dest, '/topic/islands/i1/emotes');
    channel.setEmoteEnabled(false);
    assert.equal(c.deactivated, 0);
  });

  test('연결이 이미 끊긴 emotes 구독은 로컬 핸들만 비운다', () => {
    const channel = stompIslandChannel({
      islandId: 'i1',
      emote: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    const c = client();
    c.connected = false;
    assert.doesNotThrow(() => channel.setEmoteEnabled(false));
  });

  test('새 세션에서는 이전 emotes 구독 거절 상태를 초기화한다', () => {
    const channel = stompIslandChannel({
      islandId: 'i1',
      emote: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    const c = client();
    c.opts.onStompError({ headers: { message: '거절' } });
    channel.setEmoteEnabled(false);
    const subscriptions = c.subs.length;
    channel.setEmoteEnabled(true);
    assert.equal(c.subs.length, subscriptions + 1);
    assert.equal(c.subs.at(-1).dest, '/topic/islands/i1/emotes');
  });

  // 세션이 이미 끝난 뒤 남은 emotes 재구독이 거절되며 오는 NOT_FOCUSING은 기대된 잡음이라
  // 토스트를 띄우지 않는다. /user/queue/errors 원시 메시지·onStompError 원시 헤더 둘 다 막는다.
  test('/user/queue/errors 의 NOT_FOCUSING 원시 코드는 토스트로 올리지 않는다', () => {
    const errors: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: (m) => errors.push(m),
    });
    const c = client();
    const errorSub = c.subs.find((s: { dest: string }) => s.dest === '/user/queue/errors')!;
    errorSub.cb({ body: JSON.stringify({ message: 'NOT_FOCUSING' }) });
    assert.deepEqual(errors, []);
  });

  test('/user/queue/errors 오류 봉투의 code 가 NOT_FOCUSING 이면 message 문구가 있어도 토스트로 올리지 않는다', () => {
    const errors: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: (m) => errors.push(m),
    });
    const c = client();
    const errorSub = c.subs.find((s: { dest: string }) => s.dest === '/user/queue/errors')!;
    errorSub.cb({
      body: JSON.stringify({ code: 'NOT_FOCUSING', message: '집중 중일 때만 응원할 수 있습니다.' }),
    });
    assert.deepEqual(errors, []);
  });

  test('onStompError 의 NOT_FOCUSING 헤더도 토스트로 올리지 않는다', () => {
    const errors: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: (m) => errors.push(m),
    });
    client().opts.onStompError({ headers: { message: 'NOT_FOCUSING' } });
    assert.deepEqual(errors, []);
  });

  test('알려지지 않은 대문자 코드는 그대로 보여주지 않고 기본 문구로 대신한다', () => {
    const errors: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: (m) => errors.push(m),
    });
    const c = client();
    const errorSub = c.subs.find((s: { dest: string }) => s.dest === '/user/queue/errors')!;
    errorSub.cb({ body: JSON.stringify({ message: 'SOME_UNKNOWN_CODE' }) });
    assert.deepEqual(errors, ['실시간 요청이 거절됐어요.']);
  });

  test('사람이 읽을 문구는 그대로 전달한다', () => {
    const errors: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: (m) => errors.push(m),
    });
    const c = client();
    const errorSub = c.subs.find((s: { dest: string }) => s.dest === '/user/queue/errors')!;
    errorSub.cb({ body: JSON.stringify({ message: '응원을 보낼 수 없어요.' }) });
    assert.deepEqual(errors, ['응원을 보낼 수 없어요.']);
  });

  test('재생 전용 연결은 playback만 구독하고 재연결 시 onOpen으로 복구를 요청한다', () => {
    const opened: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      presence: false,
      playback: true,
      emote: false,
      onEvent: () => {},
      onOpen: () => opened.push('open'),
      onError: () => {},
    });
    assert.deepEqual(
      client().subs.map((s: { dest: string }) => s.dest),
      ['/topic/islands/i1/playback', '/user/queue/errors'],
    );
    assert.equal(opened.length, 1);
  });

  test('이벤트는 JSON 을 파싱해 올리고, send 는 publish 로 나간다', () => {
    const events: unknown[] = [];
    const ch = stompIslandChannel({
      islandId: 'i1',
      emote: false,
      onEvent: (b) => events.push(b),
      onOpen: () => {},
      onError: () => {},
    });
    client().subs[0].cb({ body: JSON.stringify(focusEvent('u1', 1)) });
    assert.equal((events[0] as any).type, 'focus.member.updated');
    assert.equal(ch.send('/app/islands/i1/focus/emotes', { sessionId: 's', type: 'hello' }), true);
    assert.deepEqual(JSON.parse(client().published[0].body), { sessionId: 's', type: 'hello' });
  });
});

describe('friendlyRealtimeErrorMessage', () => {
  test('NOT_FOCUSING 은 억제한다(null)', () => {
    assert.equal(friendlyRealtimeErrorMessage('NOT_FOCUSING'), null);
  });
  test('그 외 대문자_밑줄 코드는 기본 문구로 대신한다', () => {
    assert.equal(friendlyRealtimeErrorMessage('ISLAND_NOT_CURRENT'), '실시간 요청이 거절됐어요.');
  });
  test('이미 사람이 읽을 문구는 그대로 돌려준다', () => {
    assert.equal(
      friendlyRealtimeErrorMessage('실시간 연결이 거절됐어요.'),
      '실시간 연결이 거절됐어요.',
    );
  });
});
