import { catchAssetPath } from '@/screens/focus/catchAssets';

test.each([
  [1, 'single'],
  [2, 'single'],
  [3, 'pile-small'],
  [5, 'pile-small'],
  [6, 'pile-medium'],
  [9, 'pile-medium'],
  [10, 'pile-large'],
  [240, 'pile-large'],
])('%i마리를 잡으면 물고기 더미는 %s 단계다', (caught, name) => {
  expect(catchAssetPath(caught)).toBe(`props/fishing/catch/${name}.png`);
});
