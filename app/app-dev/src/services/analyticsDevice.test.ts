import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { readAnalyticsDeviceProperties } from './analyticsDevice';

jest.mock('expo-application', () => ({
  getAndroidId: jest.fn(),
  getIosIdForVendorAsync: jest.fn(),
}));

const originalOS = Platform.OS;
const idfv = '68753A44-4D6F-1226-9C60-0050E4C00067';

beforeEach(() => jest.resetAllMocks());
afterEach(() => {
  Platform.OS = originalOS;
  jest.useRealTimers();
});

test('Android는 ANDROID_ID를 읽고 iOS API는 호출하지 않는다', async () => {
  Platform.OS = 'android';
  jest.mocked(Application.getAndroidId).mockReturnValue('DD96DEC43FB81C97');
  expect(await readAnalyticsDeviceProperties()).toEqual({
    device_id: 'dd96dec43fb81c97',
    device_id_source: 'android_id',
  });
  expect(Application.getIosIdForVendorAsync).not.toHaveBeenCalled();
});

test('iOS는 IDFV를 읽고 Android API는 호출하지 않는다', async () => {
  Platform.OS = 'ios';
  jest.mocked(Application.getIosIdForVendorAsync).mockResolvedValue(idfv);
  expect(await readAnalyticsDeviceProperties()).toEqual({
    device_id: idfv.toLowerCase(),
    device_id_source: 'idfv',
  });
  expect(Application.getAndroidId).not.toHaveBeenCalled();
});

test.each([null, '', '00000000-0000-0000-0000-000000000000', 'unknown'])(
  'IDFV가 %s이면 다른 식별자로 대체하지 않고 다음 조회에서 재시도한다',
  async (value) => {
    Platform.OS = 'ios';
    jest
      .mocked(Application.getIosIdForVendorAsync)
      .mockResolvedValueOnce(value)
      .mockResolvedValue(idfv);
    expect(await readAnalyticsDeviceProperties()).toEqual({});
    expect((await readAnalyticsDeviceProperties()).device_id).toBe(idfv.toLowerCase());
  },
);

test.each(['', '0000000000000000', 'unknown'])(
  '유효하지 않은 Android ID %s는 보내지 않는다',
  async (id) => {
    Platform.OS = 'android';
    jest.mocked(Application.getAndroidId).mockReturnValue(id);
    expect(await readAnalyticsDeviceProperties()).toEqual({});
  },
);

test.each(['android', 'ios'] as const)('%s OS 조회 오류는 분석을 중단하지 않는다', async (os) => {
  Platform.OS = os;
  jest.mocked(Application.getAndroidId).mockImplementation(() => {
    throw new Error('native module unavailable');
  });
  jest.mocked(Application.getIosIdForVendorAsync).mockRejectedValue(new Error('IDFV unavailable'));
  expect(await readAnalyticsDeviceProperties()).toEqual({});
});

test('IDFV 브리지가 응답하지 않아도 1초 뒤 분석 초기화를 계속한다', async () => {
  jest.useFakeTimers();
  Platform.OS = 'ios';
  jest.mocked(Application.getIosIdForVendorAsync).mockReturnValue(new Promise(() => {}));
  const pending = readAnalyticsDeviceProperties();
  await jest.advanceTimersByTimeAsync(1000);
  expect(await pending).toEqual({});
});

test('웹에서는 네이티브 OS ID API를 호출하지 않는다', async () => {
  Platform.OS = 'web';
  expect(await readAnalyticsDeviceProperties()).toEqual({});
  expect(Application.getAndroidId).not.toHaveBeenCalled();
  expect(Application.getIosIdForVendorAsync).not.toHaveBeenCalled();
});
