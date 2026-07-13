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
import { API_URL, api, getUserIdFromToken } from '@/services/api';
import { logLogin, logSignUp, setIdentityProps, type AuthMethod } from '@/services/analyticsEvents';
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
let accountSwitchHandler: (() => void | Promise<void>) | null = null;
export function setAccountSwitchHandler(handler: () => void | Promise<void>): void {
  accountSwitchHandler = handler;
}

// 토큰 저장 + (기존 유저면) 프로필 병합 — 모든 소셜 로그인 공통 후처리.
async function postAuthSave(data: AuthResponse, isGuest: boolean): Promise<LoginResult> {
  // 다른 계정으로 갈아타는 로그인이면 새 토큰 저장 전에 계정 전환 훅 실행(같은 userId 재로그인은 통과)
  const prevToken = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
  const prevUserId = prevToken ? getUserIdFromToken(prevToken) : null;
  const nextUserId = getUserIdFromToken(data.accessToken);
  if (prevUserId && nextUserId && prevUserId !== nextUserId) await accountSwitchHandler?.();
  await AsyncStorage.setItem(STORAGE_KEYS.accessToken, data.accessToken);
  await AsyncStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken);

  // 게스트/소셜 구분 플래그 — 로그인 시점의 진실. 서버가 isGuest를 응답에 주면(GROMO-606)
  // 프로필 병합에서 그 값이 우선한다(...profile 이 뒤에 spread).
  let result: LoginResult;
  if (!data.isNewUser) {
    const profile = await api
      .get<Record<string, unknown>>('/api/v1/users/me')
      .then((profileRes) => profileRes.data)
      .catch(() => ({}) as Record<string, unknown>);
    result = { isGuest, ...data, ...profile };
  } else {
    result = { isGuest, ...data };
  }
  await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(result));
  return result;
}

export async function kakaoLogin(): Promise<LoginResult> {
  const kakaoToken = await login();
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(`${API_URL}/api/v1/auth/kakao`, {
      token: kakaoToken.accessToken,
    });
    data = res.data;
  } catch (e) {
    const msg = axios.isAxiosError(e)
      ? ((e.response?.data as AuthResponse | undefined)?.message ?? '로그인 실패')
      : '로그인 실패';
    throw new Error(msg);
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
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(`${API_URL}/api/v1/auth/apple`, {
      identityToken: credential.identityToken,
    });
    data = res.data;
  } catch (e) {
    const msg = axios.isAxiosError(e)
      ? ((e.response?.data as AuthResponse | undefined)?.message ?? 'Apple 로그인 실패')
      : 'Apple 로그인 실패';
    throw new Error(msg);
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
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(`${API_URL}/api/v1/auth/google`, {
      token: idToken,
    });
    data = res.data;
  } catch (e) {
    const msg = axios.isAxiosError(e)
      ? ((e.response?.data as AuthResponse | undefined)?.message ?? 'Google 로그인 실패')
      : 'Google 로그인 실패';
    throw new Error(msg);
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
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(`${API_URL}/api/v1/auth/line`, {
      token: accessToken,
    });
    data = res.data;
  } catch (e) {
    const msg = axios.isAxiosError(e)
      ? ((e.response?.data as AuthResponse | undefined)?.message ?? 'LINE 로그인 실패')
      : 'LINE 로그인 실패';
    throw new Error(msg);
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
  let data: AuthResponse;
  try {
    const res = await axios.post<AuthResponse>(`${API_URL}/api/v1/auth/facebook`, {
      token,
    });
    data = res.data;
  } catch (e) {
    const msg = axios.isAxiosError(e)
      ? ((e.response?.data as AuthResponse | undefined)?.message ?? 'Facebook 로그인 실패')
      : 'Facebook 로그인 실패';
    throw new Error(msg);
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
