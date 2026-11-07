import { startWebMetamoaPresence } from './webMetamoaPresence';
import { request } from './api/client';
import { getAccessToken } from './api/session';
import { isPublicWebDemo } from './demoMode';

jest.mock('./api/client', () => ({ request: jest.fn().mockResolvedValue({}) }));
jest.mock('./api/session', () => ({ getAccessToken: jest.fn(() => 'test-token') }));
jest.mock('./demoMode', () => ({ isPublicWebDemo: jest.fn(() => true) }));

let stop: () => void;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let page: { location: { origin: string; href: string }; parent?: unknown };
let documentMock: { hidden: boolean; addEventListener: jest.Mock; removeEventListener: jest.Mock };

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  jest.clearAllMocks();
  jest.mocked(isPublicWebDemo).mockReturnValue(true);
  jest.mocked(getAccessToken).mockReturnValue('test-token');
  page = {
    location: { origin: 'https://try.oneorthree.world', href: 'https://try.oneorthree.world/' },
  };
  page.parent = page;
  documentMock = { hidden: false, addEventListener: jest.fn(), removeEventListener: jest.fn() };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: page });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { webdriver: false },
  });
  stop = () => {};
});

afterEach(() => {
  stop();
  jest.useRealTimers();
  for (const [key, descriptor] of [
    ['document', originalDocument],
    ['navigator', originalNavigator],
    ['window', originalWindow],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test('인증된 공개 웹만 2분 간격으로 집계하고 정리 뒤 멈춘다', async () => {
  stop = startWebMetamoaPresence();
  expect(request).toHaveBeenCalledWith('/me', { headers: { 'X-Metamoa-Presence': '1' } });
  await jest.advanceTimersByTimeAsync(119_999);
  expect(request).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  stop();
  await jest.advanceTimersByTimeAsync(120_000);
  expect(request).toHaveBeenCalledTimes(2);
});

test('네이티브·검증 방문·자동화·비로그인·숨긴 탭은 제외한다', () => {
  jest.mocked(isPublicWebDemo).mockReturnValue(false);
  stop = startWebMetamoaPresence();
  jest.mocked(isPublicWebDemo).mockReturnValue(true);
  page.location.href += '?analytics_test=1';
  stop = startWebMetamoaPresence();
  page.location.href = page.location.origin;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { webdriver: true },
  });
  stop = startWebMetamoaPresence();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { webdriver: false },
  });
  jest.mocked(getAccessToken).mockReturnValue(null);
  stop = startWebMetamoaPresence();
  stop();
  jest.mocked(getAccessToken).mockReturnValue('test-token');
  documentMock.hidden = true;
  stop = startWebMetamoaPresence();
  expect(request).not.toHaveBeenCalled();
});
