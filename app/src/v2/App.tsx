import { useState, useEffect } from 'react';
import { View, Text, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Settings as FacebookSettings } from 'react-native-fbsdk-next';
import { setLogoutHandler, setReloginHandler, getUserIdFromToken, api } from '@/services/api';
import { updateScreenTimePermission, updateOccupation } from '@/services/userApi';
import { occupationForCategory } from '@/constants/focusCategories';
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
import { PendingFocusUploader } from '@/v2/screens/focus/PendingFocusUploader';
import { PushGate } from '@/v2/PushGate';
import { PendingGoalApplier } from '@/v2/PendingGoalApplier';
import LoginScreen from '@/v2/screens/LoginScreen';
import OnboardingFlow, {
  type OnboardingCompleteStatus,
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
// 온보딩은 로그인이 '마지막' 단계(OnboardingFlow가 내부에서 처리) — 데이터를 먼저 수집하고
// W15에서 소셜/게스트 로그인(게스트도 /auth/guest로 실제 세션 발급).
// TODO: 로그아웃/탈퇴 UI를 v2 화면으로 재구현.

// v2 온보딩 수집 데이터를 서버로 전송. 로그인 상태에서만(토큰 발급 후) 호출.
// (1) POST /users/me — 프로필 설정: nickname → nickname,
//     usageGoalMinutes(W12) → dailyScreenTimeGoalMinutes,
//     dailyFocusMinutes(W12) → dailyFocusTimeGoalMinutes.
//     닉네임 중복이면 409(NICKNAME_DUPLICATE) — 온보딩 닉네임 화면은 로그인 전이라
//     실시간 중복확인 API를 못 부르므로 여기가 유일한 중복 검증 지점이다(GROMO-618).
//     실패를 삼키지 않고 결과를 돌려줘 OnboardingFlow가 재입력/재시도를 처리한다.
// (2) PATCH /users/me/screen-time-permission — 스크린타임 권한 허용 여부(W10).
//     프로필 셋업 요청엔 권한 필드가 없어 별도 엔드포인트로 보낸다.
//     screenTimeGranted === null(아직 안 물어봄)이면 스킵.
// focusCategory(W4)는 서버 Occupation(19종, GROMO-631)과 전 카테고리 1:1 매핑 —
// PATCH /users/me/occupation 으로 서버에도 동기화 → 같은 카테고리 리그 랭킹(?category=)·비교 통계 모수.
// notificationGranted(W13)는 대응 엔드포인트가 알림 설정 전체 객체뿐이라 여기선 미전송(TODO).
// 반환: 프로필 등록 결과 — 'ok'가 아니면 호출부가 온보딩 완료 처리를 보류한다(GROMO-617/618).
async function syncOnboardingToServer(data: V2OnboardingData): Promise<OnboardingCompleteStatus> {
  const body = {
    nickname: data.nickname.trim(),
    dailyScreenTimeGoalMinutes: data.usageGoalMinutes ?? undefined,
    dailyFocusTimeGoalMinutes: data.dailyFocusMinutes ?? undefined,
  };
  try {
    // 프로필은 온보딩이 일부 필드만 수집해 부분 바디로 보낸다(setupProfile은 전체 필드 요구).
    await api.post('/api/v1/users/me', body);
  } catch (e) {
    // 프로필 등록 실패 — 여기서 완료 처리하면 서버-로컬이 영구 불일치되므로 재입력/재시도 유도.
    if (axios.isAxiosError(e) && e.response?.status === 409) return 'nickname-duplicate';
    return 'error';
  }
  try {
    if (data.screenTimeGranted !== null) {
      await updateScreenTimePermission({ granted: data.screenTimeGranted });
    }
    const occupation = occupationForCategory(data.focusCategory ?? null);
    if (occupation) {
      await updateOccupation({ occupation });
    }
  } catch {
    // 권한 동기화 실패는 온보딩 완료를 막지 않는다 — 추후 재동기화(TODO)
  }
  return 'ok';
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(false);
  // 온보딩에서 받은 두 목표 — 집중·사용시간 목표(W12)를 각각 보관.
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
      // 온보딩 미완료 세션은 복원하지 않는다(GROMO-617). 신규 유저는 인증 성공 시점에
      // postAuthSave가 토큰/유저를 먼저 저장하므로, 프로필 등록(POST /users/me) 실패 후
      // 재실행하면 '저장된 user는 있는데 완료 플래그는 없는' 반쪽 세션이 남는다.
      // 이걸 복원하면 프로필 미등록 상태로 홈에 진입하므로, 온보딩을 다시 밟게 한다.
      // (user와 플래그가 따로 노는 경우는 이 경로뿐 — 완료/로그아웃 시엔 둘을 함께 저장/삭제.)
      if (!done || !raw) {
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
      // 계정 전환 시 이전 유저 값이 새 유저에 새지 않도록 디바이스 전역 캐시도 정리(리뷰 반영)
      STORAGE_KEYS.goalPending,
      STORAGE_KEYS.focusPendingUploads, // 이전 계정 세션이 새 계정으로 업로드되지 않게
      STORAGE_KEYS.notificationSettings,
      STORAGE_KEYS.statVisibility,
      STORAGE_KEYS.focusFirstDone, // 다음 계정이 '첫 집중 완료' 변형을 정상적으로 보게
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
  // 기존 계정엔 온보딩 수집값을 덮어쓰지 않는다(프로필·목표·로컬 상태 모두):
  //   - skipped=true : 'W1/W2에서 이미 계정이 있어요' → 애초에 수집값이 없음.
  //   - login.isNewUser === false : 버튼을 안 눌러도 재로그인이면 기존 유저(예: 로그아웃 후
  //     같은 소셜로 재로그인). 백엔드가 (provider, providerId)로 같은 유저를 돌려주므로,
  //     재온보딩으로 새로 입력한 값이 서버 프로필을 덮어쓰면 안 된다.
  async function handleOnboardingComplete({
    data,
    login,
    skipped,
  }: OnboardingResult): Promise<OnboardingCompleteStatus> {
    const isExistingAccount = skipped || login.isNewUser === false;
    if (!isExistingAccount) {
      // 신규 유저 — 프로필 등록(닉네임 중복 검증 포함)이 성공해야 온보딩 완료(GROMO-617/618).
      // 실패 시 완료 플래그·유저 상태를 세팅하지 않고 결과만 돌려줘 게이트를 유지한다
      // (OnboardingFlow가 닉네임 재입력/재시도 UI를 띄운다).
      const sync = await syncOnboardingToServer(data);
      if (sync !== 'ok') return sync;
      // 목표 선택(W4) — 리그 화면이 기본 시험 리그로 읽는다. 서버 필드 협의 전까지 로컬 보관.
      if (data.focusCategory) {
        await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, data.focusCategory);
      }
      // 집중·사용시간 목표(W12) 보관.
      setOnboardingFocusGoalSeconds(data.dailyFocusMinutes ? data.dailyFocusMinutes * 60 : null);
      setOnboardingScreenTimeGoalSeconds(data.usageGoalMinutes ? data.usageGoalMinutes * 60 : null);
    }
    await AsyncStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    setOnboarded(true);
    // 소셜·게스트 모두 W15에서 실제 JWT 세션을 발급받고 온다(게스트=POST /auth/guest).
    // 세션(토큰/유저)은 auth.ts가 이미 저장 — 여기선 화면 상태만 세팅.
    const userId = getUserIdFromToken(login.accessToken);
    if (isExistingAccount) {
      // 기존 계정 — 로그인 프로필(닉네임 등)을 그대로 사용, 온보딩 값으로 덮어쓰지 않음.
      setUser({ ...login, userId });
    } else {
      setUser({ ...login, userId, nickname: data.nickname.trim() });
    }
    return 'ok';
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
        onLogin={async (u: LoginResult) => {
          const userId = getUserIdFromToken(u.accessToken);
          setUser({ ...u, userId });
        }}
      />
    ) : (
      // 신규 유저 → 온보딩 플로우(V3: W1 오프닝 → … → W14 시작 → W15 로그인).
      <OnboardingFlow onComplete={handleOnboardingComplete} />
    );
  } else {
    content = (
      <UserProvider
        key={user?.userId ?? 'guest'}
        initialNickname={user?.nickname}
        initialUserId={user?.userId}
        initialIsGuest={user?.isGuest}
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
                {/* 업로드 실패로 대기열에 남은 집중 세션 재전송(앱 시작·포그라운드 복귀) */}
                <PendingFocusUploader />
                {/* 로그인 상태에서 푸시 권한·토큰 등록·수신 배선 */}
                <PushGate />
                {/* 예약된 목표('내일부터 적용')가 발효일 지나면 반영 */}
                <PendingGoalApplier />
                <RootNavigator />
              </SubjectProvider>
            </FocusProvider>
          </EquipmentProvider>
        </CoinProvider>
      </UserProvider>
    );
  }

  // SafeAreaProvider 루트 — v2 LoginScreen 등 NavigationContainer 밖 화면도 SafeAreaView 사용 가능.
  // initialMetrics: 첫 프레임부터 안전영역 인셋을 확정해 콜드스타트 레이아웃 점프(하단 CTA 튐) 방지.
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>{content}</SafeAreaProvider>;
}

const s = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.paper },
});
