// 소셜 로그인 데이터 층 — 화면(프레젠테이션)에서 분리해 v2/기존 양쪽이 공유한다.
// 로직은 기존 @/screens/LoginScreen 에서 그대로 옮겨온 것(동작 동일).
import axios from 'axios';
import { login } from '@react-native-kakao/user';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  GoogleSignin,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import LineLogin, { LoginPermission } from '@xmartlabs/react-native-line';
import { LoginManager, AccessToken, AuthenticationToken } from 'react-native-fbsdk-next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL, api, getFreshAccessToken, getUserIdFromToken } from '@/services/api';
import { getMyProfile } from '@/services/userApi';
import { logLogin, logSignUp, setIdentityProps, type AuthMethod } from '@/services/analyticsEvents';
import { claimStoredInviteAttribution } from '@/services/deferredInvite';
import { setServerZone } from '@/utils/serverZone';
import type { LoginResult } from '@/types/api';
import { STORAGE_KEYS } from '@/types/storage';

export { statusCodes };
export type { AuthMethod };

// 소셜 로그인 API 응답 (kakao/apple 공통)
interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  isNewUser?: boolean;
  message?: string;
  [key: string]: unknown;
}

// 계정(userId)이 실제로 바뀌는 토큰 교체 직전에 호출되는 훅 — 이전 계정 뒷정리용(App.tsx 등록).
// applyStoredSession 시점엔 새 토큰이 이미 저장된 뒤라, 이전 계정 인증이 필요한 정리(태그 편집 큐
// 폐기·디바이스 토큰 등록 해제)가 늦는다(PR 200/224 리뷰) — 토큰 저장 직전으로 앞당긴다.
// async 핸들러는 완료까지 기다린다 — 새 토큰이 저장되면 이전 계정 API를 더는 부를 수 없어서.
// 이전 계정 access 토큰을 핸들러에 넘긴다 — 공유 api 인스턴스의 401 전역 로그아웃을 피해
// bare 요청에 명시적으로 실어 보내기 위함(PR 226 리뷰).
let accountSwitchHandler: ((prevAccessToken: string) => void | Promise<void>) | null = null;
export function setAccountSwitchHandler(
  handler: (prevAccessToken: string) => void | Promise<void>,
): void {
  accountSwitchHandler = handler;
}

// 게스트→소셜 업그레이드 트리거(GROMO-962) — 저장된 access 토큰이 있으면 소셜 로그인 요청의
// Authorization 헤더로 실어 보낸다. 백엔드는 유효한 게스트 access JWT가 오면 새 User를 만들지 않고
// 게스트 계정을 소셜로 승격해 닉네임·서버 데이터를 보존한다(ticket 585). 비게스트·무효 토큰은
// 서버가 무시하고 기존 로그인 흐름을 타므로 항상 실어도 안전하다.
// 만료·임박 토큰은 갱신을 거친다(getFreshAccessToken) — 만료 토큰을 그대로 보내면 백엔드가
// "토큰 없음"과 동일 취급해 조용히 새 계정을 만들어 버그가 재발한다(코드리뷰 반영).
async function guestUpgradeHeaders(): Promise<{ Authorization: string } | undefined> {
  let token: string | null;
  try {
    token = await getFreshAccessToken();
  } catch {
    // 갱신 실패를 헤더 생략으로 계속하면 일시적 오류(네트워크·서버 5xx)에도 새 계정이 만들어져
    // 게스트 데이터가 영구히 버려진다 — 업그레이드를 중단하고 재시도를 유도한다(코드리뷰 반영).
    // 이 에러는 소셜 함수들의 try 밖(guestUpgradeHeaders 호출 시점)에서 던져져 그대로 화면에 전달된다.
    throw new Error('세션 갱신에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

// 소셜 로그인 실패 응답 → Error. 서버 에러 코드(code)를 함께 실어 화면에서 분기할 수 있게 한다
// (예: 게스트가 이미 연동된 소셜로 업그레이드 시도 → 409 SOCIAL_ACCOUNT_ALREADY_LINKED, GROMO-962).
function toAuthError(e: unknown, fallback: string): Error {
  if (!axios.isAxiosError(e)) {
    return new Error(fallback);
  }
  const body = e.response?.data as { code?: string; message?: string } | undefined;
  const error = new Error(body?.message ?? fallback);
  return body?.code ? Object.assign(error, { code: body.code }) : error;
}

// 토큰 저장 + (기존 유저면) 프로필 병합 — 모든 소셜 로그인 공통 후처리.
async function postAuthSave(data: AuthResponse, isGuest: boolean): Promise<LoginResult> {
  // 다른 계정으로 갈아타는 로그인이면 새 토큰 저장 전에 계정 전환 훅 실행(같은 userId 재로그인은 통과)
  const prevToken = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
  const prevUserId = prevToken ? getUserIdFromToken(prevToken) : null;
  const nextUserId = getUserIdFromToken(data.accessToken);
  if (prevToken && prevUserId && nextUserId && prevUserId !== nextUserId) {
    await accountSwitchHandler?.(prevToken);
  }
  await AsyncStorage.setItem(STORAGE_KEYS.accessToken, data.accessToken);
  await AsyncStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken);

  // 게스트/소셜 구분 플래그 — 로그인 시점의 진실. 서버가 isGuest를 응답에 주면(GROMO-606)
  // 프로필 병합에서 그 값이 우선한다(...profile 이 뒤에 spread).
  let result: LoginResult;
  if (!data.isNewUser) {
    // 병합 실패는 무시 — 프로필 필드만 빠질 뿐 로그인 자체는 진행한다(기존 동작 유지).
    const profile = await getMyProfile().catch(() => ({}));
    result = { isGuest, ...data, ...profile };
  } else {
    result = { isGuest, ...data };
  }
  // 서버 날짜 버킷 존(GROMO-1252) — 로그인 직후 첫 세션도 서버와 같은 축으로 업로드 키를 만든다.
  // 신규 유저(프로필 미조회)면 undefined → 모듈 폴백(Asia/Seoul) 유지, 다음 프로필 조회에서 갱신.
  setServerZone(result.timeZone);
  await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(result));
  // 토큰 저장이 끝난 지금이 **결정론적 결합이 가능한 가장 이른 시점**이다(초대 링크 스펙 §2-3 ③).
  // 소셜 5종·게스트·게스트→소셜 승격이 전부 이 함수로 합류하므로 배선은 여기 한 곳뿐이다.
  // 실패는 서비스가 삼킨다 — 어트리뷰션 때문에 로그인이 막히면 안 된다.
  await claimStoredInviteAttribution();
  return result;
}

export async function kakaoLogin(): Promise<LoginResult> {
  const kakaoToken = await login();
  const headers = await guestUpgradeHeaders();
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(
      `${API_URL}/api/v1/auth/kakao`,
      { token: kakaoToken.accessToken },
      { headers },
    );
    data = res.data;
  } catch (e) {
    throw toAuthError(e, '로그인 실패');
  }
  return postAuthSave(data, false);
}

export async function appleLogin(): Promise<LoginResult> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  const headers = await guestUpgradeHeaders();
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(
      `${API_URL}/api/v1/auth/apple`,
      { identityToken: credential.identityToken },
      { headers },
    );
    data = res.data;
  } catch (e) {
    throw toAuthError(e, 'Apple 로그인 실패');
  }
  return postAuthSave(data, false);
}

// Google 로그인 설정 — 모듈 로드 시 1회 실행.
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  scopes: ['profile', 'email'],
});

export async function googleLogin(): Promise<LoginResult> {
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    throw Object.assign(new Error('Google 로그인 취소'), {
      code: statusCodes.SIGN_IN_CANCELLED,
    });
  }
  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error('Google idToken을 가져오지 못했습니다.');
  }
  const headers = await guestUpgradeHeaders();
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(
      `${API_URL}/api/v1/auth/google`,
      { token: idToken },
      { headers },
    );
    data = res.data;
  } catch (e) {
    throw toAuthError(e, 'Google 로그인 실패');
  }
  return postAuthSave(data, false);
}

// LINE 로그인 설정 — setup()은 login() 전에 1회 호출돼야 한다.
let lineConfigured = false;
async function ensureLineSetup(): Promise<void> {
  if (lineConfigured) return;
  const channelId = process.env.EXPO_PUBLIC_LINE_CHANNEL_ID;
  if (!channelId) {
    throw new Error('LINE Channel ID 미설정 (EXPO_PUBLIC_LINE_CHANNEL_ID)');
  }
  // ⚠️ react-native-line v4 버그: 네이티브 setup()이 resolve()를 호출하지 않아 await 하면 멈춤.
  LineLogin.setup({ channelId }).catch(() => {});
  lineConfigured = true;
}

export async function lineLogin(): Promise<LoginResult> {
  await ensureLineSetup();
  const result = await Promise.race([
    LineLogin.login({ scopes: [LoginPermission.Profile] }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('LINE 로그인 응답 없음 — 채널 iOS 설정(번들 ID) 확인 필요')),
        30000,
      ),
    ),
  ]);
  const accessToken = result.accessToken.accessToken;
  const headers = await guestUpgradeHeaders();
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(
      `${API_URL}/api/v1/auth/line`,
      { token: accessToken },
      { headers },
    );
    data = res.data;
  } catch (e) {
    throw toAuthError(e, 'LINE 로그인 실패');
  }
  return postAuthSave(data, false);
}

export async function facebookLogin(): Promise<LoginResult> {
  // iOS는 Limited Login(ATT 팝업 없음) — access token이 아니라 OIDC id_token을 받는다.
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const result = await LoginManager.logInWithPermissions(
    ['public_profile', 'email'],
    'limited',
    nonce,
  );
  if (result.isCancelled) {
    throw Object.assign(new Error('Facebook 로그인 취소'), { code: 'CANCELLED' });
  }
  const authToken = await AuthenticationToken.getAuthenticationTokenIOS();
  let token: string | undefined = authToken?.authenticationToken;
  if (!token) {
    const accessToken = await AccessToken.getCurrentAccessToken();
    token = accessToken?.accessToken;
  }
  if (!token) {
    throw new Error('Facebook 토큰을 가져오지 못했습니다.');
  }
  const headers = await guestUpgradeHeaders();
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(
      `${API_URL}/api/v1/auth/facebook`,
      { token },
      { headers },
    );
    data = res.data;
  } catch (e) {
    throw toAuthError(e, 'Facebook 로그인 실패');
  }
  return postAuthSave(data, false);
}

// 게스트 로그인 — 소셜 계정 없이 임시 유저 생성(백엔드 POST /auth/guest, 바디 없음).
// isGuest=true 실유저 + JWT 발급 → 진짜 인증 세션이 되어 코인·통계·리그 조회 등이 동작한다.
// (그룹 생성/가입 등 일부는 서버가 403으로 제한.) 매 호출이 새 게스트를 만드므로
// postAuthSave가 토큰을 저장 → 앱 재실행 시 저장된 토큰을 재사용해 같은 게스트를 유지한다.
export async function guestLogin(): Promise<LoginResult> {
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(`${API_URL}/api/v1/auth/guest`);
    data = res.data;
  } catch (e) {
    const msg = axios.isAxiosError(e)
      ? ((e.response?.data as AuthResponse | undefined)?.message ?? '게스트 시작 실패')
      : '게스트 시작 실패';
    throw new Error(msg);
  }
  // 게스트는 항상 신규 → 프로필 병합(GET /users/me) 스킵. isGuest=true 로 태깅.
  return postAuthSave({ ...data, isNewUser: true }, true);
}

// POST /api/v1/auth/logout — 서버 리프레시 토큰 무효화. 로컬 세션 정리는 호출부(App.tsx handleLogout) 담당.
export async function logout(refreshToken: string): Promise<void> {
  await api.post('/api/v1/auth/logout', { refreshToken });
}

// ── 마지막 사용 소셜 provider (GROMO-602) ──
// 재로그인 화면의 '최근 사용' 배지용. 로그아웃해도 유지, 계정 탈퇴 시에만 초기화한다.
// 게스트는 저장하지 않는다(마지막 '소셜'만 대상) — 저장은 trackAuthSuccess(소셜 전용)에서만.
export async function saveLastAuthProvider(method: AuthMethod): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.lastAuthProvider, method);
  } catch {
    // 저장 실패는 무시 — 배지 미표시일 뿐 로그인 흐름엔 영향 없음.
  }
}
export async function getLastAuthProvider(): Promise<AuthMethod | null> {
  try {
    return ((await AsyncStorage.getItem(STORAGE_KEYS.lastAuthProvider)) as AuthMethod) ?? null;
  } catch {
    return null;
  }
}
export async function clearLastAuthProvider(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.lastAuthProvider);
  } catch {
    // 초기화 실패는 무시.
  }
}

// 인증 성공 시 GA4 이벤트 + signup_method 유저속성 기록 + 마지막 provider 저장(GROMO-602).
export function trackAuthSuccess(method: AuthMethod, isNewUser?: boolean): void {
  if (isNewUser) logSignUp(method);
  else logLogin(method);
  setIdentityProps({ is_guest: false, signup_method: method });
  // 재로그인 '최근 사용' 배지용 저장(fire-and-forget) — 게스트는 이 함수를 안 탐.
  saveLastAuthProvider(method).catch(() => {});
}
