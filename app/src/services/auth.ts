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
import { API_URL, api } from '@/services/api';
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

// 토큰 저장 + (기존 유저면) 프로필 병합 — 모든 소셜 로그인 공통 후처리.
async function postAuthSave(data: AuthResponse): Promise<LoginResult> {
  await AsyncStorage.setItem(STORAGE_KEYS.accessToken, data.accessToken);
  await AsyncStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken);

  if (!data.isNewUser) {
    const profile = await api
      .get<Record<string, unknown>>('/api/v1/user')
      .then((profileRes) => profileRes.data)
      .catch(() => ({}) as Record<string, unknown>);
    const merged: LoginResult = { ...data, ...profile };
    await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(merged));
    return merged;
  }

  await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(data));
  return data;
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
  return postAuthSave(data);
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
  return postAuthSave(data);
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
  return postAuthSave(data);
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
  return postAuthSave(data);
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
  return postAuthSave(data);
}

// 인증 성공 시 GA4 이벤트 + signup_method 유저속성 기록.
export function trackAuthSuccess(method: AuthMethod, isNewUser?: boolean): void {
  if (isNewUser) logSignUp(method);
  else logLogin(method);
  setIdentityProps({ is_guest: false, signup_method: method });
}
