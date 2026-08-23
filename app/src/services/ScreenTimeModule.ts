// ScreenTimeModule.ts
// 스크린타임 네이티브 모듈의 JS 래퍼
//
// 역할: 네이티브 모듈을 JS에서 편하게 쓸 수 있게 감싸는 유틸
// NativeModules에서 직접 꺼내 쓰는 것보다 이 파일을 import해서 쓰는 게 깔끔함
//  - iOS: ScreenTimeModule.swift (구식 브릿지, NativeModules) — 함수 계약 20개 전체 구현
//  - Android: app/modules/screen-time (Expo 모듈, GROMO-994) — M1 범위(권한·오늘/어제 조회·
//    목표 저장)만 구현. 나머지 함수는 기존 기본값 가드를 유지한다(M2~M4에서 확장).

import { NativeModules, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

export type AuthorizationStatus = 'approved' | 'denied' | 'notDetermined';

// 기기(시스템) 다크모드 설정 — 권한창 복제본 외형 분기용(GROMO-934)
export type SystemColorScheme = 'light' | 'dark';

// presentAppPicker가 반환하는 선택 개수
export interface AppSelectionCounts {
  applications: number;
  categories: number;
  webDomains: number;
  // 선택 토큰 자체를 노출하지 않고 변경 여부 비교에만 쓰는 네이티브 SHA-256 서명.
  selectionSignature?: string;
  /**
   * 네이티브가 **모달 dismiss가 끝난 뒤에** 이 promise를 풀었는가.
   *
   * ⚠️ hot-updater로 새 JS만 받은 **구 바이너리는 이 키가 없다(undefined).** 그쪽은 아직
   *    모달이 떠 있는 채로 resolve하므로, 등장 연출이 있는 UI(토스트)를 쓰면 사용자는 모달이
   *    사라진 뒤 토스트가 갑자기 나타나는 걸 보고 노출 시간도 짧아진다(codex 리뷰).
   *    새 메서드를 추가해 능력을 판별하는 대신 **응답으로 알린다** — 왕복이 없다.
   */
  dismissed?: boolean;
}

// Monitor 익스텐션 threshold 발화 타임라인 항목(N1) — App Group "usageBucketEvents:{yyyy-MM-dd}".
// bucket은 원시 threshold 눈금이 아니라 '베이스+눈금' 하루 누적 환산분(단조 증가)이다 —
// 분 단위 값 그대로 쓴다(×15 같은 변환 금지, N1 계약 확정). 2일 보존.
export interface UsageBucketEvent {
  bucket: number; // 그 발화 시점의 하루 누적 사용분
  firedAt: number; // 발화 시각(epoch 초)
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
  getSystemColorScheme(): Promise<SystemColorScheme>;
  setGoalSeconds(seconds: number): Promise<void>;
  stopGoalMonitoring(): Promise<boolean>;
  startUsageBucketMonitoring(maxMinutes: number): Promise<boolean>;
  getTodayUsageBucketMinutes(): Promise<number>;
  getYesterdayUsageBucketMinutes(): Promise<number>;
  getUsageBucketDebugInfo(): Promise<UsageBucketDebugInfo>;
  getUsageBucketEvents(dayKey: string): Promise<UsageBucketEvent[]>;
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
  startFocusActivity(
    subjectName: string,
    otherSubjectsJson: string,
    stateJson: string,
  ): Promise<boolean>;
  updateFocusActivity(stateJson: string): Promise<boolean>;
  endFocusActivity(): Promise<void>;
}

// Live Activity 세션 상태 페이로드(GROMO-1597) — 네이티브 FocusActivityStatePayload와 1:1.
// 초 단위 상대값만 싣는다(Date 앵커는 네이티브가 수신 시각 기준으로 계산).
export interface FocusActivityState {
  mode: 'countup' | 'countdown' | 'pomodoro';
  phase: 'focus' | 'break';
  isPaused: boolean;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  /**
   * 이 구간이 끝나면 **세션 자체가 끝나는가**(안드로이드 알림 전용, GROMO-1604 코드리뷰).
   *
   * 안드로이드 서비스는 백그라운드에서 남은 시간이 0이 되면 실드를 내리는데, 뽀모도로의
   * 중간 경계(집중 → 휴식)에서 내리면 **다음 세트에 차단이 안 돌아온다.** 세션이 언제
   * 끝나는지는 JS 만 안다(마지막 세트의 집중이 끝나는 시점).
   *
   * iOS 는 쓰지 않는다 — Live Activity 는 실드와 별개로 돈다.
   */
  endsSession: boolean;
  revision: number;
}

const NativeScreenTimeModule = NativeModules.ScreenTimeModule as NativeScreenTime;

// 안드로이드 Expo 모듈 인터페이스(GROMO-994) — M1 범위 함수만 네이티브 구현이 있다.
// startUsageBucketMonitoring은 예약 개념이 없어 네이티브 없이 TS에서 no-op true(§4 매핑).
interface AndroidNativeScreenTime {
  requestAuthorization(): Promise<boolean>;
  getAuthorizationStatus(): Promise<AuthorizationStatus>;
  setGoalSeconds(seconds: number): Promise<void>;
  getTodayUsageBucketMinutes(): Promise<number>;
  getYesterdayUsageBucketMinutes(): Promise<number>;
  // 허용 상태에서도 사용 정보 접근 설정을 여는 전용 경로. 구 바이너리엔 없을 수 있어 옵셔널.
  openUsageAccessSettings?(): Promise<boolean>;
  // 앱별 사용시간(GROMO-1608) — iOS는 익스텐션이 화면을 그려줄 뿐 **수치를 JS로 못 준다**.
  // 안드로이드는 수치를 그대로 넘길 수 있어 화면을 RN이 그린다. dayOffset 0=오늘, -1=어제.
  getUsageBreakdown(dayOffset: number): Promise<AppUsageBreakdown>;
  getAppIcon(packageName: string): Promise<string | null>;
  // 측정 대상 앱 선택(GROMO-1593) — iOS의 presentAppPicker 자리를 대신한다. iOS는 네이티브가
  // 모달까지 띄우지만(토큰이 opaque라 JS가 못 그린다), 안드로이드는 패키지명이 그대로라
  // 목록만 넘기고 화면은 RN이 그린다.
  // ⚠️ 옵셔널 — 구 바이너리(M2 이전)에도 ScreenTimeModule 자체는 있어서 모듈 유무로는
  //    못 가른다. 존재 여부로 게이팅하지 않으면 undefined 호출로 터진다(코드리뷰 반영).
  getInstalledApps?(): Promise<InstalledApp[]>;
  getSelectionPackages?(): Promise<string[]>;
  setSelectionPackages?(packages: string[]): Promise<void>;
  // 집중 중 허용앱 — 피커가 저장하고, 실드가 예외 목록으로 읽는다.
  getAllowedPackages(): Promise<string[]>;
  setAllowedPackages(packages: string[]): Promise<void>;
  // 집중 실드(GROMO-1604) — 폴링 + 가림막. iOS의 OS 위임과 달리 우리가 직접 돌린다.
  // ⚠️ 아래 실드 메서드들은 **전부 옵셔널이다.** 구 안드로이드 바이너리에도 ScreenTimeModule
  //    자체는 있어서 AndroidScreenTime 은 null 이 아닌데, 이 메서드들은 1604 빌드부터 생긴다.
  //    존재 여부로 게이팅하지 않으면 'undefined is not a function' 이 난다(코드리뷰 반영).
  canDrawOverlay?(): Promise<boolean>;
  requestOverlayPermission?(): Promise<void>;
  startFocusShield?(subjectName: string): Promise<boolean>;
  startFocusActivity?(
    subjectName: string,
    otherSubjectsJson: string,
    stateJson: string,
  ): Promise<boolean>;
  updateFocusActivity?(stateJson: string): Promise<boolean>;
  stopFocusShield?(): Promise<void>;
  /** 동기 — 호출부가 이탈 판정 도중 즉시 읽는다. 네이티브는 Expo Function(동기). */
  isFocusShieldAlive?(): boolean;
  // 상시 알림(iOS Live Activity 대응) — 캐릭터 스냅샷 + 과목·다른 과목 누적.
  saveCharacterSnapshot(base64: string): Promise<boolean>;
  endFocusActivity(): Promise<void>;
}

/**
 * 상태를 안 받았을 때 쓰는 기본값 — '카운트업·집중·정지 아님'.
 *
 * 모르는 상태를 카운트다운으로 그리는 것보다 안전하다. 경과 시간은 최소한 startedAt 기준으로
 * 맞고, 그건 예전(상태를 아예 안 넘기던 시절)과 같은 동작이다.
 */
const androidFallbackState: FocusActivityState = {
  mode: 'countup',
  phase: 'focus',
  isPaused: false,
  elapsedSeconds: 0,
  remainingSeconds: null,
  endsSession: false,
  revision: 0,
};

/** 측정 대상 피커에 뿌릴 설치 앱 1건(안드로이드 전용). 아이콘은 getAppIcon으로 따로 받는다. */
export interface InstalledApp {
  packageName: string;
  label: string;
}

/**
 * 앱별 사용시간 1건(안드로이드 전용). 사용 많은 순으로 정렬돼 오고, 사용 0인 앱은 빠져 있다.
 *
 * 단위가 분이 아니라 **초**인 이유: 1분 미만 사용을 분으로 뭉개면 목록 하단이 전부 '0분'이 된다.
 * 표시 단위 반올림은 화면이 정한다.
 */
/**
 * 앱별 사용시간 + 총계 — **한 번의 네이티브 조회 결과**다(GROMO-1608 코드리뷰).
 */
export interface AppUsageBreakdown {
  /** 모든 패키지 합(초). 표시용 분은 여기서 파생한다 — 홈 카드와 같은 규칙이다. */
  totalSeconds: number;
  /** 목록에 안 잡히는 시간(초) — 런처·시스템 UI. 밀리초를 유지한 채 네이티브가 뺀 값이다. */
  otherSeconds: number;
  apps: AppUsage[];
}

export interface AppUsage {
  packageName: string;
  label: string;
  seconds: number;
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

// 네이티브 바이너리가 threshold 발화 타임라인(N1, getUsageBucketEvents)을 지원하는지 — OTA로
// 새 JS만 받은 구 바이너리는 메서드가 없어 false. 이 경우 창 사용분 업로드(A4)는 전체 스킵한다
// (서버 memberProgress null = 판정불가가 정상 상태).
export const nativeSupportsUsageBucketEvents = (): boolean =>
  Platform.OS === 'ios' &&
  typeof (NativeModules.ScreenTimeModule as NativeScreenTime | undefined)?.getUsageBucketEvents ===
    'function';

// 네이티브 바이너리가 A안(GROMO-942, 측정 대상 '다음날 적용')을 지원하는지 — 같은 빌드에 추가된
// setPendingSelectionApplyDate 존재로 판별. OTA로 새 JS만 받은 구 바이너리는 이 메서드도, 자정
// 승격 로직도 없으므로 설정 화면이 '다음날 적용'을 예약하면 영영 적용되지 않는다. 이 경우 설정
// 화면은 예약 대신 즉시 적용으로 폴백한다(코드리뷰 반영).
export const nativeSupportsPendingApplyDate = (): boolean =>
  Platform.OS === 'ios' &&
  typeof (NativeModules.ScreenTimeModule as NativeScreenTime | undefined)
    ?.setPendingSelectionApplyDate === 'function';

// iOS 콜드런치 quirk 보정용 승인 이력 캐시.
// AuthorizationCenter.authorizationStatus 는 앱 프로세스가 막 뜬 직후 실제로는 승인된 상태인데도
// 'notDetermined' 를 돌려줄 때가 있다. 그러면 홈 '핸드폰 사용' 칸이 권한 켜기 안내로 바뀌어 버린다
// (v1 홈에 있던 이 방어가 화면 재작성 때 함께 삭제돼 재발했다 — 키만 남고 로직이 사라져 있었다).
// 원칙: 확정 답('approved'/'denied')만 신뢰해 캐시를 갱신하고, 'notDetermined' 인데 승인 이력이
// 있으면 quirk 로 보고 승인으로 보정한다.
// ⚠️ 한계: 설정에서 권한을 껐을 때 'denied' 가 아니라 'notDetermined' 로 오는 기기가 있으면
//    캐시가 승인으로 눌러앉는다. v1 에서 'denied' 로 오는 것을 확인해 그 전제를 그대로 따르되,
//    어긋나는 사례가 나오면 캐시에 TTL 을 주는 게 다음 수순이다.
// 캐시 값은 3상태다: '1'=승인 확정 / '0'=거부 확정 / 없음=아직 확정 답을 받은 적 없음.
// 거부를 '키 삭제'가 아니라 '0' 으로 남기는 이유는 아래 업그레이드 코호트 폴백 때문이다 —
// 삭제해 버리면 "확정 거부"와 "기록 없음"이 구분되지 않아, 폴백이 거부를 덮고 승인으로
// 되살아난다(코드리뷰 반영).
// 호출부가 await 한다 — 기록이 끝나기 전에 결과를 돌려주면, 그 직후 앱이 종료됐을 때 캐시가
// 비어 있어 다음 콜드런치에서 quirk 보정이 못 걸린다(코드리뷰 반영).
// 같은 값을 다시 쓰는 경우가 있지만 1바이트 로컬 쓰기라 조회 경로에서도 부담이 없다.
const markAuthGranted = async (granted: boolean): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEYS.screentimeAuthGranted, granted ? '1' : '0').catch(
    () => {},
  );
};

const readAuthCache = (): Promise<string | null> =>
  AsyncStorage.getItem(STORAGE_KEYS.screentimeAuthGranted).catch(() => null);

const hasAuthGrantedHistory = async (): Promise<boolean> => {
  const cached = await readAuthCache();
  // 확정 답이 한 번이라도 기록됐으면 그것만 믿는다 — 거부('0')면 폴백을 보지 않는다.
  if (cached != null) return cached === '1';
  // 업그레이드 코호트 폴백 — 캐시 로직이 없던 빌드에서 이미 권한을 허용하고 측정까지 돌던
  // 유저는 이 캐시 키가 아예 없다. 그 상태로 업데이트 후 첫 콜드런치에 quirk 가 걸리면 이력이
  // 없어 보정이 못 걸리고, 홈은 권한 켜기를 그대로 띄운다.
  // 버킷 모니터 등록 마커는 registerUsageBucketMonitoring 이 'approved' 가 아니면 즉시 빠지므로
  // (screentimeSync.ts) 존재 자체가 "과거에 승인됐었다"는 증거다 — 진짜 최초 유저는 가질 수 없다.
  // 확정 답을 한 번이라도 받으면 위에서 걸러지므로 이 폴백은 사실상 1회성이다.
  const measured = await AsyncStorage.getItem(STORAGE_KEYS.screentimeBucketMonitorRegistered).catch(
    () => null,
  );
  return measured != null;
};

// 플랫폼 라우팅 — iOS는 Swift 브릿지, 안드로이드 M1 범위는 Expo 모듈, 그 외(미구현 함수·
// 구 바이너리)는 에러 대신 기본값 반환. 화면 코드 호출부는 플랫폼을 몰라도 된다.
const ScreenTimeModule = {
  // 스크린 타임 접근 권한 요청. 반환값: true(승인) | false(거부)
  // 안드로이드는 시스템 팝업이 없어 Usage Access 설정을 열고 복귀 시 재확인한 결과로 resolve.
  requestAuthorization: async (): Promise<boolean> => {
    if (AndroidScreenTime) return AndroidScreenTime.requestAuthorization();
    if (Platform.OS !== 'ios') return false;
    const granted = await NativeScreenTimeModule.requestAuthorization();
    // 요청 결과는 네이티브가 현재 권한 상태에서 뽑아낸 확정 답이라 양쪽 다 기록한다.
    // 승인도 반드시 기록해야 한다 — 온보딩 권한 스텝은 승인되면 곧장 측정 대상 picker 로 넘어가
    // getAuthorizationStatus 를 한 번도 부르지 않는다(ScreenTimePermissionStep). 그 상태로 앱이
    // 종료되면 다음 콜드런치에서 quirk 로 notDetermined 가 오고, 이력이 없어 위 보정이 못 걸린다.
    // 거부 기록도 그대로 필요하다 — 보정이 옛 승인에 눌러앉지 않게.
    await markAuthGranted(granted);
    return granted;
  },

  // 사용 정보 접근 설정 화면 열기(안드로이드 전용). 성공하면 true.
  //
  // requestAuthorization은 **이미 허용된 상태면 설정을 열지 않는다** — 권한을 끄러 가는 경로로
  // 쓸 수 없다. 앱 상세 설정(Linking.openSettings)에도 사용 정보 접근 토글이 없다. 그래서 이
  // 전용 함수가 필요하다(코드리뷰 반영).
  //
  // false를 돌려주는 경우: iOS · 구 바이너리(OTA로 새 JS만 받아 네이티브에 이 함수가 없음) ·
  // 설정 화면을 못 여는 기기. 호출부는 false면 앱 상세 설정으로 폴백한다.
  openUsageAccessSettings: async (): Promise<boolean> => {
    if (!AndroidScreenTime?.openUsageAccessSettings) return false;
    return AndroidScreenTime.openUsageAccessSettings();
  },

  // 현재 권한 상태 확인 (안드로이드: AppOps 체크 + '설정 보낸 적' 플래그로 notDetermined 구분)
  getAuthorizationStatus: async (): Promise<AuthorizationStatus> => {
    if (AndroidScreenTime) return AndroidScreenTime.getAuthorizationStatus();
    if (Platform.OS !== 'ios') return 'denied';
    let live = await NativeScreenTimeModule.getAuthorizationStatus();
    // 거부로 기록된 유저가 설정에서 권한을 다시 켠 경우 — 아래 보정은 거부 기록을 신뢰해 눌러앉으므로
    // quirk 에 걸리면 다시 켠 사실을 못 본다. 이 조합(거부 기록 + notDetermined)에서만 한 번 더
    // 물어본다(코드리뷰 반영). 다른 경로에는 추가 호출을 주지 않는다.
    if (live === 'notDetermined' && (await readAuthCache()) === '0') {
      live = await NativeScreenTimeModule.getAuthorizationStatus();
    }
    if (live === 'approved' || live === 'denied') {
      await markAuthGranted(live === 'approved');
      return live;
    }
    // notDetermined — 승인 이력이 있으면 콜드런치 quirk 로 보고 승인 유지.
    return (await hasAuthGrantedHistory()) ? 'approved' : 'notDetermined';
  },

  // 기기(시스템) 다크모드 설정 조회 — 앱이 라이트 고정(Info.plist)이라 RN Appearance는 항상
  // light. 시스템 권한창 복제본(GROMO-934)의 외형 분기에 쓴다. iOS 외/구 바이너리(OTA로
  // 메서드 없음)는 'dark' 폴백 — 실기기로 확인된 외형 기준이고, 틀려도 안내 내용은 유효하다.
  getSystemColorScheme: async (): Promise<SystemColorScheme> => {
    if (Platform.OS !== 'ios') return 'dark';
    if (typeof NativeScreenTimeModule.getSystemColorScheme !== 'function') return 'dark';
    return NativeScreenTimeModule.getSystemColorScheme();
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

  // ── 앱별 사용 시간 · 안드로이드 (GROMO-1608) ──
  // iOS는 DeviceActivityReport 익스텐션이 그린 뷰를 통째로 임베드할 뿐 수치를 JS로 못 준다.
  // 안드로이드는 UsageStats 수치를 그대로 넘길 수 있어 목록을 RN이 그린다.
  //
  // 네이티브가 없으면(iOS·웹·구 바이너리) 조용한 기본값으로 폴백한다 — 호출부는
  // supportsUsageBreakdown()이 참일 때만 부르지만, 그 가드가 빠져도 크래시는 안 난다.

  /**
   * 앱별 사용시간 + 총계(안드로이드). **한 번의 조회로 셋을 함께 받는다.**
   *
   * 따로 부르면 각자 시각을 잡고 이벤트를 다시 훑어 서로 다른 시점의 값이 섞이는데,
   * 화면은 그 차이를 '목록에 안 잡히는 시간'으로 읽어 허위 '그 외' 행을 만든다.
   *
   * iOS·구 바이너리는 null — 그쪽은 애초에 이 목록을 RN 이 그리지 않는다.
   */
  getUsageBreakdown: async (dayOffset = 0): Promise<AppUsageBreakdown | null> => {
    if (!AndroidScreenTime?.getUsageBreakdown) return null;
    return AndroidScreenTime.getUsageBreakdown(dayOffset);
  },

  /**
   * 앱 아이콘 base64 PNG(본문만, data URI 접두 없음). 없으면 null.
   *
   * 목록 응답에 싣지 않고 개별로 받는 이유: 수십~수백 개 비트맵을 한 번에 직렬화하면
   * 목록의 **첫 표시**가 통째로 그만큼 늦어진다. 아이콘은 보이는 행만 뒤따라 채운다.
   */
  getAppIcon: async (packageName: string): Promise<string | null> => {
    if (!AndroidScreenTime) return null;
    return AndroidScreenTime.getAppIcon(packageName);
  },

  // ── 측정 대상 앱 선택 · 안드로이드 (GROMO-1593) ──
  // iOS는 presentAppPicker 하나가 '목록 표시 + 선택 + 저장'을 다 하지만(토큰이 opaque라
  // 그럴 수밖에 없다), 안드로이드는 목록 조회와 저장이 분리된다. 화면은 RN이 그린다.
  //
  // 네이티브가 없으면(iOS·웹·구 바이너리) 조용한 기본값으로 폴백한다 — 호출부는
  // supportsAppSelection()이 참일 때만 부르지만, 그 가드가 빠져도 크래시는 안 난다.

  /** 런처에 뜨는 설치 앱 목록(표시 이름 순). 자기 자신은 빠져 있다. */
  getInstalledApps: async (): Promise<InstalledApp[]> => {
    if (!AndroidScreenTime?.getInstalledApps) return [];
    return AndroidScreenTime.getInstalledApps();
  },

  /** 현재 측정 대상 패키지들. **빈 배열 = 미설정 = 전체 앱 측정**(0개 측정이 아니다). */
  getSelectionPackages: async (): Promise<string[]> => {
    if (!AndroidScreenTime?.getSelectionPackages) return [];
    return AndroidScreenTime.getSelectionPackages();
  },

  /** 측정 대상 저장. 빈 배열을 주면 '전체 앱 측정'으로 되돌아간다. 저장 즉시 오늘분부터 반영된다. */
  setSelectionPackages: async (packages: string[]): Promise<void> => {
    if (!AndroidScreenTime?.setSelectionPackages) return;
    return AndroidScreenTime.setSelectionPackages(packages);
  },

  /** 집중 중 허용앱 패키지들(안드로이드). 빈 배열 = 허용앱 없음(측정 대상과 달리 '전체'가 아니다). */
  getAllowedPackages: async (): Promise<string[]> => {
    if (!AndroidScreenTime) return [];
    return AndroidScreenTime.getAllowedPackages();
  },

  /** 집중 중 허용앱 저장(안드로이드). 저장된 목록은 실드가 예외로 통과시킨다. */
  setAllowedPackages: async (packages: string[]): Promise<void> => {
    if (!AndroidScreenTime) return;
    return AndroidScreenTime.setAllowedPackages(packages);
  },

  // ── 가림막 권한 · 안드로이드 (GROMO-1604) ──
  // '다른 앱 위에 표시'는 시스템 팝업이 없는 특수 권한이라, iOS의 권한 요청 팝업과 달리
  // 설정 화면으로 보내고 돌아왔을 때 다시 확인하는 흐름이 된다(Usage Access와 같은 모양).

  /** 가림막을 띄울 수 있는가. iOS는 실드에 별도 권한이 없어 항상 true. */
  canDrawOverlay: async (): Promise<boolean> => {
    if (AndroidScreenTime?.canDrawOverlay) return AndroidScreenTime.canDrawOverlay();
    // 안드로이드 구 바이너리는 가림막 자체가 없다 — '띄울 수 있다'고 답하면 그 위의
    // 모든 안내가 거짓이 된다.
    return Platform.OS === 'ios';
  },

  /** '다른 앱 위에 표시' 설정 화면 열기(안드로이드 전용). */
  requestOverlayPermission: async (): Promise<void> => {
    if (!AndroidScreenTime?.requestOverlayPermission) return;
    return AndroidScreenTime.requestOverlayPermission();
  },

  // 날짜 키('YYYY-MM-DD')의 threshold 발화 타임라인(N1) — 창 사용분 계산(A4)의 소스. 2일 보존.
  // 오래된 순 [{bucket, firedAt}] — bucket은 하루 누적 환산분(단조 증가). iOS 외·구 바이너리는 빈 배열.
  getUsageBucketEvents: async (dayKey: string): Promise<UsageBucketEvent[]> => {
    if (!nativeSupportsUsageBucketEvents()) return [];
    return NativeScreenTimeModule.getUsageBucketEvents(dayKey);
  },

  // A안(GROMO-942) 측정 대상 변경 '다음날 적용' 예약 — App Group에 적용 예정일을 기록해
  // 익스텐션 자정 콜백이 승격 여부를 판단하게 한다. dateString은 'YYYY-MM-DD'(로컬, 보통 내일),
  // 빈 문자열이면 예약 취소. iOS 외/구 바이너리(OTA로 메서드 없음)에는 no-op(false).
  setPendingSelectionApplyDate: async (dateString: string): Promise<boolean> => {
    if (!nativeSupportsPendingApplyDate()) return false;
    return NativeScreenTimeModule.setPendingSelectionApplyDate(dateString);
  },

  // 측정 대상(앱/카테고리) 선택 picker 표시. 취소 시 null.
  presentAppPicker: async (): Promise<AppSelectionCounts | null> => {
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.presentAppPicker();
  },

  // 대기 중인 측정 대상을 활성으로 승격 (다음날 적용 시점에 호출)
  promoteSelection: async (): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.promoteSelection();
  },

  // ── 집중 세션 허용앱 / 실드 (GROMO-553) ──

  // 집중 중 허용앱 선택 picker. 즉시 저장·적용. 취소 시 null.
  // ⚠️ 실드 예외는 개별 앱 토큰만 지원 — 카테고리 선택은 차단 예외로 무시됨.
  presentAllowedAppPicker: async (): Promise<AppSelectionCounts | null> => {
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.presentAllowedAppPicker();
  },

  // 허용앱 관리 화면(현재 목록 + 추가/삭제 피커). 완료 시 저장·적용. 스와이프 취소 불가.
  presentAllowedAppManager: async (): Promise<AppSelectionCounts | null> => {
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.presentAllowedAppManager();
  },

  // 저장된 허용앱 선택 개수. 미설정이면 null.
  getAllowedSelectionCounts: async (): Promise<AppSelectionCounts | null> => {
    // 안드로이드는 패키지 목록을 그대로 알 수 있어 개수를 직접 센다
    // (categories·webDomains는 안드로이드에 없는 개념이라 0 — 계약 형태만 맞춘다).
    if (AndroidScreenTime) {
      const packages = await AndroidScreenTime.getAllowedPackages();
      return { applications: packages.length, categories: 0, webDomains: 0 };
    }
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.getAllowedSelectionCounts();
  },

  // 집중 세션 실드 켜기 — 허용앱 외 전부 차단. 반환값: 적용 여부(권한 없으면 false).
  startFocusShield: async (subjectName: string): Promise<boolean> => {
    // 구 바이너리는 메서드가 없다 — false 가 정직한 답이다(차단이 안 걸리는 게 사실이므로
    // 호출부의 이탈 정책도 느슨해지지 않는다).
    if (AndroidScreenTime) {
      if (!AndroidScreenTime.startFocusShield) return false;
      return AndroidScreenTime.startFocusShield(subjectName);
    }
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startFocusShield(subjectName);
  },

  /**
   * 실드가 **아직 살아 있는가**(안드로이드 전용, GROMO-1604 코드리뷰 반영).
   *
   * startFocusShield 가 true 를 준 뒤에도 제조사 배터리 최적화가 백그라운드에서 서비스를
   * 죽일 수 있다. 그러면 화면은 여전히 '차단 중'이라 믿어 차단 없이 쓴 시간을 집중으로
   * 적립한다. 포그라운드 복귀마다 이 값으로 다시 확인한다.
   *
   * 구 바이너리는 메서드가 없으니 false — 애초에 실드가 걸리지 않았다.
   *
   * **동기 함수다.** 호출부가 이탈 크레딧을 계산하는 도중 즉시 읽어야 해서, 그 판정에
   * await 를 끼우지 않으려고 네이티브도 Expo Function(동기)으로 뒀다.
   */
  isFocusShieldAlive: (): boolean => {
    if (AndroidScreenTime) {
      if (!AndroidScreenTime.isFocusShieldAlive) return false;
      return AndroidScreenTime.isFocusShieldAlive();
    }
    // iOS 는 ManagedSettingsStore 가 OS 쪽에 남아 앱이 죽어도 유지된다 — 앱 생존과 무관하다.
    return Platform.OS === 'ios';
  },

  // 집중 세션 실드 끄기 — 세션 정지·고아 세션 정리 시 호출(멱등).
  stopFocusShield: async (): Promise<void> => {
    if (AndroidScreenTime) {
      if (!AndroidScreenTime.stopFocusShield) return;
      return AndroidScreenTime.stopFocusShield();
    }
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.stopFocusShield();
  },

  // 집중 중 사파리·웹 허용 여부 저장 — 실드 중이면 즉시 반영(GROMO-866).
  setFocusAllowSafariWeb: async (allowed: boolean): Promise<void> => {
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.setFocusAllowSafariWeb(allowed);
  },

  // 저장된 사파리·웹 허용 여부 조회 (미설정 = false = 차단이 기본).
  getFocusAllowSafariWeb: async (): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.getFocusAllowSafariWeb();
  },

  // 캐릭터 스냅샷(base64 PNG)을 App Group에 저장 — Live Activity·가림막이 읽어 표시.
  saveCharacterSnapshot: async (base64: string): Promise<boolean> => {
    if (AndroidScreenTime) return AndroidScreenTime.saveCharacterSnapshot(base64);
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.saveCharacterSnapshot(base64);
  },

  // 집중 Live Activity(다이나믹 아일랜드/잠금화면) 시작. 실패해도 세션엔 영향 없음.
  // otherSubjects: 현재 과목 외 과목들의 누적 집중 시간 — 잠금화면에 정적 표시.
  // state(GROMO-1597): 모드·페이즈·정지 상태 — 생략 시 카운트업 시작으로 폴백.
  startFocusActivity: async (
    subjectName: string,
    otherSubjects: { name: string; seconds: number; color: string }[] = [],
    state?: FocusActivityState,
  ): Promise<boolean> => {
    // 안드로이드는 Live Activity가 없어 실드 서비스의 상시 알림이 그 자리를 대신한다(GROMO-1604).
    if (AndroidScreenTime) {
      if (!AndroidScreenTime.startFocusActivity) return false;
      // 상태를 함께 넘긴다(코드리뷰 반영) — 안 넘기면 잠금화면 타이머가 늘 카운트업이라
      // 일시정지 중에도 시간이 늘고 카운트다운 페이즈에 엉뚱한 값이 찍힌다.
      return AndroidScreenTime.startFocusActivity(
        subjectName,
        JSON.stringify(otherSubjects),
        JSON.stringify(state ?? androidFallbackState),
      );
    }
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startFocusActivity(
      subjectName,
      JSON.stringify(otherSubjects),
      JSON.stringify(state ?? androidFallbackState),
    );
  },

  // 집중 Live Activity 상태 갱신(GROMO-1597) — 정지/재개·뽀모도로 페이즈 전환 시 호출.
  // 활성 액티비티가 없으면 네이티브가 no-op(false) — 멱등이라 아무 때나 불러도 안전.
  updateFocusActivity: async (state: FocusActivityState): Promise<boolean> => {
    if (AndroidScreenTime) {
      // 구 바이너리엔 없다 — 상태 갱신이 no-op 이어도 타이머는 카운트업으로 계속 돈다.
      if (!AndroidScreenTime.updateFocusActivity) return false;
      return AndroidScreenTime.updateFocusActivity(JSON.stringify(state));
    }
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.updateFocusActivity(JSON.stringify(state));
  },

  // 집중 Live Activity 종료(멱등).
  endFocusActivity: async (): Promise<void> => {
    if (AndroidScreenTime) return AndroidScreenTime.endFocusActivity();
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.endFocusActivity();
  },
};

export default ScreenTimeModule;
