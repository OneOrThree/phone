// GROMO-2783 별점 요청 — 세 번째 집중 완료에 한 번만 묻고, 네이티브 모듈이 없는 옛 바이너리에서는 조용히 건너뛴다.
type StoreReviewMock = { isAvailableAsync: jest.Mock; requestReview: jest.Mock };

// null 이면 옛 바이너리처럼 import 가 던진다(requireNativeModule). 던진 factory 결과는 캐시되지 않는다.
let mockNative: StoreReviewMock | null = null;
jest.mock('expo-store-review', () => {
  if (!mockNative) throw new Error("Cannot find native module 'ExpoStoreReview'");
  return mockNative;
});

const storeReview = (available = true): StoreReviewMock => ({
  isAvailableAsync: jest.fn().mockResolvedValue(available),
  requestReview: jest.fn().mockResolvedValue(undefined),
});

let count: typeof import('./storeReview').countFocusCompletion;

beforeEach(() => {
  // 테스트마다 모듈 캐시와 메모리 저장소를 새로 — 한 테스트 안에서는 같은 저장소가 이어진다.
  jest.resetModules();
  jest.useFakeTimers();
  mockNative = null;
  ({ countFocusCompletion: count } = require('./storeReview'));
});

afterEach(() => {
  jest.useRealTimers();
});

test('세 번째 완료에서 한 번만 별점창을 띄우고, 그 뒤 완료에서는 다시 묻지 않는다', async () => {
  const native = (mockNative = storeReview());

  await count();
  await count();
  jest.runAllTimers();
  expect(native.requestReview).not.toHaveBeenCalled();

  await count();
  expect(native.requestReview).not.toHaveBeenCalled(); // 결과 화면이 먼저 보이게 잠깐 뒤에 띄운다
  jest.runAllTimers();
  expect(native.requestReview).toHaveBeenCalledTimes(1);

  await count();
  await count();
  jest.runAllTimers();
  expect(native.requestReview).toHaveBeenCalledTimes(1);
});

test('OS 가 별점창을 못 띄우는 동안은 묻지 않고, 가능해진 다음 완료에서 묻는다', async () => {
  const native = (mockNative = storeReview(false));

  await count();
  await count();
  await count();
  jest.runAllTimers();
  expect(native.requestReview).not.toHaveBeenCalled();

  native.isAvailableAsync.mockResolvedValue(true);
  await count();
  jest.runAllTimers();
  expect(native.requestReview).toHaveBeenCalledTimes(1);
});

test('네이티브 모듈이 없는 옛 바이너리 — 던지지 않고 건너뛰며, 새 빌드로 바뀐 뒤 다음 완료에서 묻는다', async () => {
  await count();
  await count();
  await expect(count()).resolves.toBeUndefined();

  const native = (mockNative = storeReview());
  await count();
  jest.runAllTimers();
  expect(native.requestReview).toHaveBeenCalledTimes(1);
});
