import { useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { login } from '@react-native-kakao/user';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '../components/theme';

const API_URL = 'https://oneorthree.mooo.com';

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
  await AsyncStorage.setItem('gromo:user', JSON.stringify(data));
  return data;
}

export default function LoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (loading) return;
    setLoading(true);
    try {
      const user = await kakaoLogin();
      onLogin(user);
    } catch (e) {
      console.error('로그인 에러:', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>gromo</Text>
      <TouchableOpacity
        onPress={handleLogin}
        style={styles.kakaoButton}
        activeOpacity={0.8}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color={T.ink} style={styles.kakaoImage} />
        ) : (
          <Image
            source={require('../assets/kakao_login_medium_narrow.png')}
            style={styles.kakaoImage}
            resizeMode="contain"
          />
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 160,
    paddingBottom: 80,
  },
  title: {
    fontSize: 48,
    fontWeight: '800',
    color: T.ink,
    letterSpacing: 4,
  },
  kakaoButton: {
    width: 280,
  },
  kakaoImage: {
    width: '100%',
    height: 54,
  },
});
