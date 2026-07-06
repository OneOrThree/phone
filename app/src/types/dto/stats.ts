// 서버 stats 도메인 DTO 미러 (com.oneorthree.phone.stats.dto).
// 값 단위·의미는 백엔드 기준. 날짜(LocalDate)는 'YYYY-MM-DD', 시각(Instant)은 ISO 문자열.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.

// GET /stats/focus 의 period 파라미터 (Java enum StatsPeriod).
export type StatsPeriod = 'DAY' | 'WEEK' | 'MONTH';

// GET /stats/today — 오늘 요약(집중·스크린타임 공용 지표).
export interface TodayStatMetric {
  todayMinutes: number;
  goalMinutes: number;
  goalAchieved: boolean;
  progressPercent: number; // 스크린타임은 100 초과 가능(초과 노출)
}
export interface TodayStatsResponse {
  focus: TodayStatMetric;
  screenTime: TodayStatMetric;
}

// GET /stats/streak — 연속일(스트릭).
export interface StreakResponse {
  currentStreak: number;
  longestStreak: number;
  lastSessionDate: string | null; // LocalDate, 기록 없으면 null
}

// GET /stats/heatmap — 일별 집중/스크린타임 집계 셀.
export interface HeatmapCellResponse {
  date: string; // LocalDate
  totalFocusMinutes: number;
  sessionCount: number;
  focusGoalAchieved: boolean;
  actualScreenTimeMinutes: number;
  screenTimeGoalAchieved: boolean;
}

// GET /stats/focus — 기간별 집중시간 합계 + 직전 동일 기간 대비 delta.
export interface FocusPeriodStatsResponse {
  period: StatsPeriod;
  from: string; // LocalDate
  to: string; // LocalDate
  totalFocusMinutes: number;
  previousTotalFocusMinutes: number;
  deltaMinutes: number;
}

// GET /stats/screen-time — 기간별 스크린타임 합계 + 직전 동일 기간 대비 delta.
// day: goalAchieved 유효, achievedDays·elapsedDays는 null / week·month: 반대.
export interface ScreenTimePeriodStatsResponse {
  period: StatsPeriod;
  from: string; // LocalDate
  to: string; // LocalDate
  currentMinutes: number;
  previousMinutes: number;
  deltaMinutes: number; // current - previous (음수 = 개선)
  goalMinutes: number; // 일일 목표(분), 0 = 미설정
  goalAchieved: boolean | null; // day 전용, week/month는 null
  achievedDays: number | null; // week/month 전용 달성일수
  elapsedDays: number | null; // week/month 전용 경과일수
}
