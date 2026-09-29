import { Platform } from 'react-native';
import type { Provider } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';

const UNAVAILABLE = 'CLIENT_PROVIDER_UNAVAILABLE';
const GOOGLE_IOS_CLIENT_ID =
  '899365616896-4c2hdm77a2d0vt9ntctpcsjj457u5eop.apps.googleusercontent.com';
const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  '899365616896-f9hggskoharr2uogdtvd0d2qvntle8ae.apps.googleusercontent.com';
const LINE_CHANNEL_ID = process.env.EXPO_PUBLIC_LINE_CHANNEL_ID || '2011754820';
let googleConfigured = false;
let lineConfigured = false;

export interface SocialModuleLoaders {
  kakao: () => Promise<typeof import('@react-native-kakao/user')>;
  apple: () => Promise<typeof import('expo-apple-authentication')>;
  google: () => Promise<typeof import('@react-native-google-signin/google-signin')>;
  line: () => Promise<typeof import('@xmartlabs/react-native-line')>;
}

const defaultLoaders: SocialModuleLoaders = {
  kakao: () => import('@react-native-kakao/user'),
  apple: () => import('expo-apple-authentication'),
  google: () => import('@react-native-google-signin/google-signin'),
  line: () => import('@xmartlabs/react-native-line'),
};

function unavailable(message: string): never {
  throw new ApiError(UNAVAILABLE, message, 0);
}

export async function socialCredential(
  provider: Provider,
  loaders: SocialModuleLoaders = defaultLoaders,
): Promise<string> {
  if (Platform.OS === 'web') unavailable('앱에서 소셜 로그인을 이용해 주세요.');

  switch (provider) {
    case 'kakao': {
      const { login } = await loaders.kakao();
      const token = await login();
      return token.accessToken;
    }
    case 'apple': {
      if (Platform.OS !== 'ios') unavailable('Apple 로그인은 iPhone과 iPad에서 이용할 수 있어요.');
      const AppleAuthentication = await loaders.apple();
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken)
        unavailable('Apple 로그인 정보를 받지 못했어요. 다시 시도해 주세요.');
      return credential.identityToken;
    }
    case 'google': {
      const Google = await loaders.google();
      if (!googleConfigured) {
        // 서버는 ID 토큰의 aud 를 GOOGLE_CLIENT_ID 하나로만 검증한다(현재 iOS 클라이언트 ID).
        // iOS 에서 webClientId 를 넘기면 aud 가 웹 클라이언트가 돼 401 GOOGLE_TOKEN 으로 거절된다.
        // Android 는 ID 토큰 발급에 webClientId 가 필수라 넘긴다.
        Google.GoogleSignin.configure({
          ...(Platform.OS === 'android' ? { webClientId: GOOGLE_WEB_CLIENT_ID } : {}),
          iosClientId: GOOGLE_IOS_CLIENT_ID,
          scopes: ['profile', 'email'],
        });
        googleConfigured = true;
      }
      const response = await Google.GoogleSignin.signIn();
      if (!Google.isSuccessResponse(response)) {
        throw Object.assign(new Error('Google 로그인 취소'), {
          code: 'SIGN_IN_CANCELLED',
        });
      }
      if (!response.data.idToken)
        unavailable('Google 로그인 정보를 받지 못했어요. 다시 시도해 주세요.');
      return response.data.idToken;
    }
    case 'line': {
      const Line = await loaders.line();
      if (!lineConfigured) {
        await Line.default.setup({ channelId: LINE_CHANNEL_ID });
        lineConfigured = true;
      }
      const result = await Line.default.login({ scopes: [Line.Scope.Profile] });
      return result.accessToken.accessToken;
    }
  }
}

export function isSocialLoginCancellation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return [
    'ERR_REQUEST_CANCELED',
    'ERR_CANCELED',
    'SIGN_IN_CANCELLED',
    'E_CANCELLED_OPERATION',
    'CANCELLED',
    'LOGIN_CANCELLED',
    '3003',
  ].includes(code);
}
