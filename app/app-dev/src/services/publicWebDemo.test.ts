import { Platform } from 'react-native';
import { isDemoMode, isPublicWebDemo, isReviewMode } from './demoMode';
import { request } from './api/client';

const originalPlatform = Platform.OS;
const originalDemo = process.env.EXPO_PUBLIC_DEMO;
const originalPublicDemo = process.env.EXPO_PUBLIC_WEB_DEMO;
const originalFetch = global.fetch;

afterEach(() => {
  Platform.OS = originalPlatform;
  if (originalDemo === undefined) delete process.env.EXPO_PUBLIC_DEMO;
  else process.env.EXPO_PUBLIC_DEMO = originalDemo;
  if (originalPublicDemo === undefined) delete process.env.EXPO_PUBLIC_WEB_DEMO;
  else process.env.EXPO_PUBLIC_WEB_DEMO = originalPublicDemo;
  global.fetch = originalFetch;
});

test('공개 웹은 실제 서비스 모드이고 남은 데모 플래그도 무시한다', () => {
  Platform.OS = 'web';
  process.env.EXPO_PUBLIC_WEB_DEMO = '1';
  process.env.EXPO_PUBLIC_DEMO = '1';
  expect(isPublicWebDemo()).toBe(true);
  expect(isDemoMode()).toBe(false);
  expect(isReviewMode()).toBe(false);
});

test('공개 체험판 빌드 플래그는 네이티브 앱을 목업으로 바꾸지 않는다', () => {
  Platform.OS = 'ios';
  process.env.EXPO_PUBLIC_WEB_DEMO = '1';
  delete process.env.EXPO_PUBLIC_DEMO;
  expect(isPublicWebDemo()).toBe(false);
  expect(isDemoMode()).toBe(false);
});

test('공개 웹도 기존 API 응답 계약으로 계정 데이터를 읽는다', async () => {
  Platform.OS = 'web';
  process.env.EXPO_PUBLIC_WEB_DEMO = '1';
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ data: { id: 'web-account' } }),
  });
  await expect(request('/me', { auth: false })).resolves.toEqual({ id: 'web-account' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
