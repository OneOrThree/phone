import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureFirstArrivalConversion } from './firstArrivalConversion';
import { captureAirbridgeEvent } from './airbridge';

let mockGeneration = 7;
let mockOwner = 'a';
jest.mock('./airbridge', () => ({ captureAirbridgeEvent: jest.fn(() => true) }));
jest.mock('./api/session', () => ({
  sessionGeneration: () => mockGeneration,
  getSession: () => ({ userId: mockOwner }),
}));
const originalDev = __DEV__;
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  (global as any).__DEV__ = false;
  process.env.EXPO_PUBLIC_ENV = 'prod';
  mockGeneration = 7;
  mockOwner = 'a';
  (captureAirbridgeEvent as jest.Mock).mockReturnValue(true);
});
afterEach(() => {
  (global as any).__DEV__ = originalDev;
  delete process.env.EXPO_PUBLIC_ENV;
});

test('동시 응답·재시도에도 계정당 한 번만 발행하고 저장한다', async () => {
  await Promise.all([captureFirstArrivalConversion('a', 7), captureFirstArrivalConversion('a', 7)]);
  await captureFirstArrivalConversion('a', 7);
  expect(captureAirbridgeEvent).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem('catus:first-arrival-conversion:v1:a')).toBe('1');
});

test('저장소 대기 중 계정 전환은 새 사용자에게 전환을 보내지 않는다', async () => {
  const task = captureFirstArrivalConversion('a', 7);
  mockGeneration = 8;
  mockOwner = 'b';
  await task;
  expect(captureAirbridgeEvent).not.toHaveBeenCalled();
});

test.each(['dev', '', 'development'])(
  '%s 환경은 광고 전환을 보내지 않는다',
  async (environment) => {
    process.env.EXPO_PUBLIC_ENV = environment;
    await captureFirstArrivalConversion('a', 7);
    expect(captureAirbridgeEvent).not.toHaveBeenCalled();
  },
);

test('개발 빌드는 prod 환경 값이어도 보내지 않는다', async () => {
  (global as any).__DEV__ = true;
  await captureFirstArrivalConversion('a', 7);
  expect(captureAirbridgeEvent).not.toHaveBeenCalled();
});

test('SDK가 없으면 완료 표시를 남기지 않고 다음 응답에서 재시도한다', async () => {
  (captureAirbridgeEvent as jest.Mock).mockReturnValueOnce(false);
  await captureFirstArrivalConversion('a', 7);
  expect(await AsyncStorage.getItem('catus:first-arrival-conversion:v1:a')).toBeNull();
  await captureFirstArrivalConversion('a', 7);
  expect(await AsyncStorage.getItem('catus:first-arrival-conversion:v1:a')).toBe('1');
});

test('저장소 실패가 도착 결과를 실패시키지 않는다', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage'));
  await expect(captureFirstArrivalConversion('a', 7)).resolves.toBeUndefined();
  expect(captureAirbridgeEvent).not.toHaveBeenCalled();
});
