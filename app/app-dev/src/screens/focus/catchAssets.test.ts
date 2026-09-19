import { catchAssetPath } from '@/screens/focus/catchAssets';

test.each([
  [1, 'single'],
  [59, 'single'],
  [60, 'pile-small'],
  [119, 'pile-small'],
  [120, 'pile-medium'],
  [179, 'pile-medium'],
  [180, 'pile-large'],
  [240, 'pile-large'],
])('%i분 집중의 물고기 더미는 %s 단계다', (caught, name) => {
  expect(catchAssetPath(caught)).toBe(`props/fishing/catch/${name}.png`);
});
