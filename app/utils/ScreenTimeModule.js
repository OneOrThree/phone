// ScreenTimeModule.js
// ScreenTimeModule.swift 네이티브 모듈의 JS 래퍼
//
// 역할: Swift로 만든 네이티브 모듈을 JS에서 편하게 쓸 수 있게 감싸는 유틸
// NativeModules에서 직접 꺼내 쓰는 것보다 이 파일을 import해서 쓰는 게 깔끔함

import { NativeModules, Platform } from 'react-native';

const { ScreenTimeModule: NativeScreenTimeModule } = NativeModules;

// iOS 전용 기능이므로 Android에서 호출 시 에러 대신 기본값 반환
const ScreenTimeModule = {
  // 스크린 타임 접근 권한 요청
  // 반환값: true (승인) | false (거부)
  requestAuthorization: async () => {
    if (Platform.OS !== 'ios') return false;
    return NativeScreenTimeModule.requestAuthorization();
  },

  // 현재 권한 상태 확인
  // 반환값: "approved" | "denied" | "notDetermined"
  getAuthorizationStatus: async () => {
    if (Platform.OS !== 'ios') return 'denied';
    return NativeScreenTimeModule.getAuthorizationStatus();
  },

  // 총 스크린 타임 조회 (초 단위)
  // 반환값: 9157 (= 2시간 32분 37초)
  getTotalScreenTime: async () => {
    if (Platform.OS !== 'ios') return 0;
    return NativeScreenTimeModule.getTotalScreenTime();
  },

  // 목표 시간을 App Group에 저장 (익스텐션에서 "남은 시간" 계산에 사용)
  setGoalSeconds: async (seconds) => {
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.setGoalSeconds(seconds);
  },

  // 매일 자정 기준 스크린 타임 목표 달성 모니터링 등록
  // goalSeconds가 변경될 때마다 재호출하면 threshold 갱신됨
  startGoalMonitoring: async (goalSeconds) => {
    if (Platform.OS !== 'ios') return;
    return NativeScreenTimeModule.startGoalMonitoring(goalSeconds);
  },

  // 어제 목표 달성 결과 조회
  // 반환값: "success" | "fail" | null (어제 결과 없음)
  getYesterdayResult: async () => {
    if (Platform.OS !== 'ios') return null;
    return NativeScreenTimeModule.getYesterdayResult();
  },
};

export default ScreenTimeModule;
