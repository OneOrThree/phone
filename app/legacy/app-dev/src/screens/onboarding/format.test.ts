// onboarding/format.ts 유닛 테스트(GROMO-945) — 소요시간 표기·한글 조사(받침) 선택.

import { eunNeun, formatDuration, iGa } from './format';

describe('formatDuration (분 → "N시간 M분")', () => {
  test('시간·분 조합별 표기', () => {
    expect(formatDuration(125)).toBe('2시간 5분');
    expect(formatDuration(45)).toBe('45분'); // 0시간이면 분만
    expect(formatDuration(120)).toBe('2시간'); // 0분이면 시간만
    expect(formatDuration(0)).toBe('0분');
  });
});

describe('eunNeun (은/는 선택)', () => {
  test('받침 있으면 은, 없으면 는', () => {
    expect(eunNeun('수학')).toBe('은');
    expect(eunNeun('집중')).toBe('은');
    expect(eunNeun('국어')).toBe('는');
  });

  test('빈 문자열·비한글 끝 글자는 는', () => {
    expect(eunNeun('')).toBe('는');
    expect(eunNeun('iPad')).toBe('는');
    expect(eunNeun('레벨2')).toBe('는');
  });
});

describe('iGa (이/가 선택)', () => {
  test('받침 있으면 이, 없으면 가', () => {
    expect(iGa('집중')).toBe('이');
    expect(iGa('국어')).toBe('가');
  });

  test('빈 문자열·비한글 끝 글자는 가', () => {
    expect(iGa('')).toBe('가');
    expect(iGa('abc')).toBe('가');
  });
});
