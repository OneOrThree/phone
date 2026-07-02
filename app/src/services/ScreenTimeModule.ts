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

// Swift 네이티브 모듈 인터페이스 (실기기 iOS에서만 실제 구현 존재)
interface NativeScreenTime {
  requestAuthorization(): Promise<boolean>;
  getAuthorizationStatus(): Promise<AuthorizationStatus>;
  getTotalScreenTime(): Promise<number>;
  setGoalSeconds(seconds: number): Promise<void>;
  startGoalMonitoring(goalSeconds: number): Promise<void>;
  startUsageBucketMonitoring(maxMinutes: number): Promise<boolean>;
  getTodayUsageBucketMinutes(): Promise<number>;
  getYesterdayResult(): Promise<YesterdayResult>;
  presentAppPicker(): Promise<AppSelectionCounts | null>;
  promoteSelection(): Promise<boolean>;
  presentAllowedAppPicker(): Promise<AppSelectionCounts | null>;
  getAllowedSelectionCounts(): Promise<AppSelectionCounts | null>;
  startFocusShield(subjectName: string): Promise<boolean>;
  stopFocusShield(): Promise<void>;
  saveCharacterSnapshot(base64: string): Promise<boolean>;
  startFocusActivity(subjectName: string): Promise<boolean>;
  endFocusActivity(): Promise<void>;
}

const NativeScreenTimeModule = NativeModules.ScreenTimeModule as NativeScreenTime;

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

  // 총 스크린 타임 조회 (초 단위)
  getTotalScreenTime: async (): Promise<number> => {
    if (Platform.OS !== 'ios') return 0;
    return NativeScreenTimeModule.getTotalScreenTime();
  },

  // 목표 시간을 App Group에 저장 (익스텐션에서 "남은 시간" 계산에 사용)
  setGoalSeconds: async (seconds: number): Promise<void> => {
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.setGoalSeconds(seconds);
  },

  // 매일 자정 기준 스크린 타임 목표 달성 모니터링 등록
  startGoalMonitoring: async (goalSeconds: number): Promise<void> => {
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.startGoalMonitoring(goalSeconds);
  },

  // 30분 버킷 사용량 모니터링 등록 (maxMinutes까지 30분 간격 threshold).
  // 측정 대상 미선택이면 false. 반환값: 등록 성공 여부.
  startUsageBucketMonitoring: async (maxMinutes: number): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startUsageBucketMonitoring(maxMinutes);
  },

  // 오늘의 사용량(분) — Monitor가 기록한 도달 최고 30분 눈금. iOS 외/미측정 시 0.
  getTodayUsageBucketMinutes: async (): Promise<number> => {
    if (Platform.OS !== 'ios') return 0;
    return NativeScreenTimeModule.getTodayUsageBucketMinutes();
  },

  // 어제 목표 달성 결과 조회. 반환값: "success" | "fail" | null
  getYesterdayResult: async (): Promise<YesterdayResult> => {
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.getYesterdayResult();
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

  // 캐릭터 스냅샷(base64 PNG)을 App Group에 저장 — Live Activity·가림막이 읽어 표시.
  saveCharacterSnapshot: async (base64: string): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.saveCharacterSnapshot(base64);
  },

  // 집중 Live Activity(다이나믹 아일랜드/잠금화면) 시작. 실패해도 세션엔 영향 없음.
  startFocusActivity: async (subjectName: string): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.startFocusActivity(subjectName);
  },

  // 집중 Live Activity 종료(멱등).
  endFocusActivity: async (): Promise<void> => {
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.endFocusActivity();
  },
};

export default ScreenTimeModule;
