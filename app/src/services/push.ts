// 서버 푸시(FCM) 권한·토큰·수신·표시·딥링크 처리 (GROMO-393).
// 전송 방식은 FCM: @react-native-firebase/messaging로 FCM 토큰을 받아 서버에 등록하고,
// 서버(392)는 firebase-admin으로 발송한다. iOS는 오는 알림을 표시/라우팅만 담당한다.
import messaging, { type FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import { api } from '@/services/api';
import { addToInbox } from '@/services/notificationInbox';
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
  return raw === 'poke' || raw === 'report' || raw === 'challenge' || raw === 'rank_change'
    ? raw
    : null;
}

// payload의 type/category 원문 문자열 — 보관함 분류용(위 분석 이벤트용 판별과 달리 제한 없음).
function rawTypeFromData(data?: Record<string, unknown>): string | null {
  const raw = data?.type ?? data?.category;
  return typeof raw === 'string' ? raw : null;
}

// FCM 발송 시각 정규화 — iOS의 sentTime은 APNs payload의 google.c.a.ts에서 파생돼 문자열이나
// 초 단위로 올 수 있다(PR 226 리뷰). 숫자로 파싱하고, 초 단위(1e12 미만 — ms라면 2001년 이후는
// 항상 그 이상)면 ms로 환산한다. 유효하지 않으면 null.
function normalizeSentTime(sentTime: unknown): number | null {
  const n = typeof sentTime === 'string' ? Number(sentTime) : sentTime;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

// 수신/탭한 푸시를 알림 보관함에 저장 — 알림 화면(GROMO-661)의 데이터 원천.
// messageId로 중복 저장을 막으므로 여러 경로에서 같은 메시지를 만나도 안전하다.
function saveToInbox(msg: FirebaseMessagingTypes.RemoteMessage | null): void {
  if (!msg?.notification) return; // 표시용 payload 없는 메시지(data-only)는 보관하지 않음
  addToInbox({
    id: msg.messageId ?? undefined,
    type: rawTypeFromData(msg.data),
    title: msg.notification.title ?? '',
    body: msg.notification.body ?? '',
    link: linkFromData(msg.data),
    // 백그라운드/종료 상태 알림은 탭 시점에야 코드가 돌아 저장 시각이 '탭한 시각'이 된다 —
    // FCM 발송 시각(sentTime)이 있으면 그걸 수신 시각으로 기록한다(PR 224 리뷰).
    receivedAt: normalizeSentTime(msg.sentTime) ?? undefined,
  });
}

// getInitialNotification은 앱 실행당 1회만 소비 — PushGate가 재로그인(userId 변경)마다 재호출해도
// 캐시된 콜드스타트 딥링크로 재이동하지 않도록 가드한다.
let initialNotificationHandled = false;

// 1) FCM 토큰 발급 + 서버 등록. 로그인(토큰 보유) 상태에서만 호출.
// 알림 권한 요청은 여기가 유일한 지점 — 미결정(NOT_DETERMINED)일 때만 1회 요청해
// 토큰 등록 기회를 주고, 이미 결정된 상태면 상태만 확인한다(중복 프롬프트 없음).
export async function registerPushToken(): Promise<string | null> {
  // E2E(Maestro) 빌드는 권한 요청을 건너뛴다(GROMO-947) — 시스템 알럿이 앱 시작~홈 진입
  // 사이 임의 시점에 떠서 대본을 비결정적으로 깨뜨린다. E2E는 푸시를 검증하지 않는다.
  if (process.env.EXPO_PUBLIC_E2E === '1') return null;
  try {
    let status = await messaging().hasPermission();
    if (status === messaging.AuthorizationStatus.NOT_DETERMINED) {
      status = await messaging().requestPermission();
    }
    const granted =
      status === messaging.AuthorizationStatus.AUTHORIZED ||
      status === messaging.AuthorizationStatus.PROVISIONAL;
    logNotificationPermissionResult({ granted });
    if (!granted) return null; // 권한 없으면 서버 푸시 스킵(스펙 §2 사전조건)

    const token = await messaging().getToken();
    await putDeviceToken(token);
    return token;
  } catch {
    // 토큰 발급 실패(네이티브 모듈 미준비·GoogleService-Info.plist 부재 등) —
    // 앱 흐름을 막지 않도록 흡수한다.
    return null;
  }
}

// 2) 수신/탭 리스너 등록 → 정리(teardown) 함수 반환.
export function setupPushListeners(): () => void {
  const unsubscribers: Array<() => void> = [];

  // 토큰 갱신 → 재등록
  unsubscribers.push(messaging().onTokenRefresh((token) => putDeviceToken(token)));

  // 포그라운드 수신 → 보관함 저장 + 로컬 알림으로 표시(위 핸들러가 배너 노출)
  unsubscribers.push(
    messaging().onMessage(async (msg) => {
      saveToInbox(msg);
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

  // 백그라운드 상태에서 OS 배너 탭 → 보관함 저장 + 딥링크
  // (백그라운드 도착 시엔 앱 코드가 안 돌아 탭으로 복귀하는 지금이 첫 저장 기회)
  unsubscribers.push(
    messaging().onNotificationOpenedApp((msg) => {
      saveToInbox(msg);
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
    saveToInbox(msg);
    const type = notificationTypeFromData(msg?.data);
    if (type) logNotificationOpened({ type }); // 종료 상태에서 탭으로 콜드스타트
    const link = linkFromData(msg?.data);
    if (link) navigateToDeepLink(link);
  } catch {
    // 초기 알림 조회 실패는 무시 — 딥링크가 없을 뿐.
  }
}
