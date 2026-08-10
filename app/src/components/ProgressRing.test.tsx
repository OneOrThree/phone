// ProgressRing — strokeDashoffset은 shared value라 jest(워클릿 목)에서 값 단언이 불가능하다.
// 그래서 여기서 잠그는 건 **렌더가 깨지지 않는 것**과 **접근성 계약**뿐이다.
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { T } from '@/constants/theme';
import { ProgressRing } from './ProgressRing';

let mockReduce = false;
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

beforeEach(() => {
  mockReduce = false;
});

describe('ProgressRing', () => {
  test('렌더된다 — SVG + 애니메이션 원이 한 트리에서 마운트되는지', async () => {
    await render(
      <ProgressRing size={120} stroke={10} progress={0.4} color={T.accent} testID="r" />,
    );
    expect(screen.getByTestId('r')).toBeTruthy();
  });

  test('접근성 — progressbar 역할과 0~100 값', async () => {
    await render(<ProgressRing size={80} stroke={8} progress={0.4} color={T.accent} testID="r" />);
    const node = screen.getByTestId('r');
    expect(node.props.accessibilityRole).toBe('progressbar');
    expect(node.props.accessibilityValue).toEqual({ now: 40, min: 0, max: 100 });
  });

  test('0~1 밖의 값은 클램프된다', async () => {
    await render(<ProgressRing size={80} stroke={8} progress={2} color={T.accent} testID="over" />);
    expect(screen.getByTestId('over').props.accessibilityValue).toMatchObject({ now: 100 });
    await render(<ProgressRing size={80} stroke={8} progress={-1} color={T.accent} testID="neg" />);
    expect(screen.getByTestId('neg').props.accessibilityValue).toMatchObject({ now: 0 });
  });

  test('children이 링 안에 렌더된다(카운트다운 숫자 자리)', async () => {
    await render(
      <ProgressRing size={120} stroke={10} progress={0.5} color={T.accent} testID="r">
        <Text>04:20</Text>
      </ProgressRing>,
    );
    expect(screen.getByText('04:20')).toBeTruthy();
  });

  test('reduce=true에서도 렌더된다 — 애니메이션만 빠지고 링은 남는다', async () => {
    mockReduce = true;
    await render(<ProgressRing size={80} stroke={8} progress={0.7} color={T.accent} testID="r" />);
    expect(screen.getByTestId('r').props.accessibilityValue).toMatchObject({ now: 70 });
  });
});
