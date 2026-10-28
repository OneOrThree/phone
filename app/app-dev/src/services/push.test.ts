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
type Permission = 'granted' | 'denied' | 'provisional' | 'undetermined';

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
/**
 * 판정·탭 테스트용 — FCM 토큰이 없어 권한 거부 상태의 동기화가 같은 계정의 userId·태그를 건드리지 않는다. 확인 전 기록이라 부팅 복구가
 * 소유권은 지우지만, 수신 판정은 userId·태그만 본다.
 */
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
  answer = 'granted',
  enabled = true,
  cold = null,
}: {
  os?: string;
  bridge?: boolean;
  stored?: Device;
  current?: FakeSession | null;
  bootstrap?: string;
  permission?: Permission;
  /** 아직 안 물음일 때 시스템 팝업에 사용자가 답하는 권한. */
  answer?: Permission;
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
  // 네이티브(ExpoNotificationsPermissionsRequester)와 같은 모양 — 최상위 status 는 허용·거부 말고는 임시 허용도 undetermined 이고,
  // ios.status 는 UNAuthorizationStatus 원본 값이다.
  const permissionSnapshot = () => ({
    status: status === 'granted' || status === 'denied' ? status : 'undetermined',
    granted: status === 'granted',
    ios: { status: { undetermined: 0, denied: 1, granted: 2, provisional: 3 }[status] },
  });
  const notifications = {
    DEFAULT_ACTION_IDENTIFIER: DEFAULT_ACTION,
    IosAuthorizationStatus: { PROVISIONAL: 3 },
    getPermissionsAsync: jest.fn(async () => permissionSnapshot()),
    requestPermissionsAsync: jest.fn(async (_request: object) => {
      status = answer;
      return permissionSnapshot();
    }),
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
    apiError: (code: string, httpStatus: number, retryAfterMs?: number) =>
      new client.ApiError(code, code, httpStatus, { retryAfterMs }),
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
  // 알림을 껐다가(토큰만 지움, 소유권·태그와 그것을 확인받은 토큰은 남김) 다시 켠 기기.
  const t = setup({ stored: TOKEN_DELETED });
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
  await settle();
  t.foreground();
  await settle();

  const [lost, retried] = t.registerDevice.mock.calls;
  expect(lost[0]).toStrictEqual({ deviceToken: FCM, ownershipToken: OWN });
  expect(retried).toStrictEqual(lost);
  t.stop();
});

test('알림을 다시 켠 등록(CAS)의 응답을 잃고 앱이 다시 시작되면 확인 전인 등록을 소유권 없이 다시 보내고, 확인된 기록은 다시 시작해도 건너뛴다', async () => {
  // 알림을 껐다(토큰만 지움) 다시 켠 기기 — 등록 응답을 잃는다.
  let t = setup({ stored: TOKEN_DELETED });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
  await settle();
  const unconfirmed = t.stored()!;
  // 받은 토큰은 적혔고 옛 소유권·태그는 남았지만, 새 토큰으로는 아직 확인받지 않았다.
  expect(unconfirmed).toMatchObject({
    userId: USER,
    fcmToken: FCM_2,
    ownershipToken: OWN,
    deliveryTag: TAG,
  });
  expect(unconfirmed.registeredToken).not.toBe(FCM_2);
  t.stop();

  // 다시 시작 — 메모리의 묶음은 없어도 확인 전이라 다시 보낸다. 마지막 등록이 서버에 닿았는지 모르니 남은 소유권은 믿지 않는다.
  t = setup({ stored: unconfirmed });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  await settle();
  expect(t.registerDevice).toHaveBeenCalledWith({ deviceToken: FCM_2 }, expect.stringMatching(KEY));
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
  t.registerDevice.mockResolvedValueOnce({ ownershipToken: 'own-2', deliveryTag: 'tag-2' });
  t.publish(sessionOf(USER, 'rt-2'), 'boot-2');
  await settle();

  // 공개 순간 확인을 지워 두어도(앱이 죽을 때를 위해) 이번 실행은 그대로 소유권(CAS)과 새 bootstrap 으로 한 번 보낸다.
  expect(t.registerDevice).toHaveBeenCalledTimes(1);
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM, ownershipToken: OWN, deviceBootstrap: 'boot-2' },
    expect.stringMatching(KEY),
  );
  expect(t.fcm.deleteToken).not.toHaveBeenCalled();
  expect(t.notifications.dismissAllNotificationsAsync).not.toHaveBeenCalled();
  // 응답으로 다시 확인받은 기록이다.
  expect(t.stored()).toStrictEqual({
    userId: USER,
    fcmToken: FCM,
    registeredToken: FCM,
    ownershipToken: 'own-2',
    deliveryTag: 'tag-2',
  });
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

test.each([
  ['네트워크', 'CLIENT_NETWORK_ERROR', 0],
  ['408', 'REQUEST_TIMEOUT', 408],
  ['429', 'RATE_LIMITED', 429],
  ['5xx', 'UPSTREAM_UNAVAILABLE', 503],
] as const)(
  '%s 일시 오류는 30초 뒤 같은 키·bootstrap 본문으로 한 번 재시도해 등록한다',
  async (_name, code, status) => {
    jest.useFakeTimers();
    try {
      const t = setup({ bootstrap: 'boot-1' });
      t.registerDevice.mockRejectedValueOnce(t.apiError(code, status));
      await settle();
      expect(t.registerDevice).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(29_999);
      await settle();
      expect(t.registerDevice).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      await settle();
      expect(t.registerDevice.mock.calls[1]).toStrictEqual(t.registerDevice.mock.calls[0]);
      expect(t.registerDevice.mock.calls[1][0]).toStrictEqual({
        deviceToken: FCM,
        deviceBootstrap: 'boot-1',
      });
      expect(t.stored()).toStrictEqual(REGISTERED);
      t.stop();
    } finally {
      jest.useRealTimers();
    }
  },
);

test('30초 재시도도 실패하면 자동 재시도는 끝나고 다음 트리거를 기다린다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup({ bootstrap: 'boot-1' });
    t.registerDevice
      .mockRejectedValueOnce(t.apiError('UPSTREAM_UNAVAILABLE', 503))
      .mockRejectedValueOnce(t.apiError('UPSTREAM_UNAVAILABLE', 503));
    await settle();
    jest.advanceTimersByTime(30_000);
    await settle();
    jest.advanceTimersByTime(120_000);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(2);
    expect(t.registerDevice.mock.calls[1]).toStrictEqual(t.registerDevice.mock.calls[0]);
    t.foreground();
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(3);
    expect(t.registerDevice.mock.calls[2]).toStrictEqual(t.registerDevice.mock.calls[0]);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test.each(['로그아웃', '계정 전환', 'stop'] as const)(
  '%s 하면 대기 중인 자동 재시도를 취소한다',
  async (action) => {
    jest.useFakeTimers();
    try {
      const t = setup({ bootstrap: 'boot-1' });
      t.registerDevice.mockRejectedValueOnce(t.apiError('UPSTREAM_UNAVAILABLE', 503));
      await settle();
      if (action === 'stop') t.stop();
      else
        t.publish(
          action === '로그아웃' ? null : sessionOf(OTHER),
          action === '계정 전환' ? 'boot-b' : undefined,
        );
      await settle();
      const calls = t.registerDevice.mock.calls.length;
      jest.advanceTimersByTime(30_000);
      await settle();
      expect(t.registerDevice).toHaveBeenCalledTimes(calls);
      if (action !== 'stop') t.stop();
    } finally {
      jest.useRealTimers();
    }
  },
);

test('예약 중 앱 복귀가 같은 묶음을 먼저 보내면 타이머가 중복 전송하지 않는다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup({ bootstrap: 'boot-1' });
    t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
    await settle();
    t.foreground();
    await settle();
    expect(t.registerDevice.mock.calls[1]).toStrictEqual(t.registerDevice.mock.calls[0]);
    jest.advanceTimersByTime(30_000);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(2);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('앱 복귀의 토큰 조회 중 재시도 시간이 지나도 실패 뒤 세 번째 PUT 을 보내지 않는다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup({ bootstrap: 'boot-1' });
    t.registerDevice
      .mockRejectedValueOnce(t.apiError('UPSTREAM_UNAVAILABLE', 503))
      .mockRejectedValueOnce(t.apiError('UPSTREAM_UNAVAILABLE', 503));
    await settle();
    let release!: (token: string) => void;
    t.fcm.getToken.mockImplementationOnce(
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    jest.advanceTimersByTime(29_999);
    t.foreground();
    await settle();
    jest.advanceTimersByTime(1);
    await settle();
    release(FCM);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(2);
    expect(t.registerDevice.mock.calls[1]).toStrictEqual(t.registerDevice.mock.calls[0]);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('재시도 시각에 진행 중인 토큰 조회가 PUT 전에 실패해도 예약된 PUT 을 다시 시도한다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup({ bootstrap: 'boot-1' });
    t.registerDevice.mockRejectedValueOnce(t.apiError('UPSTREAM_UNAVAILABLE', 503));
    await settle();
    let failToken!: (error: Error) => void;
    t.fcm.getToken.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failToken = reject;
        }),
    );
    jest.advanceTimersByTime(29_999);
    t.foreground();
    await settle();
    jest.advanceTimersByTime(1);
    await settle();
    failToken(bridgeError('TOKEN_ERROR'));
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(2);
    expect(t.registerDevice.mock.calls[1]).toStrictEqual(t.registerDevice.mock.calls[0]);
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(2);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('유휴 상태의 예약 재시도가 토큰 조회에서 실패하면 즉시 반복하지 않고 30초 뒤 같은 PUT 을 보낸다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup({ bootstrap: 'boot-1' });
    t.registerDevice.mockRejectedValueOnce(t.apiError('UPSTREAM_UNAVAILABLE', 503));
    await settle();
    t.fcm.getToken.mockRejectedValueOnce(bridgeError('TOKEN_ERROR'));
    jest.advanceTimersByTime(30_000);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(1);
    expect(t.fcm.getToken).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(29_999);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await settle();
    expect(t.registerDevice.mock.calls[1]).toStrictEqual(t.registerDevice.mock.calls[0]);
    expect(t.fcm.getToken).toHaveBeenCalledTimes(3);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('예약 재시도 중 영구 브리지 오류는 30초마다 다시 묻지 않는다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup();
    t.registerDevice.mockRejectedValueOnce(t.apiError('UPSTREAM_UNAVAILABLE', 503));
    await settle();
    t.fcm.getToken.mockRejectedValueOnce(bridgeError('NOT_CONFIGURED'));
    jest.advanceTimersByTime(30_000);
    await settle();
    jest.advanceTimersByTime(120_000);
    await settle();
    expect(t.fcm.getToken).toHaveBeenCalledTimes(2);
    expect(t.registerDevice).toHaveBeenCalledTimes(1);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('Retry-After 가 30초보다 길면 그 이후에만 재시도한다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup();
    t.registerDevice.mockRejectedValueOnce(t.apiError('RATE_LIMITED', 429, 45_000));
    await settle();
    jest.advanceTimersByTime(44_999);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await settle();
    expect(t.registerDevice.mock.calls[1]).toStrictEqual(t.registerDevice.mock.calls[0]);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('Retry-After 대기 중 앱 복귀·토큰 이벤트도 같은 묶음을 일찍 재전송하지 않는다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup({ bootstrap: 'boot-1' });
    t.registerDevice.mockRejectedValueOnce(t.apiError('RATE_LIMITED', 429, 45_000));
    await settle();
    jest.advanceTimersByTime(10_000);
    t.foreground();
    await settle();
    t.fcmRefresh(FCM);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(34_999);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await settle();
    expect(t.registerDevice.mock.calls[1]).toStrictEqual(t.registerDevice.mock.calls[0]);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('한 번의 자동 재시도도 429 면 새 Retry-After 동안 수동 재전송을 기다린다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup();
    t.registerDevice
      .mockRejectedValueOnce(t.apiError('RATE_LIMITED', 429, 45_000))
      .mockRejectedValueOnce(t.apiError('RATE_LIMITED', 429, 60_000));
    await settle();
    jest.advanceTimersByTime(45_000);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(30_000);
    t.foreground();
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(30_000);
    t.foreground();
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(3);
    expect(t.registerDevice.mock.calls[2]).toStrictEqual(t.registerDevice.mock.calls[0]);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('409 오류는 자동 재시도 예약을 만들지 않고 기존 충돌 처리만 한다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup();
    t.fcm.getToken.mockResolvedValueOnce(FCM).mockResolvedValue(FCM_2);
    t.registerDevice
      .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
      .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409));
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(120_000);
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(2);
    t.stop();
  } finally {
    jest.useRealTimers();
  }
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

test.each<[string, { stored?: Device; bootstrap?: string }]>([
  [
    'bootstrap 을 실은 등록(새 세션이 직접 거절당한 것)',
    { stored: REGISTERED, bootstrap: 'boot-1' },
  ],
  ['소유권을 싣지 않은 첫 등록(물려받은 연결이 없다)', {}],
])(
  '409 SESSION_REVOKED — %s — 이면 되풀이하지 않고 그 세션에서는 멈추며 다음 세션에서 다시 한다',
  async (_case, options) => {
    const t = setup(options);
    t.registerDevice.mockRejectedValueOnce(t.apiError('SESSION_REVOKED', 409));
    await settle();
    t.foreground();
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(1);
    // 기록의 소유권은 건드리지 않는다.
    expect(t.stored()?.ownershipToken).toBe(options.stored?.ownershipToken);

    t.publish(sessionOf(USER, 'rt-2'));
    await settle();
    expect(t.registerDevice).toHaveBeenCalledTimes(2);
    t.stop();
  },
);

// 부팅 복구(첫 세션)의 기록별 첫 PUT — 확인 전 기록의 소유권은 어느 세션에 묶였는지 믿을 수 없다(마지막 등록이 서버에 닿았는지, bootstrap 은
// 메모리뿐이라 사라졌다). 서버가 옛 세션의 연결을 물려주면 폐기 전에는 200 뒤에 꺼지고 폐기 뒤에는 SESSION_REVOKED 다.
test.each<[string, Device, object[]]>([
  ['확인받은 기록은 그대로 둔다 — 매 실행 다시 등록하지 않는다', REGISTERED, []],
  [
    '확인 전 기록의 소유권은 믿지 않는다 — 소유권 없이 보낸다',
    { userId: USER, fcmToken: FCM, ownershipToken: OWN, deliveryTag: TAG },
    [{ deviceToken: FCM }],
  ],
  [
    '소유권 없는 확인 전 기록은 그대로 소유권 없이 보낸다',
    { userId: USER, fcmToken: FCM, deliveryTag: TAG },
    [{ deviceToken: FCM }],
  ],
])('부팅 복구(첫 세션) — %s', async (_case, stored, sent) => {
  const t = setup({ stored });
  await settle();

  expect(t.fcm.getToken).toHaveBeenCalled();
  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual(sent);
  // 서버가 받아 주면(409 가 아니면) 토큰을 바꾸지 않고, 어느 기록이든 확인받은 기록으로 끝난다.
  expect(t.fcm.deleteToken).not.toHaveBeenCalled();
  expect(t.stored()).toStrictEqual(REGISTERED);
  t.stop();
});

// 위 표의 가운데 줄이 409 를 받는 경우 — 서버 행이 폐기가 아직 전해지지 않은 옛 세션에 묶여 있어 소유권 없는 PUT 은 409 다. 소유권을 실었다면 서버가
// 그 연결을 물려받아 200 을 주고, 폐기가 닿는 순간 행이 꺼진 채 앱은 확인받은 줄 알고 다시 등록하지 않는다.
test('부팅 복구(첫 세션) — 확인 전 기록은 소유권 없이 보내고, 409 면 토큰을 한 번 바꿔 새 소유권·태그로 확인받는다', async () => {
  // 등록 도중 앱이 죽어 소유권·태그만 남은 기록(bootstrap 은 메모리뿐이라 사라졌다).
  const t = setup({
    stored: { userId: USER, fcmToken: FCM, ownershipToken: OWN, deliveryTag: TAG },
  });
  t.fcm.getToken.mockResolvedValueOnce(FCM).mockResolvedValue(FCM_2);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
    .mockResolvedValueOnce({ ownershipToken: 'own-2', deliveryTag: 'tag-2' });
  await settle();

  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM },
    { deviceToken: FCM_2 },
  ]);
  // 토큰은 한 번만, 409 를 받은 뒤 두 번째 PUT 전에 바꾼다.
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  const [firstPut, secondPut] = t.registerDevice.mock.invocationCallOrder;
  expect(t.fcm.deleteToken.mock.invocationCallOrder[0]).toBeGreaterThan(firstPut);
  expect(t.fcm.deleteToken.mock.invocationCallOrder[0]).toBeLessThan(secondPut);
  expect(t.stored()).toStrictEqual({
    userId: USER,
    fcmToken: FCM_2,
    registeredToken: FCM_2,
    ownershipToken: 'own-2',
    deliveryTag: 'tag-2',
  });
  t.stop();
});

test('bootstrap 을 실은 등록이 서버에 닿기 전에 실패하고 앱이 다시 시작돼 bootstrap 이 사라져도 — 확인 전 기록의 소유권을 믿지 않고 소유권 없이 보내, 409 면 토큰을 바꿔 등록한다', async () => {
  let t = setup({ stored: REGISTERED, bootstrap: 'boot-1' });
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
  await settle();
  // 확인 전 기록 — 소유권만 남았고 bootstrap 은 메모리뿐이라 앱이 죽으면 사라진다.
  const unconfirmed = t.stored()!;
  expect(unconfirmed).toStrictEqual({
    userId: USER,
    fcmToken: FCM,
    ownershipToken: OWN,
    deliveryTag: TAG,
  });
  t.stop();

  // 다시 시작 — 소유권을 싣지 않는다. 서버 행은 옛 세션의 연결에 묶여 있어 409, 토큰을 바꿔 현재 세션에 새로 묶는다.
  t = setup({ stored: unconfirmed });
  t.fcm.getToken.mockResolvedValueOnce(FCM).mockResolvedValue(FCM_2);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
    .mockResolvedValueOnce({ ownershipToken: 'own-2', deliveryTag: 'tag-2' });
  await settle();

  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM },
    { deviceToken: FCM_2 },
  ]);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.stored()).toStrictEqual({
    userId: USER,
    fcmToken: FCM_2,
    registeredToken: FCM_2,
    ownershipToken: 'own-2',
    deliveryTag: 'tag-2',
  });
  t.stop();
});

// 409 SESSION_REVOKED 반응 — 부팅의 확인 전 기록은 onSession 이 먼저 거르므로, 소유권(CAS)을 싣는 길은 확인받은 기록으로 토큰을 바꿔 보낼 때다.
test('확인받은 기록의 소유권(CAS)으로 토큰을 바꿔 보내다 409 SESSION_REVOKED 면 소유권·확인을 지우고 한 번 소유권 없이 다시 보내, 409 면 토큰을 바꿔 등록한다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValueOnce(FCM_2).mockResolvedValueOnce(FCM_2).mockResolvedValue(FCM_3);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('SESSION_REVOKED', 409))
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
    .mockResolvedValueOnce({ ownershipToken: 'own-2', deliveryTag: 'tag-2' });
  // 맞춤을 세 번 돈다(소유권 지움 → 409 회전 → 새 토큰) — settle 한 번(100 틱)으로는 모자란다.
  await settle();
  await settle();

  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM_2, ownershipToken: OWN },
    { deviceToken: FCM_2 },
    { deviceToken: FCM_3 },
  ]);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.stored()).toStrictEqual({
    userId: USER,
    fcmToken: FCM_3,
    registeredToken: FCM_3,
    ownershipToken: 'own-2',
    deliveryTag: 'tag-2',
  });
  t.stop();
});

test('SESSION_REVOKED 로 소유권을 지운 뒤의 재시도도 SESSION_REVOKED 면 되풀이하지 않고 멈춘다 — 다음 세션은 소유권 없이 bootstrap 만으로 등록한다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('SESSION_REVOKED', 409))
    .mockRejectedValueOnce(t.apiError('SESSION_REVOKED', 409));
  await settle();
  t.foreground();
  t.fcmRefresh(FCM_2);
  await settle();

  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM_2, ownershipToken: OWN },
    { deviceToken: FCM_2 },
  ]);
  expect(t.stored()).toStrictEqual({ userId: USER, fcmToken: FCM_2, deliveryTag: TAG });

  t.publish(sessionOf(USER, 'rt-2'), 'boot-2');
  await settle();
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM_2, deviceBootstrap: 'boot-2' },
    expect.stringMatching(KEY),
  );
  t.stop();
});

test('SESSION_REVOKED 로 소유권을 지우는 일은 세대당 한 번이다 — 새 소유권을 실은 같은 세대의 요청이 또 SESSION_REVOKED 면 다시 지우지 않고 멈춘다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValueOnce(FCM_2).mockResolvedValueOnce(FCM_2).mockResolvedValue(FCM_3);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('SESSION_REVOKED', 409))
    .mockResolvedValueOnce({ ownershipToken: 'own-2', deliveryTag: 'tag-2' })
    .mockRejectedValueOnce(t.apiError('SESSION_REVOKED', 409));
  await settle();
  // 소유권 없이 다시 보낸 둘째는 받아 줬다 — 같은 세대에서 FCM 토큰이 바뀌어 새 소유권(CAS)을 싣는 셋째가 또 거절당한다.
  t.fcmRefresh(FCM_3);
  await settle();
  t.foreground();
  t.fcmRefresh(FCM_3);
  await settle();

  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM_2, ownershipToken: OWN },
    { deviceToken: FCM_2 },
    { deviceToken: FCM_3, ownershipToken: 'own-2' },
  ]);
  t.stop();
});

test('SESSION_REVOKED 로 지운 소유권은 바로 저장한다 — 다시 보내기 전에 FCM 토큰을 못 받아도 기록에 옛 소유권이 남지 않는다', async () => {
  const t = setup({ stored: REGISTERED });
  t.fcm.getToken.mockResolvedValueOnce(FCM_2).mockRejectedValue(bridgeError('TOKEN_ERROR'));
  t.registerDevice.mockRejectedValueOnce(t.apiError('SESSION_REVOKED', 409));
  await settle();

  expect(t.registerDevice).toHaveBeenCalledTimes(1);
  // 다시 보내는 맞춤은 토큰을 못 받아 아무것도 쓰지 못했다 — 이 기록은 지운 직후의 저장이다.
  expect(t.stored()).toStrictEqual({ userId: USER, fcmToken: FCM_2, deliveryTag: TAG });
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

test('같은 계정이 등록 응답을 기다리는 사이 다시 로그인하면 옛 응답은 버리고, 소유권 없이 다시 보낸 등록이 409 면 토큰을 한 번 바꿔 수렴한다', async () => {
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
    // 옛 응답을 버려 다시 보낸다 — 재생된 로그인(bootstrap 없는 같은 계정의 새 세션)이 공개 순간 옛 소유권을 지웠으니 싣지 않고, 서버는 409.
    { deviceToken: FCM_2 },
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

// ── 알림 권한 조회·요청(GROMO-2526) ──

test('브리지 없는 바이너리(Android·브리지 없는 iOS)에서는 권한 조회·요청이 unavailable 이고 expo-notifications 를 불러오지 않는다', async () => {
  for (const options of [{ os: 'android' }, { bridge: false }]) {
    const t = setup(options);
    await settle();

    await expect(t.push.pushPermissionStatus()).resolves.toBe('unavailable');
    await expect(t.push.requestPushPermission()).resolves.toBe('unavailable');
    await settle();
    expect(t.loadNotifications).not.toHaveBeenCalled();
    t.stop();
  }
});

test.each([
  ['granted', 'granted'],
  // 임시 허용은 최상위 status 가 undetermined 로 오지만 동기화와 같은 기준으로 허용이다.
  ['provisional', 'granted'],
  ['denied', 'denied'],
  ['undetermined', 'undetermined'],
] as const)(
  '권한 조회 — %s 는 %s 이고 시스템 팝업을 띄우지 않는다',
  async (permission, expected) => {
    const t = setup({ permission });
    await settle();

    await expect(t.push.pushPermissionStatus()).resolves.toBe(expected);
    expect(t.notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    t.stop();
  },
);

test('아직 안 물음이면 알림·소리만 시스템 팝업으로 묻고 답을 돌려주며, 끝나면 동기화를 깨워 새 권한으로 등록한다', async () => {
  const t = setup({ permission: 'undetermined', answer: 'granted' });
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();

  await expect(t.push.requestPushPermission()).resolves.toBe('granted');
  expect(t.notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  // 배지는 묻지 않는다 — 서버도 앱도 배지를 쓰지 않는다.
  expect(t.notifications.requestPermissionsAsync).toHaveBeenCalledWith({
    ios: { allowAlert: true, allowSound: true },
  });
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(1);
  t.stop();
});

test('묻기 직전 shouldAsk 가 false 면(읽는 사이 조건이 사라졌다) 팝업 없이 undetermined 를 돌려주고, true 면 묻는다', async () => {
  const t = setup({ permission: 'undetermined', answer: 'granted' });
  await settle();
  const shouldAsk = jest.fn(() => false);
  const readsBefore = t.notifications.getPermissionsAsync.mock.calls.length;

  await expect(t.push.requestPushPermission(shouldAsk)).resolves.toBe('undetermined');
  expect(t.notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  // 상태를 읽은 뒤에 본다.
  expect(t.notifications.getPermissionsAsync).toHaveBeenCalledTimes(readsBefore + 1);
  expect(shouldAsk).toHaveBeenCalledTimes(1);
  const reads = t.notifications.getPermissionsAsync.mock.invocationCallOrder;
  expect(reads[reads.length - 1]).toBeLessThan(shouldAsk.mock.invocationCallOrder[0]);
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();

  shouldAsk.mockReturnValue(true);
  await expect(t.push.requestPushPermission(shouldAsk)).resolves.toBe('granted');
  expect(t.notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  t.stop();
});

test.each([
  ['granted', 'granted'],
  ['provisional', 'granted'],
  ['denied', 'denied'],
] as const)(
  '이미 정해졌으면(%s) shouldAsk 를 보지 않고 지금 상태 %s 를 돌려준다',
  async (permission, expected) => {
    const t = setup({ permission });
    await settle();
    const shouldAsk = jest.fn(() => false);

    await expect(t.push.requestPushPermission(shouldAsk)).resolves.toBe(expected);
    expect(shouldAsk).not.toHaveBeenCalled();
    t.stop();
  },
);

test('권한 상태 읽기가 끝나지 않으면 20초 뒤 error 로 끝난다 — 첫 홈 팝업·설정 화면의 읽기가 영영 걸려 있지 않게, 팝업은 띄우지 않는다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup({ permission: 'undetermined', answer: 'granted' });
    await settle();
    // 네이티브가 영영 답하지 않는다.
    t.notifications.getPermissionsAsync.mockImplementation(() => new Promise(() => {}));
    let statusDone = false;
    let requestDone = false;
    const status = t.push.pushPermissionStatus().finally(() => {
      statusDone = true;
    });
    const request = t.push.requestPushPermission().finally(() => {
      requestDone = true;
    });

    jest.advanceTimersByTime(19_999);
    await settle();
    expect(statusDone).toBe(false);
    expect(requestDone).toBe(false);

    jest.advanceTimersByTime(1);
    await settle();
    expect(statusDone).toBe(true);
    expect(requestDone).toBe(true);
    await expect(status).resolves.toBe('error');
    await expect(request).resolves.toBe('error');
    expect(t.notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('시스템 팝업 요청은 사용자가 답할 때까지 시간 제한 없이 기다린다 — 20초를 훌쩍 넘겨도 error 가 아니다', async () => {
  jest.useFakeTimers();
  try {
    const t = setup({ permission: 'undetermined', answer: 'granted' });
    await settle();
    // 팝업이 떠 있고 사용자가 아직 답하지 않았다.
    let answer!: () => void;
    const gate = new Promise<void>((done) => {
      answer = done;
    });
    const original = t.notifications.requestPermissionsAsync.getMockImplementation()!;
    t.notifications.requestPermissionsAsync.mockImplementationOnce(async (request: object) => {
      await gate;
      return original(request);
    });
    let done = false;
    const request = t.push.requestPushPermission().finally(() => {
      done = true;
    });
    await settle();
    expect(t.notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(120_000);
    await settle();
    expect(done).toBe(false);

    answer();
    await settle();
    await expect(request).resolves.toBe('granted');
    t.stop();
  } finally {
    jest.useRealTimers();
  }
});

test('사용자가 팝업에서 거부하면 denied 를 돌려주고 등록하지 않는다', async () => {
  const t = setup({ permission: 'undetermined', answer: 'denied' });
  await settle();

  await expect(t.push.requestPushPermission()).resolves.toBe('denied');
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();
  t.stop();
});

test.each([
  ['granted', 'granted'],
  ['provisional', 'granted'],
  ['denied', 'denied'],
] as const)(
  '이미 정해졌으면(%s) 팝업 없이 지금 상태 %s 를 돌려준다',
  async (permission, expected) => {
    const t = setup({ permission });
    await settle();

    await expect(t.push.requestPushPermission()).resolves.toBe(expected);
    expect(t.notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    t.stop();
  },
);

test('브리지가 있는데 권한을 읽거나 요청하다 네이티브가 던지면 error(확인 못 함)이고 — 브리지 없음 unavailable 과 다르다 — 동기화를 깨우지 않는다', async () => {
  const t = setup({ permission: 'undetermined', answer: 'granted' });
  await settle();

  t.notifications.getPermissionsAsync.mockRejectedValueOnce(new Error('native'));
  await expect(t.push.pushPermissionStatus()).resolves.toBe('error');
  t.notifications.getPermissionsAsync.mockRejectedValueOnce(new Error('native'));
  await expect(t.push.requestPushPermission()).resolves.toBe('error');
  t.notifications.requestPermissionsAsync.mockRejectedValueOnce(new Error('native'));
  await expect(t.push.requestPushPermission()).resolves.toBe('error');
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();
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

test('등록 전 기록 쓰기가 실패하면 등록하지 않고, 다음 트리거에 기록부터 다시 쓴 뒤 보낸다', async () => {
  const t = setup();
  t.secureStore.setItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();
  expect(t.stored()).toBeNull();

  t.foreground();
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(1);
  // 다시 쓴 기록이 디스크에 닿은 뒤에 보냈다.
  expect(JSON.parse(t.secureStore.setItemAsync.mock.calls[1][1])).toStrictEqual({
    userId: USER,
    fcmToken: FCM,
  });
  expect(t.secureStore.setItemAsync.mock.invocationCallOrder[1]).toBeLessThan(
    t.registerDevice.mock.invocationCallOrder[0],
  );
  expect(t.stored()).toStrictEqual(REGISTERED);
  t.stop();
});

test('같은 계정·같은 토큰을 새 세션의 bootstrap 으로 다시 등록하다 응답을 잃으면, 확인을 지워 두어 다시 시작해도 다시 보낸다', async () => {
  let t = setup({ stored: REGISTERED });
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();

  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
  t.publish(sessionOf(USER, 'rt-2'), 'boot-2');
  await settle();
  expect(t.registerDevice).toHaveBeenCalledWith(
    { deviceToken: FCM, ownershipToken: OWN, deviceBootstrap: 'boot-2' },
    expect.stringMatching(KEY),
  );
  // 서버가 처리했다면 소유권·태그가 바뀌었을 수 있다 — 보내기 전에 확인을 지웠다.
  const unconfirmed = t.stored()!;
  expect(unconfirmed).toStrictEqual({
    userId: USER,
    fcmToken: FCM,
    ownershipToken: OWN,
    deliveryTag: TAG,
  });
  t.stop();

  // 다시 시작 — bootstrap 은 사라졌고 확인 전이라 건너뛰지 않고 다시 보낸다. 소유권이 어느 세션에 묶였는지 모르니 싣지 않는다.
  t = setup({ stored: unconfirmed });
  await settle();
  expect(t.registerDevice).toHaveBeenCalledWith({ deviceToken: FCM }, expect.stringMatching(KEY));
  expect(t.stored()).toStrictEqual(REGISTERED);
  t.stop();
});

test('같은 계정의 새 세션이 bootstrap 과 함께 공개된 뒤 등록하기 전에 앱이 죽어도 — 확인을 지워 두어, 다시 시작하면 소유권 없이 보내 409 면 토큰을 바꿔 새로 묶는다', async () => {
  let t = setup({ stored: REGISTERED });
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();

  // 새 세션(s2)이 bootstrap 을 들고 공개되는데 FCM 토큰을 받지 못해 PUT 전에 끝난다 — 서버 행은 아직 옛 세션(s1)에 묶여 있고, 이때 앱이 죽는다.
  t.fcm.getToken.mockRejectedValue(bridgeError('TOKEN_ERROR'));
  t.publish(sessionOf(USER, 'rt-2'), 'boot-2');
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();
  // 확인만 지웠다 — 소유권·태그는 이번 실행의 CAS + bootstrap 이 쓰려고 남긴다.
  const published = t.stored()!;
  expect(published).toStrictEqual({
    userId: USER,
    fcmToken: FCM,
    ownershipToken: OWN,
    deliveryTag: TAG,
  });
  t.stop();

  // 다시 시작 — bootstrap 은 사라졌고 확인 전 기록이라 소유권을 믿지 않는다. 폐기가 아직 전해지지 않은 옛 세션에 묶인 행이라 409, 토큰을 바꿔 새로 묶는다.
  t = setup({ stored: published });
  t.fcm.getToken.mockResolvedValueOnce(FCM).mockResolvedValue(FCM_2);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
    .mockResolvedValueOnce({ ownershipToken: 'own-2', deliveryTag: 'tag-2' });
  await settle();

  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM },
    { deviceToken: FCM_2 },
  ]);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.stored()).toStrictEqual({
    userId: USER,
    fcmToken: FCM_2,
    registeredToken: FCM_2,
    ownershipToken: 'own-2',
    deliveryTag: 'tag-2',
  });
  t.stop();
});

test('legacy 창이 닫히면 응답 유실 뒤 재시작마다 토큰을 한 번 바꾸고 멈추며 새 bootstrap 로그인으로 복구한다', async () => {
  // 첫 등록은 서버에 닿았지만 응답만 유실됐다.
  let t = setup({ bootstrap: 'boot-1' });
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
  await settle();
  const lost = t.stored()!;
  expect(lost).toStrictEqual({ userId: USER, fcmToken: FCM });
  t.stop();

  // 창이 닫히면 bootstrap 없는 PUT 과 교체 뒤 새 토큰 PUT 이 모두 409 다.
  t = setup({ stored: lost });
  t.fcm.getToken.mockResolvedValueOnce(FCM).mockResolvedValue(FCM_2);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409));
  await settle();
  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM },
    { deviceToken: FCM_2 },
  ]);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  t.foreground();
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(2);
  const halted = t.stored()!;
  expect(halted).toStrictEqual({ userId: USER, fcmToken: FCM_2 });
  t.stop();

  // 다음 실행에도 같은 비용을 치른다.
  t = setup({ stored: halted });
  t.fcm.getToken.mockResolvedValueOnce(FCM_2).mockResolvedValue(FCM_3);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409));
  await settle();
  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM_2 },
    { deviceToken: FCM_3 },
  ]);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);

  // 새 세션의 bootstrap 은 창과 관계없이 등록된다.
  t.publish(sessionOf(USER, 'rt-2'), 'boot-2');
  await settle();
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM_3, deviceBootstrap: 'boot-2' },
    expect.stringMatching(KEY),
  );
  expect(t.stored()).toStrictEqual(registeredWith(FCM_3));
  t.stop();
});

// ── 재생된 로그인 — 같은 계정의 새 세션이 bootstrap 없이 공개된 경우(응답을 잃은 로그인·전환을 같은 attemptId 로 다시 한 것) ──
// 서버 행은 옛 세션의 bootstrap 에 묶여 있어 기록의 소유권(CAS)을 실으면 그 연결을 물려받는다. 공개 순간 기록의 소유권·확인을
// 지워 저장하고(로그아웃 갈래와 같다), 소유권 없이 보내 409 를 받으면 토큰을 바꿔 새로 묶는다.

test('같은 계정의 새 세션이 bootstrap 없이 공개되면 소유권 없이 보내고, 409 면 토큰을 바꿔 소유권 없이 다시 등록해 새 소유권·태그를 기록한다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();
  // 부팅 복구(첫 세션)는 건너뛴다.
  expect(t.registerDevice).not.toHaveBeenCalled();

  // 서버: 옛 세션에 묶인 행에 소유권 없는 PUT 이 오면 409, 토큰을 바꿔 다시 오면 레거시 창으로 새로 묶는다.
  t.fcm.getToken.mockResolvedValueOnce(FCM).mockResolvedValue(FCM_2);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
    .mockResolvedValueOnce({ ownershipToken: 'own-2', deliveryTag: 'tag-2' });
  t.publish(sessionOf(USER, 'rt-2'));
  await settle();

  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM },
    { deviceToken: FCM_2 },
  ]);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.stored()).toStrictEqual({
    userId: USER,
    fcmToken: FCM_2,
    registeredToken: FCM_2,
    ownershipToken: 'own-2',
    deliveryTag: 'tag-2',
  });

  // 새로 확인받은 기록이다 — 앱 복귀·AT 갱신·같은 토큰 이벤트로는 다시 보내지 않는다.
  t.foreground();
  t.refreshAccessToken();
  t.fcmRefresh(FCM_2);
  await settle();
  expect(t.registerDevice).toHaveBeenCalledTimes(2);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  t.stop();
});

test('재생된 로그인의 첫 PUT 이 일시적으로 실패하면 다음 트리거에 같은 소유권 없는 본문·같은 키로 다시 보낸다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
  t.publish(sessionOf(USER, 'rt-2'));
  await settle();
  // 공개 순간 기록의 옛 소유권·확인을 지웠다(태그는 새 응답이 바꿀 때까지 둔다).
  expect(t.stored()).toStrictEqual({ userId: USER, fcmToken: FCM, deliveryTag: TAG });
  t.foreground();
  await settle();

  const [failed, retried] = t.registerDevice.mock.calls;
  expect(failed[0]).toStrictEqual({ deviceToken: FCM });
  expect(retried).toStrictEqual(failed);
  // 재시도가 확인을 받으면 새 응답으로 덮는다.
  expect(t.stored()).toStrictEqual(REGISTERED);
  t.stop();
});

test('재생된 로그인 직후 앱이 죽어도(첫 맞춤이 기록을 쓰기 전) 다시 시작하면 옛 소유권을 싣지 않는다 — 소유권 없이 보내 409 면 토큰을 바꿔 등록한다', async () => {
  let t = setup({ stored: REGISTERED });
  await settle();
  t.publish(sessionOf(USER, 'rt-2'));
  t.stop();
  await settle();
  // 맞춤은 아무것도 쓰기 전에 끝났다 — 이 기록은 공개 순간의 쓰기뿐이다.
  expect(t.registerDevice).not.toHaveBeenCalled();
  const detected = t.stored()!;
  expect(detected).toStrictEqual({ userId: USER, fcmToken: FCM, deliveryTag: TAG });

  // 다시 시작 — 첫 세션 복구라 표시는 없고, 같은 토큰·소유권 없는 기록만 남았다. 서버 행은 아직 옛 세션에 묶여 409.
  t = setup({ stored: detected });
  t.fcm.getToken.mockResolvedValueOnce(FCM).mockResolvedValue(FCM_2);
  t.registerDevice
    .mockRejectedValueOnce(t.apiError('DEVICE_OWNERSHIP_CONFLICT', 409))
    .mockResolvedValueOnce({ ownershipToken: 'own-2', deliveryTag: 'tag-2' });
  await settle();

  expect(t.registerDevice.mock.calls.map(([body]) => body)).toStrictEqual([
    { deviceToken: FCM },
    { deviceToken: FCM_2 },
  ]);
  expect(t.fcm.deleteToken).toHaveBeenCalledTimes(1);
  expect(t.stored()).toStrictEqual({
    userId: USER,
    fcmToken: FCM_2,
    registeredToken: FCM_2,
    ownershipToken: 'own-2',
    deliveryTag: 'tag-2',
  });
  t.stop();
});

test('알림이 꺼진 채 재생된 로그인이 오고 앱이 다시 시작돼도, 켜면 옛 소유권(CAS)이 아니라 소유권 없이 등록한다', async () => {
  // 알림을 끈 기기 — 토큰만 지우고 소유권·태그·확인은 남았다. 꺼져 있어 맞춤은 아무것도 쓰지 않는다.
  let t = setup({ stored: TOKEN_DELETED, enabled: false });
  await settle();
  t.publish(sessionOf(USER, 'rt-2'));
  await settle();
  expect(t.registerDevice).not.toHaveBeenCalled();
  const detected = t.stored()!;
  expect(detected).toStrictEqual({ userId: USER, deliveryTag: TAG });
  t.stop();

  // 다시 시작해 켠다 — 옛 소유권이 남았다면 CAS 로 옛 세션의 연결을 물려받는다.
  t = setup({ stored: detected, enabled: false });
  await settle();
  t.fcm.getToken.mockResolvedValue(FCM_2);
  t.switchOn.value = true;
  t.push.refreshPush();
  await settle();

  expect(t.registerDevice).toHaveBeenCalledTimes(1);
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM_2 },
    expect.stringMatching(KEY),
  );
  expect(t.stored()).toStrictEqual(registeredWith(FCM_2));
  t.stop();
});

test('부팅 복구(첫 세션)는 bootstrap 이 없어도 재생된 로그인이 아니다 — 확인받은 기록이면 매 실행 다시 등록하지 않는다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();

  expect(t.fcm.getToken).toHaveBeenCalled();
  expect(t.registerDevice).not.toHaveBeenCalled();
  expect(t.fcm.deleteToken).not.toHaveBeenCalled();
  expect(t.stored()).toStrictEqual(REGISTERED);
  t.stop();
});

test('같은 세대의 AT 갱신은 재생된 로그인이 아니다 — 갱신 뒤 다른 트리거가 와도 다시 등록하지 않는다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();
  t.refreshAccessToken();
  t.foreground();
  await settle();

  expect(t.registerDevice).not.toHaveBeenCalled();
  expect(t.fcm.deleteToken).not.toHaveBeenCalled();
  expect(t.stored()).toStrictEqual(REGISTERED);
  t.stop();
});

// bootstrap 을 든 같은 계정의 새 세션(s1→s2)은 위의 「같은 계정의 새 세션(s1→s2)…」 테스트가 고정한다 — 소유권(CAS)과 bootstrap 을 싣는다.
test('재생된 로그인 뒤 bootstrap 을 든 새 세션이 오면 소유권 없이 bootstrap 만으로 등록한다 — 서버는 새 자격(freshBootstrap)이면 소유권 없이 받는다', async () => {
  const t = setup({ stored: REGISTERED });
  await settle();
  t.registerDevice.mockRejectedValueOnce(t.apiError('CLIENT_NETWORK_ERROR', 0));
  t.publish(sessionOf(USER, 'rt-2'));
  await settle();
  t.publish(sessionOf(USER, 'rt-3'), 'boot-3');
  await settle();

  expect(t.registerDevice).toHaveBeenCalledTimes(2);
  expect(t.registerDevice).toHaveBeenLastCalledWith(
    { deviceToken: FCM, deviceBootstrap: 'boot-3' },
    expect.stringMatching(KEY),
  );
  expect(t.fcm.deleteToken).not.toHaveBeenCalled();
  t.stop();
});
