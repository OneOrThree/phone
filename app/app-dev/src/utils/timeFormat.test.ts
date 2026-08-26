// timeFormat.ts 유닛 테스트(GROMO-945) — 시간 표기 포맷터 입출력표. 시계 의존 없음(순수 변환).

import { axisCeil, fmtAxis, fmtHm, fmtMinutes, hms } from './timeFormat';

describe('fmtMinutes (분 → "HH:MM:00")', () => {
  test('기본 표기·0패딩', () => {
    expect(fmtMinutes(1295)).toBe('21:35:00');
    expect(fmtMinutes(5)).toBe('00:05:00');
    expect(fmtMinutes(0)).toBe('00:00:00');
  });

  test('음수는 0으로 클램프, 소수는 반올림', () => {
    expect(fmtMinutes(-10)).toBe('00:00:00');
    expect(fmtMinutes(59.5)).toBe('01:00:00'); // 반올림으로 시가 올라가는 경계
  });

  test('24시간 초과도 시 자리가 그대로 늘어난다', () => {
    expect(fmtMinutes(1500)).toBe('25:00:00');
  });
});

describe('fmtHm (분 → "HH:MM")', () => {
  test('컴팩트 표기·클램프·반올림', () => {
    expect(fmtHm(95)).toBe('01:35');
    expect(fmtHm(0)).toBe('00:00');
    expect(fmtHm(-3)).toBe('00:00');
    expect(fmtHm(89.6)).toBe('01:30');
  });
});

describe('hms (초 → "HH:MM:SS")', () => {
  test('실초까지 표기·자리올림', () => {
    expect(hms(6443)).toBe('01:47:23');
    expect(hms(3600)).toBe('01:00:00');
    expect(hms(0)).toBe('00:00:00');
  });

  test('음수는 0으로 클램프, 소수 초는 버린다', () => {
    expect(hms(-1)).toBe('00:00:00');
    expect(hms(59.9)).toBe('00:00:59'); // 반올림하면 60초가 되는 값 — 버림이 맞다
  });
});

describe('axisCeil (축 상한 올림)', () => {
  test('하한 6분, 스텝 값은 그대로, 사이 값은 다음 스텝으로', () => {
    expect(axisCeil(0)).toBe(6);
    expect(axisCeil(5)).toBe(6);
    expect(axisCeil(60)).toBe(60);
    expect(axisCeil(61)).toBe(120);
  });

  test('스텝 표(최대 720)를 넘으면 120분 단위 올림', () => {
    expect(axisCeil(800)).toBe(840);
  });
});

describe('fmtAxis (분 → 축 라벨)', () => {
  test('60분 미만 "Nm", 정시 "Nh", 그 외 "NhMm"', () => {
    expect(fmtAxis(30)).toBe('30m');
    expect(fmtAxis(59)).toBe('59m');
    expect(fmtAxis(60)).toBe('1h');
    expect(fmtAxis(90)).toBe('1h30m');
  });
});
