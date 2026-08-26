// expo-audio 네이티브 모듈이 아예 없는 경우 — 이 PR이 막으려는 정확한 OTA 크래시 상황.
// (구 바이너리에 JS만 OTA로 내려가면 `require('expo-audio')` 자체가 throw한다)
//
// jest.setup.js·sound.test.ts의 목은 모두 require를 "성공"시키므로 이 분기는 그쪽에서
// 재현되지 않는다. 모듈 팩토리를 던지게 만들어야 하고, 그러면 파일 전체가 이 상태로
// 고정되므로 별도 파일로 뗀다(useReduceMotion.queryFailure.test.ts와 같은 이유).

// 팩토리는 호이스팅되므로 out-of-scope 참조가 막힌다 — `mock` 접두사 변수만 허용된다.
const mockNativeLoad = jest.fn();
jest.mock('expo-audio', () => {
  mockNativeLoad();
  throw new Error('native module not found');
});

/** 프리로드 체인이 돌 여지를 준다(이 파일에선 애초에 시작되지 않아야 한다). */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test('네이티브 모듈이 없으면 크래시 대신 무음으로 격하된다', async () => {
  const sound = require('./sound') as typeof import('./sound');

  expect(() => sound.preloadTapSound()).not.toThrow();
  await flush();
  expect(() => sound.playTapSound()).not.toThrow();
  await flush();
});

test('모듈 로드 실패는 재시도하지 않는다 — 결과가 같아 매 탭 require 폭주만 남는다', async () => {
  const sound = require('./sound') as typeof import('./sound');

  // preloadAttempts가 즉시 상한에 도달해, 이후 탭은 로드를 다시 시도하지 않는다.
  // (모듈 레지스트리를 리셋하지 않으므로 호출 수는 파일 전체 누적 = 최초 1회여야 한다)
  sound.preloadTapSound();
  for (let i = 0; i < 5; i += 1) {
    sound.playTapSound();
    await flush();
  }
  expect(mockNativeLoad).toHaveBeenCalledTimes(1);
});
