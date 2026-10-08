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
test('진행 중인 날짜는 pending으로 보고해 중간 숫자로 보상을 확정하지 않는다', () => {
  const result = buildScreenTimeObservations(
    'approved',
    timeline(),
    Date.parse('2026-10-09T01:00:00Z'),
  );
  expect(
    result.map(({ date, minutes, measurementStatus }) => ({ date, minutes, measurementStatus })),
  ).toEqual([
    { date: '2026-10-08', minutes: 75, measurementStatus: 'authorized' },
    { date: '2026-10-09', minutes: null, measurementStatus: 'pending' },
  ]);
});
test('권한 철회는 숫자를 보내지 않고 마감 지난 날짜는 제외한다', () => {
  const now = Date.parse('2026-10-09T12:00:00.001Z');
  expect(reportDeadline('2026-10-08')).toBe(now - 1);
  expect(buildScreenTimeObservations('denied', timeline(), now)).toEqual([
    {
      date: '2026-10-09',
      minutes: null,
      measurementStatus: 'denied',
      measuredAt: new Date(now).toISOString(),
    },
  ]);
});
