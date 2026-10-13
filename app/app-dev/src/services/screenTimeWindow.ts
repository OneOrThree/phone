import type { UsageTimeline, ScreenTimeAuthorization } from './ScreenTimeModule';
import type { MeasurementStatus } from './api/records';

const DAY = 86_400_000;
const KST = 9 * 60 * 60 * 1000;
export const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);
export type MeasurementTimezone = 'UTC' | 'Asia/Seoul';
export const windowStart = (date: string, timezone: MeasurementTimezone = 'UTC') =>
  Date.parse(`${date}T00:00:00Z`) - (timezone === 'Asia/Seoul' ? KST : 0);
export const reportDeadline = (date: string, timezone: MeasurementTimezone = 'UTC') =>
  windowStart(date, timezone) + DAY * 1.5;
export const observationKey = (o: ScreenTimeObservation) => `${o.timezone ?? 'UTC'}|${o.date}`;

export type ScreenTimeObservation = {
  date: string;
  minutes: number | null;
  measurementStatus: MeasurementStatus;
  measuredAt: string;
  finalized?: boolean;
  timezone?: MeasurementTimezone;
  windowStart?: string;
  windowEnd?: string;
};

/** 레거시 구간 차분 방식. 네이티브의 KST 날짜마다 누적값이 다시 0부터 시작한다. */
export function measureUTCWindow(date: string, timeline: UsageTimeline): number | null {
  const start = Date.parse(`${date}T00:00:00Z`);
  return measureUsageWindow(start, start + DAY, timeline);
}

export function measureUsageWindow(
  start: number,
  end: number,
  timeline: UsageTimeline,
): number | null {
  if (
    !Number.isFinite(start) ||
    end <= start ||
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
  // 브리지 전달 지연이 자정을 넘어도 실제로 관측한 시각과 날짜를 유지한다.
  const observedAt =
    authorization === 'approved' && timeline && Number.isFinite(timeline.observedAt)
      ? Math.min(now, timeline.observedAt * 1000)
      : now;
  const measuredAt = new Date(observedAt).toISOString();
  return (['UTC', 'Asia/Seoul'] as const).flatMap((timezone) => {
    const today = utcDay(observedAt + (timezone === 'Asia/Seoul' ? KST : 0));
    const yesterday = utcDay(Date.parse(today + 'T00:00:00Z') - DAY);
    return [yesterday, today]
      .filter((date) => now <= reportDeadline(date, timezone))
      .map((date) => {
        const start = windowStart(date, timezone);
        const finalized = observedAt >= start + DAY;
        const base = {
          date,
          measuredAt,
          minutes: null,
          finalized,
          timezone,
          windowStart: new Date(start).toISOString(),
          windowEnd: new Date(start + DAY).toISOString(),
        };
        if (authorization === 'denied') return { ...base, measurementStatus: 'denied' as const };
        if (authorization !== 'approved')
          return { ...base, measurementStatus: 'unavailable' as const };
        const minutes = timeline
          ? measureUsageWindow(start, Math.min(start + DAY, observedAt), timeline)
          : null;
        return {
          ...base,
          minutes,
          measurementStatus:
            minutes === null
              ? finalized
                ? ('unavailable' as const)
                : ('pending' as const)
              : ('authorized' as const),
        };
      });
  });
}
