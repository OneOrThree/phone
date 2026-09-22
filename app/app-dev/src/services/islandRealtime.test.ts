/**
 * 섬 실시간 프로젝션·세션 (GROMO-2010) — 스냅숏 정본, 워터마크 중복·역순 방어,
 * 모르는 주민 재조회, 응원 dedupe·TTL, STOMP 목적지·인증 헤더.
 */
import assert from 'node:assert/strict';
import { ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  IslandProjection,
  realtimeWsUrl,
  startIslandRealtime,
  stompIslandChannel,
  type IslandChannelOpts,
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
      return { unsubscribe: () => {} };
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

type FakeChannel = {
  opts: IslandChannelOpts | null;
  sent: { destination: string; body: unknown }[];
  reopened: number;
  closed: number;
  connected: boolean;
};
const fakeChannel = (): FakeChannel => ({
  opts: null,
  sent: [],
  reopened: 0,
  closed: 0,
  connected: true,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function start(
  deps: {
    islandId: string;
    emoteSessionId?: string | null;
    snapshots?: { focus: ReturnType<typeof focusSnap>; rest: ReturnType<typeof restSnap> };
    loadError?: unknown;
    views?: PresenceView[];
    sendError?: string[];
  },
  channel: FakeChannel,
) {
  let loads = 0;
  const rt = startIslandRealtime({
    islandId: deps.islandId,
    emoteSessionId: deps.emoteSessionId,
    onView: (v) => deps.views?.push(v),
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
      return deps.snapshots ?? { focus: focusSnap([]), rest: restSnap([]) };
    },
  });
  return { rt, loads: () => loads };
}

describe('startIslandRealtime', () => {
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
    assert.equal(loads(), 3);
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
