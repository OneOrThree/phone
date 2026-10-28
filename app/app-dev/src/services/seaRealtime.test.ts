import { memberLooks } from './memberLooks';
import * as apiClient from './api/client';
// 바다 방 STOMP(GROMO-2310) — 서버가 강제하는 프레임 순서, NOT_IN_SEA_ROOM 재 enter, left 멱등, member → 참가자 폴백.
// stompjs Client 는 목이다(islandRealtime.test 와 같은 FakeClient) — 구독·발행 순서를 그대로 기록한다.
import { openSeaRoom, seaMemberFromWire, seaParticipantsAt, SEA_SYNC_MS } from './seaRealtime';

jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  getAccessToken: () => 'AT',
}));
jest.mock('@stomp/stompjs', () => {
  class FakeClient {
    static instances: FakeClient[] = [];
    connected = false;
    activations = 0;
    connectHeaders: Record<string, string> = {};
    log: string[] = [];
    subs: { dest: string; cb: (m: { body: string }) => void; live: boolean }[] = [];
    opts: Record<string, any>;
    constructor(o: Record<string, any>) {
      this.opts = o;
      FakeClient.instances.push(this);
    }
    activate() {
      this.activations += 1;
      this.opts.beforeConnect?.(this);
      this.connected = true;
      this.subs = [];
      this.opts.onConnect?.({});
    }
    subscribe(dest: string, cb: (m: { body: string }) => void) {
      const sub = { dest, cb, live: true };
      this.subs.push(sub);
      this.log.push(`SUB ${dest}`);
      return {
        unsubscribe: () => {
          sub.live = false;
          this.log.push(`UNSUB ${dest}`);
        },
      };
    }
    publish(p: { destination: string; body: string }) {
      this.log.push(`SEND ${p.destination} ${p.body}`);
    }
    deactivate() {
      this.connected = false;
      this.log.push('CLOSE');
      return Promise.resolve();
    }
  }
  return { Client: FakeClient };
});

const { Client } = jest.requireMock('@stomp/stompjs') as { Client: any };
let clock = 1_000_000;
const now = () => clock;
const client = () => Client.instances[Client.instances.length - 1];
// resume() 은 deactivate() 가 끝난 뒤(마이크로태스크) 다시 붙는다 — 타이머를 돌린 뒤 한 번 비운다
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const deliver = (dest: string, body: unknown) => {
  for (const sub of client().subs.filter((s: any) => s.dest === dest && s.live))
    sub.cb({ body: JSON.stringify(body) });
};
const personal = (type: string, payload: unknown, eventId = `e-${Math.random()}`) =>
  deliver('/user/queue/sea', { eventId, schemaVersion: 1, type, roomId: 'room-1', payload });
const roomEvent = (type: string, payload: unknown, roomId = 'room-1') =>
  deliver(`/topic/sea/rooms/${roomId}`, { eventId: 'x', schemaVersion: 1, type, roomId, payload });
const member = (userId: string, over: Record<string, unknown> = {}) => ({
  userId,
  state: 'focusing',
  remark: null,
  session: {
    sessionId: `s-${userId}`,
    destinationIslandId: 'i',
    sailingMinutes: 30,
    activeSeconds: 60,
    serverNow: '2026-10-18T00:00:00Z',
    startedAt: '2026-10-17T23:59:00Z',
  },
  ...over,
});

const open = () => {
  const spy = {
    members: [] as any[],
    emotes: [] as string[],
    errors: [] as string[],
    left: [] as string[],
    reconnects: 0,
  };
  const room = openSeaRoom({
    now,
    onMembers: (m) => (spy.members = m),
    onEmote: (userId, type) => spy.emotes.push(`${userId}:${type}`),
    onError: (message) => spy.errors.push(message),
    onLeft: (reason) => spy.left.push(reason),
    onReconnect: () => (spy.reconnects += 1),
  });
  return { room, spy };
};
/** enter → assigned → 방 구독 → sync → snapshot 까지 진행 */
const joinRoom = (members: unknown[] = [member('me'), member('a')]) => {
  personal('sea.room.assigned', { roomId: 'room-1' });
  personal('sea.room.snapshot', { roomId: 'room-1', members });
};

beforeEach(() => {
  Client.instances.length = 0;
  clock += 10_000;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

test('프레임 순서 — 개인 큐 SUB → enter → assigned 뒤 방 SUB → sync → snapshot', () => {
  const { spy } = open();
  expect(client().log).toEqual([
    'SUB /user/queue/sea',
    'SUB /user/queue/errors',
    'SEND /app/sea/enter {}',
  ]);
  personal('sea.room.assigned', { roomId: 'room-1' });
  expect(client().log.slice(3)).toEqual(['SUB /topic/sea/rooms/room-1', 'SEND /app/sea/sync {}']);
  expect(client().connectHeaders.Authorization).toBe('Bearer AT');
  personal('sea.room.snapshot', { roomId: 'room-1', members: [member('me'), member('a')] });
  expect(spy.members.map((m) => m.userId)).toEqual(['me', 'a']);
});

test('방 사건 — joined·updated 는 갱신, left 는 멱등 제거, 다른 방 사건은 버린다', () => {
  const { spy } = open();
  joinRoom();
  roomEvent('sea.member.joined', { member: member('b', { remark: '수학 끝!' }) });
  expect(spy.members.find((m) => m.userId === 'b')?.message).toBe('수학 끝!');
  roomEvent('sea.member.updated', { member: member('b', { state: 'adrift' }) });
  expect(spy.members.find((m) => m.userId === 'b')?.focusing).toBe(false);
  roomEvent('sea.member.left', { userId: 'b', reason: 'left' });
  roomEvent('sea.member.left', { userId: 'b', reason: 'left' });
  expect(spy.members.map((m) => m.userId)).toEqual(['me', 'a']);
  roomEvent('sea.member.joined', { member: member('z') }, 'room-old');
  expect(spy.members.some((m) => m.userId === 'z')).toBe(false);
});

test('남의 뗏목 외양 — appearance 를 outfit 으로 싣고 version 이 작거나 같은 갱신은 무시한다 (GROMO-2390)', () => {
  const { spy } = open();
  const look = (head: string | null, version: number) => ({
    appearance: { head, neck: null, version },
  });
  joinRoom([member('me'), member('a', look('hat-1', 5))]);
  const a = () => spy.members.find((m) => m.userId === 'a');
  expect(a().outfit).toEqual({ head: 'hat-1', neck: null });
  roomEvent('sea.member.updated', { member: member('a', look('hat-2', 6)) });
  expect(a().outfit.head).toBe('hat-2');
  roomEvent('sea.member.updated', { member: member('a', look('hat-1', 5)) }); // 늦게 온 옛 갱신
  expect(a().outfit.head).toBe('hat-2');
  roomEvent('sea.member.updated', { member: member('a', look(null, 7)) }); // 벗었다
  expect(a().outfit.head).toBeNull();
  roomEvent('sea.member.updated', { member: member('a', { remark: '한마디' }) }); // appearance 없는 갱신
  expect(a().outfit.head).toBeNull();
  roomEvent('sea.member.updated', { member: member('a', look('hat-3', 8)) });
  roomEvent('sea.member.updated', { member: member('a', { state: 'adrift' }) });
  expect(a().outfit.head).toBe('hat-3');
  // 옛 서버(appearance 없음)는 outfit 을 싣지 않는다
  expect(seaMemberFromWire(member('b'), 1)).not.toHaveProperty('outfit');
  expect(
    seaParticipantsAt([seaMemberFromWire(member('c', look('h', 1)), 1)!], 1)[0],
  ).not.toHaveProperty('outfitVersion');
});

test('먼저 온 더 새 외양 갱신을 늦게 온 옛 스냅숏이 되돌리지 않는다 — 다른 필드는 스냅숏이 정본 (GROMO-2390)', () => {
  const { spy } = open();
  const look = (head: string, version: number) => ({ appearance: { head, neck: null, version } });
  joinRoom([member('me'), member('a', look('hat-5', 5))]);
  roomEvent('sea.member.updated', { member: member('a', look('hat-6', 6)) });
  personal('sea.room.snapshot', {
    roomId: 'room-1',
    members: [member('me'), member('a', { ...look('hat-5', 5), remark: '새 한마디' })],
  });
  const a = spy.members.find((m) => m.userId === 'a');
  expect(a.outfit.head).toBe('hat-6');
  expect(a.message).toBe('새 한마디');
});

test('45초마다 sync 를 보내고, 오류 큐 NOT_IN_SEA_ROOM 이면 다시 enter 한다', () => {
  open();
  joinRoom();
  const before = client().log.length;
  jest.advanceTimersByTime(SEA_SYNC_MS);
  expect(client().log.slice(before)).toEqual(['SEND /app/sea/sync {}']);
  clock += 5_000; // enter 시도 창(1초) 밖
  deliver('/user/queue/errors', { code: 'NOT_IN_SEA_ROOM', message: '방에 없어요' });
  expect(client().log.slice(before + 1)).toEqual([
    'UNSUB /topic/sea/rooms/room-1',
    'SEND /app/sea/enter {}',
  ]);
  // 새 배정을 받으면 그 방을 구독한 뒤 sync
  personal('sea.room.assigned', { roomId: 'room-2' });
  expect(client().log.slice(-2)).toEqual(['SUB /topic/sea/rooms/room-2', 'SEND /app/sea/sync {}']);
});

test('재연결하면 방 구독 없이 enter 부터 다시 한다', () => {
  open();
  joinRoom();
  client().log.length = 0;
  client().activate(); // stompjs 재접속 — onConnect 가 다시 불린다
  expect(client().log).toEqual([
    'SUB /user/queue/sea',
    'SUB /user/queue/errors',
    'SEND /app/sea/enter {}',
  ]);
});

test('sea.room.left — 같은 사건이 두 번 와도 한 번만 처리하고, adrift 면 주기 틱은 침묵하고 사용자 행동이 enter 1회 (GROMO-2484)', () => {
  const { room, spy } = open();
  joinRoom();
  clock += 5_000;
  personal('sea.room.left', { roomId: 'room-1', reason: 'adrift' }, 'left-1');
  personal('sea.room.left', { roomId: 'room-1', reason: 'adrift' }, 'left-1');
  expect(spy.left).toEqual(['adrift']);
  expect(spy.members).toEqual([]);
  const before = client().log.length;
  jest.advanceTimersByTime(SEA_SYNC_MS);
  expect(client().log.slice(before)).toEqual([]);
  // 예전에는 여기서 영구히 방이 없어 이모트가 전부 「연결이 원활하지 않아요」였다 — 사용자 전송 시도가 다시 들어간다
  expect(room.sendEmote('cheer')).toBe('no-room');
  expect(client().log.slice(before)).toEqual(['SEND /app/sea/enter {}']);
  joinRoom();
  expect(room.sendEmote('cheer')).toBe('sent');
  // 한마디·포그라운드 복귀(reconnect)도 같은 사용자 행동이다
  clock += 5_000;
  personal('sea.room.left', { roomId: 'room-1', reason: 'adrift' }, 'left-1b');
  const afterSecond = client().log.length;
  room.reconnect();
  expect(client().log.slice(afterSecond)).toEqual(['SEND /app/sea/enter {}']);
});

test('sea.room.left(left) — 다른 기기가 나간 것이라 이 화면은 다시 enter 한다', () => {
  open();
  joinRoom();
  clock += 5_000;
  personal('sea.room.left', { roomId: 'room-1', reason: 'left' }, 'left-2');
  expect(client().log.slice(-1)).toEqual(['SEND /app/sea/enter {}']);
});

test('이모트 — 방에 있을 때만 보내고 600ms 시도 창 안의 연타는 거른다, 내 sea.emote 가 ack 다', () => {
  const { room, spy } = open();
  expect(room.sendEmote('cheer')).toBe('no-room'); // 방 배정 전
  joinRoom();
  expect(room.sendEmote('cheer')).toBe('sent');
  expect(client().log.slice(-1)).toEqual(['SEND /app/sea/rooms/room-1/emotes {"type":"cheer"}']);
  expect(room.sendEmote('hello')).toBe('throttled'); // 같은 시각 연타
  clock += 1_000;
  expect(room.sendEmote('hello')).toBe('sent');
  roomEvent('sea.emote', { userId: 'me', type: 'cheer' });
  roomEvent('sea.emote', { userId: 'me', type: 'dance' }); // 모르는 타입은 버린다
  expect(spy.emotes).toEqual(['me:cheer']);
  deliver('/user/queue/errors', { code: 'EMOTE_TOO_FREQUENT', message: '...' });
  expect(spy.errors).toEqual(['이모트는 잠시 뒤에 다시 보낼 수 있어요']);
  client().connected = false; // stompjs 재접속 대기
  clock += 1_000;
  expect(room.sendEmote('hello')).toBe('disconnected');
});

test('오류 큐 UPSTREAM_UNAVAILABLE — 무시하지 않고 한 번 안내, 주기 틱이 다시 enter, 사용자 재시도 뒤 또 실패하면 다시 안내 (GROMO-2484)', () => {
  const { room, spy } = open();
  const upstream = '바다 상태를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  deliver('/user/queue/errors', { code: 'UPSTREAM_UNAVAILABLE', message: '...' });
  deliver('/user/queue/errors', { code: 'UPSTREAM_UNAVAILABLE', message: '...' });
  expect(spy.errors).toEqual([upstream]);
  clock += 5_000;
  const before = client().log.length;
  jest.advanceTimersByTime(SEA_SYNC_MS);
  expect(client().log.slice(before)).toEqual(['SEND /app/sea/enter {}']);
  deliver('/user/queue/errors', { code: 'UPSTREAM_UNAVAILABLE', message: '...' });
  expect(spy.errors).toEqual([upstream]); // 45초마다 토스트를 쌓지 않는다
  clock += 5_000;
  expect(room.sendEmote('cheer')).toBe('no-room');
  deliver('/user/queue/errors', { code: 'UPSTREAM_UNAVAILABLE', message: '...' });
  expect(spy.errors).toEqual([upstream, upstream]);
});

test('close — leave 를 보내고 소켓을 닫고 주기 sync 를 멈춘다', () => {
  const { room } = open();
  joinRoom();
  room.close();
  expect(client().log.slice(-2)).toEqual(['SEND /app/sea/leave {}', 'CLOSE']);
  const before = client().log.length;
  jest.advanceTimersByTime(SEA_SYNC_MS * 2);
  expect(client().log.length).toBe(before);
});

const stompError = (code = 'UPSTREAM_UNAVAILABLE') =>
  client().opts.onStompError({ headers: { message: code }, body: '' });

test('ERROR 프레임이 연속 3번이면 쉬었다가 백오프(30초 → 60초)로 다시 붙고, 안내는 한 번만 한다', async () => {
  const { spy } = open();
  for (let i = 0; i < 3; i += 1) stompError();
  expect(client().log.slice(-1)).toEqual(['CLOSE']);
  expect(client().connected).toBe(false);
  expect(spy.errors).toEqual(['실시간 요청이 거절됐어요.']);
  jest.advanceTimersByTime(29_999);
  expect(client().connected).toBe(false);
  jest.advanceTimersByTime(1);
  await flush();
  expect(client().connected).toBe(true); // activate 를 다시 불렀다 — onConnect 가 enter 부터
  expect(client().log.slice(-1)).toEqual(['SEND /app/sea/enter {}']);
  // 다시 붙자마자 또 거절되면 바로 다음(60초) 백오프로 쉰다 — 안내는 다시 하지 않는다
  stompError();
  expect(client().connected).toBe(false);
  expect(spy.errors).toHaveLength(1);
  jest.advanceTimersByTime(30_000);
  expect(client().connected).toBe(false);
  jest.advanceTimersByTime(30_000);
  await flush();
  expect(client().connected).toBe(true);
});

test('백오프는 30초 → 60초 → 120초로 늘고 120초가 상한이다(네 번째도 120초)', async () => {
  open();
  const reject = () => {
    for (let i = 0; i < 3; i += 1) stompError();
  };
  const waitsFor = async (ms: number) => {
    expect(client().connected).toBe(false);
    jest.advanceTimersByTime(ms - 1);
    expect(client().connected).toBe(false);
    jest.advanceTimersByTime(1);
    await flush();
    expect(client().connected).toBe(true);
  };
  reject();
  await waitsFor(30_000);
  reject();
  await waitsFor(60_000);
  reject();
  await waitsFor(120_000);
  reject();
  await waitsFor(120_000);
});

test('비코드 ERROR(Session closed.)는 3번이어도 쉬지 않고 안내도 하지 않는다 — 코드 ERROR 는 종전 백오프', () => {
  const { spy } = open();
  for (let i = 0; i < 3; i += 1) stompError('Session closed.');
  expect(client().connected).toBe(true);
  expect(spy.errors).toEqual([]);
  // 비코드가 카운터에 남지 않았다 — 코드 ERROR 3번째에야 쉰다
  stompError();
  stompError();
  expect(client().connected).toBe(true);
  stompError();
  expect(client().connected).toBe(false);
});

test('close 사유 SESSION_REVOKED — 안내하고 재접속을 멈추며 백오프 재활성도 하지 않는다', () => {
  const { spy, room } = open();
  client().onWebSocketClose({ code: 1008, reason: 'SESSION_REVOKED' });
  expect(client().log.slice(-1)).toEqual(['CLOSE']);
  expect(spy.errors).toEqual(['다른 곳에서 로그아웃돼 실시간 연결이 끊겼어요.']);
  room.reconnect();
  expect(client().connected).toBe(false);
});

test('쉬는 중에 세션 폐기 close 가 오면 백오프 타이머가 다시 붙이지 않는다', () => {
  open();
  for (let i = 0; i < 3; i += 1) stompError();
  client().onWebSocketClose({ code: 1008, reason: 'SESSION_REVOKED' });
  jest.advanceTimersByTime(300_000);
  expect(client().connected).toBe(false);
});

test('다른 close(1002·OUTBOUND_QUEUE_FULL)는 아무것도 하지 않는다', () => {
  const { spy } = open();
  const before = client().log.length;
  client().onWebSocketClose({ code: 1002, reason: 'Session closed.' });
  client().onWebSocketClose({ code: 1008, reason: 'OUTBOUND_QUEUE_FULL' });
  expect(client().log.length).toBe(before);
  expect(client().connected).toBe(true);
  expect(spy.errors).toEqual([]);
});

test('이모트 연타 ERROR(EMOTE_TOO_FREQUENT)는 안내만 하고 백오프로 세지 않는다', () => {
  const { spy } = open();
  for (let i = 0; i < 3; i += 1) stompError('EMOTE_TOO_FREQUENT');
  expect(client().connected).toBe(true);
  expect(spy.errors).toEqual(Array(3).fill('이모트는 잠시 뒤에 다시 보낼 수 있어요'));
  // 다른 오류 두 번으로도 쉬지 않는다 — 이모트 거절이 카운터에 남지 않았다
  stompError();
  stompError();
  expect(client().connected).toBe(true);
});

test('reconnect() — 쉬는 중이면 기다리지 않고 바로 다시 붙고, 연결 중이면 아무 일도 없다', async () => {
  const { room } = open();
  const before = client().log.length;
  room.reconnect();
  expect(client().log.length).toBe(before);
  for (let i = 0; i < 3; i += 1) stompError();
  expect(client().connected).toBe(false);
  room.reconnect();
  await flush();
  expect(client().connected).toBe(true);
  jest.advanceTimersByTime(120_000); // 지운 백오프 타이머가 또 붙지 않는다
  expect(client().log.filter((l: string) => l === 'SUB /user/queue/sea')).toHaveLength(2);
});

test('스냅샷을 받으면 오류 카운터·백오프·안내가 처음으로 돌아간다', async () => {
  const { spy } = open();
  for (let i = 0; i < 3; i += 1) stompError();
  jest.advanceTimersByTime(30_000);
  await flush();
  joinRoom(); // 정상화 — 스냅샷
  stompError();
  stompError();
  expect(client().connected).toBe(true); // 2회로는 쉬지 않는다(카운터 리셋)
  stompError();
  expect(client().connected).toBe(false);
  expect(spy.errors).toHaveLength(2); // 안내도 다시 한 번
  jest.advanceTimersByTime(30_000); // 백오프도 30초부터
  await flush();
  expect(client().connected).toBe(true);
});

test('close — 쉬는 중의 재접속 타이머도 멈춘다', () => {
  const { room } = open();
  for (let i = 0; i < 3; i += 1) stompError();
  room.close();
  jest.advanceTimersByTime(300_000);
  expect(client().connected).toBe(false);
});

test('close 뒤 — 내 leave 의 left 가 DISCONNECT 처리 전에 돌아와도 다시 enter 하지 않고 방 사건·ERROR 도 버린다', () => {
  const { room, spy } = open();
  joinRoom();
  room.close();
  client().connected = true; // deactivate 가 끝나기 전 창 — 소켓이 아직 살아 있어 send 가 나갈 수 있는 상태
  const before = client().log.length;
  const membersBefore = spy.members.length;
  personal('sea.room.left', { roomId: 'room-1', reason: 'left' }, 'left-after-close');
  roomEvent('sea.member.joined', { member: member('b') });
  deliver('/user/queue/errors', { code: 'NOT_IN_SEA_ROOM', message: '...' });
  clock += 1_000;
  expect(room.sendEmote('cheer')).toBe('closed'); // 닫힌 뒤의 이모트도 나가지 않는다
  expect(client().log.slice(before)).toEqual([]);
  expect(spy.members.length).toBe(membersBefore);
  expect(spy.left).toEqual([]);
});

describe('member → 참가자', () => {
  test('T1 필드(name·catColor)가 없으면 ??? · gray, remark 는 한마디, state 로 집중 여부', () => {
    expect(seaMemberFromWire(member('a', { remark: '안녕' }), 5)).toEqual({
      userId: 'a',
      name: '???',
      color: 'gray',
      focusing: true,
      activeSeconds: 60,
      anchorMs: 5,
      sessionId: 's-a',
      message: '안녕',
    });
    const named = seaMemberFromWire(
      member('b', { name: '치즈', catColor: 'ginger', state: 'adrift' }),
      5,
    );
    expect(named).toMatchObject({ name: '치즈', color: 'ginger', focusing: false });
    expect(named).not.toHaveProperty('message');
    // 모르는 털색은 gray, 세션 없음은 0초, userId 없으면 버린다
    expect(seaMemberFromWire(member('c', { catColor: 'purple', session: null }), 5)).toMatchObject({
      color: 'gray',
      activeSeconds: 0,
    });
    expect(seaMemberFromWire({ state: 'focusing' }, 5)).toBeNull();
  });

  test('집중 중이면 받은 뒤 흐른 초를 더하고 표류 중이면 멈춘 값 그대로다', () => {
    const focusing = seaMemberFromWire(member('a'), 1_000)!;
    const adrift = seaMemberFromWire(member('b', { state: 'adrift' }), 1_000)!;
    const [a, b] = seaParticipantsAt([focusing, adrift], 1_000 + 90_500);
    expect(a.activeSeconds).toBe(150);
    expect(b.activeSeconds).toBe(60);
    expect(a).not.toHaveProperty('anchorMs');
    expect(a).not.toHaveProperty('sessionId'); // 2303 표시 모델에는 싣지 않는다
  });
});

test('sea.room.left 뒤 같은 방에 재배정되면 옛 구독을 한 번 풀고 새로 한 번만 구독한다', () => {
  open();
  joinRoom();
  clock += 5_000;
  client().log.length = 0;
  personal('sea.room.left', { roomId: 'room-1', reason: 'disconnected' }, 'left-3');
  personal('sea.room.assigned', { roomId: 'room-1' });
  personal('sea.room.assigned', { roomId: 'room-1' }); // 같은 방 재확인 — 다시 구독하지 않는다
  const log = client().log;
  expect(log.filter((l: string) => l === 'UNSUB /topic/sea/rooms/room-1')).toHaveLength(1);
  expect(log.filter((l: string) => l === 'SUB /topic/sea/rooms/room-1')).toHaveLength(1);
  expect(log.indexOf('UNSUB /topic/sea/rooms/room-1')).toBeLessThan(
    log.indexOf('SUB /topic/sea/rooms/room-1'),
  );
  expect(
    client().subs.filter((x: any) => x.dest === '/topic/sea/rooms/room-1' && x.live),
  ).toHaveLength(1);
});

test('onReconnect — 첫 연결에는 부르지 않고 재연결마다 부른다', () => {
  const { spy } = open();
  expect(spy.reconnects).toBe(0);
  client().activate();
  client().activate();
  expect(spy.reconnects).toBe(2);
});

test('쉬는 중 reconnect() 직후 세션 폐기 close 가 오면 예약된 재접속을 취소한다', async () => {
  const { room } = open();
  for (let i = 0; i < 3; i += 1) stompError();
  const before = client().activations;
  room.reconnect();
  client().onWebSocketClose({ code: 1008, reason: 'SESSION_REVOKED' });
  await Promise.resolve();
  await Promise.resolve();
  expect(client().activations).toBe(before);
  expect(client().connected).toBe(false);
});

test('외양 전용 사건은 앱 캐시를 갱신하고 이후 방 스냅샷이 새 착용을 되돌리지 않는다', async () => {
  const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  memberLooks.clear();
  const request = jest.spyOn(apiClient, 'request').mockResolvedValue({
    members: [{ userId, catColor: 'black', appearance: { head: 'old', neck: null, version: 1 } }],
    hiddenUserIds: [],
  });
  await memberLooks.ensure([userId]);
  const { room, spy } = open();
  joinRoom([member(userId)]);
  expect(spy.members[0].outfit.head).toBe('old');
  roomEvent('sea.member.appearance.updated', {
    userId,
    appearance: { head: 'new', neck: null },
    version: 3,
  });
  expect(spy.members[0].outfit.head).toBe('new');
  personal('sea.room.snapshot', { roomId: 'room-1', members: [member(userId)] });
  expect(spy.members[0].outfit.head).toBe('new');
  roomEvent('sea.member.appearance.updated', {
    userId,
    appearance: { head: 'stale', neck: null },
    version: 2,
  });
  expect(spy.members[0].outfit.head).toBe('new');
  expect(request).toHaveBeenCalledTimes(1);
  room.close();
  request.mockRestore();
  memberLooks.clear();
});

test('더 최신인 바다 스냅샷과 갱신은 오래된 공용 캐시를 교체하고 추가 조회하지 않는다', async () => {
  const userId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  memberLooks.clear();
  const request = jest.spyOn(apiClient, 'request').mockResolvedValue({
    members: [{ userId, catColor: 'black', appearance: { head: 'old', neck: null, version: 1 } }],
    hiddenUserIds: [],
  });
  await memberLooks.ensure([userId]);
  const { room, spy } = open();
  joinRoom([
    member(userId, { appearance: { head: 'snapshot', neck: null, shoes: 'boots', version: 4 } }),
  ]);
  expect(spy.members[0].outfit.head).toBe('snapshot');
  expect(memberLooks.get(userId)?.appearance).toMatchObject({
    head: 'snapshot',
    shoes: 'boots',
    version: 4,
  });
  roomEvent('sea.member.updated', {
    member: member(userId, { appearance: { head: null, neck: 'scarf', version: 5 } }),
  });
  expect(spy.members[0].outfit).toMatchObject({ head: null, neck: 'scarf' });
  expect(memberLooks.get(userId)?.appearance?.version).toBe(5);
  personal('sea.room.snapshot', {
    roomId: 'room-1',
    members: [member(userId, { appearance: { head: 'stale', version: 2 } })],
  });
  expect(spy.members[0].outfit).toMatchObject({ head: null, neck: 'scarf' });
  expect(request).toHaveBeenCalledTimes(1);
  room.close();
  request.mockRestore();
  memberLooks.clear();
});
