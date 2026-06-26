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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '@/constants/theme';
import { API_URL, api } from '@/services/api';
import { logLogin, logSignUp, setIdentityProps, type AuthMethod } from '@/services/analyticsEvents';
import type { LoginResult } from '@/types/api';

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
  await AsyncStorage.setItem('gromo:accessToken', data.accessToken);
  await AsyncStorage.setItem('gromo:refreshToken', data.refreshToken);

  if (!data.isNewUser) {
    const profile = await api
      .get<Record<string, unknown>>('/api/v1/user')
      .then((profileRes) => profileRes.data)
      .catch(() => ({}) as Record<string, unknown>);
    const merged: LoginResult = { ...data, ...profile };
    await AsyncStorage.setItem('gromo:user', JSON.stringify(merged));
    return merged;
  }

  await AsyncStorage.setItem('gromo:user', JSON.stringify(data));
  return data;
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
  await AsyncStorage.setItem('gromo:accessToken', data.accessToken);
  await AsyncStorage.setItem('gromo:refreshToken', data.refreshToken);

  if (!data.isNewUser) {
    const profile = await api
      .get<Record<string, unknown>>('/api/v1/user')
      .then((profileRes) => profileRes.data)
      .catch(() => ({}) as Record<string, unknown>);
    const merged: LoginResult = { ...data, ...profile };
    await AsyncStorage.setItem('gromo:user', JSON.stringify(merged));
    return merged;
  }

  await AsyncStorage.setItem('gromo:user', JSON.stringify(data));
  return data;
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

  const loading = loadingKakao || loadingApple;

  async function handleKakaoLogin() {
    if (loading) return;
    setLoadingKakao(true);
    try {
      const user = await kakaoLogin();
      trackAuthSuccess('kakao', user.isNewUser);
      onLogin(user);
    } catch {
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
