import { expect, test } from '@jest/globals';
import { resolveTermsVersion } from '@/services/termsVersion';

test('약관 버전 설정은 공백을 정리하고 미설정·공백이면 비활성 값으로 남긴다', () => {
  expect(resolveTermsVersion(undefined)).toBe('');
  expect(resolveTermsVersion('   ')).toBe('');
  expect(resolveTermsVersion(' terms-2026-10 ')).toBe('terms-2026-10');
});
