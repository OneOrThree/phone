import { screenTime, selectionCount } from './screenTime';
import { screenTimeNative } from './ScreenTimeModule';

jest.mock('./ScreenTimeModule', () => ({
  screenTimeNative: {
    startFocusShieldWithAppearance: jest.fn().mockResolvedValue(true),
    startFocusShield: jest.fn().mockResolvedValue(true),
  },
}));

describe('screenTime service', () => {
  it('counts every selected token type', () => {
    expect(selectionCount(null)).toBe(0);
    expect(selectionCount({ applications: 2, categories: 1, webDomains: 3 })).toBe(6);
  });
});

test('선택한 고양이 색과 집중 주제를 iOS 차단 화면에 함께 넘긴다', async () => {
  await expect(screenTime.startFocusShield('영어 공부', 'calico')).resolves.toBe(true);
  expect(screenTimeNative?.startFocusShieldWithAppearance).toHaveBeenCalledWith(
    '영어 공부',
    'calico',
  );
  expect(screenTimeNative?.startFocusShield).not.toHaveBeenCalled();
});

test('새 차단 화면 API가 없는 설치본은 기존 차단 API를 사용한다', async () => {
  const native = screenTimeNative!;
  const appearance = native.startFocusShieldWithAppearance;
  native.startFocusShieldWithAppearance = undefined;
  try {
    await expect(screenTime.startFocusShield('수학', 'white')).resolves.toBe(true);
    expect(native.startFocusShield).toHaveBeenCalledWith('수학');
  } finally {
    native.startFocusShieldWithAppearance = appearance;
  }
});
