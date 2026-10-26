/**
 * iOS 푸시 등록 수명주기와 알림 수신·탭 라우팅(GROMO-2525). 서버 계약은 `api/deviceToken.ts`(PUT·DELETE), 네이티브는
 * 2523 브리지 `FCMTokenModule`(getToken·deleteToken·FCMTokenRefresh).
 *
 * 기록: 보안 저장소 키 하나 `gromo.pushDevice` = `{userId, fcmToken, ownershipToken, deliveryTag}` 를 통째로 쓴다.
 * 세션 묶음 밖이라 로그아웃·세션 상실 뒤에도 userId·fcmToken 은 남는다 — 다음 로그인이 다른 계정(A≠B)인지 가르는
 * 근거다. ownershipToken 은 CAS 값이라 이 기록에만 두고 AsyncStorage·로그·분석 이벤트에 싣지 않는다.
 *
 * 등록은 세션 공개(세대·userId 로 거른다 — AT 갱신은 재등록 대상이 아니다)·앱 활성·FCM 토큰 갱신·APNs 토큰 변경·
 * {@link refreshPush} 에서 직렬 큐로 맞춘다. 서버가 등록마다 deliveryTag 를 바꾸므로 같은 계정·같은 토큰이면 다시
 * 등록하지 않는다 — 매 실행 재등록하면 알림 센터에 남은 이전 알림을 탭해도 태그가 달라 버려진다.
 *
 * 오류 반응:
 * | 응답 | 반응 |
 * |---|---|
 * | 409 `DEVICE_OWNERSHIP_CONFLICT` | 세션당 한 번 — 표시 알림은 두고 토큰을 바꿔(deleteToken·getToken) 소유권 없이 다시 등록. 두 번째면 다음 세션까지 멈춤 |
 * | 409 `SESSION_REVOKED`·`STALE_AUTH_GENERATION`, 401(`USER_INACTIVE` 등), `CLIENT_STALE_SESSION` | 다음 세션까지 멈춤 |
 * | 네트워크·타임아웃(상태 0)·5xx(502·503) | 같은 키·같은 본문 묶음을 메모리에 두고 다음 트리거에 다시 보냄(서버가 저장 응답을 재생) |
 * | 409 `IDEMPOTENCY_KEY_CONFLICT` | 그 묶음을 버림 — 다음 트리거에 새 키 |
 * | 브리지 `NOT_CONFIGURED`(plist 없는 빌드) | 이 실행 동안 푸시를 끔 |
 * | 브리지 `INVALID_APNS_TOKEN` | 그 APNs 토큰으로는 다시 부르지 않음(다음 APNs 토큰 이벤트를 기다림) |
 * | 브리지 `TOKEN_ERROR`·APNs 토큰 조회 실패 | 다음 트리거(앱 활성·설정 변경·토큰 이벤트)에 다시 — 촘촘한 재시도는 없음 |
 */
import * as SecureStore from 'expo-secure-store';
import type {
  Notification,
  NotificationPermissionsStatus,
  NotificationResponse,
} from 'expo-notifications';
import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { openAppLink } from './appDeepLink';
import { takeDeviceBootstrap } from './api/auth';
import { ApiError, CLIENT_STALE_SESSION, uuid } from './api/client';
import {
  deleteDevice,
  registerDevice,
  type DeviceRegistration,
  type DeviceRegistrationBody,
} from './api/deviceToken';
import { getSession, sessionGeneration, subscribeSession, type Session } from './api/session';

/** 2523 브리지(`ios/Cattus/FCMTokenModule.swift`). 브리지 호출은 겹치지 않게 {@link startPushSync} 의 직렬 큐 안에서만 부른다. */
type FCMTokenBridge = {
  getToken(apnsTokenHex: string): Promise<string>;
  deleteToken(): Promise<void>;
};
/** 브리지 거절 코드 중 따로 다루는 둘. 나머지(`TOKEN_ERROR`)는 다음 트리거에 다시 한다. */
const NOT_CONFIGURED = 'NOT_CONFIGURED';
const INVALID_APNS_TOKEN = 'INVALID_APNS_TOKEN';

const DEVICE_KEY = 'gromo.pushDevice';

type PushDevice = {
  userId?: string;
  fcmToken?: string;
  ownershipToken?: string;
  deliveryTag?: string;
};

let device: PushDevice = {};
/** 응답을 기다리거나 다시 보낼 등록 묶음. 키와 본문(꺼낸 bootstrap 포함)은 한 묶음이고 메모리에만 둔다. */
let pending: { key: string; body: DeviceRegistrationBody } | undefined;
/** 더는 등록하지 않을 세션 세대(멈춤 오류·로그아웃). 세대가 바뀌면 저절로 풀린다. */
let haltedGeneration: number | undefined;
/** 돌고 있는 동기화를 깨운다. 기록을 읽기 전·정리 뒤에는 없다. */
let wake: (() => void) | undefined;
let writes: Promise<unknown> = Promise.resolve();
/** 이 실행에서 처리한 알림 응답 — 같은 탭이 리스너와 콜드 스타트 조회로 두 번 와도 한 번만 연다. */
const handledResponses = new Set<string>();

/** 기록 전체를 한 번에 쓴다(원자 저장). 쓰기를 줄 세워 마지막 메모리 값이 마지막에 남는다. */
function persist(): void {
  writes = writes
    .then(() => SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(device)))
    .catch(() => {});
}

function readDevice(stored: string | null): PushDevice {
  try {
    const value: unknown = stored ? JSON.parse(stored) : null;
    return value && typeof value === 'object' ? (value as PushDevice) : {};
  } catch {
    return {};
  }
}

/**
 * FCM data(`link`·`type`·`eventId`·`deliveryTag`)는 iOS 에서 `trigger.payload`(userInfo 전체)에 있다. `content.data` 는
 * Expo 푸시 서비스 형식 전용이라 FCM 푸시에선 비어 있다 — 그걸 읽으면 판정·라우팅이 조용히 전부 실패한다.
 */
function payloadOf(notification: Notification): Record<string, unknown> {
  const trigger = notification.request.trigger;
  return trigger && 'type' in trigger && trigger.type === 'push' ? (trigger.payload ?? {}) : {};
}

/**
 * App 이 부팅(`loaded`) 뒤 한 번 시작한다. iOS 이고 브리지가 든 바이너리가 아니면 아무것도 하지 않는다 — 그런
 * 바이너리(Android·옛 iOS·웹·Jest)에서 expo-notifications 를 불러오면 네이티브 모듈이 없어 그 자리에서 던진다.
 * @param isEnabled 설정 「알림」 의도. 끄면 FCM 토큰만 폐기하고(서버 행·소유권은 둔다) 포그라운드 표시도 막는다.
 */
export function startPushSync(isEnabled: () => boolean): () => void {
  const fcm: FCMTokenBridge | undefined =
    Platform.OS === 'ios' ? NativeModules.FCMTokenModule : undefined;
  if (!fcm) return () => {};
  const N = require('expo-notifications') as typeof import('expo-notifications');
  const cleanups: (() => void)[] = [];
  let stopped = false;
  let disabled = false;
  let running = false;
  let again = false;
  let apnsHex: string | undefined;
  let invalidHex: string | undefined;
  let observedGeneration = -1;
  let observedUserId: string | undefined;
  /** 세션 공개 직후 꺼낸 1회용 자격 — 그 세대의 첫 등록(과 그 재시도)에만 싣는다. */
  let bootstrap: { generation: number; value: string } | undefined;
  /** 소유권 충돌로 토큰을 이미 한 번 바꾼 세대. */
  let rotatedForConflict: number | undefined;

  // 지금 계정의 지금 등록으로 온 알림만 받는다. 저장 태그가 있으면 푸시 태그가 같아야 하고(다르거나 없으면 버림),
  // 저장 태그가 없으면(서버가 아직 싣지 않음) 대조하지 않는다. 포그라운드 핸들러는 3초 안에 답해야 해서 메모리만 본다.
  const accept = (notification: Notification): boolean => {
    const session = getSession();
    if (!session || !isEnabled() || device.userId !== session.userId) return false;
    return !device.deliveryTag || payloadOf(notification).deliveryTag === device.deliveryTag;
  };

  // 탭(기본 동작)만 연다. 링크는 App 의 딥링크 보관·가드를 그대로 탄다.
  const open = (response: NotificationResponse | null) => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (handledResponses.has(id)) return;
    handledResponses.add(id);
    const link = payloadOf(response.notification).link;
    if (
      response.actionIdentifier === N.DEFAULT_ACTION_IDENTIFIER &&
      accept(response.notification) &&
      typeof link === 'string'
    )
      openAppLink(link);
  };

  const granted = (permission: NotificationPermissionsStatus) =>
    permission.granted || permission.ios?.status === N.IosAuthorizationStatus.PROVISIONAL;

  const reconcile = async (): Promise<void> => {
    const session = getSession();
    const generation = sessionGeneration();
    const live = () =>
      !stopped && generation === sessionGeneration() && haltedGeneration !== generation;
    if (disabled || !session || !live()) return;
    if (!isEnabled() || !granted(await N.getPermissionsAsync())) {
      // 알림 끄기(설정 OFF·권한 거부) — DELETE 가 아니라 FCM 토큰만 폐기한다. 서버는 다음 발송에서 UNREGISTERED 로
      // transport_invalid 만 세우고 소유권을 남기므로, 다시 켜면 새 토큰을 그 소유권(CAS)으로 올린다. 꺼진 동안에는
      // getToken 을 부르지 않는다 — 브리지의 getToken 은 자동 초기화를 다시 켜 토큰을 되살린다.
      // 못 지우면(던짐) 기록을 그대로 둔다 — fcmToken 이 남아 다음 트리거에 다시 지우고, 소유권은 다시 켤 때 CAS 로 쓴다.
      if (!device.fcmToken || !live()) return;
      await fcm.deleteToken();
      device = { ...device, fcmToken: undefined };
      persist();
      return;
    }
    if (!live()) return;
    if (device.userId && device.userId !== session.userId) {
      // 계정 전환(A→B) — 이전 계정의 표시 알림을 지우고 FCM 토큰을 바꾼 뒤에만 등록한다. 못 바꾸면(던짐) 등록하지 않고
      // 다음 트리거에 다시 한다 — A 의 토큰을 B 로 올리면 A 앞으로 남은 발송이 B 에게 뜬다. 이 사이 앱이 죽어 자동
      // 초기화가 꺼진 채 남아도 다음 시작의 getToken 이 되돌린다. 기록에 토큰이 없으면 우리 코드가 이미 지웠다(알림
      // 끄기·앞선 교체) — 빈 저장소의 deleteToken 은 거절될 수 있어 부르지 않는다(그러면 B 를 영영 등록하지 못한다).
      await N.dismissAllNotificationsAsync().catch(() => {});
      if (device.fcmToken) await fcm.deleteToken();
      device = {};
      persist();
      if (!live()) return;
    }
    // 이 실행의 APNs 토큰은 처음 한 번 묻고, 바뀌면 토큰 리스너가 알려 준다.
    apnsHex ??= (await N.getDevicePushTokenAsync()).data;
    const hex = apnsHex;
    if (!hex || hex === invalidHex || !live()) return;
    let token: string;
    try {
      token = await fcm.getToken(hex);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === NOT_CONFIGURED) disabled = true;
      if (code === INVALID_APNS_TOKEN) invalidHex = hex;
      return;
    }
    if (!live()) return;
    const sameUser = device.userId === session.userId;
    const deviceBootstrap = bootstrap?.generation === generation ? bootstrap.value : undefined;
    // 같은 계정·같은 토큰·소유권 있음·꺼낼 bootstrap 없음이면 그대로 둔다(머리 주석 — 태그 회전).
    if (sameUser && device.fcmToken === token && device.ownershipToken && !deviceBootstrap) return;
    const body: DeviceRegistrationBody = {
      deviceToken: token,
      ...(sameUser && device.ownershipToken ? { ownershipToken: device.ownershipToken } : {}),
      ...(deviceBootstrap ? { deviceBootstrap } : {}),
    };
    // 응답이 유실된 등록은 같은 키·같은 본문으로 다시 보내야 서버가 저장 응답을 재생한다 — 본문이 바뀌면 새 키.
    const bundle =
      pending && JSON.stringify(pending.body) === JSON.stringify(body)
        ? pending
        : { key: uuid(), body };
    pending = bundle;
    let registered: DeviceRegistration;
    try {
      registered = await registerDevice(body, bundle.key);
    } catch (error) {
      const { code, status } = error instanceof ApiError ? error : { code: '', status: -1 };
      if ((status === 0 && code !== CLIENT_STALE_SESSION) || status >= 500) return;
      pending = undefined;
      if (code === 'IDEMPOTENCY_KEY_CONFLICT') return;
      if (code === 'DEVICE_OWNERSHIP_CONFLICT' && rotatedForConflict !== generation && live()) {
        // ponytail: 서버 `notification.legacy-device-registration:true`(소유권 없는 등록 창)에 기댄다. 그 창이
        // 닫히면 「다시 로그인하면 알림이 켜진다」 안내가 필요하다.
        // 낡은 CAS·태그·쓴 bootstrap 은 버리되, 지금 Firebase 가 쥔 토큰은 실제로 지운 뒤에야 기록에서 뺀다 — 못 지운
        // 토큰을 기록에서 놓치면 이후 A→B 가 지우지 않고 넘어가 그 토큰을 B 로 올린다.
        bootstrap = undefined;
        device = { userId: session.userId, fcmToken: token };
        persist();
        await fcm.deleteToken();
        device = { userId: session.userId };
        persist();
        rotatedForConflict = generation;
        again = true;
        return;
      }
      haltedGeneration = generation;
      return;
    }
    // 가장 최근에 시작한 등록의 응답만 저장한다. 그 사이 세션이 바뀌거나 로그아웃해 묶음이 버려졌으면 버린다 — 옛 키의
    // 응답(재생 포함)은 그 키가 처음 받은 태그를 싣고 와서, 저장하면 이후 푸시를 전부 버리게 된다.
    if (pending?.key !== bundle.key) return;
    pending = undefined;
    bootstrap = undefined;
    // 응답으로 통째로 덮는다 — 태그 없는 200(V13 전 저장 응답 재생·서버 롤백)이면 저장 태그도 지운다. 남기면 이후
    // 푸시를 전부 버린다.
    device = { userId: session.userId, fcmToken: token, ...registered };
    persist();
  };

  // 브리지 호출은 겹치면 순서가 정해지지 않는다 — 한 번에 하나만 돌리고, 도는 중에 온 트리거는 「한 번 더」로 접는다.
  const schedule = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      do {
        again = false;
        await reconcile().catch(() => {});
      } while (again && !stopped);
      running = false;
    })();
  };

  const onSession = (session: Session | null) => {
    const generation = sessionGeneration();
    // AT 갱신은 같은 세션의 연장이다(세대·userId 그대로) — 다시 등록하지 않는다.
    if (generation === observedGeneration && session?.userId === observedUserId) return;
    const first = observedGeneration < 0;
    observedGeneration = generation;
    observedUserId = session?.userId;
    pending = undefined;
    // bootstrap 은 세션 공개 직후 꺼낸다 — auth.ts 는 꺼내지 않은 값을 최근 4개까지만 두어, 권한 대기·직렬 큐 뒤로
    // 미루면 다른 로그인에 밀려 사라질 수 있다. 꺼낸 값은 저장하지 않는다(메모리·그 등록의 재시도 본문까지만).
    const value = session ? takeDeviceBootstrap(session.refreshToken) : undefined;
    bootstrap = value ? { generation, value } : undefined;
    if (session) {
      schedule();
      return;
    }
    // 부팅 직후 첫 null 은 「로그아웃 상태로 시작」이다(키체인을 못 읽어 복구하지 못한 경우 포함) — 지우지 않는다.
    if (first) return;
    // 로그아웃·401·탈퇴 확인으로 세션이 끝났다 — 네트워크 없이 표시 알림을 지우고 CAS·태그를 버린다.
    void N.dismissAllNotificationsAsync().catch(() => {});
    device = { userId: device.userId, fcmToken: device.fcmToken };
    persist();
  };

  void SecureStore.getItemAsync(DEVICE_KEY).then(
    (stored) => {
      if (stopped) return;
      device = readDevice(stored);
      wake = schedule;
      N.setNotificationHandler({
        handleNotification: async (notification) => {
          const show = accept(notification);
          return {
            shouldShowBanner: show,
            shouldShowList: show,
            shouldPlaySound: show,
            shouldSetBadge: false,
          };
        },
      });
      const responses = N.addNotificationResponseReceivedListener(open);
      const apnsTokens = N.addPushTokenListener(({ data }) => {
        // getDevicePushTokenAsync 도 같은 토큰으로 이 이벤트를 낸다 — 바뀐 토큰일 때만 깨운다(아니면 스스로 깨우는 고리).
        if (data === apnsHex) return;
        apnsHex = data;
        schedule();
      });
      const fcmTokens = new NativeEventEmitter(NativeModules.FCMTokenModule).addListener(
        'FCMTokenRefresh',
        schedule,
      );
      const appState = AppState.addEventListener('change', (next) => {
        if (next === 'active') schedule();
      });
      cleanups.push(
        () => N.setNotificationHandler(null),
        () => responses.remove(),
        () => apnsTokens.remove(),
        () => fcmTokens.remove(),
        () => appState.remove(),
      );
      // 콜드 스타트 탭 — 기록을 읽은 뒤에 판정한다.
      open(N.getLastNotificationResponse());
      N.clearLastNotificationResponse();
      cleanups.push(subscribeSession(onSession));
    },
    () => {
      // 기록을 읽지 못하면(잠긴 키체인 등) 이 실행은 시작하지 않는다 — 빈 기록으로 보면 다른 계정(A≠B) 판정 근거를 잃는다.
    },
  );
  return () => {
    stopped = true;
    if (wake === schedule) wake = undefined;
    cleanups.forEach((cleanup) => cleanup());
  };
}

/** 설정 「알림」 토글 뒤에 부른다(GROMO-2526). 동기화가 돌고 있지 않으면 아무 일도 하지 않는다. */
export function refreshPush(): void {
  wake?.();
}

/**
 * 로그아웃 직전에 부른다(App `signOut` — `logout()` 바로 앞, 탈퇴도 이 경로). 서버의 이 기기 행 삭제를 기다리지 않고
 * 시작한다 — `request()` 는 첫 await 전에 지금 세션의 AT 를 헤더에 싣고, 곧이어 `logout()` 이 세션을 지운다. 실패는
 * 삼킨다: 서버의 세션 폐기(auth.session.revoked)가 이 기기로의 발송을 막고, 이미 지워진 토큰에도 204 다.
 */
export function unregisterPushDevice(): void {
  if (!wake) return;
  const { userId, fcmToken, ownershipToken } = device;
  if (fcmToken) void deleteDevice(fcmToken, ownershipToken, uuid()).catch(() => {});
  device = { userId, fcmToken };
  // 곧 지워질 이 세션으로는 다시 등록하지 않고, 진행 중이던 등록의 응답도 버린다.
  pending = undefined;
  haltedGeneration = sessionGeneration();
  persist();
}
