// ScreenTimeModule.ts
// 스크린타임 네이티브 모듈의 JS 래퍼
//
// 역할: 네이티브 모듈을 JS에서 편하게 쓸 수 있게 감싸는 유틸
// NativeModules에서 직접 꺼내 쓰는 것보다 이 파일을 import해서 쓰는 게 깔끔함
//  - iOS: ScreenTimeModule.swift (구식 브릿지, NativeModules) — 함수 계약 20개 전체 구현
//  - Android: app/modules/screen-time (Expo 모듈, GROMO-994) — M1(권한·오늘/어제 조회·목표
//    저장) + M2(GROMO-995, 앱 선택 피커: 측정 대상·집중 허용앱) 범위 구현. 피커 UI는 네이티브가
//    아니라 RN 화면(AndroidAppPickerHost)이라, presentAppPicker 계열은 androidAppPicker 브릿지로
//    호스트 모달을 띄우고 선택 결과로 resolve한다 — 호출부 계약은 iOS와 동일.
//    M3(GROMO-996) — 집중 실드(포그라운드 서비스 폴링 차단)·잠금화면 타이머(chronometer 알림)·
//    캐릭터 스냅샷·브라우저 허용 토글 라우팅. 어제 결과 판정 등은 M4에서 확장.

import { Alert, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { presentAndroidAppPicker } from '@/services/androidAppPicker';
import { STORAGE_KEYS } from '@/types/storage';

export type AuthorizationStatus = 'approved' | 'denied' | 'notDetermined';

// presentAppPicker가 반환하는 선택 개수
export interface AppSelectionCounts {
  applications: number;
  categories: number;
  webDomains: number;
}

// 사용량 버킷 측정 상태 디버그 정보(개발용, GROMO-931) — App Group 기록 원본.
// 전체 탭 dev 패널이 15분 눈금 동작 확인에 쓴다. 판정 로직에는 쓰지 않는다.
export interface UsageBucketDebugInfo {
  bucketMinutes: number; // 오늘 도달 최고 눈금(재등록 베이스 합산)
  bucketDate: string; // 눈금이 기록된 날짜 'YYYY-MM-DD'
  baseMinutes: number; // 재등록 베이스(등록 전 오늘 기록)
  baseDate: string;
  registeredAt: number; // 버킷 모니터 등록 시각(epoch 초, 0=기록 없음)
  prevBucketMinutes: number; // 하루 경계에 보존된 전일 최종 눈금
  prevBucketDate: string;
  promotedOkDate: string; // 익스텐션이 자정 승격+버킷 등록에 성공한 날짜(백업 재등록 스킵 판단용)
  log: string[]; // 콜백·등록 이벤트 로그(시각+내용, 오래된 순, 최대 50줄)
}

// Swift 네이티브 모듈 인터페이스 (실기기 iOS에서만 실제 구현 존재)
interface NativeScreenTime {
  requestAuthorization(): Promise<boolean>;
  getAuthorizationStatus(): Promise<AuthorizationStatus>;
  setGoalSeconds(seconds: number): Promise<void>;
  stopGoalMonitoring(): Promise<boolean>;
  startUsageBucketMonitoring(maxMinutes: number): Promise<boolean>;
  getTodayUsageBucketMinutes(): Promise<number>;
  getYesterdayUsageBucketMinutes(): Promise<number>;
  getUsageBucketDebugInfo(): Promise<UsageBucketDebugInfo>;
  setPendingSelectionApplyDate(dateString: string): Promise<boolean>;
  presentAppPicker(): Promise<AppSelectionCounts | null>;
  promoteSelection(): Promise<boolean>;
  presentAllowedAppPicker(): Promise<AppSelectionCounts | null>;
  presentAllowedAppManager(): Promise<AppSelectionCounts | null>;
  getAllowedSelectionCounts(): Promise<AppSelectionCounts | null>;
  startFocusShield(subjectName: string): Promise<boolean>;
  stopFocusShield(): Promise<void>;
  setFocusAllowSafariWeb(allowed: boolean): Promise<void>;
  getFocusAllowSafariWeb(): Promise<boolean>;
  saveCharacterSnapshot(base64: string): Promise<boolean>;
  startFocusActivity(subjectName: string, otherSubjectsJson: string): Promise<boolean>;
  endFocusActivity(): Promise<void>;
}

const NativeScreenTimeModule = NativeModules.ScreenTimeModule as NativeScreenTime;

// 안드로이드 설치 앱 항목(GROMO-995) — 피커 목록 표시용.
// iconUri: 네이티브가 캐시 디렉토리에 구운 PNG의 file:// URI(생성 실패 시 빈 문자열 —
// 화면이 이니셜 폴백을 그린다).
export interface AndroidInstalledApp {
  packageName: string;
  label: string;
  iconUri: string;
}

// 안드로이드 Expo 모듈 인터페이스(GROMO-994·995·996) — M1~M3 범위 함수만 네이티브 구현이 있다.
// startUsageBucketMonitoring은 예약 개념이 없어 네이티브 없이 TS에서 no-op true(§4 매핑).
// M2·M3 함수들은 옵셔널 — OTA로 새 JS만 받은 구 바이너리엔 없으므로 호출 전 존재를 확인한다.
interface AndroidNativeScreenTime {
  requestAuthorization(): Promise<boolean>;
  getAuthorizationStatus(): Promise<AuthorizationStatus>;
  setGoalSeconds(seconds: number): Promise<void>;
  getTodayUsageBucketMinutes(): Promise<number>;
  getYesterdayUsageBucketMinutes(): Promise<number>;
  getInstalledApps?(): Promise<AndroidInstalledApp[]>;
  getSelectionPackages?(): Promise<string[] | null>;
  setPendingSelection?(packages: string[]): Promise<void>;
  promoteSelection?(): Promise<boolean>;
  getAllowedPackages?(): Promise<string[] | null>;
  setAllowedSelection?(packages: string[]): Promise<void>;
  canDrawOverlays?(): Promise<boolean>;
  requestOverlayPermission?(): Promise<boolean>;
  startFocusShield?(subjectName: string): Promise<boolean>;
  stopFocusShield?(): Promise<void>;
  setFocusAllowSafariWeb?(allowed: boolean): Promise<void>;
  getFocusAllowSafariWeb?(): Promise<boolean>;
  saveCharacterSnapshot?(base64: string): Promise<boolean>;
  startFocusActivity?(subjectName: string, otherSubjectsJson: string): Promise<boolean>;
  endFocusActivity?(): Promise<void>;
  pauseFocusActivity?(): Promise<void>;
  resumeFocusActivity?(): Promise<void>;
  // Expo 모듈 기본 이벤트 구독(onFocusShieldLost — 세션 중 실드 상실 통지, 코드리뷰 반영)
  addListener?(eventName: 'onFocusShieldLost', listener: () => void): { remove: () => void };
}

// 구 바이너리(OTA로 새 JS만 받아 네이티브 모듈이 없는 경우)는 null — 각 함수가 기존
// 기본값 가드로 폴백해 크래시 없이 동작한다(iOS의 메서드 존재 판별과 같은 취지).
const AndroidScreenTime =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<AndroidNativeScreenTime>('ScreenTimeModule')
    : null;

// 안드로이드 네이티브 스크린타임 모듈 가용 여부 — OTA로 새 JS만 받은 구 바이너리는 모듈이
// 없어 false. 이 경우 requestAuthorization도 설정 화면을 못 열므로, 화면 쪽은 권한 CTA 같은
// M1 UI 대신 M1 이전 placeholder를 유지해야 한다(코드리뷰 반영).
export const androidNativeModuleAvailable = (): boolean => AndroidScreenTime != null;

// 네이티브 바이너리가 15분 눈금(GROMO-931) 빌드인지 — 같은 빌드에 추가된
// getUsageBucketDebugInfo 존재로 판별한다. OTA로 새 JS만 받은 구 바이너리는 여전히 30분
// 눈금을 등록하므로, 등록 마커가 실제 눈금과 어긋나지 않게 하는 데 쓴다(코드리뷰 반영).
export const nativeRegistersBucketStep15 = (): boolean =>
  Platform.OS === 'ios' &&
  typeof (NativeModules.ScreenTimeModule as NativeScreenTime | undefined)
    ?.getUsageBucketDebugInfo === 'function';

// 네이티브 바이너리가 A안(GROMO-942, 측정 대상 '다음날 적용')을 지원하는지 — 같은 빌드에 추가된
// setPendingSelectionApplyDate 존재로 판별. OTA로 새 JS만 받은 구 바이너리는 이 메서드도, 자정
// 승격 로직도 없으므로 설정 화면이 '다음날 적용'을 예약하면 영영 적용되지 않는다. 이 경우 설정
// 화면은 예약 대신 즉시 적용으로 폴백한다(코드리뷰 반영).
export const nativeSupportsPendingApplyDate = (): boolean =>
  Platform.OS === 'ios' &&
  typeof (NativeModules.ScreenTimeModule as NativeScreenTime | undefined)
    ?.setPendingSelectionApplyDate === 'function';

// 안드로이드 바이너리가 M2 앱 피커(GROMO-995) 빌드인지 — 같은 빌드에 추가된 getInstalledApps
// 존재로 판별. OTA로 새 JS만 받은 M1 바이너리는 피커를 띄울 수 없어 기존 기본값으로 폴백한다.
const androidSupportsAppPicker = (): boolean =>
  typeof AndroidScreenTime?.getInstalledApps === 'function';

// 안드로이드 피커 호스트(AndroidAppPickerHost) 전용 내부 API — 화면 코드는 쓰지 말 것.
// 저장 계약(iOS와 1:1): 측정 대상은 pending 저장(승격은 호출부의 promoteSelection),
// 집중 허용앱은 즉시 저장. 구 바이너리(M2 함수 없음)는 조회 null·저장 no-op.
export const androidAppPickerNative = {
  getInstalledApps: (): Promise<AndroidInstalledApp[]> =>
    AndroidScreenTime?.getInstalledApps?.() ?? Promise.resolve([]),
  getSelectionPackages: (): Promise<string[] | null> =>
    AndroidScreenTime?.getSelectionPackages?.() ?? Promise.resolve(null),
  setPendingSelection: (packages: string[]): Promise<void> =>
    AndroidScreenTime?.setPendingSelection?.(packages) ?? Promise.resolve(),
  getAllowedPackages: (): Promise<string[] | null> =>
    AndroidScreenTime?.getAllowedPackages?.() ?? Promise.resolve(null),
  setAllowedSelection: (packages: string[]): Promise<void> =>
    AndroidScreenTime?.setAllowedSelection?.(packages) ?? Promise.resolve(),
};

// 오버레이 권한 1회 안내(안드로이드, 코드리뷰 반영) — 실드의 차단 화면은 '다른 앱 위에 표시'
// 권한이 있어야 뜨는데, 요청이 어디에도 배선돼 있지 않으면 전원이 조용히 실드 없는 세션으로
// 강등된다(기본 미허용 권한). 첫 실드 시작 때 한 번만 설정 이동을 안내하고(AsyncStorage 플래그),
// 거절해도 세션은 그대로 진행한다(기존 강등 설계 유지 — 이후 세션은 조용히 강등).
const ensureOverlayPermissionOnce = async (): Promise<void> => {
  if (!AndroidScreenTime?.canDrawOverlays || !AndroidScreenTime.requestOverlayPermission) return;
  if (await AndroidScreenTime.canDrawOverlays()) return;
  // Usage Access가 없으면 실드 자체가 불가 — 오버레이 안내를 띄울 이유가 없다.
  if ((await AndroidScreenTime.getAuthorizationStatus()) !== 'approved') return;
  const prompted = await AsyncStorage.getItem(STORAGE_KEYS.screentimeOverlayPrompted);
  if (prompted) return;
  await AsyncStorage.setItem(STORAGE_KEYS.screentimeOverlayPrompted, '1');
  const goToSettings = await new Promise<boolean>((resolve) => {
    Alert.alert(
      "'다른 앱 위에 표시' 권한이 필요해요",
      '집중하는 동안 다른 앱을 잠그려면 권한을 허용해 주세요.\n허용하지 않아도 집중은 계속할 수 있어요.',
      [
        { text: '나중에', style: 'cancel', onPress: () => resolve(false) },
        { text: '설정으로 이동', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
  // 설정 왕복 후 복귀 시 resolve — 허용됐다면 이어지는 startFocusShield가 실드를 켠다.
  if (goToSettings) await AndroidScreenTime.requestOverlayPermission();
};

// 플랫폼 라우팅 — iOS는 Swift 브릿지, 안드로이드 M1 범위는 Expo 모듈, 그 외(미구현 함수·
// 구 바이너리)는 에러 대신 기본값 반환. 화면 코드 호출부는 플랫폼을 몰라도 된다.
const ScreenTimeModule = {
  // 스크린 타임 접근 권한 요청. 반환값: true(승인) | false(거부)
  // 안드로이드는 시스템 팝업이 없어 Usage Access 설정을 열고 복귀 시 재확인한 결과로 resolve.
  requestAuthorization: async (): Promise<boolean> => {
    if (AndroidScreenTime) return AndroidScreenTime.requestAuthorization();
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.requestAuthorization();
  },

  // 현재 권한 상태 확인 (안드로이드: AppOps 체크 + '설정 보낸 적' 플래그로 notDetermined 구분)
  getAuthorizationStatus: async (): Promise<AuthorizationStatus> => {
    if (AndroidScreenTime) return AndroidScreenTime.getAuthorizationStatus();
    if (Platform.OS !== 'ios') return 'denied';
    return NativeScreenTimeModule.getAuthorizationStatus();
  },

  // 목표 시간 저장 — iOS는 App Group(익스텐션 "남은 시간" 계산용), 안드로이드는 모듈 로컬
  // 저장만(판정 계산은 M4).
  setGoalSeconds: async (seconds: number): Promise<void> => {
    if (AndroidScreenTime) return AndroidScreenTime.setGoalSeconds(seconds);
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.setGoalSeconds(seconds);
  },

  // (GROMO-942) 목표 판정 모니터(gromo.daily) 폐지 — 기존 설치에 남은 등록을 1회 중지하는
  // 마이그레이션용. 반환 true = "정리 완료(또는 정리할 대상 없음)"로 호출부가 1회 마커를 남긴다.
  // iOS 외(gromo.daily가 애초에 없음)는 true. **구 바이너리(OTA로 메서드 없음)는 실제로 중지하지
  // 못하므로 false** — 마커를 안 남겨 새 바이너리 설치 후 재시도되게 한다(코드리뷰 반영).
  stopGoalMonitoring: async (): Promise<boolean> => {
    if (Platform.OS !== 'ios') return true;
    if (typeof NativeScreenTimeModule.stopGoalMonitoring !== 'function') return false;
    return NativeScreenTimeModule.stopGoalMonitoring();
  },

  // 15분 버킷 사용량 모니터링 등록 (maxMinutes까지 15분 간격 threshold).
  // 측정 대상 미선택이면 false. 반환값: 등록 성공 여부.
  // 안드로이드는 조회형이라 예약 개념이 없음 — 모듈이 있으면 no-op true(등록 마커·측정 시작
  // 앵커는 그대로 유효), 구 바이너리(모듈 없음)는 측정 불가라 false.
  startUsageBucketMonitoring: async (maxMinutes: number): Promise<boolean> => {
    if (Platform.OS === 'android') return AndroidScreenTime != null;
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startUsageBucketMonitoring(maxMinutes);
  },

  // 오늘의 사용량(분) — iOS는 Monitor가 기록한 도달 최고 15분 눈금, 안드로이드는 오늘
  // 0시~지금 queryEvents 정확값. 미측정·미구현 시 0.
  getTodayUsageBucketMinutes: async (): Promise<number> => {
    if (AndroidScreenTime) return AndroidScreenTime.getTodayUsageBucketMinutes();
    if (Platform.OS !== 'ios') return 0;
    return NativeScreenTimeModule.getTodayUsageBucketMinutes();
  },

  // 어제의 최종 사용량(분) — iOS는 Monitor가 하루 경계에 보존한 전일 눈금(GROMO-633),
  // 안드로이드는 어제 0시~오늘 0시 queryEvents 정확값(소급 조회). 미측정·미구현 시 0.
  getYesterdayUsageBucketMinutes: async (): Promise<number> => {
    if (AndroidScreenTime) return AndroidScreenTime.getYesterdayUsageBucketMinutes();
    if (Platform.OS !== 'ios') return 0;
    return NativeScreenTimeModule.getYesterdayUsageBucketMinutes();
  },

  // 사용량 버킷 측정 상태 디버그 조회(개발용) — App Group 기록 원본. iOS 외에는 null.
  getUsageBucketDebugInfo: async (): Promise<UsageBucketDebugInfo | null> => {
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.getUsageBucketDebugInfo();
  },

  // A안(GROMO-942) 측정 대상 변경 '다음날 적용' 예약 — App Group에 적용 예정일을 기록해
  // 익스텐션 자정 콜백이 승격 여부를 판단하게 한다. dateString은 'YYYY-MM-DD'(로컬, 보통 내일),
  // 빈 문자열이면 예약 취소. iOS 외/구 바이너리(OTA로 메서드 없음)에는 no-op(false).
  setPendingSelectionApplyDate: async (dateString: string): Promise<boolean> => {
    if (!nativeSupportsPendingApplyDate()) return false;
    return NativeScreenTimeModule.setPendingSelectionApplyDate(dateString);
  },

  // 측정 대상(앱/카테고리) 선택 picker 표시. 취소 시 null.
  // 안드로이드(GROMO-995): 자체 RN 피커(측정 모드) — 선택은 네이티브 pending에 저장되고,
  // iOS와 같은 계약으로 호출부가 promoteSelection으로 승격한다. 구 바이너리는 null(기존 기본값).
  presentAppPicker: async (): Promise<AppSelectionCounts | null> => {
    if (Platform.OS === 'android') {
      return androidSupportsAppPicker() ? presentAndroidAppPicker('measurement') : null;
    }
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.presentAppPicker();
  },

  // 대기 중인 측정 대상을 활성으로 승격 (다음날 적용 시점에 호출)
  // 안드로이드는 조회형이라 승격 즉시 오늘 하루 전체가 새 기준으로 소급 재계산된다(03 문서 §4.4).
  promoteSelection: async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      return AndroidScreenTime?.promoteSelection?.() ?? false;
    }
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.promoteSelection();
  },

  // ── 집중 세션 허용앱 / 실드 (GROMO-553) ──

  // 집중 중 허용앱 선택 picker. 즉시 저장·적용. 취소 시 null.
  // ⚠️ 실드 예외는 개별 앱 토큰만 지원 — 카테고리 선택은 차단 예외로 무시됨.
  // 안드로이드(GROMO-995): 자체 RN 피커(허용 모드) — 완료 시 즉시 저장, 실드(M3)가 이 목록을 읽는다.
  presentAllowedAppPicker: async (): Promise<AppSelectionCounts | null> => {
    if (Platform.OS === 'android') {
      return androidSupportsAppPicker() ? presentAndroidAppPicker('allowed') : null;
    }
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.presentAllowedAppPicker();
  },

  // 허용앱 관리 화면(현재 목록 + 추가/삭제 피커). 완료 시 저장·적용. 스와이프 취소 불가.
  // 안드로이드는 피커가 곧 관리 화면(현재 선택 프리로드 + 추가/해제)이라 허용 모드 피커로
  // 통합한다. iOS 관리 화면과 달리 취소(null)가 가능하지만 호출부는 이미 null을 처리한다.
  presentAllowedAppManager: async (): Promise<AppSelectionCounts | null> => {
    if (Platform.OS === 'android') {
      return androidSupportsAppPicker() ? presentAndroidAppPicker('allowed') : null;
    }
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.presentAllowedAppManager();
  },

  // 저장된 허용앱 선택 개수. 미설정이면 null.
  // 안드로이드는 패키지명 배열 길이 — 카테고리·웹도메인 개념이 없어 0 고정(계약 형태 유지).
  getAllowedSelectionCounts: async (): Promise<AppSelectionCounts | null> => {
    if (Platform.OS === 'android') {
      const packages = (await AndroidScreenTime?.getAllowedPackages?.()) ?? null;
      return packages ? { applications: packages.length, categories: 0, webDomains: 0 } : null;
    }
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.getAllowedSelectionCounts();
  },

  // 집중 세션 실드 켜기 — 허용앱 외 전부 차단. 반환값: 적용 여부(권한 없으면 false).
  // 안드로이드(GROMO-996): 포그라운드 서비스 폴링 차단(03 문서 §5). 사용 정보 접근·오버레이
  // 권한이 없으면 네이티브가 false — 호출부는 iOS 권한 없음과 같은 '실드 없는 세션'(15초
  // 이탈 정책)으로 강등된다. 구 바이너리(M3 함수 없음)도 false로 동일 강등.
  startFocusShield: async (subjectName: string): Promise<boolean> => {
    if (Platform.OS === 'android') {
      // 오버레이 권한이 없으면 1회에 한해 설정 이동을 안내한다(코드리뷰 반영) — 왕복 후에도
      // 미허용이면 네이티브가 false를 반환해 기존 '실드 없는 세션' 강등을 그대로 탄다.
      if (typeof AndroidScreenTime?.startFocusShield === 'function') {
        await ensureOverlayPermissionOnce().catch(() => {});
      }
      return (await AndroidScreenTime?.startFocusShield?.(subjectName)) ?? false;
    }
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startFocusShield(subjectName);
  },

  // 집중 세션 실드 끄기 — 세션 정지·고아 세션 정리 시 호출(멱등).
  stopFocusShield: async (): Promise<void> => {
    if (Platform.OS === 'android') {
      await AndroidScreenTime?.stopFocusShield?.();
      return;
    }
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.stopFocusShield();
  },

  // 집중 중 사파리·웹 허용 여부 저장 — 실드 중이면 즉시 반영(GROMO-866).
  // 안드로이드는 주요 브라우저 패키지(Chrome 등) 허용 토글로 대응 — 실드 서비스가 폴링마다
  // 다시 읽어 세션 중에도 1~2초 안에 반영된다(§4 매핑).
  setFocusAllowSafariWeb: async (allowed: boolean): Promise<void> => {
    if (Platform.OS === 'android') {
      await AndroidScreenTime?.setFocusAllowSafariWeb?.(allowed);
      return;
    }
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.setFocusAllowSafariWeb(allowed);
  },

  // 저장된 사파리·웹 허용 여부 조회 (미설정 = false = 차단이 기본).
  getFocusAllowSafariWeb: async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      return (await AndroidScreenTime?.getFocusAllowSafariWeb?.()) ?? false;
    }
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.getFocusAllowSafariWeb();
  },

  // 캐릭터 스냅샷(base64 PNG)을 App Group에 저장 — Live Activity·가림막이 읽어 표시.
  // 안드로이드는 같은 앱이라 내부 저장소(filesDir)로 충분 — 차단 화면이 읽는다(§4 간소화).
  saveCharacterSnapshot: async (base64: string): Promise<boolean> => {
    if (Platform.OS === 'android') {
      return (await AndroidScreenTime?.saveCharacterSnapshot?.(base64)) ?? false;
    }
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.saveCharacterSnapshot(base64);
  },

  // 집중 Live Activity(다이나믹 아일랜드/잠금화면) 시작. 실패해도 세션엔 영향 없음.
  // otherSubjects: 현재 과목 외 과목들의 누적 집중 시간 — 잠금화면에 정적 표시.
  // 안드로이드(GROMO-996): 실드와 같은 포그라운드 서비스의 ongoing 알림 + chronometer로
  // 상단바·잠금화면 실시간 타이머(§6). otherSubjects는 표준 알림에 자리가 없어 미표시(M4).
  startFocusActivity: async (
    subjectName: string,
    otherSubjects: { name: string; seconds: number; color: string }[] = [],
  ): Promise<boolean> => {
    if (Platform.OS === 'android') {
      return (
        (await AndroidScreenTime?.startFocusActivity?.(
          subjectName,
          JSON.stringify(otherSubjects),
        )) ?? false
      );
    }
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startFocusActivity(subjectName, JSON.stringify(otherSubjects));
  },

  // 집중 Live Activity 종료(멱등).
  endFocusActivity: async (): Promise<void> => {
    if (Platform.OS === 'android') {
      await AndroidScreenTime?.endFocusActivity?.();
      return;
    }
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.endFocusActivity();
  },

  // 잠금화면 타이머 일시정지/재개(안드로이드 전용, 코드리뷰 반영) — 수동 일시정지 때 알림
  // 크로노미터가 계속 오르는 문제를 동기화한다. iOS Live Activity·구 바이너리는 no-op(기존 동작).
  pauseFocusActivity: async (): Promise<void> => {
    if (Platform.OS === 'android') await AndroidScreenTime?.pauseFocusActivity?.();
  },

  resumeFocusActivity: async (): Promise<void> => {
    if (Platform.OS === 'android') await AndroidScreenTime?.resumeFocusActivity?.();
  },

  // 실드 상실 구독(안드로이드 전용, 코드리뷰 반영) — 세션 중 오버레이·Usage Access 권한 회수로
  // 네이티브가 실드를 내리면 호출된다. 반환값은 구독 해제 함수. iOS·구 바이너리는 no-op 해제
  // 함수를 반환한다(화면 코드가 플랫폼 분기 없이 쓰게 한다).
  subscribeFocusShieldLost: (listener: () => void): (() => void) => {
    if (Platform.OS !== 'android' || !AndroidScreenTime?.addListener) return () => {};
    const subscription = AndroidScreenTime.addListener('onFocusShieldLost', listener);
    return () => subscription.remove();
  },

  // ── 오버레이 권한(안드로이드 전용, GROMO-996) ──
  // 실드의 차단 화면을 서비스에서 띄우기 위한 SYSTEM_ALERT_WINDOW 상태 확인/설정 딥링크.
  // Usage Access처럼 시스템 팝업이 없는 설정 토글 권한이라 왕복 후 재확인으로 resolve한다.
  // iOS에는 대응 개념이 없어 항상 true(권한 문제 없음) — 호출부가 플랫폼 분기 없이 쓰게 한다.

  // 오버레이 권한 보유 여부.
  canDrawOverlays: async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      return (await AndroidScreenTime?.canDrawOverlays?.()) ?? false;
    }
    return Platform.OS === 'ios';
  },

  // 오버레이 권한 설정 딥링크 — 설정 왕복 후 허용 여부로 resolve.
  requestOverlayPermission: async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      return (await AndroidScreenTime?.requestOverlayPermission?.()) ?? false;
    }
    return Platform.OS === 'ios';
  },
};

export default ScreenTimeModule;
