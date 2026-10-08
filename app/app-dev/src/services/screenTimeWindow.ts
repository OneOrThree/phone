import type { UsageTimeline, ScreenTimeAuthorization } from './ScreenTimeModule';
import type { MeasurementStatus } from './api/records';

const DAY = 86_400_000;
const KST = 9 * 60 * 60 * 1000;
export const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);
export const reportDeadline = (date: string) => Date.parse(`${date}T00:00:00Z`) + DAY * 1.5;

export type ScreenTimeObservation = {
  date: string;
  minutes: number | null;
  measurementStatus: MeasurementStatus;
  measuredAt: string;
};

/** 레거시 구간 차분 방식. 네이티브의 KST 날짜마다 누적값이 다시 0부터 시작한다. */
export function measureUTCWindow(date: string, timeline: UsageTimeline): number | null {
  const start = Date.parse(`${date}T00:00:00Z`);
  const end = start + DAY;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(timeline.startedAt) ||
    !Number.isFinite(timeline.observedAt) ||
    timeline.startedAt * 1000 > start ||
    timeline.startedAt <= 0
  )
    return null;
  if (timeline.observedAt * 1000 < end) return null;
  let total = 0;
  for (let cursor = start; cursor < end;) {
    const day = utcDay(cursor + KST);
    const midnight = Date.parse(`${day}T00:00:00+09:00`);
    const until = Math.min(midnight + DAY, end);
    const part = timeline.days.find((d) => d.date === day);
    if (
      !part ||
      !Number.isFinite(part.startedAt) ||
      part.startedAt * 1000 > cursor ||
      part.startedAt <= 0
    )
      return null;
    if (timeline.unconfirmedDays.includes(day)) return null;
    const events = [...part.events].sort((a, b) => a.firedAt - b.firedAt);
    let before = 0;
    let after = 0;
    let previous = 0;
    for (const event of events) {
      if (
        !Number.isFinite(event.firedAt) ||
        !Number.isInteger(event.bucket) ||
        event.bucket < previous ||
        event.bucket >= 900 ||
        event.firedAt * 1000 < midnight ||
        event.firedAt * 1000 >= midnight + DAY ||
        event.firedAt > timeline.observedAt
      )
        return null;
      previous = event.bucket;
      if (event.firedAt * 1000 <= cursor) before = event.bucket;
      if (event.firedAt * 1000 < until) after = event.bucket;
    }
    total += Math.max(0, after - before);
    cursor = until;
  }
  return total;
}

export function buildScreenTimeObservations(
  authorization: ScreenTimeAuthorization,
  timeline: UsageTimeline | null,
  now = Date.now(),
): ScreenTimeObservation[] {
  const measuredAt = new Date(now).toISOString();
  return [utcDay(now - DAY), utcDay(now)]
    .filter((date) => now <= reportDeadline(date))
    .map((date) => {
      const base = { date, measuredAt, minutes: null };
      if (authorization === 'denied') return { ...base, measurementStatus: 'denied' as const };
      if (authorization !== 'approved')
        return { ...base, measurementStatus: 'unavailable' as const };
      // 현 서버에는 최종 관측 표식이 없다. 당일 숫자를 authorized로 올리면 앱 미실행으로
      // 최종 보고가 없어도 자정 뒤 달성으로 판정한다. 닫힌 UTC 하루만 숫자로 보고한다.
      if (date === utcDay(now)) return { ...base, measurementStatus: 'pending' as const };
      const minutes = timeline ? measureUTCWindow(date, timeline) : null;
      return {
        ...base,
        minutes,
        measurementStatus: minutes === null ? ('unavailable' as const) : ('authorized' as const),
      };
    });
}
