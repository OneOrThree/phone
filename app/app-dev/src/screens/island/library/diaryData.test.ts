import { DAY, dateStart, recordsInRange, recordsOnDay } from './diaryData';

test('구간 없는 자정 교차 기록을 두 날짜에 나누고 시간표 구간은 만들지 않는다', () => {
  const record = {
    id: 'overnight',
    subject: '수학',
    seconds: 3600,
    at: Date.parse('2026-09-22T00:30:00+09:00'),
  };
  for (const day of ['2026-09-21', '2026-09-22']) {
    const rows = recordsOnDay([record], day, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].seconds).toBe(1800);
    expect(rows[0].intervals).toBeUndefined();
  }
});

test('선택 주와 겹치는 세션만 한 번씩 센다', () => {
  const start = dateStart('2026-09-20', false);
  const rows = [
    { id: 'previous', subject: '수학', seconds: 600, at: start - DAY },
    { id: 'boundary', subject: '수학', seconds: 600, at: start },
    { id: 'crossing', subject: '수학', seconds: 3600, at: start + 1800000 },
    { id: 'current', subject: '수학', seconds: 600, at: start + DAY },
    { id: 'next', subject: '수학', seconds: 600, at: start + 8 * DAY },
  ];
  expect(recordsInRange(rows, start, start + 7 * DAY).map((r) => r.id)).toEqual([
    'crossing',
    'current',
  ]);
});
