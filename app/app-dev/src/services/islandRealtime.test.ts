/**
 * 섬 실시간 프로젝션·세션 (GROMO-2010) — 스냅숏 정본, 워터마크 중복·역순 방어,
 * 모르는 주민 재조회, 응원 dedupe·TTL, STOMP 목적지·인증 헤더.
 */
import assert from 'node:assert/strict';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import { replaceBlockedUsers } from '@/services/blockedUsers';
import {
  friendlyRealtimeErrorMessage,
  IslandProjection,
  isGoldenFishParticipant,
  parseGoldenFishEvent,
  publishMoveIntent,
  realtimeClientOptions,
  realtimeWsUrl,
  startIslandRealtime,
  stompIslandChannel,
  type IslandChannelOpts,
  type IslandPresenceTransition,
  type GoldenFishEvent,
  type PresenceView,
} from '@/services/islandRealtime';
import { createMovementController, type RemotePosition } from '@/services/movementSync';
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
  test('휴식에서 빠졌다가 같은 화면에서 다시 들어와도 이름·털색·외양을 잃지 않는다 (GROMO-2390)', () => {
    const p = new IslandProjection('i1');
    const look = { head: 'hat-1', neck: 'scarf-1', version: 2 };
    p.loadRest(
      restSnap(
        [
          {
            userId: 'u1',
            name: '모모',
            catColor: 'ginger',
            appearance: look,
            restSeat: 2,
            restStartedAt: NOW,
          },
        ],
        [wm('rest.member', 'u1', 1)],
      ),
    );
    p.apply(restEvent('u1', 2, { status: 'active' })); // 휴식 해제 — 목록에서 빠진다
    assert.equal(p.rest().length, 0);
    p.apply(restEvent('u1', 3)); // 같은 화면에서 다시 휴식
    assert.equal(p.rest()[0].name, '모모');
    assert.equal(p.rest()[0].catColor, 'ginger');
    assert.deepEqual(p.rest()[0].appearance, look);
  });

  test('집중 완료 뒤 같은 화면에서 새 집중으로 다시 들어와도 외양을 잃지 않는다', () => {
    const p = new IslandProjection('i1');
    const look = { head: 'hat-1', neck: null, version: 4 };
    p.loadFocus(focusSnap([focusItem('u1', { appearance: look })], [wm('focus.member', 'u1', 1)]));
    p.apply(focusEvent('u1', 2, { status: 'completed' }));
    assert.equal(p.focus().length, 0);
    p.apply(focusEvent('u1', 3));
    assert.deepEqual(p.focus()[0].appearance, look);
    assert.equal(p.focus()[0].catColor, 'ginger');
  });

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

  test('자리: 스냅숏 seat 는 검증해 싣고, seat 없는 이벤트는 이전 자리를 이어받는다 (GROMO-2478)', () => {
    const p = new IslandProjection('i1');
    p.loadFocus(
      focusSnap(
        [
          focusItem('u1', { seat: { x: 34.1, y: 55.9 } }),
          focusItem('u2', { seat: { x: 'a', y: 1 } }),
        ],
        [wm('focus.member', 'u1', 1), wm('focus.member', 'u2', 1)],
      ),
    );
    assert.deepEqual(p.focus()[0].seat, { x: 34.1, y: 55.9 });
    assert.equal(p.focus()[1].seat, null);
    // 옛 서버 이벤트(seat 키 없음)·paused 전이에도 자리를 잃지 않는다
    p.apply(focusEvent('u1', 2, { status: 'paused' }));
    assert.deepEqual(p.focus()[0].seat, { x: 34.1, y: 55.9 });
    // 새 이벤트의 seat 가 있으면 그것이 정본
    p.apply(focusEvent('u2', 2, { seat: { x: 60, y: 40 } }));
    assert.deepEqual(p.focus()[1].seat, { x: 60, y: 40 });
  });

  test('자리: 명시적 seat null 은 null, seat 키 생략은 같은 세션일 때만 이전 자리를 잇는다 (GROMO-2478)', () => {
    const p = new IslandProjection('i1'),
      seat = { x: 34.1, y: 55.9 };
    p.loadFocus(
      focusSnap(
        [focusItem('u1', { seat }), focusItem('u2', { seat })],
        [wm('focus.member', 'u1', 1), wm('focus.member', 'u2', 1)],
      ),
    );
    // 같은 세션·seat 키 생략(옛 서버 이벤트) → 이전 자리 유지
    p.apply(focusEvent('u1', 2, { status: 'paused' }));
    assert.deepEqual(p.focus()[0].seat, seat);
    // 새 세션의 명시적 null 이 이전 세션 완료보다 먼저 와도 옛 좌표를 잇지 않는다 — null 은 자리 없이 시작
    p.apply(focusEvent('u1', 3, { sessionId: 's-u1-next', seat: null }));
    assert.equal(p.focus()[0].seat, null);
    // 세션이 다르면 seat 키를 생략해도 잇지 않는다
    p.apply(focusEvent('u2', 2, { sessionId: 's-u2-next' }));
    assert.equal(p.focus()[1].seat, null);
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

  test('방문자 응원은 말풍선 상태에 넣지 않고 콜백으로만, eventId 당 1번 전한다', () => {
    const p = new IslandProjection('i1');
    p.loadFocus(focusSnap([], [wm('focus.member', 'u1', 1)]));
    const got: string[] = [];
    p.onVisitorEmote = (emote) => got.push(`${emote.eventId}:${emote.visitor}`);
    const ev = emoteEvent('v1', { userId: 'guest', visitor: true, sessionId: undefined });
    assert.equal(p.apply(ev), false);
    assert.equal(p.apply(ev), false);
    assert.deepEqual(got, ['v1:true']);
    assert.equal(p.emotes().length, 0);
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
    visitor?: boolean;
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
    looks?: { userId: string; head: string | null; version: number | null }[];
  },
  channel: FakeChannel,
) {
  let loads = 0;
  const rt = startIslandRealtime({
    islandId: deps.islandId,
    emoteSessionId: deps.emoteSessionId,
    visitor: deps.visitor,
    onView: (v) => deps.views?.push(v),
    onTransition: (transition) => deps.transitions?.push(transition),
    onGoldenFish: (event) => deps.golden?.push(event),
    onSendError: (m) => deps.sendError?.push(m),
    onMemberAppearance: (userId, look) =>
      deps.looks?.push({ userId, head: look.head, version: look.version }),
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
  test('내가 차단한 방문자의 응원은 알림 콜백으로 넘기지 않는다 (GROMO-2470)', () => {
    replaceBlockedUsers([{ id: 'blocked', name: '밍키' }]);
    const got: string[] = [];
    let onEvent: (raw: unknown) => void = () => {};
    const rt = startIslandRealtime({
      islandId: 'i1',
      onView: () => {},
      onVisitorEmote: (emote) => got.push(emote.userId),
      connect: (opts) => {
        onEvent = opts.onEvent;
        return { send: () => false, setEmoteEnabled: () => {}, reopen: () => {}, close: () => {} };
      },
      loadSnapshots: async () => ({ focus: focusSnap([]), rest: restSnap([]) }),
    });
    try {
      onEvent(emoteEvent('v1', { userId: 'blocked', visitor: true, sessionId: undefined }));
      onEvent(emoteEvent('v2', { userId: 'guest', visitor: true, sessionId: undefined }));
      assert.deepEqual(got, ['guest']);
    } finally {
      rt.dispose();
      replaceBlockedUsers([]);
    }
  });

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

  test('member.appearance.updated 는 주민 외양으로 전달하고 다른 섬 사건은 버린다 (GROMO-2390)', () => {
    const channel = fakeChannel();
    const looks: { userId: string; head: string | null; version: number | null }[] = [];
    start({ islandId: 'i1', looks }, channel);
    const event = (islandId: string, head: string | null, version: number) => ({
      eventId: `e${version}`,
      schemaVersion: 1,
      type: 'member.appearance.updated',
      islandId,
      aggregateVersion: version,
      payload: { userId: 'u2', appearance: { head, neck: null }, version },
    });
    channel.opts?.onEvent(event('i1', 'hat', 4));
    channel.opts?.onEvent(event('other', 'hat', 5));
    channel.opts?.onEvent(event('i1', null, 6));
    assert.deepEqual(looks, [
      { userId: 'u2', head: 'hat', version: 4 },
      { userId: 'u2', head: null, version: 6 },
    ]);
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

  test('방문자 모드는 세션 없이 {type} 만 보내고 emotes 를 구독한다', async () => {
    const channel = fakeChannel();
    const { rt } = start({ islandId: 'i1', visitor: true }, channel);
    assert.equal(channel.opts?.emote, true);
    assert.equal(rt.sendEmote('cheer'), true);
    assert.equal(channel.sent[0].destination, '/app/islands/i1/focus/emotes');
    assert.deepEqual(channel.sent[0].body, { type: 'cheer' });
  });

  test('visitor 도 emoteSessionId 도 없으면 emotes 채널을 열지 않는다(emote:false) — 방문자는 응원을 받지도 않는다', async () => {
    const channel = fakeChannel();
    start({ islandId: 'i1' }, channel);
    assert.equal(channel.opts?.emote, false);
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

describe('startIslandRealtime 응원 발신 연타 (GROMO-2160)', () => {
  beforeEach(() => {
    (Client as any).instances.length = 0;
  });
  afterEach(() => jest.restoreAllMocks());

  const open = () =>
    startIslandRealtime({
      islandId: 'i1',
      emoteSessionId: 's-me',
      onView: () => {},
      loadSnapshots: async () => ({ focus: focusSnap([]), rest: restSnap([]) }),
    });

  test('서버 시도 창(600ms) 안의 연타는 앱이 한 번만 보내고 둘 다 true 를 돌린다 — 실패 토스트 없음', () => {
    const rt = open();
    const c = (Client as any).instances.at(-1);
    assert.equal(rt.sendEmote('cheer'), true);
    assert.equal(rt.sendEmote('cheer'), true);
    assert.equal(c.published.length, 1);
    assert.equal(c.published[0].destination, '/app/islands/i1/focus/emotes');
    rt.dispose();
  });

  test('700ms 가 지나면 다시 보내고, 보내지 못한 시도는 창을 열지 않는다', () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const rt = open();
    const c = (Client as any).instances.at(-1);
    c.connected = false;
    assert.equal(rt.sendEmote('cheer'), false, '끊긴 연결은 실패');
    c.connected = true;
    assert.equal(rt.sendEmote('cheer'), true, '실패한 시도는 창을 열지 않는다');
    assert.equal(c.published.length, 1);
    now += 699;
    assert.equal(rt.sendEmote('cheer'), true);
    assert.equal(c.published.length, 1, '699ms — 아직 창 안');
    now += 1;
    assert.equal(rt.sendEmote('cheer'), true);
    assert.equal(c.published.length, 2, '700ms — 다시 보낸다');
    rt.dispose();
  });

  test('시스템 시계가 뒤로 가도(음수 간격) 응원을 막지 않고 보낸 뒤 다시 찍는다', () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const rt = open();
    const c = (Client as any).instances.at(-1);
    assert.equal(rt.sendEmote('cheer'), true);
    assert.equal(c.published.length, 1);
    now -= 10_000; // 시계가 10초 뒤로 갔다
    assert.equal(rt.sendEmote('cheer'), true);
    assert.equal(c.published.length, 2, '음수 간격은 연타가 아니라 시계 되감김 — 보낸다');
    assert.equal(rt.sendEmote('cheer'), true);
    assert.equal(c.published.length, 2, '다시 찍었으니 바로 이어 누른 건 거른다');
    rt.dispose();
  });
});

describe('stompIslandChannel', () => {
  const client = () => (Client as any).instances.at(-1);
  /** 재접속(onConnect)을 흉내 내고 그때 새로 건 구독 목적지를 돌려 준다. */
  const reconnectDests = (c: any): string[] => {
    const before = c.subs.length;
    c.opts.onConnect({});
    return c.subs.slice(before).map((x: { dest: string }) => x.dest);
  };

  beforeEach(() => {
    (Client as any).instances.length = 0;
  });

  test('React Native WebSocket 용 옵션: 바이너리 프레임 강제와 수신 NULL 종결자 보정을 켠다', () => {
    stompIslandChannel({
      islandId: 'i1',
      emote: false,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    // RN WebSocket 은 문자열 프레임의 NULL(\0)을 잘라 STOMP 프레임 끝이 사라진다 —
    // 두 옵션이 없으면 CONNECT 가 서버에 도달하지 못한다.
    assert.equal(client().opts.forceBinaryWSFrames, true);
    assert.equal(client().opts.appendMissingNULLonIncoming, true);
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
    c.opts.onStompError({ headers: { message: 'NOT_FOCUSING' } });
    // 거절된 구독은 재접속에서 다시 걸지 않는다(같은 답이 올 뿐이라 무한 거절 루프가 된다)
    assert.ok(!reconnectDests(c).includes('/topic/islands/i1/emotes'), '거절 뒤 재구독하지 않는다');
    channel.setEmoteEnabled(false);
    const subscriptions = c.subs.length;
    channel.setEmoteEnabled(true);
    assert.equal(c.subs.length, subscriptions + 1);
    assert.equal(c.subs.at(-1).dest, '/topic/islands/i1/emotes');
    assert.ok(
      reconnectDests(c).includes('/topic/islands/i1/emotes'),
      '새 세션은 재접속에서도 구독한다',
    );
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

  test('/user/queue/errors 봉투의 사람 문구(message)는 그대로 전달한다 — errors 큐 경로는 불변', () => {
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

  test('비코드 STOMP ERROR(Session closed.)는 토스트·거절 상태·strike 어디에도 반영하지 않는다', () => {
    const errors: string[] = [];
    const denied: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: true,
      events: true,
      movement: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: (m) => errors.push(m),
      onMovementDenied: () => denied.push('m'),
    });
    const c = client();
    for (let i = 0; i < 5; i += 1) {
      c.opts.onStompError({ headers: { message: 'Session closed.' }, body: '' });
      c.opts.onConnect({}); // 재접속 — 접속당 1회 규칙이 아니라 진짜로 안 세는지 본다
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(denied, []);
    const subs = c.subs.length;
    c.opts.onConnect({});
    const dests = c.subs.slice(subs).map((x: { dest: string }) => x.dest);
    assert.ok(dests.includes('/topic/islands/i1/events'), 'events 구독 유지');
    assert.ok(dests.includes('/topic/islands/i1/movement'), 'movement 구독 유지');
    assert.ok(dests.includes('/topic/islands/i1/emotes'), 'emotes 구독 유지');
    // 그 뒤 코드 ERROR — channel 헤더가 없으면 응원 몫이라 events·movement 는 무영향이고 토스트만 한다
    c.opts.onStompError({ headers: { message: 'UNAUTHORIZED' }, body: '' });
    assert.deepEqual(denied, []);
    assert.deepEqual(errors, ['실시간 요청이 거절됐어요.']);
  });

  test('ERROR 의 channel 헤더가 있으면 그 채널만 센다 — events', () => {
    const denied: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: false,
      events: true,
      movement: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
      onMovementDenied: () => denied.push('m'),
    });
    const c = client();
    // channel=events 인 UNAUTHORIZED 는 movement 를 건드리지 않는다
    c.opts.onStompError({ headers: { message: 'UNAUTHORIZED', channel: 'events' }, body: '' });
    assert.deepEqual(denied, []);
    c.opts.onConnect({});
    c.opts.onStompError({ headers: { message: 'UNAUTHORIZED', channel: 'events' }, body: '' });
    // 같은 코드 2번 → events 끔
    const subs = c.subs.length;
    c.opts.onConnect({});
    assert.ok(!c.subs.slice(subs).some((x: { dest: string }) => x.dest.endsWith('/events')));
  });

  test('ERROR 에 channel 헤더가 없으면 events 탓으로 치지 않는다 — 헤더 없는 UNAUTHORIZED 를 거듭 받아도 events·movement 는 그대로', () => {
    const denied: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: false,
      events: true,
      movement: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
      onMovementDenied: () => denied.push('m'),
    });
    const c = client();
    // 상한(EVENTS_STRIKE_LIMIT=2)을 넘겨 3번 — 헤더가 없으면 strike 가 0 이라 끄지 않는다
    for (let conn = 1; conn <= 3; conn += 1) {
      c.opts.onStompError({ headers: { message: 'UNAUTHORIZED' }, body: '' });
      const dests = reconnectDests(c);
      assert.ok(
        dests.some((d) => d.endsWith('/events')),
        `${conn}번째 접속 뒤에도 events 재구독`,
      );
      assert.ok(
        dests.some((d) => d.endsWith('/movement')),
        `${conn}번째 접속 뒤에도 movement 재구독`,
      );
    }
    assert.deepEqual(denied, []);
  });

  test('ERROR 의 channel 헤더가 있으면 그 채널만 센다 — movement', () => {
    const denied: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: false,
      events: true,
      movement: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
      onMovementDenied: () => denied.push('m'),
    });
    const c = client();
    c.opts.onStompError({ headers: { message: 'UNAUTHORIZED', channel: 'movement' }, body: '' });
    assert.deepEqual(denied, ['m']);
    // events strike 는 쌓이지 않았다 — 같은 코드가 한 번 더 와도 events 는 살아 있다
    c.opts.onConnect({});
    c.opts.onStompError({ headers: { message: 'UNAUTHORIZED', channel: 'movement' }, body: '' });
    const subs = c.subs.length;
    c.opts.onConnect({});
    assert.ok(c.subs.slice(subs).some((x: { dest: string }) => x.dest.endsWith('/events')));
  });

  test('close 사유 SESSION_REVOKED 면 재접속을 멈추고(deactivate) 안내한다', () => {
    const errors: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: false,
      onEvent: () => {},
      onOpen: () => {},
      onError: (m) => errors.push(m),
    });
    const c = client();
    c.onWebSocketClose({ code: 1008, reason: 'SESSION_REVOKED' });
    assert.equal(c.deactivated, 1);
    assert.deepEqual(errors, [t('realtime.sessionRevoked')]);
  });

  test('다른 close(1002 Session closed.·OUTBOUND_QUEUE_FULL)는 아무것도 하지 않는다 — stompjs 재접속에 맡긴다', () => {
    const errors: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: false,
      onEvent: () => {},
      onOpen: () => {},
      onError: (m) => errors.push(m),
    });
    const c = client();
    c.onWebSocketClose({ code: 1002, reason: 'Session closed.' });
    c.onWebSocketClose({ code: 1008, reason: 'OUTBOUND_QUEUE_FULL' });
    assert.equal(c.deactivated, 0);
    assert.deepEqual(errors, []);
  });

  test('세션 폐기 뒤에는 reopen(포그라운드 복귀)도 폐기된 토큰으로 되살리지 않는다', async () => {
    const ch = stompIslandChannel({
      islandId: 'i1',
      emote: false,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    const c = client();
    c.onWebSocketClose({ code: 1008, reason: 'SESSION_REVOKED' });
    ch.reopen();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(c.connected, false, 'reopen 이 activate 를 다시 부르지 않는다');
    assert.equal(c.deactivated, 2);
  });

  test('channel 헤더로 다른 채널 탓이 분명한 ERROR 는 응원(emote) 구독을 끄지 않는다', () => {
    stompIslandChannel({
      islandId: 'i1',
      emote: true,
      events: true,
      movement: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
      onMovementDenied: () => {},
    });
    const c = client();
    c.opts.onStompError({
      headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' },
      body: '',
    });
    c.opts.onStompError({ headers: { message: 'UNAUTHORIZED', channel: 'events' }, body: '' });
    c.opts.onConnect({});
    // events 가 이미 꺼진 뒤의 events ERROR(eventsFault=false)도 응원엔 닿지 않는다
    c.opts.onStompError({ headers: { message: 'UNAUTHORIZED', channel: 'events' }, body: '' });
    const subs = c.subs.length;
    c.opts.onConnect({});
    const dests = c.subs.slice(subs).map((x: { dest: string }) => x.dest);
    assert.ok(dests.includes('/topic/islands/i1/emotes'), 'emotes 구독 유지');
  });

  test('channel=events 인 UNAUTHORIZED 는 응원 카운트에 들어가지 않는다 — 접속 세 번을 거쳐도 응원은 살아 있고 events 만 strike 2 에서 꺼진다', () => {
    stompIslandChannel({
      islandId: 'i1',
      emote: true,
      events: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    const c = client();
    for (let conn = 1; conn <= 3; conn += 1) {
      c.opts.onStompError({ headers: { message: 'UNAUTHORIZED', channel: 'events' }, body: '' });
      const dests = reconnectDests(c);
      assert.ok(dests.includes('/topic/islands/i1/emotes'), `${conn}번째 접속 뒤에도 응원 재구독`);
      // 같은 코드 2번(strike 2)부터 events 는 꺼진다
      assert.equal(
        dests.includes('/topic/islands/i1/events'),
        conn < 2,
        `${conn}번째 접속 뒤 events`,
      );
    }
  });

  test('channel=emotes 헤더의 UPSTREAM_UNAVAILABLE 는 events·movement 를 건드리지 않는다 — 응원만 세 번째에 꺼진다', () => {
    const denied: string[] = [];
    stompIslandChannel({
      islandId: 'i1',
      emote: true,
      events: true,
      movement: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
      onMovementDenied: () => denied.push('m'),
    });
    const c = client();
    const err = (channel: string) =>
      c.opts.onStompError({ headers: { message: 'UPSTREAM_UNAVAILABLE', channel }, body: '' });
    for (let conn = 1; conn <= 2; conn += 1) {
      err('emotes');
      const dests = reconnectDests(c);
      assert.ok(dests.includes('/topic/islands/i1/emotes'), `${conn}번째 접속 뒤에도 응원 재구독`);
      assert.ok(dests.includes('/topic/islands/i1/events'), `${conn}번째 접속 뒤에도 events`);
      assert.ok(dests.includes('/topic/islands/i1/movement'), `${conn}번째 접속 뒤에도 movement`);
    }
    err('emotes');
    const dests = reconnectDests(c);
    assert.ok(!dests.includes('/topic/islands/i1/emotes'), '응원만 세 번째에 끈다');
    assert.ok(dests.includes('/topic/islands/i1/events'), 'events 는 그대로');
    assert.ok(dests.includes('/topic/islands/i1/movement'), 'movement 는 그대로');
    assert.deepEqual(denied, []);
    // events strike 도 0 이다 — 응원 ERROR 가 쌓였다면 같은 코드 한 번으로 상한(2)에 닿아 꺼진다
    err('events');
    assert.ok(reconnectDests(c).includes('/topic/islands/i1/events'), 'events strike 는 1 뿐');
  });

  describe('응원 구독 거절 정책 (GROMO-2160)', () => {
    afterEach(() => jest.restoreAllMocks());
    const EMOTES = '/topic/islands/i1/emotes';
    const open = (over: Partial<IslandChannelOpts> = {}) => {
      stompIslandChannel({
        islandId: 'i1',
        emote: true,
        onEvent: () => {},
        onOpen: () => {},
        onError: () => {},
        ...over,
      });
      return client();
    };

    // 서버 응원 시도 창은 userId 단위라 두 기기가 600ms 안에 재접속하면 서로 거절하며 ERROR → 종료 → 재접속을 되풀이한다 —
    // 세지 않으면 이 루프의 상한이 없다. 발신 연타는 700ms 앱 거름이 막는다.
    test('시도 창(EMOTE_TOO_FREQUENT) ERROR 도 일시 오류처럼 센다 — 두 접속은 재구독, 세 번째에 끈다', () => {
      const c = open();
      for (let conn = 1; conn <= 2; conn += 1) {
        c.opts.onStompError({ headers: { message: 'EMOTE_TOO_FREQUENT' }, body: '' });
        assert.ok(reconnectDests(c).includes(EMOTES), `${conn}번째 접속 뒤에도 재구독`);
      }
      c.opts.onStompError({ headers: { message: 'EMOTE_TOO_FREQUENT' }, body: '' });
      assert.ok(!reconnectDests(c).includes(EMOTES), '두 기기 충돌 루프는 세 번째에 끊는다');
    });

    test('channel=emotes 인 EMOTE_TOO_FREQUENT 도 같은 방식으로 센다 (events 구독이 있어도)', () => {
      const c = open({ events: true });
      const err = () =>
        c.opts.onStompError({
          headers: { message: 'EMOTE_TOO_FREQUENT', channel: 'emotes' },
          body: '',
        });
      for (let conn = 1; conn <= 2; conn += 1) {
        err();
        assert.ok(reconnectDests(c).includes(EMOTES));
      }
      err();
      assert.ok(!reconnectDests(c).includes(EMOTES));
    });

    test('UNAUTHORIZED 는 응원 구독에선 영구 차단이 아니라 일시 오류다 — 세 번째 접속에서 끈다', () => {
      const denied: string[] = [];
      // movement 구독은 channel=movement 헤더가 있을 때만 UNAUTHORIZED 를 영구 차단으로 본다 — 헤더 없는 ERROR 는 응원 몫이다
      const c = open({ movement: true, onMovementDenied: () => denied.push('m') });
      for (let conn = 1; conn <= 2; conn += 1) {
        c.opts.onStompError({ headers: { message: 'UNAUTHORIZED' }, body: '' });
        assert.ok(reconnectDests(c).includes(EMOTES), `${conn}번째 접속 뒤에도 재구독`);
      }
      assert.deepEqual(denied, [], '헤더 없는 ERROR 는 movement 를 건드리지 않는다');
      c.opts.onStompError({ headers: { message: 'UNAUTHORIZED' }, body: '' });
      assert.ok(!reconnectDests(c).includes(EMOTES));
    });

    test('events 구독이 있어도 헤더 없는 NOT_FOCUSING 은 바로 응원을 끄고 events 는 건드리지 않는다', () => {
      const c = open({ events: true });
      c.opts.onStompError({ headers: { message: 'NOT_FOCUSING' }, body: '' });
      const dests = reconnectDests(c);
      assert.ok(!dests.includes(EMOTES), '첫 ERROR 로 응원 끔');
      assert.ok(dests.includes('/topic/islands/i1/events'), 'events 는 무관하니 그대로');
    });

    test('일시 오류(UPSTREAM_UNAVAILABLE)는 접속당 1번 세어 세 번째 접속에서 끈다', () => {
      const c = open({ events: false });
      // 같은 접속의 둘째 ERROR(600ms 시도 창 중복)는 다시 세지 않는다 — 두 번씩 와도 접속 둘은 센 값이 2
      for (let conn = 1; conn <= 2; conn += 1) {
        c.opts.onStompError({ headers: { message: 'UPSTREAM_UNAVAILABLE' }, body: '' });
        c.opts.onStompError({ headers: { message: 'UPSTREAM_UNAVAILABLE' }, body: '' });
        assert.ok(reconnectDests(c).includes(EMOTES), `${conn}번째 접속 뒤에도 재구독`);
      }
      c.opts.onStompError({ headers: { message: 'UPSTREAM_UNAVAILABLE' }, body: '' });
      assert.ok(!reconnectDests(c).includes(EMOTES), '세 번째 접속 ERROR 로 이번 세션 구독을 끈다');
    });

    test('channel=emotes 헤더의 일시 오류도 같은 방식으로 센다 (events 구독이 있어도)', () => {
      const c = open({ events: true });
      for (let conn = 1; conn <= 2; conn += 1) {
        c.opts.onStompError({
          headers: { message: 'UPSTREAM_UNAVAILABLE', channel: 'emotes' },
          body: '',
        });
        assert.ok(reconnectDests(c).includes(EMOTES));
      }
      c.opts.onStompError({
        headers: { message: 'UPSTREAM_UNAVAILABLE', channel: 'emotes' },
        body: '',
      });
      assert.ok(!reconnectDests(c).includes(EMOTES));
    });

    test('60초를 넘게 조용했으면 일시 오류 카운트를 새로 센다 — 드문 장애가 쌓여 응원을 영영 잃지 않는다', () => {
      let now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const c = open();
      const err = () =>
        c.opts.onStompError({ headers: { message: 'UPSTREAM_UNAVAILABLE' }, body: '' });
      for (let conn = 1; conn <= 2; conn += 1) {
        err();
        assert.ok(reconnectDests(c).includes(EMOTES));
      }
      now += 61_000; // 카운트 2 가 쌓인 채 한참 조용했다
      err(); // 새로 센 1
      assert.ok(reconnectDests(c).includes(EMOTES), '카운트가 되살아나지 않고 다시 시작');
      err(); // 2
      assert.ok(reconnectDests(c).includes(EMOTES));
      err(); // 3 — 상한은 여전히 동작한다
      assert.ok(!reconnectDests(c).includes(EMOTES));
    });

    test('조용한 시간이 60초 이내면 카운트는 그대로 쌓인다', () => {
      let now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const c = open();
      const err = () =>
        c.opts.onStompError({ headers: { message: 'UPSTREAM_UNAVAILABLE' }, body: '' });
      for (let conn = 1; conn <= 2; conn += 1) {
        err();
        assert.ok(reconnectDests(c).includes(EMOTES));
        now += 60_000;
      }
      err();
      assert.ok(!reconnectDests(c).includes(EMOTES));
    });

    test('오류를 센 뒤 시계가 뒤로 가면 카운트를 새로 센다 — sendEmote 의 역행 방어와 대칭', () => {
      let now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const c = open();
      const err = () =>
        c.opts.onStompError({ headers: { message: 'UPSTREAM_UNAVAILABLE' }, body: '' });
      for (let conn = 1; conn <= 2; conn += 1) {
        err();
        assert.ok(reconnectDests(c).includes(EMOTES));
      }
      now -= 10_000; // 시계가 10초 뒤로 갔다 — 간격이 음수
      err(); // 새로 센 1 — 간격만 보면 3 이라 꺼졌을 것
      assert.ok(reconnectDests(c).includes(EMOTES), '역행은 60초 조용함과 같이 다시 시작');
    });

    test('channel=events 헤더의 ERROR 는 응원 구독을 건드리지 않는다', () => {
      const c = open({ events: true });
      for (let i = 0; i < 5; i += 1) {
        c.opts.onStompError({
          headers: { message: 'UPSTREAM_UNAVAILABLE', channel: 'events' },
          body: '',
        });
        assert.ok(reconnectDests(c).includes(EMOTES));
      }
    });

    test('events 구독이 있어도 헤더 없는 일시 오류는 처음부터 응원 몫으로 센다 — events 는 건드리지 않는다', () => {
      const c = open({ events: true });
      for (let conn = 1; conn <= 2; conn += 1) {
        c.opts.onStompError({ headers: { message: 'UPSTREAM_UNAVAILABLE' }, body: '' });
        const dests = reconnectDests(c);
        assert.ok(dests.includes(EMOTES), `${conn}번째 접속 뒤에도 재구독`);
        assert.ok(
          dests.includes('/topic/islands/i1/events'),
          `${conn}번째 접속 뒤에도 events 재구독`,
        );
      }
      c.opts.onStompError({ headers: { message: 'UPSTREAM_UNAVAILABLE' }, body: '' });
      const dests = reconnectDests(c);
      assert.ok(!dests.includes(EMOTES), '응원 몫 3번째에 끈다');
      assert.ok(dests.includes('/topic/islands/i1/events'), 'events 는 끝까지 유지');
    });

    test('새 응원 세션(setEmoteEnabled(true))은 쌓인 일시 오류 카운트도 비운다', () => {
      const channel = stompIslandChannel({
        islandId: 'i1',
        emote: true,
        onEvent: () => {},
        onOpen: () => {},
        onError: () => {},
      });
      const c = client();
      for (let conn = 1; conn <= 2; conn += 1) {
        c.opts.onStompError({ headers: { message: 'INTERNAL_ERROR' }, body: '' });
        reconnectDests(c);
      }
      channel.setEmoteEnabled(false);
      channel.setEmoteEnabled(true); // 새 세션 — 카운트 0
      for (let conn = 1; conn <= 2; conn += 1) {
        c.opts.onStompError({ headers: { message: 'INTERNAL_ERROR' }, body: '' });
        assert.ok(reconnectDests(c).includes(EMOTES), `새 세션 ${conn}번째 접속 뒤에도 재구독`);
      }
    });
  });

  describe('realtimeClientOptions 재접속 지터', () => {
    afterEach(() => jest.restoreAllMocks());
    test('재접속 지연은 2.5~7.5 s 안에서 접속마다 새로 뽑는다 — 타이머 없이 reconnectDelay 로', () => {
      const random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
      const o = realtimeClientOptions();
      assert.equal(o.reconnectDelay, 5000);
      const fake = { connectHeaders: {}, reconnectDelay: 0 };
      random.mockReturnValue(0);
      o.beforeConnect(fake as never);
      assert.equal(fake.reconnectDelay, 2500, '하한 2.5 s');
      random.mockReturnValue(0.999);
      o.beforeConnect(fake as never);
      assert.ok(fake.reconnectDelay > 7490 && fake.reconnectDelay < 7500, '상한 7.5 s 미만');
    });
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

describe('이동 채널 (GROMO-2248)', () => {
  const ISLAND = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const MOVEMENT = `/topic/islands/${ISLAND}/movement`;
  const SNAPSHOT = `/topic/islands/${ISLAND}/movement/snapshot`;
  const client = () => (Client as any).instances.at(-1);
  const sub = (dest: string) =>
    client().subs.find((s: { dest: string }) => s.dest === dest) as {
      cb: (m: { body: string }) => void;
    };
  const open = (
    onEvent: (body: unknown) => void = () => {},
    errors: string[] = [],
    denied: number[] = [],
  ) =>
    stompIslandChannel({
      islandId: ISLAND,
      presence: false,
      emote: false,
      movement: true,
      onEvent,
      onOpen: () => {},
      onError: (m) => errors.push(m),
      onMovementDenied: () => denied.push(1),
    });

  beforeEach(() => {
    (Client as any).instances.length = 0;
  });

  test('이동 채널은 movement → movement/snapshot → 오류 큐 순으로 구독하고 presence 는 구독하지 않는다', () => {
    open();
    assert.deepEqual(
      client().subs.map((s: { dest: string }) => s.dest),
      [MOVEMENT, SNAPSHOT, '/user/queue/errors'],
    );
    assert.equal(client().connectHeaders.Authorization, 'Bearer AT');
  });

  test('목적지는 /app/islands/{id}/movement/intent 로 MoveIntent JSON 을 보낸다(id 인코딩 없음)', () => {
    const channel = open();
    const intent = { commandSeq: 1, navRevision: 1, goalX: 67.5, goalY: 27.5 };
    assert.equal(publishMoveIntent(channel, ISLAND, intent), true);
    assert.equal(client().published[0].destination, `/app/islands/${ISLAND}/movement/intent`);
    assert.deepEqual(JSON.parse(client().published[0].body), intent);
  });

  test('PathAccepted 전에 온 스냅샷(pathId 3)도 모르는 pathId 그대로 그리고(N35), PathAccepted(pathId 3) 뒤에도 채택한다', () => {
    const remote: [string, RemotePosition][] = [];
    const controller = createMovementController({
      me: ME,
      send: () => true,
      position: () => ({ x: 38.5, y: 45.5 }),
      walking: () => false,
      onRemotePosition: (userId, p) => remote.push([userId, p]),
    });
    open(controller.onMessage);
    const actor = (userId: string) => ({
      userId,
      x: 38.5,
      y: 45.5,
      state: 'IDLE',
      pathId: 0,
      lastCommandSeq: 0,
    });
    sub(MOVEMENT).cb({
      body: JSON.stringify({
        type: 'FullState',
        navRevision: 1,
        serverTick: 12345,
        tickMs: 50,
        speed: 10.989,
        actors: [actor(ME), actor(B)],
      }),
    });
    remote.length = 0;
    const snapshot = JSON.stringify({
      type: 'Snapshot',
      serverTick: 12350,
      navRevision: 1,
      entities: [
        {
          userId: B,
          pathId: 3,
          x: 39.21,
          y: 44.79,
          segmentIndex: 1,
          state: 'MOVING',
          lastCommandSeq: 7,
        },
      ],
    });
    sub(SNAPSHOT).cb({ body: snapshot });
    // N35: 경로를 아직 몰라도 보간 없이 서버 좌표를 그대로 그린다 — 멈춰 있지 않는다.
    assert.deepEqual(remote, [[B, { x: 39.21, y: 44.79, moving: true }]]);
    sub(MOVEMENT).cb({
      body: JSON.stringify({
        type: 'PathAccepted',
        userId: B,
        commandSeq: 7,
        pathId: 3,
        navRevision: 1,
        startTick: 12346,
        start: { x: 38.5, y: 45.5 },
        goal: { x: 40.5, y: 43.5 },
        speed: 10.989,
        waypoints: [
          { x: 39.5, y: 44.5 },
          { x: 40.5, y: 43.5 },
        ],
      }),
    });
    remote.length = 0;
    sub(SNAPSHOT).cb({ body: snapshot });
    assert.deepEqual(remote, [[B, { x: 39.21, y: 44.79, moving: true }]]);
  });

  test('오류 큐의 NOT_A_MEMBER 를 받으면 호출부에 알리고(onMovementDenied), 재접속해도 이동 토픽을 다시 구독하지 않는다', () => {
    const errors: string[] = [];
    const denied: number[] = [];
    open(undefined, errors, denied);
    const c = client();
    sub('/user/queue/errors').cb({
      body: JSON.stringify({
        code: 'NOT_A_MEMBER',
        message: 'NOT_A_MEMBER',
        clientMessageId: null,
      }),
    });
    assert.equal(errors.length, 1);
    assert.equal(denied.length, 1);
    c.subs.length = 0;
    c.activate(); // stompjs 의 5초 재접속
    assert.deepEqual(
      c.subs.map((s: { dest: string }) => s.dest),
      ['/user/queue/errors'],
    );
  });

  test('구독 거절 STOMP ERROR 도 onMovementDenied 를 부르고 이동 구독을 끊는다 — 무한 재접속·재거절 루프를 막는다', () => {
    const errors: string[] = [];
    const denied: number[] = [];
    open(undefined, errors, denied);
    const c = client();
    c.opts.onStompError({ headers: { message: 'NOT_A_MEMBER', channel: 'movement' } });
    assert.equal(errors.length, 1);
    assert.equal(denied.length, 1);
    c.subs.length = 0;
    c.activate();
    assert.deepEqual(
      c.subs.map((s: { dest: string }) => s.dest),
      ['/user/queue/errors'],
    );
  });

  test('오류 큐의 STALE_COMMAND 같은 무관한 코드는 onMovementDenied 를 부르지 않는다 — onError 로만 오고 동기화는 그대로 둔다', () => {
    const errors: string[] = [];
    const denied: number[] = [];
    open(undefined, errors, denied);
    sub('/user/queue/errors').cb({
      body: JSON.stringify({
        code: 'STALE_COMMAND',
        message: '명령이 낡았어요. 다시 시도해주세요.',
      }),
    });
    assert.deepEqual(errors, ['명령이 낡았어요. 다시 시도해주세요.']);
    assert.equal(denied.length, 0);
  });

  test('일시 오류(MOVEMENT_TOO_FREQUENT) STOMP ERROR 는 onMovementDenied 를 부르지 않고 재접속에서 이동 토픽을 다시 구독한다', () => {
    const errors: string[] = [];
    const denied: number[] = [];
    open(undefined, errors, denied);
    const c = client();
    c.opts.onStompError({ headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' } });
    assert.equal(denied.length, 0);
    c.subs.length = 0;
    c.activate(); // stompjs 의 5초 재접속
    assert.deepEqual(
      c.subs.map((s: { dest: string }) => s.dest),
      [MOVEMENT, SNAPSHOT, '/user/queue/errors'],
    );
  });

  test('일시 오류가 3번 쌓이면 그때 deny 한다(루프 가드, 접속당 1회만 센다)', () => {
    const errors: string[] = [];
    const denied: number[] = [];
    open(undefined, errors, denied);
    const c = client();
    c.opts.onStompError({ headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' } });
    // 같은 접속의 둘째 ERROR는 카운트되지 않는다 — 재접속해야 다음 1회가 센다.
    c.opts.onStompError({ headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' } });
    c.activate();
    c.opts.onStompError({ headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' } });
    c.opts.onStompError({ headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' } });
    assert.equal(denied.length, 0);
    c.activate();
    c.opts.onStompError({ headers: { message: 'INTERNAL_ERROR', channel: 'movement' } });
    assert.equal(denied.length, 1);
    c.subs.length = 0;
    c.activate();
    assert.deepEqual(
      c.subs.map((s: { dest: string }) => s.dest),
      ['/user/queue/errors'],
    );
  });

  test('헤더가 없고 본문 JSON 에 code 가 있으면 그 코드로 판정한다', () => {
    const errors: string[] = [];
    const denied: number[] = [];
    open(undefined, errors, denied);
    const c = client();
    c.opts.onStompError({
      headers: { channel: 'movement' },
      body: JSON.stringify({ code: 'NOT_A_MEMBER' }),
    });
    assert.equal(denied.length, 1);
  });

  test('이동 토픽의 정상 메시지를 받으면 일시 오류 카운터가 0 으로 돌아간다', () => {
    const errors: string[] = [];
    const denied: number[] = [];
    open(undefined, errors, denied);
    const c = client();
    c.opts.onStompError({ headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' } });
    c.activate();
    c.opts.onStompError({ headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' } });
    // FullState 수신 — 연속 실패가 끊겨 카운터가 0으로 돌아간다.
    sub(MOVEMENT).cb({
      body: JSON.stringify({
        type: 'FullState',
        navRevision: 1,
        serverTick: 1,
        tickMs: 50,
        speed: 10.989,
        actors: [],
      }),
    });
    c.activate();
    c.opts.onStompError({ headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' } });
    c.activate();
    c.opts.onStompError({ headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' } });
    assert.equal(denied.length, 0);
    c.activate();
    c.opts.onStompError({ headers: { message: 'INTERNAL_ERROR', channel: 'movement' } });
    assert.equal(denied.length, 1);
  });

  test('INVALID_REQUEST 는 영구 차단이다 — 같은 요청은 항상 같은 거절', () => {
    const errors: string[] = [];
    const denied: number[] = [];
    open(undefined, errors, denied);
    const c = client();
    c.opts.onStompError({ headers: { message: 'INVALID_REQUEST', channel: 'movement' } });
    assert.equal(denied.length, 1);
    c.subs.length = 0;
    c.activate();
    assert.deepEqual(
      c.subs.map((s: { dest: string }) => s.dest),
      ['/user/queue/errors'],
    );
  });

  test('헤더가 없고 본문이 깨진 JSON 이면 예외 없이 코드 없는 ERROR 로 보고 세지 않는다', () => {
    const errors: string[] = [];
    const denied: number[] = [];
    open(undefined, errors, denied);
    const c = client();
    for (let i = 0; i < 4; i += 1) {
      assert.doesNotThrow(() => c.opts.onStompError({ headers: {}, body: '{not json' }));
      c.activate();
    }
    assert.equal(denied.length, 0);
    assert.deepEqual(errors, []);
  });

  test('헤더가 없고 본문이 "null" 이면 예외 없이 코드 없는 ERROR 로 보고 세지 않는다', () => {
    const errors: string[] = [];
    const denied: number[] = [];
    open(undefined, errors, denied);
    const c = client();
    for (let i = 0; i < 4; i += 1) {
      assert.doesNotThrow(() => c.opts.onStompError({ headers: {}, body: 'null' }));
      c.activate();
    }
    assert.equal(denied.length, 0);
    assert.deepEqual(errors, []);
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

describe('island.member.arrived (GROMO-2311)', () => {
  const { memberArrivalFilter, parseMemberArrivedEvent } = jest.requireActual('./islandRealtime');
  const ev = (over: Record<string, unknown> = {}, userId = 'u2') => ({
    eventId: 'e1',
    schemaVersion: 1,
    type: 'island.member.arrived',
    islandId: 'isl',
    aggregateVersion: 3,
    occurredAt: '2026-10-18T00:00:00Z',
    payload: { islandId: 'isl', userId, name: '모모', catColor: 'gray', arrivedAt: 'x' },
    ...over,
  });

  test('파서는 다른 type·섬을 버린다', () => {
    expect(parseMemberArrivedEvent(ev(), 'isl')?.name).toBe('모모');
    expect(parseMemberArrivedEvent(ev({ type: 'focus.emote' }), 'isl')).toBeNull();
    expect(parseMemberArrivedEvent(ev(), 'other')).toBeNull();
  });

  test('eventId 중복·내 도착은 거르고 aggregateVersion 은 보지 않는다', () => {
    const f = memberArrivalFilter('isl', () => 'me');
    expect(f(ev())).not.toBeNull();
    expect(f(ev())).toBeNull();
    expect(f(ev({ eventId: 'e2', aggregateVersion: 1 }))).not.toBeNull();
    expect(f(ev({ eventId: 'e3' }, 'me'))).toBeNull();
  });

  test('내가 차단한 상대의 도착은 토스트로 넘기지 않는다 — 서버 필터 스위치와 무관 (GROMO-2470)', () => {
    replaceBlockedUsers([{ id: 'u2', name: '모모' }]);
    try {
      const f = memberArrivalFilter('isl', () => 'me');
      expect(f(ev())).toBeNull();
      expect(f(ev({ eventId: 'e2' }, 'u3'))).not.toBeNull();
    } finally {
      replaceBlockedUsers([]);
    }
  });
});

describe('홈 채널의 주민 소식 구독 (GROMO-2311)', () => {
  const client = () => (Client as any).instances.at(-1);
  beforeEach(() => {
    (Client as any).instances.length = 0;
  });
  const open = (denied: number[] = []) =>
    stompIslandChannel({
      islandId: 'isl',
      presence: false,
      emote: false,
      movement: true,
      events: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
      onMovementDenied: () => denied.push(1),
    });
  const count = (c: any, dest: string) => c.subs.filter((s: any) => s.dest === dest).length;

  test('이동과 겹치는 코드(MOVEMENT_TOO_FREQUENT)의 첫 ERROR 는 events 를 끄지 않고 재접속에서 다시 구독, 이동 상태도 보존한다', () => {
    const denied: number[] = [];
    open(denied);
    const c = client();
    expect(count(c, '/topic/islands/isl/events')).toBe(1);
    expect(count(c, '/topic/islands/isl/movement')).toBe(1);
    c.opts.onStompError({ headers: { message: 'MOVEMENT_TOO_FREQUENT', channel: 'movement' } });
    expect(denied).toEqual([]);
    c.opts.onConnect({});
    expect(count(c, '/topic/islands/isl/events')).toBe(2);
    expect(count(c, '/topic/islands/isl/movement')).toBe(2);
  });

  test('events 와 무관한 코드(NOT_FOCUSING)는 events 판정에서 제외 — 재접속에서 /events 를 다시 구독한다', () => {
    open();
    const c = client();
    c.opts.onStompError({ headers: { message: 'NOT_FOCUSING' } });
    c.opts.onConnect({});
    c.opts.onStompError({ headers: { message: 'NOT_FOCUSING' } });
    c.opts.onConnect({});
    expect(count(c, '/topic/islands/isl/events')).toBe(3);
  });

  test('channel=events 로 같은 코드가 두 번 거절되면 세 번째 접속에서 /events 를 건너뛰고 이동은 재구독한다', () => {
    const denied: number[] = [];
    open(denied);
    const c = client();
    c.opts.onStompError({ headers: { message: 'INVALID_REQUEST', channel: 'events' } });
    c.opts.onConnect({});
    c.opts.onStompError({ headers: { message: 'INVALID_REQUEST', channel: 'events' } });
    c.opts.onConnect({});
    expect(count(c, '/topic/islands/isl/events')).toBe(2);
    expect(count(c, '/topic/islands/isl/movement')).toBe(3);
    expect(denied).toEqual([]);
  });

  test('events + emote 동시 ON — events 거절은 응원 구독을 끊지 않는다', () => {
    stompIslandChannel({
      islandId: 'isl',
      emote: true,
      events: true,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    const c = client();
    expect(count(c, '/topic/islands/isl/emotes')).toBe(1);
    c.opts.onStompError({ headers: { message: 'INVALID_REQUEST', channel: 'events' } });
    c.opts.onConnect({});
    expect(count(c, '/topic/islands/isl/emotes')).toBe(2);
    expect(count(c, '/topic/islands/isl/events')).toBe(2);
    c.opts.onStompError({ headers: { message: 'INVALID_REQUEST', channel: 'events' } });
    c.opts.onConnect({});
    expect(count(c, '/topic/islands/isl/emotes')).toBe(3);
    expect(count(c, '/topic/islands/isl/events')).toBe(2);
  });

  test('events 구독이 60초 ERROR 없이 유지되면 strike 를 비운다 — 이후 ERROR 1회로는 차단되지 않는다', () => {
    jest.useFakeTimers();
    try {
      open();
      const c = client();
      c.opts.onStompError({ headers: { message: 'INVALID_REQUEST', channel: 'events' } }); // strike 1
      c.opts.onConnect({});
      jest.advanceTimersByTime(61_000); // 무사히 유지
      c.opts.onStompError({ headers: { message: 'INVALID_REQUEST', channel: 'events' } }); // 다시 strike 1
      c.opts.onConnect({});
      expect(count(c, '/topic/islands/isl/events')).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
