// ScreenTimeModule.ts
// ScreenTimeModule.swift 네이티브 모듈의 JS 래퍼
//
// 역할: Swift로 만든 네이티브 모듈을 JS에서 편하게 쓸 수 있게 감싸는 유틸
// NativeModules에서 직접 꺼내 쓰는 것보다 이 파일을 import해서 쓰는 게 깔끔함

import { NativeModules, Platform } from 'react-native';

export type AuthorizationStatus = 'approved' | 'denied' | 'notDetermined';
export type YesterdayResult = 'success' | 'fail' | null;

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
  log: string[]; // 콜백·등록 이벤트 로그(시각+내용, 오래된 순, 최대 50줄)
}

// Swift 네이티브 모듈 인터페이스 (실기기 iOS에서만 실제 구현 존재)
interface NativeScreenTime {
  requestAuthorization(): Promise<boolean>;
  getAuthorizationStatus(): Promise<AuthorizationStatus>;
  setGoalSeconds(seconds: number): Promise<void>;
  startGoalMonitoring(goalSeconds: number): Promise<boolean>;
  startUsageBucketMonitoring(maxMinutes: number): Promise<boolean>;
  getTodayUsageBucketMinutes(): Promise<number>;
  getYesterdayUsageBucketMinutes(): Promise<number>;
  getYesterdayResult(): Promise<YesterdayResult>;
  getUsageBucketDebugInfo(): Promise<UsageBucketDebugInfo>;
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

// 네이티브 바이너리가 15분 눈금(GROMO-931) 빌드인지 — 같은 빌드에 추가된
// getUsageBucketDebugInfo 존재로 판별한다. OTA로 새 JS만 받은 구 바이너리는 여전히 30분
// 눈금을 등록하므로, 등록 마커가 실제 눈금과 어긋나지 않게 하는 데 쓴다(코드리뷰 반영).
export const nativeRegistersBucketStep15 = (): boolean =>
  Platform.OS === 'ios' &&
  typeof (NativeModules.ScreenTimeModule as NativeScreenTime | undefined)
    ?.getUsageBucketDebugInfo === 'function';

// iOS 전용 기능이므로 Android에서 호출 시 에러 대신 기본값 반환
const ScreenTimeModule = {
  // 스크린 타임 접근 권한 요청. 반환값: true(승인) | false(거부)
  requestAuthorization: async (): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.requestAuthorization();
  },

  // 현재 권한 상태 확인
  getAuthorizationStatus: async (): Promise<AuthorizationStatus> => {
    if (Platform.OS !== 'ios') return 'denied';
    return NativeScreenTimeModule.getAuthorizationStatus();
  },

  // 목표 시간을 App Group에 저장 (익스텐션에서 "남은 시간" 계산에 사용)
  setGoalSeconds: async (seconds: number): Promise<void> => {
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.setGoalSeconds(seconds);
  },

  // 매일 자정 기준 스크린 타임 목표 달성 모니터링 등록 — 어제 판정(getYesterdayResult)의 소스.
  // 측정 대상 미선택이면 false. 목표 변경 시 재호출하면 이전 모니터링을 교체한다.
  startGoalMonitoring: async (goalSeconds: number): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startGoalMonitoring(goalSeconds);
  },

  // 15분 버킷 사용량 모니터링 등록 (maxMinutes까지 15분 간격 threshold).
  // 측정 대상 미선택이면 false. 반환값: 등록 성공 여부.
  startUsageBucketMonitoring: async (maxMinutes: number): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startUsageBucketMonitoring(maxMinutes);
  },

  // 오늘의 사용량(분) — Monitor가 기록한 도달 최고 15분 눈금. iOS 외/미측정 시 0.
  getTodayUsageBucketMinutes: async (): Promise<number> => {
    if (Platform.OS !== 'ios') return 0;
    return NativeScreenTimeModule.getTodayUsageBucketMinutes();
  },

  // 어제의 최종 사용량(분) — Monitor가 하루 경계에 보존한 전일 눈금(GROMO-633).
  // iOS 외/보존 날짜가 어제가 아니면 0.
  getYesterdayUsageBucketMinutes: async (): Promise<number> => {
    if (Platform.OS !== 'ios') return 0;
    return NativeScreenTimeModule.getYesterdayUsageBucketMinutes();
  },

  // 어제 목표 달성 결과 조회. 반환값: "success" | "fail" | null
  getYesterdayResult: async (): Promise<YesterdayResult> => {
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.getYesterdayResult();
  },

  // 사용량 버킷 측정 상태 디버그 조회(개발용) — App Group 기록 원본. iOS 외에는 null.
  getUsageBucketDebugInfo: async (): Promise<UsageBucketDebugInfo | null> => {
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.getUsageBucketDebugInfo();
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
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.getAllowedSelectionCounts();
  },

  // 집중 세션 실드 켜기 — 허용앱 외 전부 차단. 반환값: 적용 여부(권한 없으면 false).
  startFocusShield: async (subjectName: string): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startFocusShield(subjectName);
  },

  // 집중 세션 실드 끄기 — 세션 정지·고아 세션 정리 시 호출(멱등).
  stopFocusShield: async (): Promise<void> => {
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
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.saveCharacterSnapshot(base64);
  },

  // 집중 Live Activity(다이나믹 아일랜드/잠금화면) 시작. 실패해도 세션엔 영향 없음.
  // otherSubjects: 현재 과목 외 과목들의 누적 집중 시간 — 잠금화면에 정적 표시.
  startFocusActivity: async (
    subjectName: string,
    otherSubjects: { name: string; seconds: number; color: string }[] = [],
  ): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startFocusActivity(subjectName, JSON.stringify(otherSubjects));
  },

  // 집중 Live Activity 종료(멱등).
  endFocusActivity: async (): Promise<void> => {
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.endFocusActivity();
  },
};

export default ScreenTimeModule;
