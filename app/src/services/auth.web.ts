// 웹 로컬 디버그는 네이티브 소셜 SDK 없이 게스트 토큰으로 시작하되,
// 프론트 기능 게이트는 일반 유저처럼 열어 그룹·리그·친구 화면까지 확인한다.
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL, api } from '@/services/api';
import { claimStoredInviteAttribution } from '@/services/deferredInvite';
import { logLogin, logSignUp, setIdentityProps, type AuthMethod } from '@/services/analyticsEvents';
import { setServerZone } from '@/utils/serverZone';
import { STORAGE_KEYS } from '@/types/storage';
import type { LoginResult } from '@/types/api';
import { mockGuestLogin } from '@/mocks/fixtures/session';

export type { AuthMethod };

export const statusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
} as const;

let accountSwitchHandler: ((prevAccessToken: string) => void | Promise<void>) | null = null;

export function setAccountSwitchHandler(
  handler: (prevAccessToken: string) => void | Promise<void>,
): void {
  accountSwitchHandler = handler;
}

function unsupportedSocialLogin(): Promise<never> {
  return Promise.reject(new Error('웹 체험판에서는 소셜 로그인을 지원하지 않아요.'));
}

export const kakaoLogin = unsupportedSocialLogin;
export const appleLogin = unsupportedSocialLogin;
export const googleLogin = unsupportedSocialLogin;
export const lineLogin = unsupportedSocialLogin;
export const facebookLogin = unsupportedSocialLogin;

export async function guestLogin(): Promise<LoginResult> {
  let data: LoginResult & { refreshToken: string };
  if (__DEV__ && process.env.EXPO_PUBLIC_USE_MOCK === 'true') {
    data = mockGuestLogin();
  } else {
    try {
      const response = await axios.post<LoginResult & { refreshToken: string }>(
        `${API_URL}/api/v1/auth/guest`,
      );
      data = response.data;
    } catch (e) {
      const body = axios.isAxiosError(e)
        ? (e.response?.data as { message?: string } | undefined)
        : null;
      throw new Error(body?.message ?? '게스트 시작 실패');
    }
  }

  const previousToken = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
  if (previousToken) await accountSwitchHandler?.(previousToken);

  // 게이트를 여는 건 로컬 디버그(dev)일 때뿐이다. 로컬 시드는 닉네임이 설정되는 순간
  // 트리거로 서버 쪽 is_guest 도 false 로 승격시키지만, 배포 웹은 팀 dev 서버라 그 승격
  // 절차가 없다 — 거기서까지 비게스트로 덮어쓰면 그룹·친구를 열어 준 뒤 서버 검증에서
  // GUEST_FORBIDDEN 을 받는다(코드리뷰). 배포 웹은 서버가 준 값을 그대로 쓴다.
  const result: LoginResult = {
    ...data,
    isGuest:
      __DEV__ && process.env.EXPO_PUBLIC_USE_MOCK === 'true'
        ? true
        : __DEV__
          ? false
          : (data.isGuest ?? true),
    isNewUser: true,
  };
  await AsyncStorage.setItem(STORAGE_KEYS.accessToken, result.accessToken);
  await AsyncStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken);
  await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(result));
  setServerZone(result.timeZone);
  await claimStoredInviteAttribution();
  return result;
}

export async function logout(refreshToken: string): Promise<void> {
  await api.post('/api/v1/auth/logout', { refreshToken });
}

export async function saveLastAuthProvider(method: AuthMethod): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.lastAuthProvider, method);
  } catch {}
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
  } catch {}
}

export function trackAuthSuccess(method: AuthMethod, isNewUser?: boolean): void {
  if (isNewUser) logSignUp(method);
  else logLogin(method);
  setIdentityProps({ is_guest: false, signup_method: method });
  saveLastAuthProvider(method).catch(() => {});
}
