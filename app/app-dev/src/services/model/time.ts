import { formatDuration } from '@/i18n/format';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const kstDate = (at: number) => new Date(at + KST_OFFSET_MS);

export const dayKey = (at = Date.now()) => {
  const d = kstDate(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

// 날짜 "M/D"와 시각 "HH:MM"(Asia/Seoul, 기기 시간대와 무관)
export const kstMonthDay = (at: number) => {
  const d = kstDate(at);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export const kstHourMinute = (at: number) => {
  const d = kstDate(at);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

export const kstDayStart = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) - KST_OFFSET_MS;
};

// "HH:MM" → 자정부터 분. 형식이 틀리면 null
// 시간대 종료는 24:00까지 쓸 수 있고, 네이티브 입력의 '9:00' 같은 한 자리 시도 받는다
export const clockMinutes = (v?: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? '');
  if (!m || +m[2] >= 60 || +m[1] > 24 || (+m[1] === 24 && +m[2] > 0)) return null;
  return +m[1] * 60 + +m[2];
};

// "9:00" 같은 입력을 "09:00"으로 맞춘다 (형식이 틀리면 입력 그대로)
export const clockText = (value: string) => {
  const m = clockMinutes(value);
  return m == null
    ? value
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// 이번 주 시작 = Asia/Seoul 기준 일요일 00:00 (정책: 주간 랭킹은 매주 일요일 00시에 초기화)
export function weekStart(now = Date.now()) {
  const d = kstDate(now);
  return (
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()) - KST_OFFSET_MS
  );
}

// "N시간 M분", 1시간 미만은 "M분", 딱 떨어지는 시간은 "N시간" — 언어별 표기는 formatDuration 이 맡는다
export function hoursMinutes(seconds: number) {
  return formatDuration(seconds);
}

// Period filtering is shared by the diary and ranking; no fabricated record values.
export function periodBounds(period: '일' | '주' | '월', offset: number, at = Date.now()) {
  const d = kstDate(at);
  d.setUTCHours(0, 0, 0, 0);
  if (period === '일') d.setUTCDate(d.getUTCDate() + offset);
  if (period === '주') {
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offset * 7);
  }
  if (period === '월') {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + offset);
  }
  const from = d.getTime() - KST_OFFSET_MS;
  if (period === '일') d.setUTCDate(d.getUTCDate() + 1);
  if (period === '주') d.setUTCDate(d.getUTCDate() + 7);
  if (period === '월') d.setUTCMonth(d.getUTCMonth() + 1);
  return { from, until: d.getTime() - KST_OFFSET_MS };
}
