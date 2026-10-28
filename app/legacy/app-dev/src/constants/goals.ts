// 개인 목표(집중·스크린타임)의 선택 가능 범위 — 온보딩 W12(GoalSettingStep)와
// 설정 > 개인 목표 수정(GoalsScreen)이 **같은 값**을 쓰도록 한 곳에 모았다.
// 두 화면이 각자 상수를 선언한 탓에 스크린타임 상한(8h vs 12h)·집중 하한(30분 vs 5분)이
// 어긋나 있었다 (GROMO-1255). 새로 목표 피커를 붙이는 화면도 여기서 import할 것.
//
// 눈금 5분은 공통 피커 DurationDrumPicker가 전제하는 값이라 min·max도 5의 배수여야 한다
// (아니면 휠에 없는 값으로 클램프된다).
export const GOAL_STEP_MINUTES = 5;

// 집중 목표: 30분~24시간. 하한 30분은 사실상 자동 달성이 되는 목표를 막는 값이다.
export const FOCUS_GOAL_MINUTES = { min: 30, max: 24 * 60 } as const;

// 스크린타임 목표: 30분~12시간.
export const USAGE_GOAL_MINUTES = { min: 30, max: 12 * 60 } as const;
