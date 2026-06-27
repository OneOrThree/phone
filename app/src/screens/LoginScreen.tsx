import { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
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
import { T } from '@/constants/theme';
import { API_URL, api } from '@/services/api';
import { logLogin, logSignUp, setIdentityProps, type AuthMethod } from '@/services/analyticsEvents';
import type { LoginResult } from '@/types/api';
import { STORAGE_KEYS } from '@/types/storage';

interface LoginScreenProps {
  onLogin: (u: LoginResult) => void;
  onGuestStart: () => void;
}

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

async function kakaoLogin(): Promise<LoginResult> {
  const kakaoToken = await login();

  // 로그인 전 호출이므로 인터셉터(토큰 주입·401 로그아웃) 없는 bare axios 사용
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

async function appleLogin(): Promise<LoginResult> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  // 로그인 전 호출이므로 인터셉터(토큰 주입·401 로그아웃) 없는 bare axios 사용
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
// webClientId: 발급 id_token 의 aud → 백엔드 GOOGLE_CLIENT_ID 와 일치해야 함.
// iosClientId: iOS 네이티브 로그인용(이 값의 역방향이 URL scheme). 둘 다 env 에서 로드.
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  scopes: ['profile', 'email'],
});

async function googleLogin(): Promise<LoginResult> {
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    // 사용자가 취소 — 호출부에서 알림을 생략하도록 취소 코드를 실어 던진다
    throw Object.assign(new Error('Google 로그인 취소'), {
      code: statusCodes.SIGN_IN_CANCELLED,
    });
  }
  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error('Google idToken을 가져오지 못했습니다.');
  }

  // 로그인 전 호출이므로 인터셉터(토큰 주입·401 로그아웃) 없는 bare axios 사용
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

// LINE 로그인 설정 — setup()은 login() 전에 1회 호출돼야 한다(채널 시크릿 불필요, 네이티브 SDK가 처리).
let lineConfigured = false;
async function ensureLineSetup(): Promise<void> {
  if (lineConfigured) return;
  const channelId = process.env.EXPO_PUBLIC_LINE_CHANNEL_ID;
  // Channel ID 미설정 시 즉시 실패시킨다.
  if (!channelId) {
    throw new Error('LINE Channel ID 미설정 (EXPO_PUBLIC_LINE_CHANNEL_ID)');
  }
  // ⚠️ react-native-line v4 버그: 네이티브 setup()이 resolve()를 호출하지 않아 await 하면 영영 멈춤(무한로딩).
  // LoginManager.shared.setup()은 동기로 채널을 설정하므로, await 없이 호출만 하고 진행한다.
  LineLogin.setup({ channelId }).catch(() => {});
  lineConfigured = true;
}

async function lineLogin(): Promise<LoginResult> {
  await ensureLineSetup();
  // login()이 콜백을 못 받아 영영 안 끝나는 경우(주로 LINE 채널 iOS 설정 누락) 무한로딩 방지.
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

  // 로그인 전 호출이므로 인터셉터(토큰 주입·401 로그아웃) 없는 bare axios 사용
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

async function facebookLogin(): Promise<LoginResult> {
  // iOS는 Limited Login(개인정보 친화, ATT 팝업 없음) — access token이 아니라 OIDC id_token을 받는다.
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const result = await LoginManager.logInWithPermissions(
    ['public_profile', 'email'],
    'limited',
    nonce,
  );
  if (result.isCancelled) {
    // 사용자 취소 — 호출부에서 알림 생략하도록 코드 부여
    throw Object.assign(new Error('Facebook 로그인 취소'), { code: 'CANCELLED' });
  }

  // Limited Login(iOS) → id_token. 미지원(Android/클래식) 환경은 access token 으로 폴백.
  const authToken = await AuthenticationToken.getAuthenticationTokenIOS();
  let token: string | undefined = authToken?.authenticationToken;
  if (!token) {
    const accessToken = await AccessToken.getCurrentAccessToken();
    token = accessToken?.accessToken;
  }
  if (!token) {
    throw new Error('Facebook 토큰을 가져오지 못했습니다.');
  }

  // 로그인 전 호출이므로 인터셉터(토큰 주입·401 로그아웃) 없는 bare axios 사용
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
// 신규 가입은 sign_up, 기존 사용자는 login (GA4 표준 이벤트).
function trackAuthSuccess(method: AuthMethod, isNewUser?: boolean): void {
  if (isNewUser) logSignUp(method);
  else logLogin(method);
  setIdentityProps({ is_guest: false, signup_method: method });
}

export default function LoginScreen({ onLogin, onGuestStart }: LoginScreenProps) {
  const [loadingKakao, setLoadingKakao] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingLine, setLoadingLine] = useState(false);
  const [loadingFacebook, setLoadingFacebook] = useState(false);

  const loading = loadingKakao || loadingApple || loadingGoogle || loadingLine || loadingFacebook;

  async function handleKakaoLogin() {
    if (loading) return;
    setLoadingKakao(true);
    try {
      const user = await kakaoLogin();
      trackAuthSuccess('kakao', user.isNewUser);
      onLogin(user);
    } catch (e) {
      // 사용자가 취소한 경우는 알림 생략
      const reason = String(
        (e as { code?: string; message?: string }).code ?? (e as Error).message ?? '',
      ).toLowerCase();
      if (!reason.includes('cancel')) {
        Alert.alert('로그인 실패', '카카오 로그인 중 오류가 발생했습니다.');
      }
    } finally {
      setLoadingKakao(false);
    }
  }

  async function handleAppleLogin() {
    if (loading) return;
    setLoadingApple(true);
    try {
      const user = await appleLogin();
      trackAuthSuccess('apple', user.isNewUser);
      onLogin(user);
    } catch (e) {
      // 사용자가 직접 취소한 경우는 에러 알림 생략
      if ((e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('로그인 실패', 'Apple 로그인 중 오류가 발생했습니다.');
      }
    } finally {
      setLoadingApple(false);
    }
  }

  async function handleGoogleLogin() {
    if (loading) return;
    setLoadingGoogle(true);
    try {
      const user = await googleLogin();
      trackAuthSuccess('google', user.isNewUser);
      onLogin(user);
    } catch (e) {
      // 사용자가 직접 취소한 경우는 에러 알림 생략
      if ((e as { code?: string }).code !== statusCodes.SIGN_IN_CANCELLED) {
        Alert.alert('로그인 실패', 'Google 로그인 중 오류가 발생했습니다.');
      }
    } finally {
      setLoadingGoogle(false);
    }
  }

  async function handleLineLogin() {
    if (loading) return;
    setLoadingLine(true);
    try {
      const user = await lineLogin();
      trackAuthSuccess('line', user.isNewUser);
      onLogin(user);
    } catch (e) {
      // 사용자가 취소한 경우는 알림 생략
      const reason = String(
        (e as { code?: string; message?: string }).code ?? (e as Error).message ?? '',
      ).toLowerCase();
      if (!reason.includes('cancel')) {
        Alert.alert('로그인 실패', 'LINE 로그인 중 오류가 발생했습니다.');
      }
    } finally {
      setLoadingLine(false);
    }
  }

  async function handleFacebookLogin() {
    if (loading) return;
    setLoadingFacebook(true);
    try {
      const user = await facebookLogin();
      trackAuthSuccess('facebook', user.isNewUser);
      onLogin(user);
    } catch (e) {
      // 사용자가 직접 취소한 경우는 알림 생략
      if ((e as { code?: string }).code !== 'CANCELLED') {
        Alert.alert('로그인 실패', 'Facebook 로그인 중 오류가 발생했습니다.');
      }
    } finally {
      setLoadingFacebook(false);
    }
  }

  return (
    <View style={styles.container}>
      {/* 앱 아이콘 */}
      <View style={styles.iconBox}>
        <Text style={styles.iconLetter}>G</Text>
      </View>

      {/* 타이틀 */}
      <Text style={styles.title}>GROMO</Text>
      <Text style={styles.subtitle}>함께하는 집중 타이머</Text>

      {/* 로그인 버튼 영역 */}
      <View style={styles.buttonArea}>
        {/* 카카오 로그인 — 공식 이미지 버튼 */}
        <TouchableOpacity
          style={styles.kakaoButton}
          onPress={handleKakaoLogin}
          activeOpacity={0.8}
          disabled={loading}
        >
          {loadingKakao ? (
            <ActivityIndicator size="small" color={T.ink} />
          ) : (
            <Image
              source={require('../assets/kakao_login_medium_wide.png')}
              style={styles.kakaoImage}
              resizeMode="contain"
            />
          )}
        </TouchableOpacity>

        {/* Apple 로그인 — 공식 내장 버튼 */}
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={12}
          style={styles.appleButton}
          onPress={() => {
            if (!loading) handleAppleLogin();
          }}
        />

        {/* Google 로그인 */}
        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleLogin}
          activeOpacity={0.8}
          disabled={loading}
        >
          {loadingGoogle ? (
            <ActivityIndicator size="small" color={T.ink} />
          ) : (
            <Text style={styles.googleButtonText}>Google로 계속하기</Text>
          )}
        </TouchableOpacity>

        {/* LINE 로그인 */}
        <TouchableOpacity
          style={styles.lineButton}
          onPress={handleLineLogin}
          activeOpacity={0.8}
          disabled={loading}
        >
          {loadingLine ? (
            <ActivityIndicator size="small" color={T.ink} />
          ) : (
            <Text style={styles.lineButtonText}>LINE으로 계속하기</Text>
          )}
        </TouchableOpacity>

        {/* Facebook 로그인 */}
        <TouchableOpacity
          style={styles.facebookButton}
          onPress={handleFacebookLogin}
          activeOpacity={0.8}
          disabled={loading}
        >
          {loadingFacebook ? (
            <ActivityIndicator size="small" color={T.ink} />
          ) : (
            <Text style={styles.facebookButtonText}>Facebook으로 계속하기</Text>
          )}
        </TouchableOpacity>

        {/* 게스트 로그인 */}
        <TouchableOpacity
          style={styles.guestButton}
          onPress={onGuestStart}
          activeOpacity={0.8}
          disabled={loading}
        >
          <Text style={styles.guestButtonText}>게스트로 시작하기</Text>
        </TouchableOpacity>

        {/* 구분선 */}
        <View style={styles.divider} />

        {/* 안내 문구 */}
        <Text style={styles.notice}>소셜 기능과 랭킹은 로그인 시 이용 가능합니다</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
    alignItems: 'center',
    paddingTop: 148,
  },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: T.paperLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLetter: {
    fontSize: 36,
    fontWeight: '700',
    color: T.inkMed,
  },
  title: {
    marginTop: 16,
    fontSize: 28,
    fontWeight: '800',
    color: T.ink,
    letterSpacing: 1,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: T.inkLight,
  },
  buttonArea: {
    marginTop: 64,
    width: 345,
    alignItems: 'center',
    gap: 12,
  },
  kakaoButton: {
    width: '100%',
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kakaoImage: {
    width: '100%',
    height: 54,
  },
  appleButton: {
    width: '100%',
    height: 54,
  },
  googleButton: {
    width: '100%',
    height: 54,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    backgroundColor: T.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: T.ink,
  },
  lineButton: {
    width: '100%',
    height: 54,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    backgroundColor: T.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: T.ink,
  },
  facebookButton: {
    width: '100%',
    height: 54,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    backgroundColor: T.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facebookButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: T.ink,
  },
  guestButton: {
    width: '100%',
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.inkMed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestButtonText: {
    fontSize: 16,
    color: T.inkMed,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: T.paperLine,
    marginTop: 4,
  },
  notice: {
    fontSize: 12,
    color: T.inkLight,
    textAlign: 'center',
  },
});
