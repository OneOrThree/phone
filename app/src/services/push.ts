// 서버 푸시(FCM) 권한·토큰·수신·표시·딥링크 처리 (GROMO-393).
// 전송 방식은 FCM: @react-native-firebase/messaging로 FCM 토큰을 받아 서버에 등록하고,
// 서버(392)는 firebase-admin으로 발송한다. iOS는 오는 알림을 표시/라우팅만 담당한다.
import messaging from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import { api } from '@/services/api';
import { navigateToDeepLink } from '@/navigation/navigationRef';
import {
  logNotificationOpened,
  logNotificationPermissionResult,
  type NotificationType,
} from '@/services/analyticsEvents';

// 포그라운드에서도 배너를 띄운다(iOS는 기본적으로 포그라운드 알림을 표시하지 않음).
// SDK 54: shouldShowAlert가 shouldShowBanner/shouldShowList로 분리됨.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const DEVICE_TOKEN_ENDPOINT = '/api/v1/users/me/device-token';

// FCM 토큰을 서버에 등록. 실패해도 앱 흐름은 막지 않는다.
async function putDeviceToken(deviceToken: string): Promise<void> {
  try {
    await api.put(DEVICE_TOKEN_ENDPOINT, { deviceToken });
  } catch {
    // TODO: 등록 실패 재시도 정책(예: 다음 앱 진입 시 재시도). 현재는 조용히 무시.
  }
}

// 서버 payload의 data.link(예: 'gromo://league')에서 딥링크 문자열을 뽑는다.
function linkFromData(data?: Record<string, unknown>): string | null {
  const link = data?.link;
  return typeof link === 'string' ? link : null;
}

// payload의 type/category에서 알림 유형을 뽑는다. 알 수 없으면 null(이벤트 생략).
function notificationTypeFromData(data?: Record<string, unknown>): NotificationType | null {
  const raw = data?.type ?? data?.category;
  return raw === 'poke' || raw === 'report' || raw === 'challenge' ? raw : null;
}

// getInitialNotification은 앱 실행당 1회만 소비 — PushGate가 재로그인(userId 변경)마다 재호출해도
// 캐시된 콜드스타트 딥링크로 재이동하지 않도록 가드한다.
let initialNotificationHandled = false;

// 1) 권한 요청(M3) + FCM 토큰 발급 + 서버 등록. 로그인(토큰 보유) 상태에서만 호출.
export async function registerPushToken(): Promise<string | null> {
  try {
    const status = await messaging().requestPermission();
    const granted =
      status === messaging.AuthorizationStatus.AUTHORIZED ||
      status === messaging.AuthorizationStatus.PROVISIONAL;
    logNotificationPermissionResult({ granted });
    if (!granted) return null; // 거부 시 서버 푸시 스킵(스펙 §2 사전조건)

    const token = await messaging().getToken();
    await putDeviceToken(token);
    return token;
  } catch {
    // 권한 요청·토큰 발급 실패(네이티브 모듈 미준비·GoogleService-Info.plist 부재 등) —
    // 앱 흐름을 막지 않도록 흡수한다.
    return null;
  }
}

// 2) 수신/탭 리스너 등록 → 정리(teardown) 함수 반환.
export function setupPushListeners(): () => void {
  const unsubscribers: Array<() => void> = [];

  // 토큰 갱신 → 재등록
  unsubscribers.push(messaging().onTokenRefresh((token) => putDeviceToken(token)));

  // 포그라운드 수신 → 로컬 알림으로 표시(위 핸들러가 배너 노출)
  unsubscribers.push(
    messaging().onMessage(async (msg) => {
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: msg.notification?.title ?? '',
            body: msg.notification?.body ?? '',
            data: msg.data ?? {},
          },
          trigger: null, // 즉시 발송
        });
      } catch {
        // 로컬 표시 실패는 무시(수신 자체는 유효).
      }
    }),
  );

  // 백그라운드 상태에서 OS 배너 탭 → 딥링크
  unsubscribers.push(
    messaging().onNotificationOpenedApp((msg) => {
      const type = notificationTypeFromData(msg?.data);
      if (type) logNotificationOpened({ type }); // 백그라운드 탭으로 앱 복귀
      const link = linkFromData(msg?.data);
      if (link) navigateToDeepLink(link);
    }),
  );

  // 포그라운드에서 표시한 로컬 알림을 탭 → 딥링크
  const responseSub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const link = linkFromData(resp.notification.request.content.data);
    if (link) navigateToDeepLink(link);
  });
  unsubscribers.push(() => responseSub.remove());

  return () => unsubscribers.forEach((off) => off());
}

// 3) 앱이 완전히 종료된 상태에서 알림 탭으로 실행된 경우 — 진입 시 1회 확인.
export async function handleInitialNotification(): Promise<void> {
  if (initialNotificationHandled) return; // 앱 실행당 1회 — 재로그인 시 캐시 딥링크 재이동 방지
  initialNotificationHandled = true;
  try {
    const msg = await messaging().getInitialNotification();
    const type = notificationTypeFromData(msg?.data);
    if (type) logNotificationOpened({ type }); // 종료 상태에서 탭으로 콜드스타트
    const link = linkFromData(msg?.data);
    if (link) navigateToDeepLink(link);
  } catch {
    // 초기 알림 조회 실패는 무시 — 딥링크가 없을 뿐.
  }
}
