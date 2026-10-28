import { clampCodePoints, codePointLength } from '@/utils/codePoints';

test('이모지는 UTF-16 이 아니라 코드포인트 1개로 센다', () => {
  expect('🐟'.length).toBe(2);
  expect(codePointLength('🐟🐟가')).toBe(3);
});

test('한도 안이면 같은 문자열, 넘으면 코드포인트 단위로 자른다(서로게이트 쌍을 쪼개지 않는다)', () => {
  const same = '안녕 🐟';
  expect(clampCodePoints(same, 4)).toBe(same);
  expect(clampCodePoints('🐟'.repeat(41), 40)).toBe('🐟'.repeat(40));
  expect(clampCodePoints('a'.repeat(41), 40)).toBe('a'.repeat(40));
  expect(clampCodePoints('가🐟나🐟', 3)).toBe('가🐟나');
});
