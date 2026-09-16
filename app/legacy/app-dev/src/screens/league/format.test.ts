// league/format.ts 유닛 테스트(GROMO-945) — fmtDelta만 검증(fmtMinutes·hms는 timeFormat 재수출이라 원본에서 테스트).

import { fmtDelta } from './format';

describe('fmtDelta (나 대비 차이, 초)', () => {
  test('0은 부호 없이 00:00:00', () => {
    expect(fmtDelta(0)).toBe('00:00:00');
  });

  test('양수는 +, 음수는 - 부호에 절대값 표기', () => {
    expect(fmtDelta(7954)).toBe('+02:12:34');
    expect(fmtDelta(-2423)).toBe('-00:40:23');
  });
});
