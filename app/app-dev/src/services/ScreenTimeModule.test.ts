describe('플랫폼별 스크린타임 브리지', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('react-native');
    jest.dontMock('expo');
  });
  test.each(['android', 'ios', 'web'])('%s 플랫폼의 모듈만 연결한다', (os) => {
    jest.resetModules();
    const android = { getAuthorizationStatus: jest.fn() };
    const ios = { requestAuthorization: jest.fn() };
    const resolve = jest.fn(() => android);
    jest.doMock('react-native', () => ({
      Platform: { OS: os },
      NativeModules: { ScreenTimeModule: ios },
    }));
    jest.doMock('expo', () => ({ requireOptionalNativeModule: resolve }));
    const { screenTimeNative } = require('./ScreenTimeModule');
    expect(screenTimeNative).toBe(os === 'android' ? android : os === 'ios' ? ios : undefined);
    expect(resolve).toHaveBeenCalledTimes(os === 'android' ? 1 : 0);
    if (os === 'android') expect(resolve).toHaveBeenCalledWith('ScreenTimeModule');
  });
});
