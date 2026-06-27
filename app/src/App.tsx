import { useState, useEffect } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { setLogoutHandler, getUserIdFromToken, api } from '@/services/api';
import { runStorageMigrations } from '@/utils/storageMigration';
import { logLogin } from '@/services/analyticsEvents';
import type { LoginResult, OnboardingData, UserProfile } from '@/types/api';
import { Settings as FacebookSettings } from 'react-native-fbsdk-next';

// Facebook SDK 초기화 — 앱 시작 시 1회 (FacebookAppID/ClientToken 은 Info.plist 에서 로드).
FacebookSettings.initializeSDK();

const GENDER_MAP: Record<string, string> = { male: 'MALE', female: 'FEMALE', other: 'UNKNOWN' };

async function syncOnboardingToServer(onboardingData: OnboardingData | null) {
  if (!onboardingData) return;
  const body = {
    nickname: onboardingData.nickname,
    gender: GENDER_MAP[onboardingData.gender] ?? 'UNKNOWN',
    birthDate: onboardingData.birthday,
    dailyScreenTimeGoalMinutes: Math.round((onboardingData.goalSeconds ?? 0) / 60),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dayStartTime: onboardingData.dayStartTime ?? '00:00',
    dayEndTime: onboardingData.dayEndTime ?? '00:00',
    reportTime: onboardingData.reportTime ?? '00:00',
  };
  try {
    await api.post('/api/v1/user', body);
  } catch {}
}

import { FocusProvider } from '@/store/FocusContext';
import { EquipmentProvider } from '@/store/EquipmentContext';
import { CoinProvider } from '@/store/CoinContext';
import { UserProvider } from '@/store/UserContext';

import OnboardingScreen from '@/screens/OnboardingScreen';
import LoginScreen from '@/screens/LoginScreen';
import { RootNavigator } from '@/navigation/RootNavigator';

import { T } from '@/constants/theme';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingOnboarding, setPendingOnboarding] = useState(false);
  const [onboardingGoalSeconds, setOnboardingGoalSeconds] = useState<number | null>(null);
  const [showGuestOnboarding, setShowGuestOnboarding] = useState(false);

  useEffect(() => {
    (async () => {
      // 숫자 id 캐시 무효화(PK Long→UUID 전환). 부트스트랩 캐시 로드보다 먼저 실행.
      await runStorageMigrations();
      const raw = await AsyncStorage.getItem('gromo:user');
      if (!raw) {
        setLoading(false);
        return;
      }
      const data = JSON.parse(raw) as UserProfile;
      const userId = getUserIdFromToken(data.accessToken ?? '');
      try {
        const profileRes = await api.get('/api/v1/user');
        const profile = profileRes.data;
        const merged = { ...data, ...profile };
        await AsyncStorage.setItem('gromo:user', JSON.stringify(merged));
        setUser({ ...merged, userId });
      } catch {
        // 비-2xx·오프라인 등 실패 시 캐시 사용
        setUser({ ...data, userId });
      }
      setLoading(false);
    })();
  }, []);

  async function handleLogout() {
    try {
      const refreshToken = await AsyncStorage.getItem('gromo:refreshToken');
      if (refreshToken) {
        await api.post('/api/v1/auth/logout', { refreshToken });
      }
    } catch {}
    await AsyncStorage.multiRemove(['gromo:accessToken', 'gromo:refreshToken', 'gromo:user']);
    setUser(null);
  }

  async function handleWithdraw() {
    try {
      await api.delete('/api/v1/user');
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 400) {
        throw new Error('400');
      }
      throw new Error('error');
    }
    await AsyncStorage.multiRemove(['gromo:accessToken', 'gromo:refreshToken', 'gromo:user']);
    setUser(null);
  }

  useEffect(() => {
    setLogoutHandler(handleLogout);
  }, []);

  if (loading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color={T.ink} />
      </View>
    );
  }

  if (pendingOnboarding) {
    return (
      <OnboardingScreen
        onComplete={(data: OnboardingData) => {
          setOnboardingGoalSeconds(data.goalSeconds);
          setUser((prev) => ({ ...prev, nickname: data.nickname }));
          setPendingOnboarding(false);
          syncOnboardingToServer(data);
        }}
      />
    );
  }

  if (showGuestOnboarding) {
    return (
      <OnboardingScreen
        onComplete={(data: OnboardingData) => {
          setOnboardingGoalSeconds(data.goalSeconds);
          setShowGuestOnboarding(false);
          setUser({ nickname: data.nickname, userId: null, isNewUser: false });
        }}
      />
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onLogin={(u: LoginResult) => {
          const userId = getUserIdFromToken(u.accessToken);
          setUser({ ...u, userId });
          if (u.isNewUser) setPendingOnboarding(true);
        }}
        onGuestStart={() => {
          logLogin('guest');
          setShowGuestOnboarding(true);
        }}
      />
    );
  }

  return (
    <UserProvider
      initialNickname={user?.nickname}
      initialUserId={user?.userId}
      initialGoalSeconds={
        onboardingGoalSeconds ??
        (user?.dailyScreenTimeGoalMinutes ? user.dailyScreenTimeGoalMinutes * 60 : null)
      }
      initialIsNewUser={user?.isNewUser}
    >
      <CoinProvider>
        <EquipmentProvider>
          <FocusProvider>
            <RootNavigator user={user} onLogout={handleLogout} onWithdraw={handleWithdraw} />
          </FocusProvider>
        </EquipmentProvider>
      </CoinProvider>
    </UserProvider>
  );
}

const s = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.paper },
});
