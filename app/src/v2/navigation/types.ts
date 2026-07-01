// v2 루트 스택 파라미터 — 탭(Main) 위에 상세 화면을 얹는 구조.
// 별도 파일로 분리해 화면 ↔ 네비게이터 순환 import을 피한다.
import type { FocusTimerMode, PomodoroConfig } from '@/v2/screens/focus/types';

export type V2RootStackParamList = {
  Main: undefined; // 4탭 + FAB
  Stats: undefined; // 통계 상세 (홈 '자세히'에서 진입)
  FocusCategory: undefined; // 02 과목 선택 (홈 ● 집중 FAB에서 진입)
  FocusSession: {
    subjectName: string;
    mode: FocusTimerMode;
    goalSeconds?: number; // 카운트다운 목표
    pomodoro?: PomodoroConfig; // 뽀모도로 설정
  }; // 06~11 집중 세션
};
