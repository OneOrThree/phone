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
import OnboardingFlow, {
  type OnboardingResult,
  type V2OnboardingData,
} from '@/v2/screens/onboarding';

// Facebook SDK 초기화 — 앱 시작 시 1회.
FacebookSettings.initializeSDK();

// v2 새 앱의 뿌리 — 데이터/로직 층(@/store, @/services, @/utils)은 기존 것을 그대로 공유한다.
// 게이트: 로딩 → (미온보딩 신규유저)온보딩 → 홈 / (온보딩 완료·로그아웃)로그인 → 홈.
// 온보딩은 로그인이 '마지막' 단계(OnboardingFlow가 내부에서 처리) — 게스트로 수집 후 로그인.
// TODO: 로그아웃/탈퇴 UI를 v2 화면으로 재구현. 09 권한거부 분기(09a/09b)·06 성별/생일 화면.

// v2 온보딩 수집 데이터를 서버로 전송. 로그인 상태에서만 호출(토큰 필요).
// 매핑: usageGoalMinutes → dailyScreenTimeGoalMinutes, nickname → nickname.
// focusCategory(16)·dailyFocusMinutes(17)는 서버 필드 미정 → 미전송(TODO: 백엔드 협의).
async function syncOnboardingToServer(data: V2OnboardingData) {
  const body = {
    nickname: data.nickname,
    dailyScreenTimeGoalMinutes: data.usageGoalMinutes ?? undefined,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  try {
    await api.post('/api/v1/user', body);
  } catch {
    // 실패해도 진행 — 추후 재동기화(TODO)
  }
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(false);
  const [onboardingGoalSeconds, setOnboardingGoalSeconds] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      // 숫자 id 캐시 무효화(PK Long→UUID). 부트스트랩보다 먼저.
      await runStorageMigrations();
      const done = await AsyncStorage.getItem(STORAGE_KEYS.onboardingComplete);
      if (done) setOnboarded(true);
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
    // 온보딩 완료 플래그까지 지워 로그아웃 시 온보딩 첫 페이지로 돌아가게 한다.
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.refreshToken,
      STORAGE_KEYS.user,
      STORAGE_KEYS.onboardingComplete,
    ]);
    setOnboardingGoalSeconds(null);
    setOnboarded(false);
    setUser(null);
  }

  // 온보딩 완료(마지막 로그인/게스트) → 플래그 저장 + 유저 설정 → 홈 진입.
  async function handleOnboardingComplete({ data, login }: OnboardingResult) {
    await AsyncStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    setOnboarded(true);
    setOnboardingGoalSeconds(data.usageGoalMinutes ? data.usageGoalMinutes * 60 : null);
    if (login) {
      // 소셜 로그인으로 마무리 — 세션(토큰/유저)은 auth.ts가 이미 저장.
      const userId = getUserIdFromToken(login.accessToken);
      setUser({ ...login, userId, nickname: data.nickname });
      syncOnboardingToServer(data);
    } else {
      // 게스트로 시작 — 토큰 없어 서버 미전송, 로컬 상태로 홈 진입.
      setUser({ nickname: data.nickname, userId: null, isNewUser: false });
    }
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
    content = onboarded ? (
      // 온보딩 완료한 재방문 유저(로그아웃 상태) → 바로 로그인.
      <LoginScreen
        onLogin={(u: LoginResult) => {
          const userId = getUserIdFromToken(u.accessToken);
          setUser({ ...u, userId });
        }}
        onGuestStart={() => setUser({ userId: null, isNewUser: false })}
      />
    ) : (
      // 신규 유저 → 온보딩 플로우(8→9→12→15→16→17→로그인).
      <OnboardingFlow onComplete={handleOnboardingComplete} />
    );
  } else {
    content = (
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
