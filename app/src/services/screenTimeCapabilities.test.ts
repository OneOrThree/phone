// 스크린타임 기능별 플랫폼 가용성 — GROMO-1592
//
// 여기서 잠그는 핵심은 **'고를 수 있다'와 '실제로 동작한다'를 섞지 않는 것**이다.
// 두 술어를 합치면 둘 중 하나가 반드시 거짓이 된다:
//   - 합쳐서 false → 화면을 숨겨 목록을 확인조차 못 한다
//   - 합쳐서 true  → "집중 중 모든 앱이 잠겨요"라고 거짓 안내한다
import { Platform } from 'react-native';
import {
  supportsAppSelection,
  supportsFocusShield,
  supportsUsageBreakdown,
  enforcesFocusShield,
} from './screenTimeCapabilities';

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
