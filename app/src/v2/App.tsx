import { useState, useEffect } from 'react';
import { View, Text, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Settings as FacebookSettings } from 'react-native-fbsdk-next';
import { setLogoutHandler, setReloginHandler, getUserIdFromToken, api } from '@/services/api';
import { runStorageMigrations } from '@/utils/storageMigration';
import { STORAGE_KEYS } from '@/types/storage';
import type { LoginResult, UserProfile } from '@/types/api';

import { UserProvider } from '@/store/UserContext';
import { CoinProvider } from '@/store/CoinContext';
import { EquipmentProvider } from '@/store/EquipmentContext';
import { FocusProvider } from '@/store/FocusContext';
import { SubjectProvider } from '@/store/SubjectContext';
import { T } from '@/constants/theme';
import { RootNavigator } from '@/navigation/RootNavigator';
import { OrphanFocusSettler } from '@/v2/screens/focus/OrphanFocusSettler';
import { PushGate } from '@/v2/PushGate';
import LoginScreen from '@/v2/screens/LoginScreen';
import OnboardingFlow, {
  type OnboardingResult,
  type V2OnboardingData,
} from '@/v2/screens/onboarding';

// Facebook SDK 초기화 — 앱 시작 시 1회.
FacebookSettings.initializeSDK();

// 앱 전체 글씨를 디자인 크기로 고정(기기 '텍스트 크기' 설정 무시) → 화면 간 크기 일관.
// 홈은 네이티브 리포트 뷰와 맞추려 이미 고정이었는데, 나머지 화면도 같은 기준으로 통일한다.
type FontScalable = { defaultProps?: { allowFontScaling?: boolean } };
(Text as unknown as FontScalable).defaultProps = {
  ...(Text as unknown as FontScalable).defaultProps,
  allowFontScaling: false,
};
(TextInput as unknown as FontScalable).defaultProps = {
  ...(TextInput as unknown as FontScalable).defaultProps,
  allowFontScaling: false,
};

// v2 새 앱의 뿌리 — 데이터/로직 층(@/store, @/services, @/utils)은 기존 것을 그대로 공유한다.
// 게이트: 로딩 → (미온보딩 신규유저)온보딩 → 홈 / (온보딩 완료·로그아웃)로그인 → 홈.
// 온보딩은 로그인이 '마지막' 단계(OnboardingFlow가 내부에서 처리) — 게스트로 수집 후 로그인.
// TODO: 로그아웃/탈퇴 UI를 v2 화면으로 재구현. 09 권한거부 분기(09a/09b)·06 성별/생일 화면.

// v2 온보딩 수집 데이터를 서버로 전송(POST /users/me 프로필 설정). 로그인 상태에서만 호출.
// 매핑: nickname → nickname, usageGoalMinutes(12) → dailyScreenTimeGoalMinutes,
//       dailyFocusMinutes(17) → dailyFocusTimeGoalMinutes.
// focusCategory(16)는 서버 Occupation enum(5종)과 항목이 안 맞아 로컬 보관 유지
// (handleOnboardingComplete — 리그 기본 시험 리그로 쓰인다. TODO: 백엔드 협의).
async function syncOnboardingToServer(data: V2OnboardingData) {
  const body = {
    nickname: data.nickname,
    dailyScreenTimeGoalMinutes: data.usageGoalMinutes ?? undefined,
    dailyFocusTimeGoalMinutes: data.dailyFocusMinutes ?? undefined,
  };
  try {
    await api.post('/api/v1/users/me', body);
  } catch {
    // 실패해도 진행 — 추후 재동기화(TODO)
  }
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(false);
  // 온보딩에서 받은 두 목표 — 집중(17단계)·사용시간(12단계)을 각각 보관.
  const [onboardingFocusGoalSeconds, setOnboardingFocusGoalSeconds] = useState<number | null>(null);
  const [onboardingScreenTimeGoalSeconds, setOnboardingScreenTimeGoalSeconds] = useState<
    number | null
  >(null);

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
        const profileRes = await api.get('/api/v1/users/me');
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
      STORAGE_KEYS.focusCategory,
    ]);
    setOnboardingFocusGoalSeconds(null);
    setOnboardingScreenTimeGoalSeconds(null);
    setOnboarded(false);
    setUser(null);
  }

  // 게스트가 설정 화면에서 소셜 로그인하면 auth.ts가 토큰/유저를 이미 저장한다.
  // 로그아웃 없이 저장된 세션을 다시 읽어 인메모리 상태(user)를 새 소셜 계정으로 교체한다.
  // (UserProvider는 아래 key(user.userId)로 리마운트되어 새 userId를 반영한다.)
  async function applyStoredSession() {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.user);
    if (!raw) return;
    const data = JSON.parse(raw) as UserProfile;
    const userId = getUserIdFromToken(data.accessToken ?? '');
    await AsyncStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    setOnboarded(true);
    try {
      const profileRes = await api.get('/api/v1/users/me');
      setUser({ ...data, ...profileRes.data, userId });
    } catch {
      setUser({ ...data, userId });
    }
  }

  // 온보딩 완료(마지막 로그인/게스트) → 플래그 저장 + 유저 설정 → 홈 진입.
  async function handleOnboardingComplete({ data, login }: OnboardingResult) {
    await AsyncStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    // 목표 선택(16) — 리그 화면이 기본 시험 리그로 읽는다. 서버 필드 협의 전까지 로컬 보관.
    if (data.focusCategory) {
      await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, data.focusCategory);
    }
    setOnboarded(true);
    // 집중 목표=17단계 dailyFocusMinutes, 사용시간 목표=12단계 usageGoalMinutes.
    setOnboardingFocusGoalSeconds(data.dailyFocusMinutes ? data.dailyFocusMinutes * 60 : null);
    setOnboardingScreenTimeGoalSeconds(data.usageGoalMinutes ? data.usageGoalMinutes * 60 : null);
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
    setReloginHandler(() => {
      applyStoredSession();
    });
  }, []);

  let content;
  if (loading) {
    content = (
      <View style={s.loading}>
        <ActivityIndicator size="large" color={T.ink} />
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
        key={user?.userId ?? 'guest'}
        initialNickname={user?.nickname}
        initialUserId={user?.userId}
        initialGoalSeconds={
          onboardingFocusGoalSeconds ??
          (user?.dailyFocusTimeGoalMinutes ? user.dailyFocusTimeGoalMinutes * 60 : null)
        }
        initialScreenTimeGoalSeconds={
          onboardingScreenTimeGoalSeconds ??
          (user?.dailyScreenTimeGoalMinutes ? user.dailyScreenTimeGoalMinutes * 60 : null)
        }
        initialIsNewUser={user?.isNewUser}
      >
        <CoinProvider>
          <EquipmentProvider>
            <FocusProvider>
              <SubjectProvider>
                {/* 강제 종료된 세션 정산 — 라이브 레코드가 있으면 적립 후 삭제 */}
                <OrphanFocusSettler />
                {/* 로그인 상태에서 푸시 권한·토큰 등록·수신 배선 */}
                <PushGate />
                <RootNavigator />
              </SubjectProvider>
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
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.paper },
});
