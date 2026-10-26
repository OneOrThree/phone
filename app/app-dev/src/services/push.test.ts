import type { Notification, NotificationResponse } from 'expo-notifications';

const USER = 'user-1';
const OTHER = 'user-2';
const APNS = 'ab'.repeat(32);
const NEW_APNS = 'cd'.repeat(32);
const FCM = 'fcm-token-1';
const FCM_2 = 'fcm-token-2';
const FCM_3 = 'fcm-token-3';
const OWN = '0b8f4f0e-6a1e-4f43-9d61-3a5f1f7c9e21';
const TAG = '5d1c2f0a-9a53-4b36-8f0e-1c2d3e4f5a6b';
const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Device = {
  userId?: string;
  fcmToken?: string;
  registeredToken?: string;
  ownershipToken?: string;
  deliveryTag?: string;
};
type FakeSession = { accessToken: string; refreshToken: string; userId: string };
type Permission = 'granted' | 'denied' | 'provisional';

/** 그 토큰으로 등록을 확인받은 기록 — 같은 계정·같은 토큰이면 다시 등록하지 않는다. 등록 응답 기본값도 이 소유권·태그다. */
const registeredWith = (fcmToken: string, userId = USER): Device => ({
  userId,
  fcmToken,
  registeredToken: fcmToken,
  ownershipToken: OWN,
  deliveryTag: TAG,
});
const REGISTERED = registeredWith(FCM);
/** 알림을 끈 기기 — 토큰만 지우고 소유권·태그와 그것을 확인받은 토큰은 남긴다(다시 켜면 CAS). */
const TOKEN_DELETED: Device = {
  userId: USER,
  registeredToken: FCM,
  ownershipToken: OWN,
  deliveryTag: TAG,
};
/** 판정·탭 테스트용 — FCM 토큰이 없어 권한 거부 상태의 동기화가 같은 계정의 기록을 건드리지 않는다. */
const RECEIVING: Device = { userId: USER, ownershipToken: OWN, deliveryTag: TAG };

const sessionOf = (userId = USER, refreshToken = `rt-${userId}`): FakeSession => ({
  accessToken: `at-${refreshToken}`,
  refreshToken,
  userId,
});

const settle = async () => {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
};

const notice = (
  payload: Record<string, unknown>,
  { id = 'n-1', data = {}, type = 'push' }: { id?: string; data?: object; type?: string } = {},
) =>
  ({
    date: 0,
    request: {
      identifier: id,
      content: { title: '알림', body: '본문', data },
      trigger: { type, payload },
    },
  }) as unknown as Notification;

const responseOf = (notification: Notification, actionIdentifier = DEFAULT_ACTION) =>
  ({ notification, actionIdentifier }) as NotificationResponse;

const bridgeError = (code: string) => Object.assign(new Error(code), { code });

function setup({
  os = 'ios',
  bridge = true,
  stored,
  current = sessionOf(),
  bootstrap,
  permission = 'granted',
  enabled = true,
  cold = null,
}: {
  os?: string;
  bridge?: boolean;
  stored?: Device;
  current?: FakeSession | null;
  bootstrap?: string;
  permission?: Permission;
  enabled?: boolean;
  cold?: NotificationResponse | null;
} = {}) {
  jest.resetModules();
  // session.ts 와 같은 계약: 구독 즉시 지금 값을 알리고, 로그인·로그아웃은 세대를 올린다(AT 갱신은 그대로).
  let active = current;
  let generation = 1;
  const listeners = new Set<(session: FakeSession | null) => void>();
  const bootstraps = new Map<string, string>();
  if (current && bootstrap) bootstraps.set(current.refreshToken, bootstrap);
  const store = new Map<string, string>();
  if (stored) store.set('gromo.pushDevice', JSON.stringify(stored));
  const secureStore = {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string): Promise<void> => {
      store.set(key, value);
    }),
  };
  const fcm = {
    getToken: jest.fn(async (_hex: string) => FCM),
    deleteToken: jest.fn(async () => undefined),
  };
  const remove = jest.fn();
  let onAppState: (state: string) => void = () => {};
  let onFcmToken: (event: { token: string }) => void = () => {};
  let onApnsToken: (token: { type: string; data: string }) => void = () => {};
  let onResponse: (response: NotificationResponse) => void = () => {};
  let handler:
    { handleNotification: (n: Notification) => Promise<Record<string, boolean>> } | undefined;
  let status: Permission = permission;
  const notifications = {
    DEFAULT_ACTION_IDENTIFIER: DEFAULT_ACTION,
    IosAuthorizationStatus: { PROVISIONAL: 3 },
    getPermissionsAsync: jest.fn(async () => ({
      granted: status === 'granted',
      ios: { status: status === 'granted' ? 2 : status === 'provisional' ? 3 : 1 },
    })),
    getDevicePushTokenAsync: jest.fn(async () => ({ type: 'ios', data: APNS })),
    dismissAllNotificationsAsync: jest.fn(async () => undefined),
    setNotificationHandler: jest.fn((next: typeof handler | null) => {
      handler = next ?? undefined;
    }),
    addNotificationResponseReceivedListener: jest.fn((listener: typeof onResponse) => {
      onResponse = listener;
      return { remove };
    }),
    addPushTokenListener: jest.fn((listener: typeof onApnsToken) => {
      onApnsToken = listener;
      return { remove };
    }),
    getLastNotificationResponse: jest.fn(() => cold),
    clearLastNotificationResponse: jest.fn(),
  };
  const loadNotifications = jest.fn(() => notifications);
  const registerDevice = jest.fn(
    async (
      _body: object,
      _key: string,
    ): Promise<{ ownershipToken: string; deliveryTag?: string }> => ({
      ownershipToken: OWN,
      deliveryTag: TAG,
    }),
  );
  const deleteDevice = jest.fn(
    async (_token: string, _owner: string | undefined, _key: string) => {},
  );
  const openAppLink = jest.fn();
  const takeDeviceBootstrap = jest.fn((refreshToken: string) => {
    const value = bootstraps.get(refreshToken);
    bootstraps.delete(refreshToken);
    return value;
  });
  jest.doMock('react-native', () => ({
    Platform: { OS: os },
    NativeModules: bridge ? { FCMTokenModule: fcm } : {},
    NativeEventEmitter: jest.fn(() => ({
      addListener: jest.fn((_name: string, listener: typeof onFcmToken) => {
        onFcmToken = listener;
        return { remove };
      }),
    })),
    AppState: {
      currentState: 'active',
      addEventListener: jest.fn((_name: string, listener: typeof onAppState) => {
        onAppState = listener;
        return { remove };
      }),
    },
  }));
  jest.doMock('expo-notifications', loadNotifications);
  jest.doMock('expo-secure-store', () => secureStore);
  jest.doMock('./api/deviceToken', () => ({ registerDevice, deleteDevice }));
  jest.doMock('./api/auth', () => ({ takeDeviceBootstrap }));
  jest.doMock('./appDeepLink', () => ({ openAppLink }));
  jest.doMock('./api/session', () => ({
    getSession: () => active,
    sessionGeneration: () => generation,
    subscribeSession: (listener: (session: FakeSession | null) => void) => {
      listeners.add(listener);
      listener(active);
      return () => listeners.delete(listener);
    },
  }));
  const push = require('./push') as typeof import('./push');
  const client = require('./api/client') as typeof import('./api/client');
  const switchOn = { value: enabled };
  const stop = push.startPushSync(() => switchOn.value);
  return {
    push,
    stop,
    fcm,
    notifications,
    loadNotifications,
    registerDevice,
    deleteDevice,
    openAppLink,
    secureStore,
    switchOn,
    stored: (): Device | null => JSON.parse(store.get('gromo.pushDevice') ?? 'null'),
    apiError: (code: string, httpStatus: number) => new client.ApiError(code, code, httpStatus),
    setPermission: (next: Permission) => {
      status = next;
    },
    /** 세션 공개(로그인·계정 전환·로그아웃·세션 상실) — 세대가 오른다. */
    publish: (next: FakeSession | null, nextBootstrap?: string) => {
      if (next && nextBootstrap) bootstraps.set(next.refreshToken, nextBootstrap);
      active = next;
      generation += 1;
      listeners.forEach((listener) => listener(active));
    },
    /** AT 갱신 — 같은 세션의 연장이라 세대·userId 가 그대로다. */
    refreshAccessToken: () => {
      active = { ...active!, accessToken: 'at-refreshed' };
      listeners.forEach((listener) => listener(active));
    },
    foreground: () => onAppState('active'),
    fcmRefresh: (token: string) => onFcmToken({ token }),
    apnsChanged: (data: string) => onApnsToken({ type: 'ios', data }),
    tap: (response: NotificationResponse) => onResponse(response),
    show: (notification: Notification) => handler!.handleNotification(notification),
  };
}

test('첫 등록은 그 세션의 bootstrap 을 싣고, 응답을 userId·토큰과 함께 기록 하나로 한 번에 저장한다', async () => {
  const t = setup({ bootstrap: 'boot-1' });
  await settle();

  // expo-notifications 가 준 APNs 토큰(hex)으로 FCM 토큰을 받는다.
  expect(t.fcm.getToken).toHaveBeenCalledWith(APNS);
  expect(t.registerDevice).toHaveBeenCalledTimes(1);
  const [body, key] = t.registerDevice.mock.calls[0];
  expect(body).toStrictEqual({ deviceToken: FCM, deviceBootstrap: 'boot-1' });
  expect(key).toMatch(KEY);
  // 원자 저장 — 응답(소유권·태그)은 userId·토큰과 함께 기록 하나로 한 번에 쓴다.
  const writes = t.secureStore.setItemAsync.mock.calls.map(([, value]) => JSON.parse(value));
  expect(writes.filter((write) => 'ownershipToken' in write)).toStrictEqual([REGISTERED]);
  expect(t.stored()).toStrictEqual(REGISTERED);
  expect(t.fcm.deleteToken).not.toHaveBeenCalled();
  t.stop();
});

test('첫 등록의 응답을 잃어도(네트워크) 받은 토큰과 계정은 먼저 적혀 있다 — 알림을 끄면 그 토큰을 지운다', async () => {
  const t = setup({ bootstrap: 'boot-1' });
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
  await settle();
  expect(t.stored()).toStrictEqual({ userId: USER, fcmToken: FCM });

  t.switchOn.value = false;
  t.push.refreshPush();
  await settle();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.stored()).toStrictEqual({ userId: USER });
  t.stop();
});

test('첫 등록의 응답을 잃은 뒤 A 가 로그아웃하고 B 가 로그인하면 그 토큰을 지운 뒤에 B 를 등록한다', async () => {
  const t = setup({ bootstrap: 'boot-1' });
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_TIMEOUT', 0));
  await settle();

  // A 로그아웃 — 서버 행 삭제도 먼저 적어 둔 토큰으로 시작한다.
  t.push.unregisterPushDevice();
  expect(t.deleteDevice).toHaveBeenCalledWith(FCM, undefined, expect.stringMatching(KEY));
  t.publish(null);
  await settle();

  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.publish(sessionOf(OTHER), 'boot-b');
  await settle();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM_2, deviceBootstrap: 'boot-b' },
    expect.stringMatching(KEY),
  );
  expect(t.fcm.deleteToken.mock.invocationCallOrder[0]).toBeLessThan(
    t.registerDevice.mock.invocationCallOrder[1],
  );
  t.stop();
});

test('첫 등록의 응답을 잃으면 다음 트리거에 같은 키·같은 본문으로 다시 보내 재생 응답의 소유권·태그를 저장한다', async () => {
  const t = setup({ bootstrap: 'boot-1' });
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_TIMEOUT', 0));
  await settle();
  t.foreground();
  await settle();

  const [lost, replayed] = t.registerDevice.mock.calls;
  expect(lost[0]).toStrictEqual({ deviceToken: FCM, deviceBootstrap: 'boot-1' });
  expect(replayed).toStrictEqual(lost);
  expect(t.stored()).toStrictEqual(REGISTERED);
  t.stop();
});

test('알림을 다시 켠 등록(CAS)의 응답을 잃으면 같은 상태로 보고 건너뛰지 않고 다음 트리거에 같은 키·본문으로 다시 보낸다', async () => {
  // 알림을 껐다가(토큰만 지움, 소유권·태그는 남김) 다시 켠 기기.
  const t = setup({ stored: { userId: USER, ownershipToken: OWN, deliveryTag: TAG } });
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
  await settle();
  t.foreground();
  await settle();

  const [lost, retried] = t.registerDevice.mock.calls;
  expect(lost[0]).toStrictEqual({ deviceToken: FCM, ownershipToken: OWN });
  expect(retried).toStrictEqual(lost);
  t.stop();
});

test('알림을 다시 켠 등록(CAS)의 응답을 잃고 앱이 다시 시작돼도 확인 전인 등록을 다시 보내고, 확인된 기록은 다시 시작해도 건너뛴다', async () => {
  // 알림을 껐다(토큰만 지움) 다시 켠 기기 — 등록 응답을 잃는다.
  let t = setup({ stored: TOKEN_DELETED });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
  await settle();
  const unconfirmed = t.stored()!;
  // 받은 토큰은 적혔지만 소유권·태그는 아직 옛 토큰으로 확인받은 것이다.
  expect(unconfirmed).toStrictEqual({ ...TOKEN_DELETED, fcmToken: FCM_2 });
  t.stop();

  // 다시 시작 — 메모리의 묶음은 없어도 확인 전이라 다시 보낸다.
  t = setup({ stored: unconfirmed });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  await settle();
  expect(t.registerDevice).toHaveBeenCalledWith(
    { deviceToken: FCM_2, ownershipToken: OWN },
    expect.stringMatching(KEY),
  );
  const confirmed = t.stored()!;
  expect(confirmed).toStrictEqual(registeredWith(FCM_2));
  t.stop();

  // 확인된 기록으로 다시 시작하면 건너뛴다.
  t = setup({ stored: confirmed });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  await settle();
  expect(t.fcm.getToken).toHaveBeenCalled();
  expect(t.registerDevice).not.toHaveBeenCalled();
  t.stop();
});

test('Android·브리지 없는 바이너리에서는 expo-notifications 를 불러오지 않고 브리지·저장소·서버도 부르지 않는다', async () => {
  for (const options of [{ os: 'android' }, { bridge: false }]) {
    const t = setup({ ...options, stored: REGISTERED });
    await settle();
    t.push.refreshPush();
    t.push.unregisterPushDevice();
    await settle();

    expect(t.loadNotifications).not.toHaveBeenCalled();
    expect(t.secureStore.getItemAsync).not.toHaveBeenCalled();
    expect(t.fcm.getToken).not.toHaveBeenCalled();
    expect(t.fcm.deleteToken).not.toHaveBeenCalled();
    expect(t.registerDevice).not.toHaveBeenCalled();
    expect(t.deleteDevice).not.toHaveBeenCalled();
    t.stop();
  }
});

test('같은 계정의 새 세션(s1→s2)은 토큰을 지우지 않고 소유권과 새 bootstrap 으로 등록한다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();
  t.publish(sessionOf(USER, 'rt-2'), 'boot-2');
  await settle();

  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM, ownershipToken: OWN, deviceBootstrap: 'boot-2' },
    expect.stringMatching(KEY),
  );
  expect(t.fcm.deleteToken).not.toHaveBeenCalled();
  expect(t.notifications.dismissAllNotificationsAsync).not.toHaveBeenCalled();
  t.stop();
});

test('A→B 는 표시 알림을 지우고 FCM 토큰을 바꾼 뒤에 소유권 없이 등록한다 — 토큰을 못 바꾸면 등록하지 않는다', async () => {
  const t = setup({ stored: { ...REGISTERED, userId: OTHER }, bootstrap: 'boot-b' });
  t.fcm.deleteToken.mockRejectedValueOnce(bridgeError('TOKEN_ERROR'));
  t.fcm.getToken.mockResolvedValue(FCM_2);
  await settle();

  expect(t.notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.fcm.getToken).not.toHaveBeenCalled();
  expect(t.registerDevice).not.toHaveBeenCalled();

  // 다음 트리거에 처음부터 다시 — 이번엔 토큰을 바꿨으니 등록한다.
  t.foreground();
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(1);
  expect(t.registerDevice).toHaveBeenCalledWith(
    { deviceToken: FCM_2, deviceBootstrap: 'boot-b' },
    expect.stringMatching(KEY),
  );
  const dismissed = t.notifications.dismissAllNotificationsAsync.mock.invocationCallOrder[1];
  const deleted = t.fcm.deleteToken.mock.invocationCallOrder[1];
  const registered = t.registerDevice.mock.invocationCallOrder[0];
  expect(dismissed).toBeLessThan(deleted);
  expect(deleted).toBeLessThan(registered);
  expect(t.stored()).toStrictEqual(registeredWith(FCM_2));
  t.stop();
});

test('A→B 는 알림이 꺼져 있어도 먼저 한다 — A 의 표시 알림·토큰을 지우고 기록을 비우되 getToken·등록은 하지 않고, 켜면 B 로 등록한다', async () => {
  // A 의 등록 기록이 남은 기기(로그아웃 뒤)에 알림이 꺼진 채 B 가 로그인한다.
  const t = setup({ stored: REGISTERED, current: null, enabled: false });
  await settle();
  t.publish(sessionOf(OTHER), 'boot-b');
  await settle();
  expect(t.notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.fcm.getToken).not.toHaveBeenCalled();
  expect(t.registerDevice).not.toHaveBeenCalled();
  expect(t.stored()).toStrictEqual({});

  // 같은 세션에서 켜면 그 세션의 bootstrap 으로, 소유권 없이 B 를 등록한다.
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.switchOn.value = true;
  t.push.refreshPush();
  await settle();
  expect(t.registerDevice).toHaveBeenCalledWith(
    { deviceToken: FCM_2, deviceBootstrap: 'boot-b' },
    expect.stringMatching(KEY),
  );
  expect(t.stored()).toStrictEqual(registeredWith(FCM_2, OTHER));
  t.stop();
});

test('같은 계정·같은 토큰·소유권이 있으면 매 실행·앱 복귀·같은 토큰 이벤트에 다시 등록하지 않는다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();
  t.foreground();
  await settle();
  // Firebase 는 같은 토큰으로도 갱신 이벤트를 낸다.
  t.fcmRefresh(FCM);
  await settle();
  // getDevicePushTokenAsync 도 같은 APNs 토큰으로 이벤트를 다시 낸다.
  t.apnsChanged(APNS);
  await settle();

  expect(t.fcm.getToken).toHaveBeenCalled();
  expect(t.registerDevice).not.toHaveBeenCalled();
  t.stop();
});

test('FCM 토큰 갱신 이벤트·APNs 토큰 변경이면 새 FCM 토큰을 소유권(CAS)과 함께 등록한다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();

  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.fcmRefresh(FCM_2);
  await settle();
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM_2, ownershipToken: OWN },
    expect.stringMatching(KEY),
  );
  expect(t.stored()).toStrictEqual(registeredWith(FCM_2));

  // swizzling 을 꺼서 Firebase 는 APNs 토큰을 getToken 인자로만 받는다 — 바뀐 APNs 토큰으로 다시 묻는다.
  t.fcm.getToken.mockResolvedValue(FCM_3);
  t.apnsChanged(NEW_APNS);
  await settle();
  expect(t.fcm.getToken).toHaveBeenLastCalledWith(NEW_APNS);
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM_3, ownershipToken: OWN },
    expect.stringMatching(KEY),
  );
  t.stop();
});

test('네트워크·5xx 로 실패한 등록은 다음 트리거에 같은 키·같은 본문으로 다시 보내고, 본문이 바뀌면 새 키를 쓴다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0))
    .mockRejectedValueOnce(t.apiError('UPSTREAM_UNAVAILABLE', 503));
  await settle();
  t.foreground();
  await settle();
  t.fcm.getToken.mockResolvedValue(FCM_3);
  t.fcmRefresh(FCM_3);
  await settle();

  const [first, retry, changed] = t.registerDevice.mock.calls;
  expect(first[0]).toStrictEqual({ deviceToken: FCM_2, ownershipToken: OWN });
  expect(retry).toStrictEqual(first);
  expect(changed[0]).toStrictEqual({ deviceToken: FCM_3, ownershipToken: OWN });
  expect(changed[1]).not.toBe(first[1]);
  expect(t.stored()).toStrictEqual(registeredWith(FCM_3));
  t.stop();
});

test('409 DEVICE_OWNERSHIP_CONFLICT 는 세션당 한 번 — 표시 알림은 두고 토큰을 바꿔 소유권 없이 다시 등록하고, 두 번째면 다음 세션까지 멈춘다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValueOnce(FCM_2).mockResolvedValue(FCM_3);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409));
  await settle();

  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM_2, ownershipToken: OWN },
    { deviceToken: FCM_3 },
  ]);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.notifications.dismissAllNotificationsAsync).not.toHaveBeenCalled();

  // 두 번째 충돌 — 이 세션에서는 더 묻지도 보내지도 않는다.
  t.foreground();
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(2);
  expect(t.fcm.getToken).toHaveBeenCalledTimes(2);

  // 다음 로그인에서 다시 시작한다.
  t.publish(sessionOf(USER, 'rt-2'), 'boot-2');
  await settle();
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM_3, deviceBootstrap: 'boot-2' },
    expect.stringMatching(KEY),
  );
  t.stop();
});

test.each([
  ['SESSION_REVOKED', 409],
  ['STALE_AUTH_GENERATION', 409],
  ['USER_INACTIVE', 401],
  ['CLIENT_STALE_SESSION', 0],
])('%s(%i) 면 그 세션에서는 더 등록하지 않고 다음 세션에서 다시 한다', async (code, httpStatus) => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.registerDevice.mockRejectedValueOnce(t.apiError(code, httpStatus));
  await settle();
  t.foreground();
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(1);

  t.publish(sessionOf(USER, 'rt-2'));
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(2);
  t.stop();
});

test('409 IDEMPOTENCY_KEY_CONFLICT 면 그 묶음을 버리고 다음 트리거에 같은 본문을 새 키로 보낸다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.registerDevice.mockRejectedValueOnce(t.apiError('IDEMPOTENCY_KEY_CONFLICT', 409));
  await settle();
  t.foreground();
  await settle();

  const [conflicted, retried] = t.registerDevice.mock.calls;
  expect(retried[0]).toStrictEqual(conflicted[0]);
  expect(retried[1]).not.toBe(conflicted[1]);
  t.stop();
});

test('가장 최근에 시작한 등록의 응답만 저장한다 — 세션이 바뀐 뒤 도착한 이전 묶음의 응답(옛 태그)은 버린다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  let answerFirst!: (value: { ownershipToken: string; deliveryTag: string }) => void;
  t.registerDevice.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answerFirst = resolve;
      }),
  );
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(1);

  // 첫 등록의 응답을 기다리는 사이 새 세션이 열린다 — 그 묶음은 버려지고 새 세션은 새 키로 등록한다.
  t.publish(sessionOf(USER, 'rt-2'), 'boot-2');
  answerFirst({ ownershipToken: 'stale-ownership', deliveryTag: 'stale-tag' });
  await settle();

  const written = t.secureStore.setItemAsync.mock.calls.map(([, value]) => value);
  expect(written.some((value) => value.includes('stale-tag'))).toBe(false);
  const [[, firstKey], [secondBody, secondKey]] = t.registerDevice.mock.calls;
  expect(secondKey).not.toBe(firstKey);
  expect(secondBody).toStrictEqual({
    deviceToken: FCM_2,
    ownershipToken: OWN,
    deviceBootstrap: 'boot-2',
  });
  expect(t.stored()).toStrictEqual(registeredWith(FCM_2));
  t.stop();
});

test('세션이 끝나면(로그아웃·401) 네트워크 없이 표시 알림을 지우고 소유권·태그만 버린다 — 부팅 직후 첫 null 은 무시한다', async () => {
  const t = setup({ stored: REGISTERED, current: null });
  await settle();
  expect(t.notifications.dismissAllNotificationsAsync).not.toHaveBeenCalled();
  expect(t.secureStore.setItemAsync).not.toHaveBeenCalled();

  t.publish(sessionOf());
  await settle();
  t.publish(null);
  await settle();

  expect(t.notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(t.stored()).toStrictEqual({ userId: USER, fcmToken: FCM });
  expect(t.deleteDevice).not.toHaveBeenCalled();
  expect(t.fcm.deleteToken).not.toHaveBeenCalled();
  t.stop();
});

test('AT 갱신(같은 세대·같은 계정)으로는 다시 맞추지 않는다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();
  const tokenReads = t.fcm.getToken.mock.calls.length;
  const registrations = t.registerDevice.mock.calls.length;

  t.refreshAccessToken();
  await settle();

  expect(t.fcm.getToken).toHaveBeenCalledTimes(tokenReads);
  expect(t.registerDevice).toHaveBeenCalledTimes(registrations);
  t.stop();
});

test('설정을 끄면 서버 행은 두고 FCM 토큰만 지운다(소유권 유지) — 꺼진 동안 getToken 을 부르지 않고, 다시 켜면 새 토큰을 CAS 로 등록한다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();
  const tokenReads = t.fcm.getToken.mock.calls.length;

  t.switchOn.value = false;
  t.push.refreshPush();
  await settle();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.deleteDevice).not.toHaveBeenCalled();
  expect(t.stored()).toStrictEqual(TOKEN_DELETED);

  t.foreground();
  await settle();
  expect(t.fcm.getToken).toHaveBeenCalledTimes(tokenReads);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);

  t.switchOn.value = true;
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.push.refreshPush();
  await settle();
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM_2, ownershipToken: OWN },
    expect.stringMatching(KEY),
  );
  t.stop();
});

test('권한이 거부면 FCM 토큰을 받지도 등록하지도 않고, 임시 허용(provisional)은 허용으로 본다', async () => {
  const t = setup({ permission: 'denied' });
  await settle();
  expect(t.fcm.getToken).not.toHaveBeenCalled();
  expect(t.registerDevice).not.toHaveBeenCalled();

  t.setPermission('provisional');
  t.foreground();
  await settle();
  expect(t.registerDevice).toHaveBeenCalledWith({ deviceToken: FCM }, expect.stringMatching(KEY));
  t.stop();
});

test('로그아웃(unregisterPushDevice)은 같은 tick 에 DELETE 를 시작하고 소유권·태그를 버리며, 그 세션으로는 다시 등록하지 않는다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();
  const registrations = t.registerDevice.mock.calls.length;
  t.deleteDevice.mockRejectedValueOnce(new Error('offline'));

  t.push.unregisterPushDevice();
  // await 없이 시작해야 logout 이 세션을 지우기 전에 지금 AT 가 실린다.
  expect(t.deleteDevice).toHaveBeenCalledWith(FCM, OWN, expect.stringMatching(KEY));
  await settle();
  expect(t.stored()).toStrictEqual({ userId: USER, fcmToken: FCM });

  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.foreground();
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(registrations);
  t.stop();
});

test.each<[string, { stored?: Device; current?: null; enabled?: boolean }, Notification, boolean]>([
  ['세션 없음', { current: null }, notice({ deliveryTag: TAG }), false],
  ['알림 꺼짐', { enabled: false }, notice({ deliveryTag: TAG }), false],
  [
    '다른 계정의 등록(알림이 꺼져도 A→B 교체로 비운 뒤)',
    { stored: { ...RECEIVING, userId: OTHER } },
    notice({ deliveryTag: TAG }),
    false,
  ],
  ['저장 태그 있음 · 푸시 태그 같음 → 표시', {}, notice({ deliveryTag: TAG }), true],
  ['저장 태그 있음 · 푸시 태그 다름 → 버림', {}, notice({ deliveryTag: 'other-tag' }), false],
  ['저장 태그 있음 · 푸시 태그 없음 → 버림', {}, notice({}), false],
  [
    '저장 태그 없음 → 대조하지 않음(표시)',
    { stored: { userId: USER, ownershipToken: OWN } },
    notice({ deliveryTag: 'other-tag' }),
    true,
  ],
  [
    '태그는 trigger.payload 에서만 읽는다(content.data 무시)',
    {},
    notice({}, { data: { deliveryTag: TAG } }),
    false,
  ],
  [
    '푸시가 아닌 알림(로컬)은 버림',
    {},
    notice({ deliveryTag: TAG }, { type: 'timeInterval' }),
    false,
  ],
])('수신 판정 — %s', async (_case, options, notification, expected) => {
  // 권한 거부·FCM 토큰 없음 — 동기화가 토큰을 받지도 등록하지도 않아 판정만 본다(다른 계정 기록은 교체로 비운다).
  const t = setup({ stored: RECEIVING, permission: 'denied', ...options });
  await settle();

  await expect(t.show(notification)).resolves.toStrictEqual({
    shouldShowBanner: expected,
    shouldShowList: expected,
    shouldPlaySound: expected,
    shouldSetBadge: false,
  });
  t.stop();
});

test('탭은 기록을 읽은 뒤 콜드 스타트 응답을 한 번 열고 지우며, 같은 알림의 중복·기본 동작이 아닌 응답·거른 알림은 열지 않는다', async () => {
  const tapped = notice({ link: 'gromo://friends', deliveryTag: TAG });
  const t = setup({ stored: RECEIVING, permission: 'denied', cold: responseOf(tapped) });
  await settle();
  expect(t.openAppLink).toHaveBeenCalledTimes(1);
  expect(t.openAppLink).toHaveBeenCalledWith('gromo://friends');
  expect(t.notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);

  // 같은 탭이 리스너로도 다시 온다.
  t.tap(responseOf(tapped));
  expect(t.openAppLink).toHaveBeenCalledTimes(1);

  t.tap(responseOf(notice({ link: 'gromo://home', deliveryTag: TAG }, { id: 'n-2' })));
  expect(t.openAppLink).toHaveBeenLastCalledWith('gromo://home');

  t.tap(
    responseOf(
      notice({ link: 'gromo://friends', deliveryTag: TAG }, { id: 'n-3' }),
      'com.apple.UNNotificationDismissActionIdentifier',
    ),
  );
  t.tap(responseOf(notice({ link: 'gromo://friends', deliveryTag: 'other-tag' }, { id: 'n-4' })));
  t.tap(responseOf(notice({ link: 42, deliveryTag: TAG }, { id: 'n-5' })));
  expect(t.openAppLink).toHaveBeenCalledTimes(2);
  t.stop();
});

test.each([
  ['같은 계정이면 한 번 연다', USER, 1],
  ['다른 계정이면 버린다', OTHER, 0],
])(
  '세션을 알기 전에 온 탭은 들고 있다가 세션이 공개되면 한 번 판정한다 — %s',
  async (_case, userId, opens) => {
    const tapped = notice({ link: 'gromo://friends', deliveryTag: TAG });
    const t = setup({
      stored: RECEIVING,
      permission: 'denied',
      current: null,
      cold: responseOf(tapped),
    });
    await settle();
    // 세션을 모르는 동안에는 열지 않고, 같은 탭이 리스너로 다시 와도 들고만 있다(OS 의 마지막 응답은 지운다).
    t.tap(responseOf(tapped));
    expect(t.openAppLink).not.toHaveBeenCalled();
    expect(t.notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);

    t.publish(sessionOf(userId));
    await settle();
    expect(t.openAppLink).toHaveBeenCalledTimes(opens);

    // 판정은 한 번뿐 — 같은 탭이 다시 와도, 세션이 다시 바뀌어도 다시 열지 않는다.
    t.tap(responseOf(tapped));
    t.publish(null);
    t.publish(sessionOf(USER, 'rt-again'));
    await settle();
    expect(t.openAppLink).toHaveBeenCalledTimes(opens);
    t.stop();
  },
);

test('태그 없는 200(V13 전 저장 응답 재생)이면 저장 태그를 지워 이후 푸시를 버리지 않는다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.registerDevice.mockResolvedValueOnce({ ownershipToken: 'replayed-ownership' });
  await settle();

  expect(t.stored()).toStrictEqual({
    userId: USER,
    fcmToken: FCM_2,
    registeredToken: FCM_2,
    ownershipToken: 'replayed-ownership',
  });
  await expect(t.show(notice({}))).resolves.toMatchObject({ shouldShowBanner: true });
  t.stop();
});

test('브리지 오류 — NOT_CONFIGURED 면 이 실행 동안 끄고, INVALID_APNS_TOKEN 이면 그 APNs 토큰으로 다시 묻지 않고, TOKEN_ERROR 면 다음 트리거에 다시 한다', async () => {
  let t = setup();
  t.fcm.getToken.mockRejectedValue(bridgeError('NOT_CONFIGURED'));
  await settle();
  t.foreground();
  t.push.refreshPush();
  await settle();
  expect(t.fcm.getToken).toHaveBeenCalledTimes(1);
  t.stop();

  t = setup();
  t.fcm.getToken.mockRejectedValueOnce(bridgeError('INVALID_APNS_TOKEN'));
  await settle();
  t.foreground();
  await settle();
  expect(t.fcm.getToken).toHaveBeenCalledTimes(1);
  t.apnsChanged(NEW_APNS);
  await settle();
  expect(t.fcm.getToken).toHaveBeenLastCalledWith(NEW_APNS);
  expect(t.registerDevice).toHaveBeenCalledTimes(1);
  t.stop();

  t = setup();
  t.fcm.getToken.mockRejectedValueOnce(bridgeError('TOKEN_ERROR'));
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();
  t.foreground();
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(1);
  t.stop();
});

test('알림 끄기의 deleteToken 이 실패하면 기록을 그대로 두고 다음 트리거에 다시 지운다 — 다시 켜면 남긴 소유권으로 CAS 등록한다', async () => {
  const t = setup({ stored: REGISTERED, enabled: false });
  t.fcm.deleteToken.mockRejectedValueOnce(bridgeError('TOKEN_ERROR'));
  await settle();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.stored()).toStrictEqual(REGISTERED);

  t.foreground();
  await settle();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(2);
  expect(t.stored()).toStrictEqual(TOKEN_DELETED);

  t.switchOn.value = true;
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.push.refreshPush();
  await settle();
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM_2, ownershipToken: OWN },
    expect.stringMatching(KEY),
  );
  t.stop();
});

test('A→B 에서 기록에 FCM 토큰이 없으면(알림 끄기로 이미 지움) deleteToken 없이 표시 알림만 지우고 B 로 등록한다', async () => {
  const t = setup({ stored: REGISTERED, enabled: false });
  await settle();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.stored()).toStrictEqual(TOKEN_DELETED);

  // 빈 저장소의 deleteToken 은 거절될 수 있다 — 불렀다면 B 를 등록하지 못한다.
  t.fcm.deleteToken.mockRejectedValue(bridgeError('TOKEN_ERROR'));
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.switchOn.value = true;
  t.publish(sessionOf(OTHER), 'boot-b');
  await settle();
  expect(t.notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.registerDevice).toHaveBeenCalledWith(
    { deviceToken: FCM_2, deviceBootstrap: 'boot-b' },
    expect.stringMatching(KEY),
  );
  expect(t.stored()).toStrictEqual(registeredWith(FCM_2, OTHER));
  t.stop();
});

test('409 충돌 뒤 deleteToken 이 실패하면 살아 있는 토큰을 기록에 남긴다 — 이후 A→B 는 그 토큰을 지운 뒤에 B 로 등록한다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.registerDevice.mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409));
  t.fcm.deleteToken.mockRejectedValueOnce(bridgeError('TOKEN_ERROR'));
  await settle();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  // 낡은 소유권·태그는 버리고, 못 지운 토큰(지금 Firebase 가 쥔 것)은 남긴다.
  expect(t.stored()).toStrictEqual({ userId: USER, fcmToken: FCM_2 });

  t.fcm.getToken.mockResolvedValue(FCM_3);
  t.publish(sessionOf(OTHER), 'boot-b');
  await settle();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(2);
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM_3, deviceBootstrap: 'boot-b' },
    expect.stringMatching(KEY),
  );
  expect(t.fcm.deleteToken.mock.invocationCallOrder[1]).toBeLessThan(
    t.registerDevice.mock.invocationCallOrder[1],
  );
  t.stop();
});

// FCM 브리지 호출(getToken·deleteToken)의 시간 초과는 아래 두 테스트가 본다 — 앞 호출이 끝나야 다음을 부르므로
// 「영영 안 끝나는」 브리지 호출 뒤에는 다음 브리지 호출도 시작하지 않는다(의도).
test.each<[string, (t: ReturnType<typeof setup>) => jest.Mock]>([
  ['권한 조회', (t) => t.notifications.getPermissionsAsync],
  ['APNs 토큰 조회', (t) => t.notifications.getDevicePushTokenAsync],
])(
  '%s 가 끝나지 않아도 20초 뒤 그 실행만 끝내 직렬 큐를 비우고, 다음 트리거가 다시 한다',
  async (_step, stepOf) => {
    jest.useFakeTimers();
    try {
      const t = setup();
      const step = stepOf(t);
      step.mockImplementationOnce(() => new Promise(() => {}));
      await settle();
      expect(step).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(20_000);
      await settle();
      t.foreground();
      await settle();
      expect(step).toHaveBeenCalledTimes(2);
      t.stop();
    } finally {
      jest.useRealTimers();
    }
  },
);

test('등록이 멈춘 세션(409 두 번)에서도 알림을 끄면 FCM 토큰을 지운다 — 멈춤은 등록만 막는다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValueOnce(FCM_2).mockResolvedValue(FCM_3);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409));
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(2);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.stored()).toStrictEqual({ userId: USER, fcmToken: FCM_3 });

  t.switchOn.value = false;
  t.push.refreshPush();
  await settle();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(2);
  expect(t.stored()).toStrictEqual({ userId: USER });
  expect(t.registerDevice).toHaveBeenCalledTimes(2);
  t.stop();
});

test('받은 토큰·계정의 기록이 디스크에 닿기 전에는 등록(PUT)을 보내지 않고, 409 뒤에도 기록을 쓴 다음에 토큰을 지운다', async () => {
  const t = setup();
  const write = t.secureStore.setItemAsync.getMockImplementation()!;
  const held: (() => void)[] = [];
  const hold = (key: string, value: string) =>
    new Promise<void>((resolve) => {
      held.push(() => {
        write(key, value).then(resolve);
      });
    });
  t.secureStore.setItemAsync.mockImplementationOnce(hold).mockImplementationOnce(hold);
  t.registerDevice.mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409));
  await settle();
  expect(JSON.parse(t.secureStore.setItemAsync.mock.calls[0][1])).toStrictEqual({
    userId: USER,
    fcmToken: FCM,
  });
  expect(t.registerDevice).not.toHaveBeenCalled();

  held.shift()!();
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(1);
  // 409 — 낡은 소유권을 버린 기록을 먼저 쓰고, 그 쓰기가 끝나야 토큰을 지운다.
  expect(t.secureStore.setItemAsync).toHaveBeenCalledTimes(2);
  expect(t.fcm.deleteToken).not.toHaveBeenCalled();

  held.shift()!();
  await settle();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  t.stop();
});

test.each([
  [408, 'REQUEST_TIMEOUT'],
  [429, 'TOO_MANY_REQUESTS'],
])(
  '%i(%s) 는 네트워크·5xx 처럼 묶음을 두고 다음 트리거에 같은 키·같은 본문으로 다시 보낸다',
  async (httpStatus, code) => {
    const t = setup({ stored: REGISTERED });
    t.fcm.getToken.mockResolvedValue(FCM_2);
    t.registerDevice.mockRejectedValueOnce(t.apiError(code, httpStatus));
    await settle();
    t.foreground();
    await settle();

    const [failed, retried] = t.registerDevice.mock.calls;
    expect(failed[0]).toStrictEqual({ deviceToken: FCM_2, ownershipToken: OWN });
    expect(retried).toStrictEqual(failed);
    expect(t.stored()).toStrictEqual(registeredWith(FCM_2));
    t.stop();
  },
);

test('같은 계정이 등록 응답을 기다리는 사이 다시 로그인하면 옛 응답은 버리고, 옛 소유권으로 보낸 등록이 409 면 토큰을 한 번 바꿔 수렴한다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValueOnce(FCM_2).mockResolvedValueOnce(FCM_2).mockResolvedValue(FCM_3);
  let answerFirst!: (value: { ownershipToken: string; deliveryTag: string }) => void;
  t.registerDevice
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
    )
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409));
  await settle();

  // 같은 계정의 새 세션(bootstrap 없음) — 그 사이 서버는 첫 등록을 처리해 소유권을 바꿨다(옛 키의 응답).
  t.publish(sessionOf(USER, 'rt-2'));
  answerFirst({ ownershipToken: 'rotated-ownership', deliveryTag: 'rotated-tag' });
  await settle();

  const calls = t.registerDevice.mock.calls;
  expect(calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM_2, ownershipToken: OWN },
    // 옛 응답을 버려 옛 소유권으로 다시 보낸다 — 서버는 409.
    { deviceToken: FCM_2, ownershipToken: OWN },
    // 토큰을 한 번 바꿔 소유권 없이 보낸다.
    { deviceToken: FCM_3 },
  ]);
  expect(calls[1][1]).not.toBe(calls[0][1]);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  const written = t.secureStore.setItemAsync.mock.calls.map(([, value]) => value);
  expect(written.some((value) => value.includes('rotated-tag'))).toBe(false);
  expect(t.stored()).toStrictEqual(registeredWith(FCM_3));
  t.stop();
});

test('시간 초과로 끝낸 getToken 이 늦게 토큰을 만들 수 있어, 기록에 토큰이 없어도 알림을 끄면 FCM 토큰을 지운다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup();
    let lateToken!: (token: string) => void;
    t.fcm.getToken.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          lateToken = resolve;
        }),
    );
    await settle();
    jest.advanceTimersByTime(20_000);
    await settle();
    // 늦게 끝나 Firebase 에는 토큰이 생겼지만 기록에는 없다.
    lateToken(FCM);
    await settle();
    expect(t.stored()).toBeNull();

    t.switchOn.value = false;
    t.push.refreshPush();
    await settle();
    expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
    expect(t.registerDevice).not.toHaveBeenCalled();
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('시간 초과로 끝낸 deleteToken 이 끝나기 전에는 다음 실행이 getToken 을 부르지 않는다 — 늦게 끝난 삭제가 새 토큰을 지우지 않게', async () => {
  jest.useFakeTimers();
  try {
    const t = setup({ stored: REGISTERED, enabled: false });
    let finishDelete!: () => void;
    t.fcm.deleteToken.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishDelete = () => resolve(undefined);
        }),
    );
    await settle();
    // 이 실행은 20초 뒤 끝나 큐가 빈다 — 다음 트리거의 실행은 돈다.
    jest.advanceTimersByTime(20_000);
    await settle();
    t.switchOn.value = true;
    t.push.refreshPush();
    await settle();
    expect(t.notifications.getPermissionsAsync).toHaveBeenCalled();
    expect(t.fcm.getToken).not.toHaveBeenCalled();

    finishDelete();
    await settle();
    expect(t.fcm.getToken).toHaveBeenCalledTimes(1);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('ApiError 가 아닌 던짐도 네트워크·5xx 처럼 묶음을 두고 다음 트리거에 같은 키·같은 본문으로 다시 보낸다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.registerDevice.mockRejectedValueOnce(new TypeError('Network request failed'));
  await settle();
  t.foreground();
  await settle();

  const [failed, retried] = t.registerDevice.mock.calls;
  expect(failed[0]).toStrictEqual({ deviceToken: FCM_2, ownershipToken: OWN });
  expect(retried).toStrictEqual(failed);
  expect(t.stored()).toStrictEqual(registeredWith(FCM_2));
  t.stop();
});

test('등록 전 기록을 쓰는 사이 알림을 끄면 등록하지 않고, 이어서 그 토큰을 지운다', async () => {
  const t = setup();
  const write = t.secureStore.setItemAsync.getMockImplementation()!;
  let release!: () => void;
  t.secureStore.setItemAsync.mockImplementationOnce(
    (key: string, value: string) =>
      new Promise<void>((resolve) => {
        release = () => {
          write(key, value).then(resolve);
        };
      }),
  );
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();

  // 도는 중에 끈다 — 「한 번 더」로 접혀 이 실행이 끝난 뒤 알림 끄기가 돈다.
  t.switchOn.value = false;
  t.push.refreshPush();
  release();
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  t.stop();
});
