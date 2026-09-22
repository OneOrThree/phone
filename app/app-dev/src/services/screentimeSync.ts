import { getSession } from './api/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  screenTimeNative,
  type AndroidUsageSnapshot,
  type ScreenTimeAuthorization,
} from './ScreenTimeModule';
import { dayKey } from './model';

export const ANDROID_SCREEN_TIME_KEY = 'gromo:v2:android-screen-time';
type Measurement = {
  anchor: string;
  lastSeen: string;
  lastGranted: string;
  values: Record<string, number>;
  unconfirmed: string[];
};
export type ScreenTimeSnapshot = {
  approved: boolean;
  date: string;
  minutes: number | null;
  history: { date: string; minutes: number }[];
  unconfirmedDays: string[];
};
type Dependencies = {
  status: () => Promise<ScreenTimeAuthorization>;
  read: () => Promise<AndroidUsageSnapshot>;
  owner?: () => string;
  load: (owner: string) => Promise<string | null>;
  save: (value: string, owner: string) => Promise<void>;
  now: () => number;
  clear: (owner: string) => Promise<void>;
};

function parse(value: string | null): Measurement | null {
  if (!value) return null;
  const data = JSON.parse(value) as Measurement;
  const validDate = (date: unknown) =>
    typeof date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date + 'T00:00:00+09:00'));
  if (
    !validDate(data.anchor) ||
    !validDate(data.lastSeen) ||
    !validDate(data.lastGranted) ||
    !data.values ||
    !Array.isArray(data.unconfirmed) ||
    !data.unconfirmed.every(validDate) ||
    Object.entries(data.values).some(
      ([date, minutes]) => !validDate(date) || !Number.isFinite(minutes) || minutes < 0,
    )
  ) {
    throw new Error('INVALID_MEASUREMENT');
  }
  return data;
}

// 호출을 직렬화해 복귀·타이머·권한 화면의 동시 조회가 더 최신 기록을 덮지 않게 한다.
export function createAndroidScreenTimeSync(deps: Dependencies) {
  let tail: Promise<unknown> = Promise.resolve();
  const ownerNow = () => deps.owner?.() ?? 'local';
  const run = async (owner: string): Promise<ScreenTimeSnapshot> => {
    const checkOwner = () => {
      if (ownerNow() !== owner) throw new Error('SCREEN_TIME_ACCOUNT_CHANGED');
    };
    checkOwner();
    const today = dayKey(deps.now());
    const stored = parse(await deps.load(owner));
    if (stored && stored.lastSeen > today) throw new Error('CLOCK_MOVED_BACKWARDS');
    const approved = (await deps.status()) === 'approved';
    const invalid = new Set(stored?.unconfirmed ?? []);
    if (!approved) {
      if (stored) {
        // 철회 시점을 알 수 없으므로 마지막 승인 관측일부터 확인 불가로 남긴다.
        for (let date = stored.lastGranted || stored.lastSeen; date <= today;) {
          invalid.add(date);
          date = dayKey(Date.parse(date + 'T00:00:00+09:00') + 86400000);
        }
        stored.unconfirmed = [...invalid].sort();
        stored.lastSeen = today;
        checkOwner();
        await deps.save(JSON.stringify(stored), owner);
      }
      checkOwner();
      return {
        approved: false,
        date: today,
        minutes: null,
        history: [],
        unconfirmedDays: [...invalid],
      };
    }
    const raw = await deps.read();
    if (
      raw.date !== dayKey(deps.now()) ||
      raw.previousDate !== dayKey(Date.parse(raw.date + 'T00:00:00+09:00') - 1) ||
      !Number.isFinite(raw.minutes) ||
      raw.minutes < 0 ||
      !Number.isFinite(raw.previousMinutes) ||
      raw.previousMinutes < 0
    ) {
      throw new Error('STALE_OR_INVALID_USAGE');
    }
    if ((await deps.status()) !== 'approved') throw new Error('USAGE_ACCESS_CHANGED');
    const record: Measurement = stored ?? {
      anchor: raw.date,
      lastSeen: raw.date,
      lastGranted: raw.date,
      values: {},
      unconfirmed: [],
    };
    // OS 원시 이벤트의 보존 기간이 짧으므로 어제보다 오래된 미확정 날짜는 0으로 만들지 않는다.
    for (let date = record.lastSeen; date < raw.previousDate;) {
      invalid.add(date);
      date = dayKey(Date.parse(date + 'T00:00:00+09:00') + 86400000);
    }
    record.values[raw.date] = Math.max(record.values[raw.date] ?? 0, raw.minutes);
    if (raw.previousDate >= record.anchor && !invalid.has(raw.previousDate)) {
      record.values[raw.previousDate] = Math.max(
        record.values[raw.previousDate] ?? 0,
        raw.previousMinutes,
      );
    }
    record.lastSeen = raw.date;
    record.lastGranted = raw.date;
    record.unconfirmed = [...invalid].sort();
    checkOwner();
    await deps.save(JSON.stringify(record), owner);
    checkOwner();
    return {
      approved: true,
      date: raw.date,
      minutes: record.values[raw.date],
      history: Object.entries(record.values)
        .filter(([date]) => date < raw.date && !invalid.has(date))
        .map(([date, minutes]) => ({ date, minutes })),
      unconfirmedDays: record.unconfirmed,
    };
  };
  const sync = () => {
    const owner = ownerNow();
    const next = tail.then(
      () => run(owner),
      () => run(owner),
    );
    tail = next.catch(() => {});
    return next;
  };
  return Object.assign(sync, {
    reset: () => {
      const owner = ownerNow();
      const cleared = tail.then(
        () => deps.clear(owner),
        () => deps.clear(owner),
      );
      tail = cleared.catch(() => {});
      return cleared;
    },
  });
}

export const syncAndroidScreenTime = createAndroidScreenTimeSync({
  status: () => screenTimeNative?.getAuthorizationStatus?.() ?? Promise.resolve('unavailable'),
  read: () => screenTimeNative?.getUsageSnapshot?.() ?? Promise.reject(new Error('UNAVAILABLE')),
  owner: () => (getSession()?.userId ? `user:${getSession()!.userId}` : 'local'),
  load: (owner) => AsyncStorage.getItem(`${ANDROID_SCREEN_TIME_KEY}:${owner}`),
  save: (value, owner) => AsyncStorage.setItem(`${ANDROID_SCREEN_TIME_KEY}:${owner}`, value),
  now: () => Date.now(),
  clear: (owner) => AsyncStorage.removeItem(`${ANDROID_SCREEN_TIME_KEY}:${owner}`),
});
