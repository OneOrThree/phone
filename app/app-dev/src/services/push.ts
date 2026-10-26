/**
 * iOS 푸시 등록 수명주기와 알림 수신·탭 라우팅(GROMO-2525). 서버 계약은 `api/deviceToken.ts`(PUT·DELETE), 네이티브는
 * 2523 브리지 `FCMTokenModule`(getToken·deleteToken·FCMTokenRefresh).
 *
 * 기록: 보안 저장소 키 하나 `gromo.pushDevice` = `{userId, fcmToken, registeredToken, ownershipToken, deliveryTag}` 를
 * 통째로 쓴다.
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
 * | 409 `SESSION_REVOKED`·`STALE_AUTH_GENERATION`, 401(`USER_INACTIVE` 등), `CLIENT_STALE_SESSION` | 다음 세션까지 등록을 멈춤(알림 끄기·A→B 정리는 계속) |
 * | 네트워크·타임아웃(상태 0)·408·429·5xx(502·503) | 같은 키·같은 본문 묶음을 메모리에 두고 다음 트리거에 다시 보냄(서버가 저장 응답을 재생) |
 * | 409 `IDEMPOTENCY_KEY_CONFLICT` | 그 묶음을 버림 — 다음 트리거에 새 키 |
 * | 브리지 `NOT_CONFIGURED`(plist 없는 빌드) | 이 실행 동안 푸시를 끔 |
 * | 브리지 `INVALID_APNS_TOKEN` | 그 APNs 토큰으로는 다시 부르지 않음(다음 APNs 토큰 이벤트를 기다림) |
 * | 브리지 `TOKEN_ERROR`·APNs 토큰 조회 실패·브리지/OS 호출 20초 초과 | 다음 트리거(앱 활성·설정 변경·토큰 이벤트)에 다시 — 촘촘한 재시도는 없음 |
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

type NotificationsModule = typeof import('expo-notifications');

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
  /** 저장한 ownershipToken·deliveryTag 를 확인받은(등록 성공 응답) FCM 토큰 — 지금 토큰과 다르면 아직 확인 전이다. */
  registeredToken?: string;
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

/**
 * 기록 전체를 한 번에 쓴다(원자 저장). 쓰기를 줄 세워 마지막 메모리 값이 마지막에 남는다. 돌려준 약속은 이 쓰기가
 * 실패하면 거절한다 — 기다리는 곳(등록 전·409)은 그 실행을 끝내고, 기다리지 않는 곳은 `.catch` 로 삼킨다.
 */
function persist(): Promise<void> {
  const done = writes.then(() => SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(device)));
  writes = done.catch(() => {});
  return done;
}

/** 브리지·OS 호출이 끝나지 않으면 직렬 큐가 영영 막힌다 — 이 시간이 지나면 그 실행만 끝내고(던짐) 다음 트리거에 다시 한다. */
const STEP_TIMEOUT_MS = 20_000;
function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('PUSH_STEP_TIMEOUT')), STEP_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** getToken 을 부른 뒤로 지우지 않았다 — 시간 초과로 끝낸 getToken 이 늦게 만든 토큰은 기록에 없어 이것으로 지운다. */
let tokenMayExist = false;
/** 마지막 FCM 브리지 호출(오류는 삼킴). */
let bridgeInflight: Promise<unknown> = Promise.resolve();

/**
 * FCM 브리지 호출은 하나씩 한다 — 시간 초과로 끝낸 deleteToken 이 늦게 끝나며 새 getToken 이 막 받은 토큰을 지우지
 * 않게, 앞 호출이 끝난 뒤에만 시작한다. 앞 호출이 아직 걸려 있으면 이 실행을 끝낸다(다음 트리거에 다시).
 */
async function bridge<T>(call: () => Promise<T>): Promise<T> {
  await within(bridgeInflight);
  const work = call();
  bridgeInflight = work.catch(() => {});
  return within(work);
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

/** 알림을 받을 수 있는 권한인가 — 임시 허용(provisional)도 허용으로 본다. 동기화({@link startPushSync})와 권한 표시가 같은 기준이다. */
const granted = (N: NotificationsModule, permission: NotificationPermissionsStatus) =>
  permission.granted || permission.ios?.status === N.IosAuthorizationStatus.PROVISIONAL;

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
  /** 세션을 알기 전에 온 탭 — 세션이 공개되면 한 번 판정한다(같은 계정이면 열고, 아니면 버린다). */
  let heldResponse: NotificationResponse | undefined;

  // 지금 계정의 지금 등록으로 온 알림만 받는다. 저장 태그가 있으면 푸시 태그가 같아야 하고(다르거나 없으면 버림),
  // 저장 태그가 없으면(서버가 아직 싣지 않음) 대조하지 않는다. 포그라운드 핸들러는 3초 안에 답해야 해서 메모리만 본다.
  const accept = (notification: Notification): boolean => {
    const session = getSession();
    if (!session || !isEnabled() || device.userId !== session.userId) return false;
    return !device.deliveryTag || payloadOf(notification).deliveryTag === device.deliveryTag;
  };

  // 탭(기본 동작)만 연다. 링크는 App 의 딥링크 보관·가드를 그대로 탄다.
  const open = (response: NotificationResponse | null | undefined) => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (handledResponses.has(id)) return;
    // 세션을 아직 모르면(복구 전·로그아웃 뒤 다시 로그인 전) 처리했다고 적지 않고 들고 있다가, 세션이 공개되면 판정한다.
    if (!getSession()) {
      heldResponse = response;
      return;
    }
    handledResponses.add(id);
    const link = payloadOf(response.notification).link;
    if (
      response.actionIdentifier === N.DEFAULT_ACTION_IDENTIFIER &&
      accept(response.notification) &&
      typeof link === 'string'
    )
      openAppLink(link);
  };

  const reconcile = async (): Promise<void> => {
    const session = getSession();
    const generation = sessionGeneration();
    // 정리(알림 끄기의 토큰 지우기·A→B 교체)는 멈춘 세션에서도 한다 — 멈춤(halt)은 등록만 막는다.
    const current = () => !stopped && generation === sessionGeneration();
    const live = () => current() && haltedGeneration !== generation;
    if (disabled || !session || !current()) return;
    if (device.userId && device.userId !== session.userId) {
      // 계정 전환(A→B) — 알림 설정·권한과 상관없이 먼저 한다: 이전 계정의 표시 알림을 지우고 FCM 토큰을 바꾼다. 못
      // 바꾸면(던짐) 등록하지 않고 다음 트리거에 다시 한다 — A 의 토큰을 B 로 올리면 A 앞으로 남은 발송이 B 에게 뜬다.
      // 이 사이 앱이 죽어 자동 초기화가 꺼진 채 남아도 다음 시작의 getToken 이 되돌린다. 기록에 토큰이 없고 getToken 뒤로
      // 이미 지웠으면(알림 끄기·앞선 교체) 부르지 않는다 — 빈 저장소의 deleteToken 은 거절될 수 있어, 그러면 B 를 영영
      // 등록하지 못한다.
      await within(N.dismissAllNotificationsAsync()).catch(() => {});
      if (device.fcmToken || tokenMayExist) {
        await bridge(() => fcm.deleteToken());
        tokenMayExist = false;
      }
      device = {};
      persist().catch(() => {});
      if (!current()) return;
    }
    if (!isEnabled() || !granted(N, await within(N.getPermissionsAsync()))) {
      // 알림 끄기(설정 OFF·권한 거부) — DELETE 가 아니라 FCM 토큰만 폐기한다. 서버는 다음 발송에서 UNREGISTERED 로
      // transport_invalid 만 세우고 소유권을 남기므로, 다시 켜면 새 토큰을 그 소유권(CAS)으로 올린다. 꺼진 동안에는
      // getToken 을 부르지 않는다 — 브리지의 getToken 은 자동 초기화를 다시 켜 토큰을 되살린다.
      // 못 지우면(던짐) 기록을 그대로 둔다 — fcmToken 이 남아 다음 트리거에 다시 지우고, 소유권은 다시 켤 때 CAS 로 쓴다.
      // 기록에 없어도 시간 초과로 끝낸 getToken 이 늦게 토큰을 만들었을 수 있으면(tokenMayExist) 지운다.
      if (!(device.fcmToken || tokenMayExist) || !current()) return;
      await bridge(() => fcm.deleteToken());
      tokenMayExist = false;
      device = { ...device, fcmToken: undefined };
      persist().catch(() => {});
      return;
    }
    if (!live()) return;
    // 이 실행의 APNs 토큰은 처음 한 번 묻고, 바뀌면 토큰 리스너가 알려 준다.
    apnsHex ??= (await within(N.getDevicePushTokenAsync())).data;
    const hex = apnsHex;
    if (!hex || hex === invalidHex || !live()) return;
    let token: string;
    try {
      token = await bridge(() => {
        tokenMayExist = true;
        return fcm.getToken(hex);
      });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === NOT_CONFIGURED) disabled = true;
      if (code === INVALID_APNS_TOKEN) invalidHex = hex;
      return;
    }
    if (!live()) return;
    const sameUser = device.userId === session.userId;
    const deviceBootstrap = bootstrap?.generation === generation ? bootstrap.value : undefined;
    // 같은 계정·같은 토큰이고 그 토큰으로 확인받은 소유권이 있으며 꺼낼 bootstrap 이 없으면 그대로 둔다(머리 주석 — 태그
    // 회전). 응답을 잃은 등록은 확인 토큰이 달라 앱을 다시 시작해도 다시 보낸다.
    const settled =
      sameUser &&
      device.fcmToken === token &&
      device.registeredToken === token &&
      device.ownershipToken;
    if (settled && !deviceBootstrap) return;
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
    // 받은 토큰과 계정은 등록 결과와 따로 먼저 적는다 — 서버가 처리했는데 응답만 잃으면 빈 기록으로는 알림 끄기가 토큰을
    // 지우지 않고(fcmToken 없음) A→B 가 토큰을 바꾸지 않는다(userId 없음). 같은 계정이면 옛 소유권(이미 CAS 본문에
    // 있다)·태그(새 응답이 바꿀 때까지)를 남기되 확인은 지운다 — 같은 토큰을 bootstrap 으로 다시 등록하다 응답을 잃어도
    // 「확인 전」으로 남아, 앱을 다시 시작하면 다시 보낸다.
    if (!sameUser || device.fcmToken !== token || device.registeredToken !== undefined) {
      device = {
        ...(sameUser ? device : {}),
        userId: session.userId,
        fcmToken: token,
        registeredToken: undefined,
      };
    }
    // 디스크에 닿은 뒤에 보낸다 — PUT 이 서버에 닿은 직후 앱이 죽어도 토큰·계정이 남는다. 늘 쓴다: 앞 실행의 쓰기가
    // 실패했으면 메모리만 바뀌어 있어, 조건부로 쓰면 다시 쓰지 않고 보내게 된다. 실패하면(던짐) 이 실행을 끝낸다.
    await within(persist());
    // 보내기 직전에 다시 본다 — 그 사이 세션이 바뀌었거나 알림을 껐으면(곧 지울 토큰) 등록하지 않는다.
    if (!live() || !isEnabled()) return;
    let registered: DeviceRegistration;
    try {
      registered = await registerDevice(body, bundle.key);
    } catch (error) {
      // 네트워크·타임아웃(상태 0)·408·429·5xx·ApiError 가 아닌 던짐은 같은 묶음으로 다음 트리거에 다시 보낸다.
      if (!(error instanceof ApiError)) return;
      const { code, status } = error;
      const transient = (status === 0 && code !== CLIENT_STALE_SESSION) || status === 408;
      if (transient || status === 429 || status >= 500) return;
      pending = undefined;
      if (code === 'IDEMPOTENCY_KEY_CONFLICT') return;
      if (code === 'DEVICE_OWNERSHIP_CONFLICT' && rotatedForConflict !== generation && live()) {
        // ponytail: 서버 `notification.legacy-device-registration:true`(소유권 없는 등록 창)에 기댄다. 그 창이
        // 닫히면 「다시 로그인하면 알림이 켜진다」 안내가 필요하다.
        // 낡은 CAS·태그·쓴 bootstrap 은 버리되, 지금 Firebase 가 쥔 토큰은 실제로 지운 뒤에야 기록에서 뺀다 — 못 지운
        // 토큰을 기록에서 놓치면 이후 A→B 가 지우지 않고 넘어가 그 토큰을 B 로 올린다.
        bootstrap = undefined;
        device = { userId: session.userId, fcmToken: token };
        await within(persist());
        await bridge(() => fcm.deleteToken());
        tokenMayExist = false;
        // 토큰을 실제로 지운 뒤에만 덮어쓴다 — 그 사이 세션이 끝나 남긴 기록을 덮어도 빠지는 것은 지운 토큰뿐이다(의도).
        device = { userId: session.userId };
        persist().catch(() => {});
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
    device = { userId: session.userId, fcmToken: token, registeredToken: token, ...registered };
    persist().catch(() => {});
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
      // 세션을 알기 전에 온 탭은 첫 세션에서 한 번만 판정한다 — 계정 전환(A→B)이 기록을 비우기 전이라 다른 계정이면 버린다.
      const held = heldResponse;
      heldResponse = undefined;
      open(held);
      schedule();
      return;
    }
    // 부팅 직후 첫 null 은 「로그아웃 상태로 시작」이다(키체인을 못 읽어 복구하지 못한 경우 포함) — 지우지 않는다.
    if (first) return;
    // 로그아웃·401·탈퇴 확인으로 세션이 끝났다 — 네트워크 없이 표시 알림을 지우고 CAS·태그를 버린다.
    void N.dismissAllNotificationsAsync().catch(() => {});
    device = { userId: device.userId, fcmToken: device.fcmToken };
    persist().catch(() => {});
  };

  void SecureStore.getItemAsync(DEVICE_KEY).then(
    (stored) => {
      if (stopped) return;
      device = readDevice(stored);
      wake = schedule;
      // 기록을 읽기 전(핸들러가 아직 없을 때) 온 포그라운드 푸시는 띄우지 않는다 — 누구의 알림인지 모를 때는 숨기는 쪽이다.
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

/** 설정 「알림」이 바뀐 뒤 부른다(App 의 설정 effect). 동기화가 돌고 있지 않으면 아무 일도 하지 않는다. */
export function refreshPush(): void {
  wake?.();
}

/**
 * 설정·권한 관리 화면이 보는 알림 권한(GROMO-2526). `unavailable` 은 iOS 가 아니거나 브리지가 없는 바이너리 — 알림 항목을 그리지
 * 않는다. `error` 는 브리지가 있는데 네이티브가 권한을 읽지 못한 것(일시적 실패)이다 — 허용도 «브리지 없음»도 아닌 확인 못 함이다.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable' | 'error';

/** {@link startPushSync} 와 같은 바이너리 판정 — 그 밖에서는 expo-notifications 를 불러오는 자리에서 던지므로 불러오지 않는다. */
function bridgedNotifications(): NotificationsModule | undefined {
  return Platform.OS === 'ios' && NativeModules.FCMTokenModule
    ? (require('expo-notifications') as NotificationsModule)
    : undefined;
}

// iOS 는 최상위 status 를 임시 허용(provisional)에도 undetermined 로 낸다 — 허용 판정을 먼저 본다.
const permissionOf = (
  N: NotificationsModule,
  permission: NotificationPermissionsStatus,
): PushPermission =>
  granted(N, permission)
    ? 'granted'
    : permission.status === 'undetermined'
      ? 'undetermined'
      : 'denied';

/**
 * 지금 알림 권한을 읽는다 — 시스템 팝업은 띄우지 않는다. 브리지가 있는데 읽지 못하면(던지거나 {@link within} 시간 안에 끝나지
 * 않으면) `error`, 브리지가 없으면 `unavailable` 이다.
 */
export async function pushPermissionStatus(): Promise<PushPermission> {
  const N = bridgedNotifications();
  if (!N) return 'unavailable';
  try {
    return permissionOf(N, await within(N.getPermissionsAsync()));
  } catch {
    return 'error';
  }
}

/**
 * 아직 안 물음이면 시스템 팝업으로 묻고 답을 돌려준다(알림·소리만 — 배지는 서버도 앱도 쓰지 않는다). 이미 정해졌으면 묻지
 * 않고 지금 상태를 돌려준다. 물은 뒤에는 동기화를 깨워 새 권한으로 등록하게 한다. 네이티브가 던지거나 상태 읽기가 시간 안에
 * 끝나지 않으면 `error` 다(사용자의 답을 기다리는 팝업 요청에는 시간 제한이 없다).
 * @param shouldAsk 상태를 읽은 직후·팝업 직전에 한 번 본다(아직 안 물음일 때만). 읽는 사이 묻고 싶던 화면을 떠났다면 false 를
 *   돌려 팝업을 막는다 — 그러면 묻지 않고 `undetermined` 를 돌려준다.
 */
export async function requestPushPermission(shouldAsk?: () => boolean): Promise<PushPermission> {
  const N = bridgedNotifications();
  if (!N) return 'unavailable';
  try {
    // 상태 읽기만 시간을 제한한다 — 팝업 요청은 사용자가 답할 때까지 기다려야 하므로 제한하지 않는다.
    const current = permissionOf(N, await within(N.getPermissionsAsync()));
    if (current !== 'undetermined') return current;
    if (shouldAsk && !shouldAsk()) return 'undetermined';
    const answered = permissionOf(
      N,
      await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } }),
    );
    refreshPush();
    return answered;
  } catch {
    return 'error';
  }
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
  persist().catch(() => {});
}
