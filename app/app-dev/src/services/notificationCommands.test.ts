import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { STORAGE_KEYS } from '@/types/storage';
import { acquireAuthSessionTransition } from './api';
import {
  flushNotificationCommands,
  queueDeviceDeletion,
  queueDeviceRegistration,
  queueNotificationSettings,
  queueSessionLogout,
  reportNotificationLanguage,
} from './notificationCommands';

function token(user: string) {
  return `header.${btoa(JSON.stringify({ sub: user, exp: Math.floor(Date.now() / 1000) + 3600 }))}.sig`;
}
/** 만료된 AT — 전송 직전 getFreshAccessToken() 이 실제로 갱신을 타게 한다. */
function expiredToken(user: string) {
  return `header.${btoa(JSON.stringify({ sub: user, exp: Math.floor(Date.now() / 1000) - 60 }))}.sig`;
}
/** sessionId·bootstrap 이 «없는» 구 로그인 상태. 구 앱으로 로그인한 뒤 아직 회전하지 않은 세션이다. */
async function legacySession(user: string) {
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.accessToken, expiredToken(user)],
    [STORAGE_KEYS.refreshToken, `${user}-refresh`],
  ]);
  await AsyncStorage.multiRemove([
    STORAGE_KEYS.authSessionId,
    STORAGE_KEYS.deviceBootstrap,
    STORAGE_KEYS.authSessionPromotion,
  ]);
}
// sessionId 는 두 모양으로 저장된다 — 키가 없으면 null, 세션 없는 로그인 응답을 저장한 자리는 ''.
function legacyRegister(
  user: string,
  id: string,
  deviceToken: string,
  sessionId: string | null = null,
) {
  return {
    id,
    kind: 'register',
    userId: user,
    accessToken: expiredToken(user),
    sessionId,
    body: { deviceToken },
  };
}
async function session(user: string, id = `${user}-session`) {
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.accessToken, token(user)],
    [STORAGE_KEYS.refreshToken, `${user}-refresh`],
    [STORAGE_KEYS.authSessionId, id],
    [STORAGE_KEYS.deviceBootstrap, `${id}-bootstrap`],
  ]);
}
/** 이벤트 루프를 한 턴 넘긴다 — 대기 중인 promise 연쇄가 끝까지 진행할 기회를 준다(경과 시간 아님). */
function turn() {
  return new Promise((resolve) => setImmediate(resolve));
}
/** 조건이 참이 될 때까지 턴을 돌린다. 시간이 아니라 턴 수로 한계를 둔다. */
async function waitFor(condition: () => boolean, turns = 20) {
  for (let i = 0; i < turns && !condition(); i += 1) await turn();
  if (!condition()) throw new Error('기다리던 상태가 되지 않았습니다.');
}
/** 풀어준 연쇄가 더 갈 수 있는 데까지 가도록 턴을 돌린다. 목 응답은 타이머 없이 promise 로만 진행한다. */
async function drain(turns = 10) {
  for (let i = 0; i < turns; i += 1) await turn();
}
async function queue() {
  return JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.notificationCommands)) ?? '[]');
}
const settings = { notificationEnabled: true, soundEnabled: true, nightModeEnabled: false };

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
  await session('a');
});

test('응답 유실 뒤 기기 등록 재시도는 같은 키와 bootstrap을 사용한다', async () => {
  const put = jest.spyOn(axios, 'put').mockRejectedValue(new Error('response lost'));
  await queueDeviceRegistration('fcm');
  const [saved] = await queue();
  expect(saved.body.deviceBootstrap).toBe('a-session-bootstrap');
  put.mockResolvedValue({ data: { ownershipToken: 'ownership-a' } });
  await queueDeviceRegistration('fcm');
  expect(put.mock.calls[1][2]?.headers?.['Idempotency-Key']).toBe(saved.id);
  expect(await queue()).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.deviceOwnership))!)).toMatchObject({
    ownershipToken: 'ownership-a',
    userId: 'a',
  });
});

test('저장된 설정의 전체 상태와 키를 재시도에 사용한다', async () => {
  const put = jest.spyOn(axios, 'put').mockRejectedValue(new Error('offline'));
  await queueNotificationSettings(settings);
  const [saved] = await queue();
  expect(saved.body).toEqual({ ...settings, nightStartTime: null, nightEndTime: null });
  put.mockResolvedValue({ data: {} });
  await flushNotificationCommands();
  expect(put.mock.calls[1][2]?.headers?.['Idempotency-Key']).toBe(saved.id);
  expect(await queue()).toEqual([]);
});

test('FCM 토큰이 갱신되면 같은 세션의 소유권으로 교체한다', async () => {
  const put = jest.spyOn(axios, 'put').mockResolvedValue({ data: { ownershipToken: 'owner-old' } });
  await queueDeviceRegistration('fcm-old');
  put.mockResolvedValue({ data: { ownershipToken: 'owner-new' } });
  await queueDeviceRegistration('fcm-new');
  expect(put.mock.calls[1][1]).toMatchObject({
    deviceToken: 'fcm-new',
    ownershipToken: 'owner-old',
  });
  expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.deviceOwnership))!)).toMatchObject({
    deviceToken: 'fcm-new',
    ownershipToken: 'owner-new',
  });
  await session('a', 'replacement-session');
  await queueDeviceRegistration('fcm-new');
  expect(put.mock.calls[2][1]).not.toHaveProperty('ownershipToken');
});

test('오프라인에 쌓인 토큰 교체는 선행 등록의 소유권을 이어받아 완주한다', async () => {
  const put = jest.spyOn(axios, 'put').mockRejectedValue(new Error('offline'));
  await queueDeviceRegistration('fcm-old');
  await queueDeviceRegistration('fcm-new');
  const [first, second] = await queue();
  expect(second.body).toMatchObject({
    deviceToken: 'fcm-new',
    deviceBootstrap: 'a-session-bootstrap',
  });
  expect(second.body).not.toHaveProperty('ownershipToken');
  put
    .mockClear()
    .mockResolvedValueOnce({ data: { ownershipToken: 'owner-old' } })
    .mockResolvedValueOnce({ data: { ownershipToken: 'owner-new' } });
  await flushNotificationCommands();
  expect(put.mock.calls[0][1]).toMatchObject({ deviceToken: 'fcm-old' });
  expect(put.mock.calls[0][2]?.headers?.['Idempotency-Key']).toBe(first.id);
  // 소비된 bootstrap 은 그대로 두고 소유권만 이어받는다 — 세션 축 확인을 버리지 않는다.
  expect(put.mock.calls[1][1]).toMatchObject({
    deviceToken: 'fcm-new',
    deviceBootstrap: 'a-session-bootstrap',
    ownershipToken: 'owner-old',
  });
  expect(put.mock.calls[1][2]?.headers?.['Idempotency-Key']).toBe(second.id);
  expect(await queue()).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.deviceOwnership))!)).toMatchObject({
    deviceToken: 'fcm-new',
    ownershipToken: 'owner-new',
  });
});

// 결정적 재현: 「소유권 조회」와 「직전 응답의 소유권 회전」을 서로 엇갈리게 세운다.
// 후속 등록이 소유권을 읽은 «직후» 이전 응답이 도착하도록 barrier 로 고정하면, 직렬화가 없을 때는
// 그 응답의 승계가 아직 큐에 없는 이 명령을 지나치고 명령은 낡은 소유권으로 굳는다.
test('직전 등록 응답의 소유권 회전과 후속 등록 적재는 서로를 추월하지 않는다', async () => {
  const put = jest.spyOn(axios, 'put').mockResolvedValue({ data: { ownershipToken: 'owner-0' } });
  await queueDeviceRegistration('fcm-0');
  expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.deviceOwnership))!)).toMatchObject({
    ownershipToken: 'owner-0',
  });

  // 두 번째 등록의 «응답»을 barrier 가 열 때까지 붙잡는다 — 이 사이에 FCM 토큰이 또 갱신된다.
  let openResponse!: () => void;
  const response = new Promise<void>((resolve) => {
    openResponse = resolve;
  });
  put
    .mockClear()
    .mockImplementationOnce(async () => {
      await response;
      return { data: { ownershipToken: 'owner-1' } };
    })
    .mockResolvedValue({ data: { ownershipToken: 'owner-2' } });
  const rotating = queueDeviceRegistration('fcm-1');
  await waitFor(() => put.mock.calls.length === 1);

  // 세 번째 등록이 소유권을 읽은 «바로 그 자리»에서 두 번째 응답을 풀고, 그 연쇄가 갈 수 있는 데까지
  // 턴을 돌린다. 직렬화가 없으면 회전·승계·전송이 이 턴들 안에서 모두 끝나 이 명령을 지나치고,
  // 직렬화가 있으면 경계에서 멈춰 적재를 기다린다 — 어느 쪽도 경과 시간에 기대지 않는다.
  const getItem = jest.mocked(AsyncStorage.getItem);
  const original = getItem.getMockImplementation()!;
  let crossed = false;
  getItem.mockImplementation(async (storageKey: string) => {
    const value = await original(storageKey);
    if (storageKey === STORAGE_KEYS.deviceOwnership && !crossed) {
      crossed = true;
      openResponse();
      await drain();
    }
    return value;
  });
  try {
    await Promise.all([queueDeviceRegistration('fcm-2'), rotating]);
  } finally {
    getItem.mockImplementation(original);
  }
  expect(crossed).toBe(true);

  // 낡은 owner-0 을 그대로 실으면 소비된 bootstrap 과 함께 영구히 거절된다.
  expect(put.mock.calls[1][1]).toMatchObject({
    deviceToken: 'fcm-2',
    ownershipToken: 'owner-1',
  });
  expect(put).toHaveBeenCalledTimes(2);
  expect(await queue()).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.deviceOwnership))!)).toMatchObject({
    deviceToken: 'fcm-2',
    ownershipToken: 'owner-2',
  });
});

test('소유권 승계는 이미 보낸 명령과 다른 사용자의 의도를 건드리지 않는다', async () => {
  const put = jest.spyOn(axios, 'put').mockRejectedValue(new Error('offline'));
  await queueDeviceRegistration('fcm-old');
  const [mine] = await queue();
  await AsyncStorage.setItem(
    STORAGE_KEYS.notificationCommands,
    JSON.stringify([
      mine,
      { ...mine, id: 'sent-heir', started: true, body: { ...mine.body, deviceToken: 'fcm-sent' } },
      { ...mine, id: 'other-user', userId: 'b', started: false },
      { ...mine, id: 'other-session', sessionId: 'later-session', started: false },
    ]),
  );
  put
    .mockClear()
    .mockResolvedValueOnce({ data: { ownershipToken: 'owner-old' } })
    .mockRejectedValue(new Error('offline'));
  await flushNotificationCommands();
  // 이미 전송한 키는 그 본문이 계약이다 — 결과가 불확정이므로 같은 본문으로 재시도한다.
  expect(put.mock.calls[1][1]).not.toHaveProperty('ownershipToken');
  const rest = await queue();
  expect(rest.map((item: { id: string }) => item.id)).toEqual([
    'sent-heir',
    'other-user',
    'other-session',
  ]);
  expect(rest.every((item: { body: object }) => !('ownershipToken' in item.body))).toBe(true);
  expect(put).toHaveBeenCalledTimes(2);
});

test('기기 토큰을 모르면 사용자 전체 삭제 요청을 만들지 않는다', async () => {
  const del = jest.spyOn(axios, 'delete').mockResolvedValue({ data: {} });
  await queueDeviceDeletion(token('a'));
  expect(del).not.toHaveBeenCalled();
  expect(await queue()).toEqual([]);
});

test('RT 로그아웃 성공은 동일 기기 삭제 재시도만 완료한다', async () => {
  jest.spyOn(axios, 'delete').mockRejectedValue(new Error('expired access token'));
  const old = {
    deviceToken: 'fcm-a',
    ownershipToken: 'owner-a',
    userId: 'a',
    sessionId: 'a-session',
  };
  await AsyncStorage.setItem(STORAGE_KEYS.deviceOwnership, JSON.stringify(old));
  await queueDeviceDeletion(token('a'));
  await AsyncStorage.setItem(
    STORAGE_KEYS.deviceOwnership,
    JSON.stringify({ ...old, ownershipToken: 'owner-new', sessionId: 'new-session' }),
  );
  await queueDeviceDeletion(token('a'));
  await AsyncStorage.setItem(STORAGE_KEYS.deviceOwnership, JSON.stringify(old));
  jest.spyOn(axios, 'post').mockResolvedValue({ data: {} });
  await queueSessionLogout('a-refresh', token('a'));
  expect(await queue()).toHaveLength(1);
  expect((await queue())[0]).toMatchObject({
    kind: 'delete',
    sessionId: 'new-session',
    body: { ownershipToken: 'owner-new' },
  });
});

test('계정 전환 전에 준비한 로그아웃은 저장 rollback 뒤 기존 세션을 폐기하지 않는다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: {} });
  await queueSessionLogout('a-refresh', token('a'), {
    prepareAccountSwitch: true,
    sessionId: 'a-session',
  });
  const [saved] = await queue();
  expect(post).not.toHaveBeenCalled();
  const release = await acquireAuthSessionTransition();
  let flushing: Promise<void>;
  try {
    await session('b'); // multiSet 도중 새 토큰이 보이는 창
    flushing = flushNotificationCommands();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(post).not.toHaveBeenCalled();
    await session('a'); // 세션 저장 실패로 원래 snapshot 복구
  } finally {
    release();
  }
  await flushing!;
  expect(post).not.toHaveBeenCalled();
  expect(await queue()).toEqual([saved]);
  await session('b'); // 이후 성공한 전환은 같은 키로 이전 RT를 폐기한다.
  await flushNotificationCommands();
  expect(post.mock.calls[0][1]).toMatchObject({ refreshToken: 'a-refresh' });
  expect(post.mock.calls[0][2]?.headers?.['Idempotency-Key']).toBe(saved.id);
  expect(await queue()).toEqual([]);
});

test('준비한 로그아웃 저장 실패는 이전 세션과 RT를 보존한다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: {} });
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage full'));
  await expect(
    queueSessionLogout('a-refresh', token('a'), {
      prepareAccountSwitch: true,
      sessionId: 'a-session',
    }),
  ).rejects.toThrow('storage full');
  expect(await AsyncStorage.getItem(STORAGE_KEYS.refreshToken)).toBe('a-refresh');
  expect(post).not.toHaveBeenCalled();
});

test('응답 유실 설정의 결과를 확인한 뒤 최근 의도를 보내며 다른 계정으로 보내지 않는다', async () => {
  const put = jest.spyOn(axios, 'put').mockRejectedValue(new Error('offline'));
  await queueNotificationSettings(settings);
  await queueNotificationSettings({ ...settings, soundEnabled: false });
  expect(await queue()).toHaveLength(2);
  await session('b');
  put.mockClear().mockResolvedValue({ data: {} });
  await flushNotificationCommands();
  expect(put).not.toHaveBeenCalled();
  await session('a');
  await flushNotificationCommands();
  expect(put.mock.calls[0][1]).toMatchObject({ soundEnabled: true });
  expect(put.mock.calls[1][1]).toMatchObject({ soundEnabled: false });
});

test('이전 로그인 bootstrap을 새 로그인 세션으로 재등록하지 않는다', async () => {
  const put = jest.spyOn(axios, 'put').mockRejectedValue(new Error('offline'));
  await queueDeviceRegistration('fcm');
  await session('a', 'new-session');
  put.mockClear().mockResolvedValue({ data: {} });
  await flushNotificationCommands();
  expect(put).not.toHaveBeenCalled();
  expect(await queue()).toEqual([]);
});

test('로그아웃 mutex 안에서도 삭제 실패를 저장하고 이전 인증으로 재시도한다', async () => {
  await AsyncStorage.setItem(
    STORAGE_KEYS.deviceOwnership,
    JSON.stringify({
      deviceToken: 'fcm-a',
      ownershipToken: 'owner-a',
      userId: 'a',
      sessionId: 'a-session',
    }),
  );
  const del = jest.spyOn(axios, 'delete').mockRejectedValue(new Error('offline'));
  const oldToken = token('a');
  const release = await acquireAuthSessionTransition();
  try {
    await queueDeviceDeletion(oldToken);
  } finally {
    release();
  }
  const [saved] = await queue();
  await session('b');
  del.mockResolvedValue({ data: {} });
  await flushNotificationCommands();
  expect(del.mock.calls[1][1]?.headers).toMatchObject({
    Authorization: `Bearer ${oldToken}`,
    'X-Device-Token': 'fcm-a',
    'X-Device-Ownership': 'owner-a',
    'Idempotency-Key': saved.id,
  });
  expect(await queue()).toEqual([]);
});

test('네트워크 단절 때 로그아웃 RT와 삭제 대상을 함께 보존한다', async () => {
  await AsyncStorage.setItem(
    STORAGE_KEYS.deviceOwnership,
    JSON.stringify({
      deviceToken: 'fcm-a',
      ownershipToken: 'owner-a',
      userId: 'a',
      sessionId: 'a-session',
    }),
  );
  const post = jest.spyOn(axios, 'post').mockRejectedValue(new Error('offline'));
  await queueSessionLogout('a-refresh', token('a'));
  const [saved] = await queue();
  await AsyncStorage.multiRemove([STORAGE_KEYS.accessToken, STORAGE_KEYS.refreshToken]);
  post.mockResolvedValue({ data: {} });
  await flushNotificationCommands();
  expect(post.mock.calls[1][1]).toEqual({
    refreshToken: 'a-refresh',
    deviceToken: 'fcm-a',
    ownershipToken: 'owner-a',
  });
  expect(post.mock.calls[1][2]?.headers?.['Idempotency-Key']).toBe(saved.id);
  expect(await queue()).toEqual([]);
});

test('동시에 발생한 flush는 동일 명령을 중복 발행하지 않는다', async () => {
  const put = jest.spyOn(axios, 'put').mockRejectedValue(new Error('offline'));
  await queueNotificationSettings(settings);
  put.mockClear().mockResolvedValue({ data: {} });
  await Promise.all([flushNotificationCommands(), flushNotificationCommands()]);
  expect(put).toHaveBeenCalledTimes(1);
});

test('표시 언어 실패도 보존하고 성공한 언어는 다시 전송하지 않는다', async () => {
  const patch = jest.spyOn(axios, 'patch').mockRejectedValue(new Error('offline'));
  await reportNotificationLanguage('zh-Hant');
  const [saved] = await queue();
  expect(await AsyncStorage.getItem(STORAGE_KEYS.languageReported)).toBeNull();
  patch.mockResolvedValue({ data: {} });
  await reportNotificationLanguage('zh-Hant');
  expect(patch.mock.calls[1][2]?.headers?.['Idempotency-Key']).toBe(saved.id);
  await reportNotificationLanguage('zh-Hant');
  expect(patch).toHaveBeenCalledTimes(2);
});

test('구 세션 승격은 아직 못 보낸 기기 등록을 폐기하지 않는다', async () => {
  await legacySession('a');
  const [first, second] = [
    legacyRegister('a', 'legacy-1', 'fcm'),
    // 빈 문자열로 저장된 「세션 없음」도 같은 승계를 받아야 한다.
    legacyRegister('a', 'legacy-2', 'fcm-2', ''),
  ];
  await AsyncStorage.setItem(STORAGE_KEYS.notificationCommands, JSON.stringify([first, second]));
  // AT 만료 → refresh 가 «처음으로» sessionId 를 준다(서버의 구 세션 승격).
  const post = jest.spyOn(axios, 'post').mockResolvedValue({
    data: {
      accessToken: token('a'),
      sessionId: 'promoted-session',
      deviceBootstrap: 'promoted-bootstrap',
    },
  });
  const put = jest.spyOn(axios, 'put').mockResolvedValue({ data: { ownershipToken: 'owner-a' } });

  await flushNotificationCommands();

  // 승격을 세션 불일치로 읽으면 이 등록은 HTTP 를 한 번도 타지 못한 채 사라진다.
  expect(post).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledTimes(2);
  expect(put.mock.calls[0][1]).toEqual({
    deviceToken: 'fcm',
    deviceBootstrap: 'promoted-bootstrap',
  });
  expect(put.mock.calls[0][2]?.headers?.['Idempotency-Key']).toBe('legacy-1');
  // 형제 명령도 함께 승계된다 — 하나만 옮기면 다음 차례에 같은 불일치로 삭제된다.
  expect(put.mock.calls[1][2]?.headers?.['Idempotency-Key']).toBe('legacy-2');
  expect(await queue()).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.deviceOwnership))!)).toMatchObject({
    userId: 'a',
    sessionId: 'promoted-session',
  });
});

test('승격이 아닌 로그인 교체는 세션 없는 등록을 종전대로 폐기한다', async () => {
  await legacySession('a');
  await AsyncStorage.setItem(
    STORAGE_KEYS.notificationCommands,
    JSON.stringify([legacyRegister('a', 'legacy-1', 'fcm')]),
  );
  // 같은 사용자가 다시 로그인해 새 세션이 저장됐다. 승격 표식은 그 «이전» 세션을 가리킨다.
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.accessToken, token('a')],
    [STORAGE_KEYS.authSessionId, 'fresh-login-session'],
    [
      STORAGE_KEYS.authSessionPromotion,
      JSON.stringify({ userId: 'a', sessionId: 'older-promoted-session' }),
    ],
  ]);
  const put = jest.spyOn(axios, 'put').mockResolvedValue({ data: {} });

  await flushNotificationCommands();

  expect(put).not.toHaveBeenCalled();
  expect(await queue()).toEqual([]);
});

test('구 세션 승격 표식은 이후 로그인 교체를 승계하지 않는다', async () => {
  await legacySession('a');
  const post = jest.spyOn(axios, 'post').mockResolvedValue({
    data: { accessToken: token('a'), sessionId: 'promoted-session' },
  });
  const put = jest.spyOn(axios, 'put').mockRejectedValue(new Error('offline'));
  await AsyncStorage.setItem(
    STORAGE_KEYS.notificationCommands,
    JSON.stringify([legacyRegister('a', 'legacy-1', 'fcm')]),
  );
  await flushNotificationCommands();
  // 승계된 명령은 승격 세션의 것이다 — 저장된 sessionId 가 그 사실을 남긴다.
  expect((await queue())[0]).toMatchObject({ id: 'legacy-1', sessionId: 'promoted-session' });
  expect(post).toHaveBeenCalledTimes(1);

  // 그 뒤 진짜 로그인 교체가 오면 승격 세션의 의도는 더 이상 보내지 않는다.
  await session('a', 'replacement-session');
  put.mockClear().mockResolvedValue({ data: {} });
  await flushNotificationCommands();
  expect(put).not.toHaveBeenCalled();
  expect(await queue()).toEqual([]);
});

test('유효한 구 AT도 첫 등록 전에 승격하고 응답 유실 뒤 같은 키와 본문을 재생한다', async () => {
  await legacySession('a');
  await AsyncStorage.setItem(STORAGE_KEYS.accessToken, token('a'));
  const post = jest.spyOn(axios, 'post').mockResolvedValue({
    data: {
      accessToken: token('a'),
      sessionId: 'promoted-session',
      deviceBootstrap: 'promoted-bootstrap',
    },
  });
  const put = jest.spyOn(axios, 'put').mockRejectedValue(new Error('response lost'));
  await queueDeviceRegistration('fcm');
  expect(post).toHaveBeenCalledTimes(1);
  const [pending] = await queue();
  expect(pending).toMatchObject({
    started: true,
    sessionId: 'promoted-session',
    body: { deviceToken: 'fcm', deviceBootstrap: 'promoted-bootstrap' },
  });
  expect(put.mock.calls[0][1]).toEqual(pending.body);
  put.mockResolvedValue({ data: { ownershipToken: 'owner-a' } });
  await flushNotificationCommands();
  expect(put.mock.calls[1][1]).toEqual(put.mock.calls[0][1]);
  expect(put.mock.calls[1][2]?.headers?.['Idempotency-Key']).toBe(pending.id);
  expect(await queue()).toEqual([]);
});

test('최초 등록 전 세션 승격 장애는 미전송 명령으로 남는다', async () => {
  await legacySession('a');
  await AsyncStorage.setItem(STORAGE_KEYS.accessToken, token('a'));
  jest.spyOn(axios, 'post').mockRejectedValue(new Error('offline'));
  const put = jest.spyOn(axios, 'put').mockResolvedValue({ data: {} });
  await queueDeviceRegistration('fcm');
  expect(put).not.toHaveBeenCalled();
  expect((await queue())[0].started).not.toBe(true);
});
