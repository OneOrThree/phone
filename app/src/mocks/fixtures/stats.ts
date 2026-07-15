import type { InternalAxiosRequestConfig } from 'axios';
import type {
  CategoryFocusItem,
  CategoryFocusStatsResponse,
  FocusAverageResponse,
  FocusAverageScope,
  StatsPeriod,
} from '@/types/dto/stats';
import type { PublicProfileResponse, UserStatsResponse } from '@/types/dto/user';
import { mockFriendById } from './friends';

// GROMO-692 — 과목별 비교 오늘/이번주 탭을 실기기에서 데이터 상태별로 확인하기 위한 목.
// friends 파라미터 유무로 나/상대를 구분하고, 기간별 배수로 탭 전환 시 값이 달라지는 걸 보이게 한다.
// 상대에게는 겹치지 않는 과목(태그)도 섞어 겹침 매칭 로직이 실제로 걸러내는지 확인한다.

// 기간 배수 — DAY 기준값 × 주/월. 값이 다르면 탭이 실제로 데이터를 갈아끼우는지 눈으로 확인된다.
const PERIOD_MULT: Record<StatsPeriod, number> = { DAY: 1, WEEK: 5, MONTH: 18 };

// [과목명, 내 DAY 분, 상대 DAY 분] — 상대 전용(null)·나 전용(0) 과목 포함
const SUBJECTS: [string, number, number][] = [
  ['알고리즘', 45, 62],
  ['자료구조', 30, 18],
  ['코딩테스트', 0, 35], // 나는 0분이지만 태그는 있음 — 0 바 표기 확인
  ['프로젝트', 25, 0],
];
const THEIR_ONLY: [string, number][] = [['운영체제', 40]]; // 겹침 매칭에서 걸러져야 함

function items(period: StatsPeriod, theirs: boolean): CategoryFocusItem[] {
  const mult = PERIOD_MULT[period];
  const rows: CategoryFocusItem[] = SUBJECTS.map(([name, mine, their], i) => ({
    tagId: `00000000-0000-0000-0000-00000000c69${i}`,
    tagName: name,
    totalFocusMinutes: (theirs ? their : mine) * mult,
  }));
  if (theirs) {
    rows.push(
      ...THEIR_ONLY.map(([name, min], i) => ({
        tagId: `00000000-0000-0000-0000-00000000c79${i}`,
        tagName: name,
        totalFocusMinutes: min * mult,
      })),
    );
  }
  return rows.sort((a, b) => b.totalFocusMinutes - a.totalFocusMinutes);
}

// GET /api/v1/stats/by-category — period·friends별 과목 집중 합계
export function mockFocusStatsByCategory(
  config: InternalAxiosRequestConfig,
): CategoryFocusStatsResponse {
  const period = (config.params?.period as StatsPeriod | undefined) ?? 'WEEK';
  const date = (config.params?.date as string | undefined) ?? '2026-01-01';
  const theirs = config.params?.friends != null;
  const rows = items(period, theirs);
  return {
    period,
    from: date,
    to: date,
    totalFocusMinutes: rows.reduce((a, b) => a + b.totalFocusMinutes, 0),
    items: rows,
  };
}

// GROMO-755 — 오늘 비교 3축 평균(753 API) 목. scope·period 조합별로 값이 달라
// 축 칩 전환·기간별 표기가 실제로 갈아끼워지는지 확인된다.
const AVG_BASE: Record<FocusAverageScope, { avg: number; sample: number }> = {
  FRIENDS: { avg: 38, sample: 4 },
  TOTAL: { avg: 52, sample: 1240 },
  CATEGORY: { avg: 61, sample: 87 },
};

// GET /api/v1/stats/focus/average — scope×period 평균(분)·표본 수
export function mockFocusAverage(config: InternalAxiosRequestConfig): FocusAverageResponse {
  const scope = (config.params?.scope as FocusAverageScope | undefined) ?? 'TOTAL';
  const period = (config.params?.period as StatsPeriod | undefined) ?? 'DAY';
  const date = (config.params?.date as string | undefined) ?? '2026-01-01';
  const base = AVG_BASE[scope] ?? AVG_BASE.TOTAL;
  return {
    scope,
    period,
    from: date,
    to: date,
    averageMinutes: Math.round(base.avg * PERIOD_MULT[period]),
    sampleSize: base.sample,
  };
}

// GROMO-692 — 목 친구의 프로필 상세 진입용. 과목별 비교 카드는 상대 통계(getUserStats)가
// 성공해야(heatmap != null → 세부 공개) 보이므로, 목 친구 ID에 한해 프로필·통계도 목으로 응답한다.
// 실제 유저 ID는 핸들러 매칭에서 제외돼 실서버로 나간다.

// 이번 주 월요일~오늘 날짜 배열(로컬) — 프로필 요일 차트·세부 공개 판정용 heatmap 셀
function thisWeekDates(): string[] {
  const now = new Date();
  const dow = now.getDay(); // 0=일..6=토
  const toMonday = dow === 0 ? -6 : 1 - dow;
  const dates: string[] = [];
  for (let i = 0; ; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMonday + i);
    if (d > now) break;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${d.getFullYear()}-${mm}-${dd}`);
  }
  return dates;
}

// GET /api/v1/users/{목친구id}/profile
export function mockUserProfile(userId: string): PublicProfileResponse {
  const friend = mockFriendById(userId);
  return {
    userId,
    nickname: friend?.nickname ?? '목친구',
    occupation: null,
    equipments: [],
    friendCount: 3,
    currentTier: friend?.tierLevel ?? 1,
    rank: 12,
  };
}

// GET /api/v1/users/{목친구id}/stats — heatmap을 채워 세부 공개(과목 비교 카드 노출) 경로를 연다
export function mockUserStats(): UserStatsResponse {
  const dates = thisWeekDates();
  return {
    isFriend: true,
    streak: { currentStreak: 4, longestStreak: 9, lastSessionDate: dates[dates.length - 1] },
    today: {
      focus: { todayMinutes: 62, goalMinutes: 120, goalAchieved: false, progressPercent: 52 },
      screenTime: { todayMinutes: 95, goalMinutes: 120, goalAchieved: true, progressPercent: 79 },
    },
    heatmap: dates.map((date, i) => ({
      date,
      totalFocusMinutes: [80, 45, 0, 120, 60, 30, 62][i % 7],
      sessionCount: 2,
      focusGoalAchieved: i % 2 === 0,
      actualScreenTimeMinutes: [90, 130, 200, 60, 95, 110, 95][i % 7],
      screenTimeGoalAchieved: i % 3 !== 0,
    })),
  };
}
