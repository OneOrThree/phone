// 스크린타임 기능별 플랫폼 가용성 — GROMO-1592
//
// 여기서 잠그는 핵심은 **'고를 수 있다'와 '실제로 동작한다'를 섞지 않는 것**이다.
// 두 술어를 합치면 둘 중 하나가 반드시 거짓이 된다:
//   - 합쳐서 false → 화면을 숨겨 목록을 확인조차 못 한다
//   - 합쳐서 true  → "집중 중 모든 앱이 잠겨요"라고 거짓 안내한다
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  supportsAppSelection,
  supportsFocusShield,
  supportsUsageBreakdown,
  enforcesFocusShield,
} from './screenTimeCapabilities';

// 네이티브 레지스트리를 갈아끼워 '새 바이너리 / 구 바이너리'를 재현한다. hot-updater 로
// 새 JS 가 옛 안드로이드 바이너리에 내려가는 경로가 실제로 있으므로 둘 다 테스트한다.
// ⚠️ 모듈을 통째로 대체하면 안 된다. expo 내부(winter/fetch)가 같은 모듈의
//    requireNativeModule 을 쓰는데, 그게 사라지면 **이 스위트가 아예 로드되지 않는다**
//    (`requireNativeModule is not a function`). 로컬 전체 실행에선 다른 스위트가 먼저 캐시를
//    채워 통과했고 CI 에서만 터졌다 — 워커 분배가 달라서다.
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: jest.fn(),
}));
const mockRequireNative = requireOptionalNativeModule as jest.MockedFunction<
  typeof requireOptionalNativeModule
>;

/** 새 바이너리 — 1608 이 추가한 getUsageBreakdown 이 있다. */
const newBinary = () =>
  mockRequireNative.mockReturnValue({ getUsageBreakdown: jest.fn() } as never);
/** M1 바이너리 — 모듈은 있는데 getUsageBreakdown 이 없다. */
const m1Binary = () =>
  mockRequireNative.mockReturnValue({ getTodayUsageBucketMinutes: jest.fn() } as never);
/** 네이티브가 아예 없는 바이너리. */
const noNative = () => mockRequireNative.mockReturnValue(null as never);

beforeEach(() => {
  jest.clearAllMocks();
  newBinary();
});

const originalPlatformOS = Platform.OS;

function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

afterEach(() => setPlatform(originalPlatformOS));

describe('iOS — 넷 다 열려 있다', () => {
  beforeEach(() => setPlatform('ios'));

  test('네이티브가 다 있으므로 전부 true', () => {
    expect([
      supportsAppSelection(),
      supportsUsageBreakdown(),
      supportsFocusShield(),
      enforcesFocusShield(),
    ]).toEqual([true, true, true, true]);
  });
});

// 안드로이드는 구현이 붙는 순서대로 하나씩 열린다. 지금 한꺼번에 열면 눌러도 반응이 없거나
// 사실과 다른 안내가 나가므로, **구현이 들어오는 PR에서 그 술어만** 뒤집는다.
// 지금 열린 것: 앱별 사용시간(GROMO-1608).
test('안드로이드 — 앱별 사용시간만 열려 있다', () => {
  setPlatform('android');
  expect([
    supportsAppSelection(),
    supportsUsageBreakdown(),
    supportsFocusShield(),
    enforcesFocusShield(),
  ]).toEqual([false, true, false, false]);
});

// 구 바이너리 — 이 JS 는 hot-updater 로 옛 안드로이드 빌드에도 그대로 내려간다.
// 플랫폼만 보고 열면 진입점은 열려 있는데 화면이 '0분 · 사용 기록이 없어요'로 거짓말하거나,
// 없는 메서드를 불러 실패한다(코드리뷰 반영).
describe('안드로이드 구 바이너리 — 앱별 사용시간을 닫는다', () => {
  beforeEach(() => setPlatform('android'));

  test('네이티브 모듈이 아예 없으면 false', () => {
    noNative();

    expect(supportsUsageBreakdown()).toBe(false);
  });

  test('M1 모듈만 있어 getUsageBreakdown 이 없으면 false', () => {
    m1Binary();

    expect(supportsUsageBreakdown()).toBe(false);
  });
});

// 웹엔 측정 자체가 없다 — 여기까지 true가 되면 없는 화면으로 보내게 된다.
test('웹 — 넷 다 없다', () => {
  setPlatform('web');
  expect([
    supportsAppSelection(),
    supportsUsageBreakdown(),
    supportsFocusShield(),
    enforcesFocusShield(),
  ]).toEqual([false, false, false, false]);
});
