import { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Settings as FacebookSettings } from 'react-native-fbsdk-next';
import { setLogoutHandler, getUserIdFromToken, api } from '@/services/api';
import { runStorageMigrations } from '@/utils/storageMigration';
import { STORAGE_KEYS } from '@/types/storage';
import type { LoginResult, UserProfile } from '@/types/api';

import { UserProvider } from '@/store/UserContext';
import { CoinProvider } from '@/store/CoinContext';
import { EquipmentProvider } from '@/store/EquipmentContext';
import { FocusProvider } from '@/store/FocusContext';
import { RootNavigator } from '@/v2/navigation/RootNavigator';
import LoginScreen from '@/v2/screens/LoginScreen';

// Facebook SDK 초기화 — 앱 시작 시 1회.
FacebookSettings.initializeSDK();

// v2 새 앱의 뿌리 — 데이터/로직 층(@/store, @/services, @/utils)은 기존 것을 그대로 공유한다.
// 현재 범위: 인증 게이트(로딩 → 로그인 → 홈)만. 로그인 성공 시 홈으로 진입.
// TODO: 신규 유저 온보딩(O1~O8)·게스트 온보딩·로그아웃/탈퇴 UI를 v2 화면으로 재구현.
export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // 숫자 id 캐시 무효화(PK Long→UUID). 부트스트랩보다 먼저.
      await runStorageMigrations();
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.user);
      if (!raw) {
        setLoading(false);
        return;
      }
      const data = JSON.parse(raw) as UserProfile;
      const userId = getUserIdFromToken(data.accessToken ?? '');
      try {
        const profileRes = await api.get('/api/v1/user');
        const merged = { ...data, ...profileRes.data };
        await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(merged));
        setUser({ ...merged, userId });
      } catch {
        setUser({ ...data, userId });
      }
      setLoading(false);
    })();
  }, []);

  async function handleLogout() {
    try {
      const refreshToken = await AsyncStorage.getItem(STORAGE_KEYS.refreshToken);
      if (refreshToken) await api.post('/api/v1/auth/logout', { refreshToken });
    } catch {}
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.refreshToken,
      STORAGE_KEYS.user,
    ]);
    setUser(null);
  }

  useEffect(() => {
    setLogoutHandler(handleLogout);
  }, []);

  let content;
  if (loading) {
    content = (
      <View style={s.loading}>
        <ActivityIndicator size="large" color="#2C2421" />
      </View>
    );
  } else if (!user) {
    content = (
      <LoginScreen
        onLogin={(u: LoginResult) => {
          const userId = getUserIdFromToken(u.accessToken);
          setUser({ ...u, userId });
          // TODO: 신규 유저(u.isNewUser) → v2 온보딩으로 분기
        }}
        onGuestStart={() => {
          // TODO: v2 게스트 온보딩. 일단 게스트로 홈 진입.
          setUser({ userId: null, isNewUser: false });
        }}
      />
    );
  } else {
    content = (
      <UserProvider
        initialNickname={user?.nickname}
        initialUserId={user?.userId}
        initialGoalSeconds={
          user?.dailyScreenTimeGoalMinutes ? user.dailyScreenTimeGoalMinutes * 60 : null
        }
        initialIsNewUser={user?.isNewUser}
      >
        <CoinProvider>
          <EquipmentProvider>
            <FocusProvider>
              <RootNavigator />
            </FocusProvider>
          </EquipmentProvider>
        </CoinProvider>
      </UserProvider>
    );
  }

  // SafeAreaProvider 루트 — v2 LoginScreen 등 NavigationContainer 밖 화면도 SafeAreaView 사용 가능.
  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}

const s = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EFE3CE' },
});
