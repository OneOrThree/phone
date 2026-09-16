import { render } from '@testing-library/react-native';
import { useMotion } from '@/hooks/useMotion';
import { ConfettiBurst } from './ConfettiBurst';

type FrameCallback = (frame: {
  timestamp: number;
  timeSincePreviousFrame: number | null;
  timeSinceFirstFrame: number;
}) => void;

const mockFrameCallbacks: FrameCallback[] = [];
const mockGravitySensor = { value: { x: 0 } };
// 공유값 쓰기 횟수를 세는 mock — "멈추면 더 이상 쓰지 않는다"를 검증하려면 값이 아니라
// **쓰기 자체**를 봐야 한다(같은 값을 써도 reanimated는 구독자를 전부 깨우므로).
const mockSharedValues: { value: unknown; writes: number }[] = [];
// 워클릿이 실제로 캡처한 식별자 — babel worklets 플러그인이 함수에 붙이는 __closure를 읽는다.
const workletClosure = (fn: unknown): string[] =>
  Object.keys((fn as { __closure?: object })?.__closure ?? {});

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
    useSharedValue: jest.fn((initial) => {
      const ref = React.useRef(null);
      if (ref.current === null) {
        let current = initial;
        const sv = {
          writes: 0,
          get value() {
            return current;
          },
          set value(next) {
            current = next;
            sv.writes++;
          },
        };
        ref.current = sv;
        mockSharedValues.push(sv);
      }
      return ref.current;
    }),
    withTiming: jest.fn((value) => value),
  };
});

const mockUseMotion = useMotion as jest.MockedFunction<typeof useMotion>;

describe('ConfettiBurst', () => {
  beforeEach(() => {
    mockFrameCallbacks.length = 0;
    mockSharedValues.length = 0;
    mockGravitySensor.value.x = 0;
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

  // GROMO-1601 회귀 — 워클릿이 `M`을 캡처하면 `M.curve.*.fn`(CubicBezierEasing 인스턴스)
  // 복사에서 죽어 축하 모달이 조각 수만큼 Render Error를 뱉는다. 캡처 목록으로 직접 막는다.
  it('낙하 워클릿이 모션 토큰 객체(M)를 캡처하지 않는다', async () => {
    const { useAnimatedReaction } = jest.requireMock('react-native-reanimated');
    await render(<ConfettiBurst obstacle={{ x: 20, y: 100, width: 200 }} />);

    const reactions = (useAnimatedReaction as jest.Mock).mock.calls;
    expect(reactions.length).toBeGreaterThan(0);
    for (const [, effect] of reactions) {
      expect(workletClosure(effect)).not.toContain('M');
    }
  });

  it('기울임이 멎으면 공유값 쓰기를 멈춘다', async () => {
    await render(<ConfettiBurst obstacle={{ x: 20, y: 100, width: 200 }} />);
    const onFrame = mockFrameCallbacks[0];
    // ConfettiBurstInner가 가장 먼저 만드는 두 개가 slide·slideVel이다(조각들은 그 뒤).
    const [slide] = mockSharedValues;
    const tick = (i: number) =>
      onFrame({ timestamp: i * 16, timeSincePreviousFrame: 16, timeSinceFirstFrame: i * 16 });

    mockGravitySensor.value.x = 5; // 크게 기울임 — 흐르기 시작
    tick(1);
    expect(slide.writes).toBeGreaterThan(0);

    mockGravitySensor.value.x = 0; // 다시 평평 — 마찰로 멎는다
    for (let i = 2; i < 200; i++) tick(i);
    const settled = slide.writes;
    for (let i = 200; i < 260; i++) tick(i);

    expect(slide.writes).toBe(settled);
  });
});
