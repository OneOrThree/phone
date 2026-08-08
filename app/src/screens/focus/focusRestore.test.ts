// 세션 집중초 계산 테스트(GROMO-1214 코드리뷰 ⑥) — 앱이 합산하는 값과 서버 확정값의 정합.
//
// 잠그는 것: 앱이 세션 구간을 그대로 합하면 일시정지 시간만큼 부풀어, 서버가 확정한 값
// (daily_focus_stats·리그 주간 랭킹)과 어긋난다. 서버와 **같은 공식**으로 방해 비율을 뺀다:
//   기여분 = 겹침초 × (1 − totalDistractionSeconds / (endedAt − startedAt)), 하한 0
import { sessionFocusSeconds, sessionTodayFocusSeconds } from './focusRestore';
import type { FocusSessionResponse } from '@/types/dto/focus';

jest.mock('@/services/focusApi', () => ({
  getAllFocusSessions: jest.fn(),
  getFocusTags: jest.fn(),
}));

function session(
  startedAt: string,
  endedAt: string,
  totalDistractionSeconds = 0,
): FocusSessionResponse {
  return { focusTagId: null, startedAt, endedAt, totalDistractionSeconds };
}

// 오늘 12:00~13:00 (로컬) — 자정에 걸치지 않는 세션
function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

describe('sessionFocusSeconds — 세션 전체 길이', () => {
  test('방해 0이면 구간 전체 — 종전과 동일(회귀 방지)', () => {
    expect(sessionFocusSeconds(session(todayAt(12), todayAt(13)))).toBe(3600);
  });

  test('일시정지가 있으면 그만큼 빠진다 — 서버 사전집계(구간−방해초)와 같은 값', () => {
    expect(sessionFocusSeconds(session(todayAt(12), todayAt(13), 900))).toBe(2700);
  });

  test('방해가 구간보다 커도 음수가 아니라 0', () => {
    expect(sessionFocusSeconds(session(todayAt(12), todayAt(13), 7200))).toBe(0);
  });

  test('시계가 뒤로 간 비정상 레코드는 0', () => {
    expect(sessionFocusSeconds(session(todayAt(13), todayAt(12), 60))).toBe(0);
  });
});

describe('sessionTodayFocusSeconds — 오늘 몫', () => {
  test('오늘 안에 들어간 세션은 구간 − 방해초', () => {
    expect(sessionTodayFocusSeconds(session(todayAt(12), todayAt(13), 900))).toBe(2700);
  });

  // 자정을 걸친 세션은 오늘 겹침만 세고, 방해는 세션 전체 길이 대비 비율로 깎는다 —
  // 방해 초에 타임스탬프가 없어 어디서 났는지 모르므로 세션에 고르게 퍼져 있다고 본다.
  test('자정을 걸친 세션은 오늘 겹침에 방해 비율만 적용된다', () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const yesterday23 = new Date(midnight.getTime() - 3600e3).toISOString(); // 어제 23:00
    const today1 = new Date(midnight.getTime() + 3600e3).toISOString(); // 오늘 01:00
    // 전체 2시간 중 오늘 몫 1시간, 방해 12분(10%) → 3600 × 0.9 = 3240
    expect(sessionTodayFocusSeconds(session(yesterday23, today1, 720))).toBe(3240);
  });

  test('방해 0이면 오늘 겹침 그대로 — 종전과 동일(회귀 방지)', () => {
    expect(sessionTodayFocusSeconds(session(todayAt(12), todayAt(13)))).toBe(3600);
  });
});
