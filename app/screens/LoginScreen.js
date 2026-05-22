import { useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { T } from '../components/theme';

// 목업 로그인 함수 — 실제 서버 연동 시 POST /api/auth/kakao 호출로 교체
async function mockKakaoLogin() {
  await new Promise(r => setTimeout(r, 600));
  return {
    id: 1,
    nickname: '테스터',
    profileImageUrl: null,
    coins: 10,
  };
}

export default function LoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (loading) return;
    setLoading(true);
    try {
      const user = await mockKakaoLogin();
      onLogin(user);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>otium</Text>
      <TouchableOpacity onPress={handleLogin} style={styles.kakaoButton} activeOpacity={0.8} disabled={loading}>
        {loading
          ? <ActivityIndicator size="small" color={T.ink} style={styles.kakaoImage} />
          : <Image
              source={require('../assets/kakao_login_medium_narrow.png')}
              style={styles.kakaoImage}
              resizeMode="contain"
            />
        }
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
