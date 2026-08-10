// 챌린지 요일 스케줄·날짜 표기 유틸 — 카드 요일 배지(GROMO-1274)·다음 활성일 예약(1419)·
// 주간 일괄 참여(1276)가 같은 산출을 쓴다. 정본 규칙은 docs/prd/challenge/low-level-design.md
// §3.4(RepeatSchedule)·§2.1 — 서버와 같은 결과가 나와야 화면과 결제 대상이 어긋나지 않는다.
//
// ⚠️ 날짜 연산은 전부 'YYYY-MM-DD' 문자열 공간의 UTC 산술이다 — 날짜만 다루는 계산은 시간대가
//    없어야 안전하다(기기 로컬 Date로 접으면 비KST 기기에서 하루 어긋난다). '오늘'은 호출부가
//    todayStrKst()로 넘긴다 — 이 모듈은 시계를 직접 읽지 않는다(테스트에서 시각 고정이 쉬워진다).
import type { ChallengeRepeatDay } from '@/types/dto/group';

// ISO 요일 순서(월=0…일=6) — 배지 행의 렌더 순서이자 주(월~일) 경계 계산의 축.
export const REPEAT_DAY_ORDER: readonly ChallengeRepeatDay[] = [
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
];

// 배지·문구용 한글 요일 — REPEAT_DAY_ORDER와 같은 인덱스.
export const REPEAT_DAY_LABELS: readonly string[] = ['월', '화', '수', '목', '금', '토', '일'];

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000; // KST는 DST가 없어 고정 오프셋으로 접어도 안전하다.

// 'YYYY-MM-DD' → UTC 자정 ms. 형식이 어긋나면 NaN(호출부 폴백 유도).
function dateStrToMs(dateStr: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? Date.parse(`${dateStr}T00:00:00Z`) : NaN;
}

// 'YYYY-MM-DD'의 요일 인덱스(월=0…일=6). 무효 입력은 null.
export function weekdayIndexOf(dateStr: string): number | null {
  const ms = dateStrToMs(dateStr);
  if (Number.isNaN(ms)) return null;
  // getUTCDay: 일=0…토=6 → 월=0…일=6로 회전.
  return (new Date(ms).getUTCDay() + 6) % 7;
}

// 'YYYY-MM-DD'의 ISO 요일. 무효 입력은 null.
export function repeatDayOf(dateStr: string): ChallengeRepeatDay | null {
  const idx = weekdayIndexOf(dateStr);
  return idx === null ? null : REPEAT_DAY_ORDER[idx];
}

// 'YYYY-MM-DD' + n일. 무효 입력은 원문 유지(깨진 날짜보다 원문이 낫다 — monthDay 관례).
export function addDaysStr(dateStr: string, days: number): string {
  const ms = dateStrToMs(dateStr);
  if (Number.isNaN(ms)) return dateStr;
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

// ISO Instant(서버 nextSessionAt) → KST 'YYYY-MM-DD'. 파싱 실패는 null(표기 생략 유도).
// utils/localDate.kstDateStr과 같은 결과지만 Intl 없이 고정 오프셋으로 접는다 — 이 모듈을
// 쓰는 화면 테스트들이 localDate를 부분 목으로 갈아 끼우는 관행과 충돌하지 않기 위해서다.
export function kstDateOfInstant(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' → '8/12(수)' — 날짜·요일이 같이 읽혀야 요일 반복 화면에서 정보가 된다(ux §02).
// 연도는 넣지 않는다(카드 monthDay와 같은 이유 — 대상은 늘 이번 주 언저리다). 무효면 원문.
export function fmtMonthDayDow(dateStr: string): string {
  const idx = weekdayIndexOf(dateStr);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (idx === null || m === null) return dateStr;
  return `${Number(m[2])}/${Number(m[3])}(${REPEAT_DAY_LABELS[idx]})`;
}

// 다음 회차 날짜의 상대·절대 혼용 표기(ux §02 note): 오늘 → '오늘', 내일 → '내일', 그 밖 →
// '8/12(수)'. "3일 뒤" 같은 상대 표현은 쓰지 않는다 — 요일 반복에서는 날짜가 곧 정보다.
export function fmtRelativeDay(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return '오늘';
  if (dateStr === addDaysStr(todayStr, 1)) return '내일';
  return fmtMonthDayDow(dateStr);
}

// 'HH:mm:ss'·ISO 등 서버 시각 문자열에서 'HH:mm'만 — challengeLabel.hhmm과 같은 규칙(원문 폴백).
export function hhmmOf(v: string): string {
  return /(\d{2}:\d{2})/.exec(v)?.[1] ?? v;
}

// 이번 주(월~일, KST) 안에서 오늘 **이후**의 활성 요일 날짜들. includeToday면 오늘도 후보다 —
// 오늘의 참여 가능 여부(창 시작 전·미참가·자격)는 호출부가 판단해 넘긴다(카드가 이미 아는 값들).
// 서버 RepeatSchedule.remainingThisWeek(LLD §2.2)와 같은 창(그 주 일요일까지)이다.
export function weekRemainingActiveDates(
  repeatDays: readonly ChallengeRepeatDay[],
  todayStr: string,
  includeToday: boolean,
): string[] {
  const todayIdx = weekdayIndexOf(todayStr);
  if (todayIdx === null) return [];
  const dates: string[] = [];
  for (let offset = includeToday ? 0 : 1; offset <= 6 - todayIdx; offset++) {
    const date = addDaysStr(todayStr, offset);
    const day = repeatDayOf(date);
    if (day !== null && repeatDays.includes(day)) dates.push(date);
  }
  return dates;
}

// 분 → '6시간 12분' — 하루형 참가 시트의 '오늘 남은 시간'(N16)·시간 부족 경고(N23) 표기.
// 0분 이하는 '0분'(마이너스를 지어내지 않는다).
export function fmtKoreanDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}
