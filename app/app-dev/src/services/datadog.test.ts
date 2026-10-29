import { initDatadog, measureDatadogOperation } from './datadog';

const mockInitialize = jest.fn(async () => {});
const mockAddAction = jest.fn(async (..._args: unknown[]) => {});
const mockCoreConfiguration = jest.fn(function (...args: unknown[]) {
  return { args };
});

jest.mock('@datadog/mobile-react-native', () => ({
  CoreConfiguration: mockCoreConfiguration,
  RumConfiguration: jest.fn(function (...args: unknown[]) {
    return { args };
  }),
  TrackingConsent: { GRANTED: 'granted' },
  PropagatorType: { DATADOG: 'datadog' },
  RumActionType: { CUSTOM: 'custom' },
  DdSdkReactNative: { initialize: mockInitialize },
  DdRum: { addAction: mockAddAction },
}));

const previousId = process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID;
const previousToken = process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN;
const load = (id?: string) => {
  jest.resetModules();
  if (id === undefined) delete process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID;
  else process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID = id;
  process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = 'public-test-token';
  return require('./datadog') as {
    initDatadog: typeof initDatadog;
    measureDatadogOperation: typeof measureDatadogOperation;
  };
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  if (previousId === undefined) delete process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID;
  else process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID = previousId;
  if (previousToken === undefined) delete process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN;
  else process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = previousToken;
});

test('로컬에 gromo ID가 남아 있어도 cattus 데이터를 gromo로 보내지 않는다', async () => {
  const dd = load('44a4f021-ed4d-4134-b59d-63a40e37c2ff');
  dd.initDatadog();
  await expect(dd.measureDatadogOperation('focus_start', async () => 'ok')).resolves.toBe('ok');
  await flush();
  expect(mockInitialize).not.toHaveBeenCalled();
  expect(mockAddAction).not.toHaveBeenCalled();
});

test('cattus 서비스로 한 번만 초기화한다', async () => {
  const dd = load('31edaff8-b8b4-434b-9d8c-898e05a41255');
  dd.initDatadog();
  dd.initDatadog();
  await flush();
  expect(mockInitialize).toHaveBeenCalledTimes(1);
  expect(mockCoreConfiguration.mock.calls[0][3]).toEqual(
    expect.objectContaining({ service: 'cattus-app' }),
  );
});

test('수집 키가 없어도 원래 명령은 실행한다', async () => {
  const dd = load();
  dd.initDatadog();
  await expect(dd.measureDatadogOperation('focus_start', async () => 42)).resolves.toBe(42);
  expect(mockInitialize).not.toHaveBeenCalled();
});

test('SDK 초기화가 실패해도 원래 명령의 결과를 유지한다', async () => {
  mockInitialize.mockRejectedValueOnce(new Error('native SDK unavailable'));
  const dd = load('31edaff8-b8b4-434b-9d8c-898e05a41255');
  dd.initDatadog();
  await expect(dd.measureDatadogOperation('focus_start', async () => 42)).resolves.toBe(42);
  await flush();
  expect(mockAddAction).not.toHaveBeenCalled();
});

test('수집 전송 실패가 성공한 집중 명령을 실패로 바꾸지 않는다', async () => {
  mockAddAction.mockRejectedValueOnce(new Error('upload failed'));
  const dd = load('31edaff8-b8b4-434b-9d8c-898e05a41255');
  dd.initDatadog();
  await expect(dd.measureDatadogOperation('focus_finish', async () => 42)).resolves.toBe(42);
  await flush();
  expect(mockAddAction).toHaveBeenCalledWith(
    'custom',
    'focus_finish',
    expect.objectContaining({ outcome: 'success', duration_ms: expect.any(Number) }),
  );
});

test('실패한 명령은 같은 오류를 반환하고 개인정보 없이 처리시간만 기록한다', async () => {
  const dd = load('31edaff8-b8b4-434b-9d8c-898e05a41255');
  dd.initDatadog();
  const error = new Error('private error detail');
  await expect(
    dd.measureDatadogOperation('focus_start', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  await flush();
  expect(mockAddAction).toHaveBeenCalledWith('custom', 'focus_start', {
    operation: 'focus_start',
    outcome: 'failure',
    duration_ms: expect.any(Number),
  });
});
