import { render } from '@testing-library/react-native';
import { useMotion } from '@/hooks/useMotion';
import { ConfettiBurst } from './ConfettiBurst';

const mockFrameCallbacks: unknown[] = [];
const mockGravitySensor = { value: { x: 0 } };

jest.mock('@/hooks/useMotion', () => ({
  useMotion: jest.fn(),
}));

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    __esModule: true,
    default: { View },
    Easing: {
      in: jest.fn((fn) => fn),
      out: jest.fn((fn) => fn),
      bezier: jest.fn(),
      linear: jest.fn(),
      quad: jest.fn(),
    },
    ReduceMotion: { Never: 'never', Always: 'always', System: 'system' },
    SensorType: { GRAVITY: 'gravity' },
    cubicBezier: jest.fn(),
    useAnimatedReaction: jest.fn(),
    useAnimatedSensor: jest.fn(() => ({ sensor: mockGravitySensor })),
    useAnimatedStyle: jest.fn(() => ({})),
    useFrameCallback: jest.fn((callback) => {
      mockFrameCallbacks.push(callback);
      return { setActive: jest.fn() };
    }),
    useSharedValue: jest.fn((value) => React.useRef({ value }).current),
    withTiming: jest.fn((value) => value),
  };
});

const mockUseMotion = useMotion as jest.MockedFunction<typeof useMotion>;

describe('ConfettiBurst', () => {
  beforeEach(() => {
    mockFrameCallbacks.length = 0;
    mockUseMotion.mockReturnValue({ reduce: false } as ReturnType<typeof useMotion>);
  });

  it('같은 obstacle로 다시 렌더링해도 프레임 콜백을 다시 등록하지 않는다', async () => {
    const obstacle = { x: 20, y: 100, width: 200 };
    const { rerender } = await render(<ConfettiBurst obstacle={obstacle} />);

    await rerender(<ConfettiBurst obstacle={obstacle} />);

    expect(mockFrameCallbacks).toHaveLength(1);
  });

  it('필요한 재렌더링에서도 프레임 콜백 참조를 유지한다', async () => {
    const firstObstacle = { x: 20, y: 100, width: 200 };
    const nextObstacle = { x: 24, y: 104, width: 200 };
    const { rerender } = await render(<ConfettiBurst obstacle={firstObstacle} />);
    const firstCallback = mockFrameCallbacks[0];

    await rerender(<ConfettiBurst obstacle={nextObstacle} />);

    expect(mockFrameCallbacks).toHaveLength(2);
    expect(mockFrameCallbacks[1]).toBe(firstCallback);
  });
});
