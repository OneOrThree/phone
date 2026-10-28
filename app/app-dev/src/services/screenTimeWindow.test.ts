import { buildScreenTimeObservations, measureUTCWindow, reportDeadline } from './screenTimeWindow';
import type { UsageTimeline } from './ScreenTimeModule';

const sec = (value: string) => Date.parse(value) / 1000;
const timeline = (): UsageTimeline => ({
  startedAt: sec('2026-10-07T00:00:00Z'),
  observedAt: sec('2026-10-09T01:00:00Z'),
  unconfirmedDays: [],
  days: [
    {
      date: '2026-10-08',
      startedAt: sec('2026-10-08T00:00:00+09:00'),
      events: [
        { bucket: 30, firedAt: sec('2026-10-08T08:00:00+09:00') },
        { bucket: 60, firedAt: sec('2026-10-08T12:00:00+09:00') },
        { bucket: 90, firedAt: sec('2026-10-08T23:00:00+09:00') },
      ],
    },
    {
      date: '2026-10-09',
      startedAt: sec('2026-10-09T00:00:00+09:00'),
      events: [
        { bucket: 15, firedAt: sec('2026-10-09T08:00:00+09:00') },
        { bucket: 30, firedAt: sec('2026-10-09T09:30:00+09:00') },
      ],
    },
  ],
});

test('UTC 하루에 해당하는 두 KST 날짜 차분만 합산한다', () => {
  expect(measureUTCWindow('2026-10-08', timeline())).toBe(75);
});
test('기기 로컬 시간대가 바뀌어도 네이티브 KST 측정 경계를 유지한다', () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ['Asia/Seoul', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = timezone;
      expect(measureUTCWindow('2026-10-08', timeline())).toBe(75);
    }
  } finally {
    process.env.TZ = previous;
  }
});
test.each(['partial', 'missing', 'permission', 'saturated', 'reversed', 'future'])(
  '%s 관측을 0분이나 확정 숫자로 보고하지 않는다',
  (kind) => {
    const value = timeline();
    if (kind === 'partial') value.startedAt = sec('2026-10-08T01:00:00Z');
    if (kind === 'missing') value.days.pop();
    if (kind === 'permission') value.unconfirmedDays = ['2026-10-09'];
    if (kind === 'saturated') value.days[0].events[2].bucket = 900;
    if (kind === 'reversed') value.days[0].events[2].bucket = 15;
    if (kind === 'future') value.days[1].events[1].firedAt = value.observedAt + 1;
    expect(measureUTCWindow('2026-10-08', value)).toBeNull();
  },
);
test('완전한 측정 구간에서 이벤트가 없을 때만 실제 0분이다', () => {
  const value = timeline();
  value.days.forEach((d) => {
    d.events = [];
  });
  expect(measureUTCWindow('2026-10-08', value)).toBe(0);
});
test('진행 중인 수치는 중간 관측으로 보고하고 닫힌 하루만 최종 관측으로 보낸다', () => {
  const result = buildScreenTimeObservations(
    'approved',
    timeline(),
    Date.parse('2026-10-09T01:00:00Z'),
  );
  expect(
    result
      .filter((o) => o.timezone === 'UTC')
      .map(({ date, minutes, measurementStatus }) => ({ date, minutes, measurementStatus })),
  ).toEqual([
    { date: '2026-10-08', minutes: 75, measurementStatus: 'authorized' },
    { date: '2026-10-09', minutes: 15, measurementStatus: 'authorized' },
  ]);
  expect(result.filter((o) => o.timezone === 'UTC').map((o) => o.finalized)).toEqual([true, false]);
});
test('권한 철회는 숫자를 보내지 않고 마감 지난 날짜는 제외한다', () => {
  const now = Date.parse('2026-10-09T12:00:00.001Z');
  expect(reportDeadline('2026-10-08')).toBe(now - 1);
  expect(
    buildScreenTimeObservations('denied', timeline(), now).filter((o) => o.timezone === 'UTC'),
  ).toEqual([
    {
      date: '2026-10-09',
      minutes: null,
      measurementStatus: 'denied',
      measuredAt: new Date(now).toISOString(),
      finalized: false,
      timezone: 'UTC',
      windowStart: '2026-10-09T00:00:00.000Z',
      windowEnd: '2026-10-10T00:00:00.000Z',
    },
  ]);
});

test('같은 날짜의 UTC 일계와 KST 일계를 독립 집계하고 UTC 경계를 보낸다', () => {
  const result = buildScreenTimeObservations(
    'approved',
    timeline(),
    Date.parse('2026-10-09T01:00:00Z'),
  );
  expect(result.find((o) => o.date === '2026-10-08' && o.timezone === 'UTC')?.minutes).toBe(75);
  expect(result.find((o) => o.date === '2026-10-08' && o.timezone === 'Asia/Seoul')).toMatchObject({
    minutes: 90,
    finalized: true,
    windowStart: '2026-10-07T15:00:00.000Z',
    windowEnd: '2026-10-08T15:00:00.000Z',
  });
});

test('브리지 전달이 늦어져도 당일 관측을 비우지 않고 실제 측정 시각을 보고한다', () => {
  const value = timeline();
  const result = buildScreenTimeObservations('approved', value, value.observedAt * 1000 + 250);
  expect(result.find((o) => o.timezone === 'UTC' && !o.finalized)).toMatchObject({
    minutes: 15,
    measurementStatus: 'authorized',
    measuredAt: '2026-10-09T01:00:00.000Z',
  });
  expect(result.find((o) => o.timezone === 'Asia/Seoul' && !o.finalized)).toMatchObject({
    minutes: 30,
    measurementStatus: 'authorized',
    measuredAt: '2026-10-09T01:00:00.000Z',
  });
});

test.each([
  ['2026-10-09T14:59:59.999Z', 'Asia/Seoul'],
  ['2026-10-09T23:59:59.999Z', 'UTC'],
])(
  '%s 자정 직전 스냅샷은 전달 중 자정이 지나도 최종 관측으로 바뀌지 않는다',
  (instant, timezone) => {
    const value = timeline();
    value.observedAt = sec(instant);
    value.days.push({
      date: '2026-10-10',
      startedAt: sec('2026-10-10T00:00:00+09:00'),
      events: [],
    });
    const result = buildScreenTimeObservations('approved', value, value.observedAt * 1000 + 2);
    expect(result.find((o) => o.date === '2026-10-09' && o.timezone === timezone)).toMatchObject({
      finalized: false,
      measurementStatus: 'authorized',
      measuredAt: instant,
    });
  },
);

test('iOS 900분 포화는 UTC·KST 최종 관측에서 측정 불가로 보내고 확정 900분으로 보고하지 않는다', () => {
  const value = timeline();
  value.days[0].events[2].bucket = 900;
  const result = buildScreenTimeObservations('approved', value, value.observedAt * 1000);
  for (const timezone of ['UTC', 'Asia/Seoul']) {
    expect(result.find((o) => o.date === '2026-10-08' && o.timezone === timezone)).toMatchObject({
      minutes: null,
      measurementStatus: 'unavailable',
      finalized: true,
    });
  }
});
