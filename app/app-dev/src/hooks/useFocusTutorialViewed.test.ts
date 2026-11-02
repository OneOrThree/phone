import { renderHook } from '@testing-library/react-native';
import { captureProductEvent } from '@/services/posthog';
import { useFocusTutorialViewed } from './useFocusTutorialViewed';

jest.mock('@/services/posthog', () => ({ captureProductEvent: jest.fn() }));

test('집중 튜토리얼 단계(4~21)에 진입할 때마다 1회만 발행하고 그 밖은 발행하지 않는다', async () => {
  const { rerender } = await renderHook(
    ({ step }: { step: number }) => useFocusTutorialViewed(step),
    {
      initialProps: { step: 3 },
    },
  );
  expect(captureProductEvent).not.toHaveBeenCalled();
  await rerender({ step: 4 });
  await rerender({ step: 4 });
  await rerender({ step: 5 });
  await rerender({ step: 22 });
  expect((captureProductEvent as jest.Mock).mock.calls).toEqual([
    ['focus_tutorial_viewed', { step: 4 }],
    ['focus_tutorial_viewed', { step: 5 }],
  ]);
});
