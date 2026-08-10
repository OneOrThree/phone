import { useState, useEffect, useRef } from 'react';
import { Text, TextInput, AppState } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Settings as FacebookSettings } from 'react-native-fbsdk-next';
import { HotUpdater } from '@hot-updater/react-native';
import {
  getAuthSessionGeneration,
  getUserIdFromToken,
  setLogoutHandler,
  setReloginHandler,
} from '@/services/api';
import { setAccountSwitchHandler, logout } from '@/services/auth';
import { syncAdTracking, logCompleteRegistration } from '@/services/tracking';
import { todayStr } from '@/utils/localDate';
import {
  setupProfile,
  getMyProfile,
  updateScreenTimePermission,
  updateOccupation,
  updateProfile,
  deleteDeviceToken,
} from '@/services/userApi';
import { clearInbox } from '@/services/notificationInbox';
import StudyWidgetModule from '@/services/StudyWidgetModule';
import { recordAccessDay } from '@/services/storeReview';
import { occupationForCategory, categoryForOccupation } from '@/constants/focusCategories';
import { getDeviceCountryCode } from '@/utils/deviceLocale';
import { runStorageMigrations } from '@/utils/storageMigration';
import { resetServerZone, setServerZone } from '@/utils/serverZone';
import { markOtaSplashShown } from '@/utils/otaGate';
import { preloadTapSound } from '@/utils/sound';
import * as ScreenOrientation from 'expo-screen-orientation';
import { STORAGE_KEYS } from '@/types/storage';
import type { LoginResult, UserProfile } from '@/types/api';

import BrandSplash from '@/components/BrandSplash';
import { UserProvider } from '@/store/UserContext';
import { CoinProvider, transferOwnedItems } from '@/store/CoinContext';
import { EquipmentProvider, transferEquipment } from '@/store/EquipmentContext';
import { CharacterProvider, transferCharacter } from '@/store/CharacterContext';
import { FocusProvider } from '@/store/FocusContext';
import { SubjectProvider } from '@/store/SubjectContext';
import { RootNavigator } from '@/navigation/RootNavigator';
import { RageTapDetector } from '@/components/RageTapDetector';
import { DeepLinkGate } from '@/components/DeepLinkGate';
import { OrphanFocusSettler } from '@/screens/focus/OrphanFocusSettler';
import { abortTagEdits } from '@/screens/focus/tagSync';
import { abortFocusRestore } from '@/screens/focus/focusRestore';
import { PendingFocusUploader } from '@/screens/focus/PendingFocusUploader';
import { PushGate } from '@/components/PushGate';
import { PendingGoalApplier } from '@/components/PendingGoalApplier';
import { ScreenTimeSyncer } from '@/components/ScreenTimeSyncer';
import LoginScreen from '@/screens/LoginScreen';
import OnboardingFlow, {
  type OnboardingCompleteStatus,
  type OnboardingResult,
  type V2OnboardingData,
} from '@/screens/onboarding';

// Facebook SDK 초기화 — 앱 시작 시 1회.
FacebookSettings.initializeSDK();

// 준비 시험 백필(GROMO-758) — 서버 occupation(757)을 로컬 focusCategory로 복원한다.
// 준비 시험 표시(useFocusCategory)가 로컬 전용이라 재로그인·새 기기에선 '미설정'이 되는 문제 대응.
// 로컬 값이 있으면 유지(설정 화면의 로컬 변경 → 서버 동기 흐름과 충돌 방지), 757 배포 전(필드 없음)엔 no-op.
async function backfillFocusCategory(profile: { occupation?: unknown }): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(STORAGE_KEYS.focusCategory);
    if (existing) return;
    const occupation = typeof profile.occupation === 'string' ? profile.occupation : null;
    const category = categoryForOccupation(occupation);
    if (category) await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, category);
  } catch {}
}

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
// 온보딩 로그인은 '중간' 단계(OnboardingFlow가 내부에서 처리) — 공감 스텝들 뒤에 소셜/게스트
// 로그인(게스트도 /auth/guest로 실제 세션 발급)하고, 이후 스텝은 토큰이 필요한 서버 호출을 쓴다.

// v2 온보딩 수집 데이터를 서버로 전송. 로그인 상태에서만(토큰 발급 후) 호출.
// (1) POST /users/me — 프로필 설정: nickname → nickname,
//     usageGoalMinutes(W12) → dailyScreenTimeGoalMinutes,
//     dailyFocusMinutes(W12) → dailyFocusTimeGoalMinutes.
//     닉네임 중복이면 409(NICKNAME_DUPLICATE) — 닉네임 스텝이 실시간 중복확인(GROMO-1215)을
//     하지만 검사 응답은 stale할 수 있어, 여기 409가 중복 검증의 최종 방어다(GROMO-618).
//     실패를 삼키지 않고 결과를 돌려줘 OnboardingFlow가 재입력/재시도를 처리한다.
// (2) PATCH /users/me/screen-time-permission — 스크린타임 권한 허용 여부(W10).
//     프로필 셋업 요청엔 권한 필드가 없어 별도 엔드포인트로 보낸다.
//     screenTimeGranted === null(아직 안 물어봄)이면 스킵.
// focusCategory(W4)는 서버 Occupation(19종, GROMO-631)과 전 카테고리 1:1 매핑 —
// PATCH /users/me/occupation 으로 서버에도 동기화 → 같은 카테고리 리그 랭킹(?category=)·비교 통계 모수.
// notificationGranted는 현재 온보딩에서 수집하지 않는다 — 알림 권한 요청은 푸시 등록(services/push.ts)이 유일 지점.
// 반환: 프로필 등록 결과 — 'ok'가 아니면 호출부가 온보딩 완료 처리를 보류한다(GROMO-617/618).
async function syncOnboardingToServer(data: V2OnboardingData): Promise<OnboardingCompleteStatus> {
  const body = {
    nickname: data.nickname.trim(),
    dailyScreenTimeGoalMinutes: data.usageGoalMinutes ?? undefined,
    dailyFocusTimeGoalMinutes: data.dailyFocusMinutes ?? undefined,
    // 기기 로케일 국가코드 — 서버가 유저 타임존(ZoneId) 파생에 사용(GROMO-663). 확정 불가면 생략.
    countryCode: getDeviceCountryCode(),
  };
  try {
    // 프로필은 온보딩이 수집한 필드만 부분 바디로 보낸다(서버 필수는 nickname뿐).
    await setupProfile(body);
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

function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(false);
  // 온보딩에서 받은 두 목표 — 집중·사용시간 목표(W12)를 각각 보관.
  const [onboardingFocusGoalSeconds, setOnboardingFocusGoalSeconds] = useState<number | null>(null);
  const [onboardingScreenTimeGoalSeconds, setOnboardingScreenTimeGoalSeconds] = useState<
    number | null
  >(null);
  // 온보딩 누끼 체험에서 만든 캐릭터 경로 — CharacterProvider가 하이드레이션 시 시드한다(장착은 안 함).
  const [onboardingCutoutUri, setOnboardingCutoutUri] = useState<string | null>(null);
  // applyStoredSession이 [] effect에서 1회 등록돼 user 클로저가 낡는다 — 현재 userId는 ref로 참조.
  const currentUserIdRef = useRef<string | null>(null);
  currentUserIdRef.current = user?.userId ?? null;

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
      // 서버 날짜 버킷 존(GROMO-1252) — 캐시된 프로필로 먼저 세운다. 프로필 조회가 실패(오프라인)해도
      // 지난 실행에서 받은 존이 유지되고, 한 번도 못 받았으면 모듈 폴백(Asia/Seoul)이 남는다.
      setServerZone(data.timeZone);
      try {
        const profile = await getMyProfile();
        setServerZone(profile.timeZone);
        const merged = { ...data, ...profile };
        await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(merged));
        await backfillFocusCategory(merged); // 준비 시험 복원(GROMO-758)
        setUser({ ...merged, userId });
        // GROMO-663: 기존 유저 백필 — 프로필에 countryCode 없으면 기기 로케일로 1회 PATCH.
        // 앱 진입을 막지 않도록 fire-and-forget(실패 시 다음 실행에 재시도).
        if (!profile.countryCode) {
          const countryCode = getDeviceCountryCode();
          if (countryCode) updateProfile({ countryCode }).catch(() => {});
        }
      } catch {
        setUser({ ...data, userId });
      }
      setLoading(false);
    })();
  }, []);

  // 버튼 탭 효과음 프리로드 — 첫 탭에서 플레이어를 만들면 재생이 눈에 띄게 늦는다.
  useEffect(() => {
    preloadTapSound();
  }, []);

  // 앱 전역 세로 고정(GROMO-973) — 집중 세션 화면만 가로를 허용하고 나머지는 세로로 잠근다.
  // (집중 화면이 가로를 열고, 화면을 벗어날 때 다시 PORTRAIT_UP으로 되돌린다.)
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // ATT(추적 동의) 팝업 — 홈 진입 시점 1회(기존 유저는 앱 시작, 신규 유저는 온보딩 완료 직후).
  // 온보딩 도중의 알림·스크린타임 권한 요청 구간과 겹치지 않게 onboarded 이후로 미룬다(GROMO-890).
  useEffect(() => {
    if (onboarded) syncAdTracking();
  }, [onboarded]);

  // 앱 접속 누적일 기록(GROMO-980) — 별점 요청 조건(누적 7일)용. 앱 시작 + 포그라운드 복귀마다
  // 호출하되 하루 1회만 증가한다(자정을 넘겨 복귀하는 세션도 그날치로 반영).
  useEffect(() => {
    recordAccessDay();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') recordAccessDay();
    });
    return () => sub.remove();
  }, []);

  async function handleLogout() {
    const logoutSessionGeneration = getAuthSessionGeneration();
    // 서버 디바이스 토큰 등록 해제 — 이전 계정 푸시가 이 기기로 계속 발송되지 않게(PR 224 리뷰).
    // 아래 multiRemove로 토큰이 지워지기 전, 인증이 살아있을 때 호출해야 한다.
    // 토큰을 명시해 bare 요청으로 보낸다 — 공유 api 경유 시 만료 토큰이면 401 인터셉터가
    // 이 함수(로그아웃)를 재발동시킬 수 있다(PR 226 리뷰).
    try {
      const accessToken = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
      if (accessToken) await deleteDeviceToken(accessToken);
    } catch {}
    // 디바이스 토큰 해제 대기 중 새 인증이 시작됐다면 새 refresh token을 읽어 서버에서
    // 무효화하면 안 된다. 두 번째 서버 요청 전에 이전 로그아웃의 소유권을 재검증한다.
    if (getAuthSessionGeneration() !== logoutSessionGeneration) return;
    try {
      const refreshToken = await AsyncStorage.getItem(STORAGE_KEYS.refreshToken);
      // 저장소 읽기도 비동기다. 그 사이 새 인증이 토큰을 교체했다면 방금 읽은 refresh token은
      // 새 세션 소유일 수 있으므로 서버 logout에 넘기기 직전에 다시 확인한다.
      if (getAuthSessionGeneration() !== logoutSessionGeneration) return;
      if (refreshToken) await logout(refreshToken);
    } catch {}
    // 위 네트워크 대기 중 새 로그인/게스트 승격이 시작됐다면 이 로그아웃은 이전 세션의
    // 작업이다. 새 세션의 토큰·캐시·React 상태를 지우지 않고 여기서 끝낸다.
    if (getAuthSessionGeneration() !== logoutSessionGeneration) return;
    // 대기 중인 태그 편집 동기화 폐기 — 이전 계정의 편집이 다음 계정 토큰으로 실행되지 않게(리뷰 반영)
    abortTagEdits();
    // 공유 복원 스냅샷 폐기(캐시+진행 중 조회 무효화) — 재로그인 프로바이더가 이전 계정
    // 스냅샷을 재사용하지 않게. 아래 multiRemove보다 먼저여야 함(코덱스 리뷰).
    abortFocusRestore();
    // 서버 날짜 버킷 존도 폴백으로 되돌린다(GROMO-1252 5차 ②) — 다음 계정의 프로필 조회가 실패하면
    // setServerZone이 직전 값을 유지해 이전 계정 존으로 업로드 키가 나간다.
    resetServerZone();
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
      STORAGE_KEYS.subjects, // 이전 계정 과목 목록·과목별 오늘 누적이 새 계정에 노출되지 않게(GROMO-677)
      STORAGE_KEYS.focus, // 이전 계정 '오늘 집중' 총합이 새 계정 홈에 남지 않게(GROMO-677)
      // equipment·ownedItems는 여기서 지우지 않는다 — 지우는 방식은 아직 마운트된 이전
      // Provider가 지운 키에 도로 써넣는 레이스가 있고, 보유 아이템은 아이템 API 부재로
      // 로컬이 유일한 구매 기록이다. 각 Context가 계정별 맵으로 분리 보관해 누출을
      // 막는다(GROMO-936 코덱스 리뷰).
      // 이전 계정의 축하 기록이 새 계정 축하를 막거나, 예약된 모달이 새 계정에 뜨지 않게(PR 225 리뷰)
      STORAGE_KEYS.focusGoalCelebratedDate,
      STORAGE_KEYS.focusGoalCelebratePending,
      STORAGE_KEYS.screentimeLastRewardedDate,
      STORAGE_KEYS.screentimeCelebratePending,
    ]);
    // multiRemove가 네이티브 큐에서 실행되는 동안 새 인증 시도가 시작될 수 있다. 인증 저장은
    // 이 삭제 뒤에 큐잉되므로 토큰은 보존되지만, 아래 인메모리 초기화까지 실행하면 방금 로그인한
    // 사용자를 다시 로그인 화면으로 보내므로 세대를 한 번 더 확인한다.
    if (getAuthSessionGeneration() !== logoutSessionGeneration) return;
    // 알림 보관함 정리 — multiRemove가 아니라 보관함 쓰기 큐를 태워, 직전에 수신된 푸시의
    // 저장이 옛 목록을 도로 써넣는 레이스를 막는다(PR 224 리뷰).
    await clearInbox();
    if (getAuthSessionGeneration() !== logoutSessionGeneration) return;
    // 안드로이드 홈 위젯 스냅샷 초기화 — 위젯이 읽는 네이티브 SharedPreferences는 위
    // multiRemove로 안 지워져 이전 계정 과목·공부시간이 런처에 남는다(GROMO-1006 코드리뷰 반영).
    StudyWidgetModule.updateTopSubjects([]).catch(() => {});
    setOnboardingFocusGoalSeconds(null);
    setOnboardingScreenTimeGoalSeconds(null);
    setOnboardingCutoutUri(null);
    setOnboarded(false);
    setUser(null);
  }

  // 게스트가 설정 화면에서 소셜 로그인하면 auth.ts가 토큰/유저를 이미 저장한다.
  // 로그아웃 없이 저장된 세션을 다시 읽어 인메모리 상태(user)를 새 소셜 계정으로 교체한다.
  // (UserProvider는 아래 key(user.userId)로 리마운트되어 새 userId를 반영한다.)
  async function applyStoredSession(fromGuest: boolean) {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.user);
    if (!raw) return;
    const data = JSON.parse(raw) as UserProfile;
    const userId = getUserIdFromToken(data.accessToken ?? '');
    // 로그아웃 없이 계정이 바뀌는 유일한 경로 — 다른 계정(userId 변경)으로 갈아탄 경우엔
    // 로그아웃과 동일하게 이전 계정 디바이스 캐시를 정리해 누출을 막는다(GROMO-677 리뷰).
    // 세션·온보딩 키는 새 계정 것이 이미 저장돼 있으므로 유지. 같은 userId(계정 연결)면 그대로 둔다.
    if (currentUserIdRef.current && userId && currentUserIdRef.current !== userId) {
      // 태그 편집 큐 폐기는 여기가 아니라 토큰 저장 직전(auth.ts postAuthSave → setAccountSwitchHandler)에
      // 실행된다 — 이 시점엔 새 토큰이 이미 저장돼 늦다(PR 200 리뷰).
      // 게스트 → 소셜 전환이면 게스트 UUID 버킷의 로컬 구매·장착 기록을 새 계정으로 인계.
      // 이전·새 userId를 모두 아는 이 시점에만 수행 — 고정 게스트 버킷 방식은 로그아웃 후에도
      // 남아 다음 게스트·무관 계정에 누출된다(코덱스 리뷰). 전환 여부(fromGuest)는 게스트 판별
      // 주체인 AccountScreen이 넘긴다 — isGuest 태깅 없는 구 세션도 연동 목록 기준으로
      // 게스트일 수 있어 프로필 플래그만으론 놓친다(코덱스 리뷰).
      if (fromGuest) {
        const prevUserId = currentUserIdRef.current;
        // 인계 실패는 1회 재시도, 그래도 실패하면 전환은 진행한다 — 토큰이 이미 교체돼
        // 되돌릴 수 없고, 쓰기가 계속 실패하는 상황은 앱 영속성 전체가 깨진 경우다(코덱스 리뷰).
        await transferOwnedItems(prevUserId, userId)
          .catch(() => transferOwnedItems(prevUserId, userId))
          .catch(() => {});
        await transferEquipment(prevUserId, userId)
          .catch(() => transferEquipment(prevUserId, userId))
          .catch(() => {});
        await transferCharacter(prevUserId, userId)
          .catch(() => transferCharacter(prevUserId, userId))
          .catch(() => {});
      }
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.focusCategory,
        STORAGE_KEYS.goalPending,
        STORAGE_KEYS.focusPendingUploads,
        STORAGE_KEYS.notificationSettings,
        STORAGE_KEYS.statVisibility,
        STORAGE_KEYS.focusFirstDone,
        STORAGE_KEYS.subjects,
        STORAGE_KEYS.focus,
        // equipment·ownedItems는 계정별 맵이라 지우지 않는다(GROMO-936, 위 handleLogout 주석 참고)
        STORAGE_KEYS.focusGoalCelebratedDate,
        STORAGE_KEYS.focusGoalCelebratePending,
        STORAGE_KEYS.screentimeLastRewardedDate,
        STORAGE_KEYS.screentimeCelebratePending,
      ]);
      await clearInbox(); // 보관함은 쓰기 큐로 정리(위 handleLogout과 동일 이유)
      // 홈 위젯도 이전 계정 데이터 정리(위 handleLogout과 동일) — 새 계정 값은
      // SubjectProvider 리마운트 복원이 다시 채운다
      StudyWidgetModule.updateTopSubjects([]).catch(() => {});
    }
    await AsyncStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    setOnboarded(true);
    try {
      const profile = await getMyProfile();
      setServerZone(profile.timeZone); // 서버 날짜 버킷 존(GROMO-1252)
      const merged = { ...data, ...profile };
      await backfillFocusCategory(merged); // 준비 시험 복원(GROMO-758)
      setUser({ ...merged, userId });
    } catch {
      setUser({ ...data, userId });
    }
  }

  // 온보딩 완료(중간 로그인 세션 + 수집 데이터) → 플래그 저장 + 유저 설정 → 홈 진입.
  // 기존 계정엔 온보딩 수집값을 덮어쓰지 않는다(프로필·목표·로컬 상태 모두):
  //   - login.isNewUser === false : 재로그인이면 기존 유저(예: 로그아웃 후 같은 소셜로 재로그인).
  //     백엔드가 (provider, providerId)로 같은 유저를 돌려주므로, 새로 입력한 값이 서버 프로필을
  //     덮어쓰면 안 된다. (중간 로그인에서 isNewUser === false면 남은 온보딩을 건너뛰고 바로 확정.)
  async function handleOnboardingComplete({
    data,
    login,
  }: OnboardingResult): Promise<OnboardingCompleteStatus> {
    const isExistingAccount = login.isNewUser === false;
    if (!isExistingAccount) {
      // 신규 유저 — 프로필 등록(닉네임 중복 검증 포함)이 성공해야 온보딩 완료(GROMO-617/618).
      // 실패 시 완료 플래그·유저 상태를 세팅하지 않고 결과만 돌려줘 게이트를 유지한다
      // (OnboardingFlow가 닉네임 재입력/재시도 UI를 띄운다).
      const sync = await syncOnboardingToServer(data);
      if (sync !== 'ok') return sync;
      // 신규 가입 확정 — 광고 소재별 '설치 후 실제 사용' 판단용 온보딩 완료 이벤트(GROMO-890).
      // 재로그인(isExistingAccount)·세션 복원 경로에는 넣지 않는다(가입이 아니므로 중복 집계 방지).
      // ATT 동의 반영을 이벤트 전송보다 먼저 끝내야 동의 유저의 개인 단위 매칭이 산다 — onboarded
      // 이펙트는 이 함수가 끝난 뒤에야 돌아 순서를 보장하지 못한다(PR 321 코덱스 리뷰). 이펙트에서
      // 한 번 더 돌지만 결정된 동의 상태를 재적용할 뿐이라 무해(팝업은 미결정일 때만 1회).
      await syncAdTracking();
      logCompleteRegistration();
      // 목표 선택(W4) — 리그 화면이 기본 시험 리그로 읽는다. 서버 필드 협의 전까지 로컬 보관.
      if (data.focusCategory) {
        await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, data.focusCategory);
      }
      // 과목 확인(W5) 결과를 실제 과목 목록으로 저장 — SubjectProvider는 user 세팅 후 마운트되므로
      // 여기서 저장하면 첫 로드가 이 목록을 읽는다. 저장 안 하면 신규 계정은 서버 태그도 비어 있어
      // 과목 0개로 시작하는 문제(PR 200 리뷰). color는 로드 시 팔레트 자동 배정, 서버 태그 생성은
      // 세션 업로드 시 ensureFocusTagId가 find-or-create로 자가치유.
      if (data.subjects.length > 0) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.subjects,
          JSON.stringify({
            date: todayStr(),
            subjects: data.subjects.map((name, i) => ({
              id: `subj-ob-${i}`,
              name,
              accumulatedSeconds: 0,
            })),
          }),
        );
      }
      // 집중·사용시간 목표(W12) 보관.
      setOnboardingFocusGoalSeconds(data.dailyFocusMinutes ? data.dailyFocusMinutes * 60 : null);
      setOnboardingScreenTimeGoalSeconds(data.usageGoalMinutes ? data.usageGoalMinutes * 60 : null);
      // 누끼 체험(W13.5)에서 만든 캐릭터 보관 — CharacterProvider가 새 계정 버킷에 시드한다.
      setOnboardingCutoutUri(data.cutoutCharacterUri ?? null);
    }
    await AsyncStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    setOnboarded(true);
    // 소셜·게스트 모두 중간 로그인 노드에서 실제 JWT 세션을 발급받고 온다(게스트=POST /auth/guest).
    // 세션(토큰/유저)은 auth.ts가 이미 저장 — 여기선 화면 상태만 세팅.
    const userId = getUserIdFromToken(login.accessToken);
    if (isExistingAccount) {
      // 기존 계정 — 로그인 프로필(닉네임 등)을 그대로 사용, 온보딩 값으로 덮어쓰지 않음.
      // 로그아웃/새 기기에선 온보딩 중간 로그인이 기존 계정의 주 진입로라 여기서도 백필(GROMO-758 리뷰).
      await backfillFocusCategory(login); // postAuthSave가 /users/me를 병합해 occupation이 실려 옴
      setUser({ ...login, userId });
    } else {
      setUser({ ...login, userId, nickname: data.nickname.trim() });
    }
    return 'ok';
  }

  useEffect(() => {
    setLogoutHandler(handleLogout);
    // 반환된 Promise로 호출부(AccountScreen)가 세션 교체 완료까지 대기한다.
    setReloginHandler((opts) => applyStoredSession(opts?.fromGuest ?? false));
    // 계정이 바뀌는 토큰 교체 직전, 이전 계정 인증이 살아있을 때 뒷정리(PR 200 리뷰 — applyStoredSession은 늦음):
    // 태그 편집 큐 폐기 + 서버 디바이스 토큰 등록 해제(이전 계정 푸시가 이 기기로 오지 않게, PR 224 리뷰).
    // 해제 요청은 넘겨받은 이전 계정 토큰으로 보낸다 — 공유 api 경유 시 만료 토큰이면 401
    // 인터셉터가 전역 로그아웃을 발동시켜 방금 로그인한 계정이 풀릴 수 있다(PR 226 리뷰).
    setAccountSwitchHandler(async (prevAccessToken) => {
      abortTagEdits();
      // 이전 계정 복원 스냅샷 폐기(캐시+진행 중 조회 무효화) — applyStoredSession의 스토리지
      // 클리어·새 계정 프로바이더 리마운트보다 먼저 실행되는 지점(코덱스 리뷰).
      abortFocusRestore();
      // 이전 계정 서버 존 폐기(GROMO-1252 5차 ②) — 새 계정 프로필 조회가 실패해도 폴백(Asia/Seoul)에서
      // 시작하도록. 성공하면 곧바로 postAuthSave의 setServerZone이 새 계정 존으로 덮어쓴다.
      resetServerZone();
      await deleteDeviceToken(prevAccessToken).catch(() => {});
    });
  }, []);

  let content;
  if (loading) {
    // 프로필 대기 화면 — OTA 준비 화면(OtaUpdateGateScreen)과 같은 비주얼로 통일해
    // 두 로딩이 끊김 없이 이어져 보이게 한다(GROMO-1029). 이 단계엔 진행%가 없어
    // OTA와 같은 응원 문구만 고정 노출(퍼센트만 빠짐).
    content = <BrandSplash caption="오늘 집중도 화이팅!!" />;
  } else if (!user) {
    content = onboarded ? (
      // 온보딩 완료한 재방문 유저(로그아웃 상태) → 바로 로그인.
      <LoginScreen
        onLogin={async (u: LoginResult) => {
          const userId = getUserIdFromToken(u.accessToken);
          // 기존 계정 로그인이면 postAuthSave가 /users/me를 병합해 occupation이 실려 온다
          await backfillFocusCategory(u); // 준비 시험 복원(GROMO-758)
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
            <CharacterProvider initialCustomUri={onboardingCutoutUri ?? undefined}>
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
                  {/* 스크린타임 사용량 서버 동기화(어제 마감 + 오늘 중간값, 앱 시작·포그라운드 복귀) */}
                  <ScreenTimeSyncer />
                  <RootNavigator />
                </SubjectProvider>
              </FocusProvider>
            </CharacterProvider>
          </EquipmentProvider>
        </CoinProvider>
      </UserProvider>
    );
  }

  // SafeAreaProvider 루트 — v2 LoginScreen 등 NavigationContainer 밖 화면도 SafeAreaView 사용 가능.
  // initialMetrics: 첫 프레임부터 안전영역 인셋을 확정해 콜드스타트 레이아웃 점프(하단 CTA 튐) 방지.
  // RageTapDetector — 전역 연타(좌절 신호) 계측. UI 없이 터치 버블링만 관찰(GROMO-782).
  // DeepLinkGate — 딥링크(그룹 초대) 수신. **인증 분기 밖**에 둔다: 로그인·온보딩 화면에서
  // 누른 초대 링크도 버퍼에 담겨야 로그인 후 같은 그룹 프리뷰로 이어진다(§6-6).
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <DeepLinkGate />
      <RageTapDetector>{content}</RageTapDetector>
    </SafeAreaProvider>
  );
}

// OTA 준비 화면 — 온보딩 진입 스플래시와 같은 구성(캐릭터+GROMO)에 응원 문구,
// 다운로드 중임은 퍼센트로만 표시(BrandSplash 공통 비주얼 재사용, GROMO-1029). 노출 기록은
// 렌더 도중이 아니라 커밋(마운트) 후에 남긴다 — 커밋되지 않고 버려진 렌더가 온보딩 스플래시를
// 잘못 스킵시키지 않도록(코드리뷰 P2).
function OtaUpdateGateScreen({ progress }: { progress: number }) {
  useEffect(() => {
    markOtaSplashShown();
  }, []);
  const caption = `오늘 집중도 화이팅!!${progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}`;
  return <BrandSplash caption={caption} />;
}

// hot-updater OTA 게이트(GROMO-875) — 릴리즈 빌드 시작 시 새 JS 번들을 확인하고,
// 있으면 내려받는 동안 준비 화면으로 진입을 막았다가 적용한다. 없으면 즉시 통과.
// baseURL은 공개 엔드포인트(비밀값 아님). 채널은 네이티브 설정(HOT_UPDATER_CHANNEL=production)을 따른다.
const OtaWrappedApp = HotUpdater.wrap({
  baseURL: 'https://ohwgkgbhzvnbtxfewosa.supabase.co/functions/v1/update-server',
  updateStrategy: 'appVersion',
  fallbackComponent: OtaUpdateGateScreen,
  // 제네릭 명시 — index.ts의 Sentry.wrap이 요구하는 props 타입(Record<string, unknown>)에 맞춘다.
})<Record<string, unknown>>(App);

// E2E(Maestro) 빌드는 OTA 게이트를 우회한다(GROMO-947) — 대본 실행 중 스테일 OTA 번들이
// 내려와 testID 없는 구 JS로 교체되는 오염 방지. EXPO_PUBLIC_E2E는 scripts/e2e.sh가 빌드 시 주입.
export default process.env.EXPO_PUBLIC_E2E === '1' ? App : OtaWrappedApp;
