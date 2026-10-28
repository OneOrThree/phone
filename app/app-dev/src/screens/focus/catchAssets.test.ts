import { catchAssetPath } from '@/screens/focus/catchAssets';

test.each([
  [1, 'single'],
  [59, 'single'],
  [60, 'pile-small'],
  [119, 'pile-small'],
  [120, 'pile-medium'],
  [239, 'pile-medium'],
  [240, 'pile-large'],
])('%i마리를 잡으면 물고기 더미는 %s 단계다', (caught, name) => {
  expect(catchAssetPath(caught)).toBe(`props/fishing/catch/${name}.png`);
});
