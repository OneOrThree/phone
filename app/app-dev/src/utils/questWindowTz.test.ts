import assert from 'node:assert/strict';
import {
  kstClockToUtc,
  utcClockToKst,
  kstWindowCrossesUtcMidnight,
  utcWindowToKst,
} from '@/utils/questWindowTz';

// 창은 절대 시각 구간이라 앱 경계에서 KST↔UTC 벽시계 변환만 한다(결정 Q-6, 서버 계약은 UTC 유지).

test('kstClockToUtc — KST 벽시계를 9시간 앞선 UTC 로 바꾼다', () => {
  // 저녁 21:00–24:00 KST ↔ 12:00–15:00 UTC
  assert.equal(kstClockToUtc('21:00'), '12:00');
  assert.equal(kstClockToUtc('24:00'), '15:00'); // 하루 끝(자정)도 15:00 UTC 로 깨지지 않게 변환
  // 오전 이전 06:00–08:00 KST ↔ 21:00–23:00 UTC (전날로 넘어감)
  assert.equal(kstClockToUtc('06:00'), '21:00');
  assert.equal(kstClockToUtc('08:00'), '23:00');
  // 경계: 09:00 KST = 00:00 UTC
  assert.equal(kstClockToUtc('09:00'), '00:00');
  assert.equal(kstClockToUtc('00:00'), '15:00');
});

test('utcClockToKst — UTC 벽시계를 9시간 뒤 KST 로 바꾼다', () => {
  assert.equal(utcClockToKst('12:00'), '21:00');
  assert.equal(utcClockToKst('21:00'), '06:00');
  assert.equal(utcClockToKst('23:00'), '08:00');
  assert.equal(utcClockToKst('00:00'), '09:00');
  assert.equal(utcClockToKst('15:00'), '00:00'); // 15:00 UTC = KST 자정(= 00:00, 하루 끝은 utcWindowToKst 가 24:00 로 되살린다)
});

test('한 자리 시·분 형식도 받고, 형식이 틀리면 원본을 그대로 돌려준다', () => {
  assert.equal(kstClockToUtc('9:00'), '00:00'); // clockMinutes 와 일관되게 한 자리 시 허용
  assert.equal(kstClockToUtc('25:00'), '25:00'); // 범위 밖 → 원본
  assert.equal(kstClockToUtc('abc'), 'abc');
  assert.equal(utcClockToKst(''), '');
});

test('왕복(kst→utc→kst)은 동일하다 (24:00 은 00:00 과 같은 시각이라 제외)', () => {
  for (const hhmm of ['19:00', '22:00', '06:00', '08:00', '21:00', '09:00', '00:00', '23:59'])
    assert.equal(utcClockToKst(kstClockToUtc(hhmm)), hhmm);
});

test('kstWindowCrossesUtcMidnight — UTC 로 바꾼 창이 자정을 가로지르면 true(저장 불가)', () => {
  // 걸치지 않는 창
  assert.equal(kstWindowCrossesUtcMidnight('21:00', '24:00'), false); // 12:00–15:00 UTC
  assert.equal(kstWindowCrossesUtcMidnight('06:00', '08:00'), false); // 21:00–23:00 UTC
  assert.equal(kstWindowCrossesUtcMidnight('19:00', '22:00'), false); // 10:00–13:00 UTC
  assert.equal(kstWindowCrossesUtcMidnight('09:00', '10:00'), false); // 00:00–01:00 UTC
  // 걸치는 창 — 08:00–10:00 KST = 23:00–01:00 UTC
  assert.equal(kstWindowCrossesUtcMidnight('08:00', '10:00'), true);
  // 종료가 UTC 자정에 정확히 닿는 창도 저장할 수 없다 — 08:00–09:00 KST = 23:00–00:00 UTC
  assert.equal(kstWindowCrossesUtcMidnight('08:00', '09:00'), true);
  // 하루 전체는 늘 UTC 자정을 넘는다 — 00:00–24:00 KST = 15:00–15:00 UTC
  assert.equal(kstWindowCrossesUtcMidnight('00:00', '24:00'), true);
  // 형식 오류는 다른 검증에 맡기고 false
  assert.equal(kstWindowCrossesUtcMidnight('bad', '10:00'), false);
});

test('utcWindowToKst — 서버(UTC) 창 객체를 KST 표시용으로 되돌리고 자정 종료는 24:00 으로 복원한다', () => {
  assert.deepEqual(utcWindowToKst({ windowStart: '10:00', windowEnd: '13:00' }), {
    windowStart: '19:00',
    windowEnd: '22:00',
  });
  // 종료가 UTC 자정(→ KST 00:00)이면 하루 끝 24:00 으로 되살린다
  assert.deepEqual(utcWindowToKst({ windowStart: '12:00', windowEnd: '15:00' }), {
    windowStart: '21:00',
    windowEnd: '24:00',
  });
  // 시작이 KST 00:00 이면 그대로 둔다(시작은 하루 시작이라 24:00 복원 대상이 아니다)
  assert.deepEqual(utcWindowToKst({ windowStart: '15:00', windowEnd: '16:00' }), {
    windowStart: '00:00',
    windowEnd: '01:00',
  });
  // null·기타 필드는 그대로 보존한다
  assert.deepEqual(utcWindowToKst({ windowStart: null, windowEnd: null, id: 'q1' }), {
    windowStart: null,
    windowEnd: null,
    id: 'q1',
  });
});
