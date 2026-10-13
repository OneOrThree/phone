import { Platform } from 'react-native';
import type { Provider } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { t } from '@/i18n';

const UNAVAILABLE = 'CLIENT_PROVIDER_UNAVAILABLE';
// GROMO-2215 — 구글 로그인을 2.0 전용 프로젝트(263851348176)로 옮겼다. 구 프로젝트(899365616896)는
// 1.x 와 공유하던 것이고, 이미 설치된 구 빌드가 보내는 aud 는 서버 허용 목록에 남겨 둔다.
const GOOGLE_IOS_CLIENT_ID =
  '263851348176-8ochua7scca7h6ldmdk7v3iqc9uoit50.apps.googleusercontent.com';
const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  '263851348176-hpndg0cj79f9n0vp78us3cktno7p0h9k.apps.googleusercontent.com';
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
  if (Platform.OS === 'web') unavailable(t('login.error.webUnavailable'));

  switch (provider) {
    case 'kakao': {
      const { login } = await loaders.kakao();
      const token = await login();
      return token.accessToken;
    }
    case 'apple': {
      if (Platform.OS !== 'ios') unavailable(t('login.error.appleIosOnly'));
      const AppleAuthentication = await loaders.apple();
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) unavailable(t('login.error.appleNoCredential'));
      return credential.identityToken;
    }
    case 'google': {
      const Google = await loaders.google();
      if (!googleConfigured) {
        // 1.x 와 같은 설정이다. 두 플랫폼 모두 webClientId 를 넘겨 ID 토큰 aud 가 웹 클라이언트로
        // 통일된다(Android 는 webClientId 가 필수라 다른 aud 를 받을 수 없다). 서버 GOOGLE_CLIENT_ID 는
        // 웹 클라이언트 ID 여야 iOS·Android 가 모두 통과한다.
        Google.GoogleSignin.configure({
          webClientId: GOOGLE_WEB_CLIENT_ID,
          iosClientId: GOOGLE_IOS_CLIENT_ID,
          scopes: ['profile', 'email'],
        });
        googleConfigured = true;
      }
      const response = await Google.GoogleSignin.signIn();
      if (!Google.isSuccessResponse(response)) {
        throw Object.assign(new Error(t('login.error.googleCancelled')), {
          code: 'SIGN_IN_CANCELLED',
        });
      }
      if (!response.data.idToken) unavailable(t('login.error.googleNoCredential'));
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
