/**
 * 게시판 시간대 집중 퀘스트의 창(windowStart/windowEnd) KST↔UTC 벽시계 변환 (GROMO-2672).
 *
 * 서버 계약은 UTC 로 고정이다(결정 Q-6) — 서버는 창을 UTC `HH:mm`, timezone="UTC" 로 받는다.
 * 창은 절대 시각 구간이라 앱 경계(서버 어댑터)에서 벽시계만 ±9시간 옮기면 된다. 앱 내부(폼·표시·
 * 목업)는 전부 KST 벽시계를 쓰고, 이 변환은 `services/api/quests.ts`·`notices.ts` 어댑터에서만 한다.
 *
 * "하루 회차 리셋이 UTC 자정"은 별개 서버 이슈라 여기서 다루지 않는다.
 */
import { clockMinutes } from '@/services/model';

const DAY = 24 * 60;
const KST_OFFSET = 9 * 60; // KST = UTC + 9시간

// 분(0~1439)을 "HH:mm" 로. 변환 결과는 늘 [0,1440) 이라 24:00 이 나오지 않는다.
const format = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// 벽시계를 delta 분만큼 옮긴다. 형식이 틀리면(clockMinutes 가 null) 원본을 그대로 돌려준다.
const shift = (hhmm: string, delta: number): string => {
  const m = clockMinutes(hhmm);
  if (m === null) return hhmm;
  return format((((m + delta) % DAY) + DAY) % DAY);
};

/** KST 벽시계 "HH:mm" → UTC "HH:mm"(9시간 앞). 24:00 → 15:00. 형식 오류는 원본 반환. */
export const kstClockToUtc = (hhmm: string): string => shift(hhmm, -KST_OFFSET);

/** UTC "HH:mm" → KST 벽시계 "HH:mm"(9시간 뒤). 형식 오류는 원본 반환. */
export const utcClockToKst = (hhmm: string): string => shift(hhmm, KST_OFFSET);

/**
 * KST 창을 UTC 로 바꿨을 때 UTC 자정을 가로지르는가 — 서버 cross-midnight CHECK 와 같다.
 * utcStart >= utcEnd 이면 하루를 넘겨(또는 종료가 UTC 자정에 정확히 닿아) 저장할 수 없다(= true).
 * 형식 오류는 다른 검증에 맡기고 false.
 */
export function kstWindowCrossesUtcMidnight(startKst: string, endKst: string): boolean {
  const s = clockMinutes(startKst),
    e = clockMinutes(endKst);
  if (s === null || e === null) return false;
  const utcStart = (((s - KST_OFFSET) % DAY) + DAY) % DAY,
    utcEnd = (((e - KST_OFFSET) % DAY) + DAY) % DAY;
  return utcStart >= utcEnd;
}

type QuestWindow = { windowStart: string | null; windowEnd: string | null };

/**
 * 서버(UTC) 창 필드를 KST 표시용으로 되돌린 사본. null·형식 오류는 그대로 둔다.
 * 종료가 UTC 자정(= KST 00:00)으로 떨어지면 하루 끝 24:00 으로 되살린다 —
 * 21:00–24:00 KST(= 12:00–15:00 UTC) 창이 21:00–00:00 으로 거꾸로 보이지 않게 한다.
 */
export function utcWindowToKst<T extends QuestWindow>(q: T): T {
  if (q.windowStart == null && q.windowEnd == null) return q;
  let windowEnd = q.windowEnd;
  if (windowEnd != null) {
    const kst = utcClockToKst(windowEnd);
    windowEnd = kst === '00:00' ? '24:00' : kst;
  }
  return {
    ...q,
    windowStart: q.windowStart == null ? q.windowStart : utcClockToKst(q.windowStart),
    windowEnd,
  };
}
