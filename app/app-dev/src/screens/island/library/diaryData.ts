import { dayKey, kstDayStart, recordSecondsBetween, type RecordItem } from '@/services/model';
import { utcPeriodRange } from '@/services/api/records';

export const DAY = 86400000;
export type Period = '일' | '주' | '월';
export type DiaryRecord = {
  id: string;
  subject: string;
  seconds: number;
  at: number;
  intervals?: { start: number; end: number }[];
  fish?: number;
};

export const dateKey = (at: number, utc: boolean) =>
  utc ? new Date(at).toISOString().slice(0, 10) : dayKey(at);
export const dateStart = (key: string, utc: boolean) =>
  utc ? Date.parse(`${key}T00:00:00Z`) : kstDayStart(key);
export const shiftDate = (key: string, days: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export const datesBetween = (from: string, to: string) =>
  Array.from(
    { length: Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1) },
    (_, n) => shiftDate(from, n),
  );
export const shortDate = (key: string) => `${Number(key.slice(5, 7))}.${Number(key.slice(8))}`;
export const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
export const weekday = (key: string) => weekdays[new Date(`${key}T00:00:00Z`).getUTCDay()];
export const longDate = (key: string) =>
  `${Number(key.slice(5, 7))}월 ${Number(key.slice(8))}일 ${weekday(key)}요일`;

export function diaryRange(period: Period, offset: number, now: number, utc: boolean) {
  // 로컬 기록도 서버와 같은 일요일~토요일 배치를 쓰되 각자의 날짜 축은 보존한다.
  const key = dateKey(now, utc);
  return utcPeriodRange(period, offset, Date.parse(`${key}T12:00:00Z`));
}

export function localFocusByDay(records: RecordItem[], keys: string[], now: number) {
  return new Map(
    keys.map((key) => {
      const start = kstDayStart(key);
      return [
        key,
        records.reduce(
          (sum, r) => sum + recordSecondsBetween(r, start, Math.min(start + DAY, now)),
          0,
        ),
      ] as const;
    }),
  );
}

export function recordsOnDay(records: DiaryRecord[], key: string, utc: boolean) {
  const from = dateStart(key, utc);
  return recordsInRange(records, from, from + DAY);
}

export function recordsInRange(records: DiaryRecord[], from: number, until: number) {
  return records.flatMap((r) => {
    const intervals = r.intervals ?? [{ start: r.at - r.seconds * 1000, end: r.at }];
    const clipped = intervals.flatMap((interval) => {
      const start = Math.max(interval.start, from);
      const end = Math.min(interval.end, until);
      return start < end ? [{ start, end }] : [];
    });
    const seconds = clipped.reduce(
      (sum, interval) => sum + (interval.end - interval.start) / 1000,
      0,
    );
    return seconds > 0 ? [{ ...r, seconds, ...(r.intervals ? { intervals: clipped } : {}) }] : [];
  });
}

/** 실제 구간만 색칠한다. 완료 시각-집중 시간으로 휴식 위치를 추정하지 않는다. */
export function timetableRows(records: DiaryRecord[], key: string, utc: boolean) {
  const start = dateStart(key, utc);
  return Array.from({ length: 24 }, (_, index) => {
    const hour = (index + 6) % 24;
    return {
      hour,
      cells: Array.from({ length: 6 }, (_, cell) => {
        const from = start + (hour * 60 + cell * 10) * 60000;
        return records.some((r) =>
          r.intervals?.some((i) => i.start < from + 600000 && i.end > from),
        );
      }),
    };
  });
}
