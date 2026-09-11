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
async function session(user: string, id = `${user}-session`) {
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.accessToken, token(user)],
    [STORAGE_KEYS.refreshToken, `${user}-refresh`],
    [STORAGE_KEYS.authSessionId, id],
    [STORAGE_KEYS.deviceBootstrap, `${id}-bootstrap`],
  ]);
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
