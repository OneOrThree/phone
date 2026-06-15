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
import { login } from '@react-native-kakao/user';
import * as AppleAuthentication from 'expo-apple-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '../components/theme';
import { API_URL, apiFetch } from '../utils/api';

async function kakaoLogin() {
  const kakaoToken = await login();

  const res = await fetch(`${API_URL}/api/v1/auth/kakao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kakaoAccessToken: kakaoToken.accessToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? '로그인 실패');
  await AsyncStorage.setItem('gromo:accessToken', data.accessToken);
  await AsyncStorage.setItem('gromo:refreshToken', data.refreshToken);

  if (!data.isNewUser) {
    const profileRes = await apiFetch('/api/v1/user');
    const profile = await profileRes.json().catch(() => ({}));
    const merged = { ...data, ...profile };
    await AsyncStorage.setItem('gromo:user', JSON.stringify(merged));
    return merged;
  }

  await AsyncStorage.setItem('gromo:user', JSON.stringify(data));
  return data;
}

async function appleLogin() {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  const res = await fetch(`${API_URL}/api/v1/auth/apple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken: credential.identityToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Apple 로그인 실패');
  await AsyncStorage.setItem('gromo:accessToken', data.accessToken);
  await AsyncStorage.setItem('gromo:refreshToken', data.refreshToken);

  if (!data.isNewUser) {
    const profileRes = await apiFetch('/api/v1/user');
    const profile = await profileRes.json().catch(() => ({}));
    const merged = { ...data, ...profile };
    await AsyncStorage.setItem('gromo:user', JSON.stringify(merged));
    return merged;
  }

  await AsyncStorage.setItem('gromo:user', JSON.stringify(data));
  return data;
}

export default function LoginScreen({ onLogin }) {
  const [loadingKakao, setLoadingKakao] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);

  const loading = loadingKakao || loadingApple;

  async function handleKakaoLogin() {
    if (loading) return;
    setLoadingKakao(true);
    try {
      const user = await kakaoLogin();
      onLogin(user);
    } catch (e) {
      console.error('카카오 로그인 에러:', e);
    } finally {
      setLoadingKakao(false);
    }
  }

  async function handleAppleLogin() {
    if (loading) return;
    setLoadingApple(true);
    try {
      const user = await appleLogin();
      onLogin(user);
    } catch (e) {
      // 사용자가 직접 취소한 경우는 에러 알림 생략
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        console.error('Apple 로그인 에러:', e);
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
          onPress={loading ? undefined : handleAppleLogin}
        />

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
