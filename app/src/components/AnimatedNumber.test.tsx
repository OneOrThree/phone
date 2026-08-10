// AnimatedNumber — 잠그는 규칙: 타이머를 끝까지 전진시킨 뒤의 **최종 텍스트**,
// reduce면 첫 렌더에 최종값, a11y 라벨은 항상 최종 포맷값.
// 중간 프레임 값·이징 곡선은 단언하지 않는다(연출이지 계약이 아니다).
import { act, render, screen } from '@testing-library/react-native';
import { M } from '@/constants/motion';
import { AnimatedNumber } from './AnimatedNumber';

let mockReduce = false;
let mockReady = true;
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => mockReady,
  whenReduceMotionReady: () => Promise.resolve(),
}));

beforeEach(() => {
  mockReduce = false;
  mockReady = true;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// 애니메이션 구간을 넘길 만큼 충분히 전진시킨다(경과 시간 기준이라 여유분을 둔다).
const runToEnd = async (ms = M.dur.slow * 2) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

describe('AnimatedNumber', () => {
  test('첫 렌더는 넘어온 값을 그대로 그린다 — 마운트만으로 0부터 세지 않는다', async () => {
    await render(<AnimatedNumber value={1240} testID="n" />);
    expect(screen.getByTestId('n').props.children).toBe('1240');
  });

  test('value가 바뀌면 세어 올라가고, 타이머를 끝까지 전진시키면 최종값이 표시된다', async () => {
    const { rerender } = await render(<AnimatedNumber value={0} testID="n" />);
    await rerender(<AnimatedNumber value={1240} testID="n" />);
    await runToEnd();
    expect(screen.getByTestId('n').props.children).toBe('1240');
  });

  // 애니메이션 도중 목표가 또 바뀌어도 0부터 다시 시작하지 않고 이어가야 한다.
  // (중간값은 단언하지 않고, 이어붙인 뒤에도 최종값에 도달하는지만 본다)
  test('재생 도중 목표가 바뀌어도 최종값에 도달한다', async () => {
    const { rerender } = await render(<AnimatedNumber value={0} testID="n" />);
    await rerender(<AnimatedNumber value={100} testID="n" />);
    await act(async () => {
      jest.advanceTimersByTime(M.dur.slow / 3);
    });
    await rerender(<AnimatedNumber value={30} testID="n" />);
    await runToEnd();
    expect(screen.getByTestId('n').props.children).toBe('30');
  });

  test('reduce=true면 첫 렌더에 최종값 — 세는 과정 자체가 애니메이션이다', async () => {
    mockReduce = true;
    const { rerender } = await render(<AnimatedNumber value={0} testID="n" />);
    await rerender(<AnimatedNumber value={987} testID="n" />);
    // 타이머를 전혀 전진시키지 않은 상태
    expect(screen.getByTestId('n').props.children).toBe('987');
  });

  test('format이 표시 문자열을 만든다', async () => {
    await render(<AnimatedNumber value={3} format={(n) => `${Math.round(n)}일 연속`} testID="n" />);
    await runToEnd();
    expect(screen.getByTestId('n').props.children).toBe('3일 연속');
  });

  // 라벨이 없으면 VoiceOver가 중간 숫자(1, 4, 9…)를 매 프레임 읽어 버린다.
  test('accessibilityLabel은 애니메이션 시작 시점부터 최종 포맷값이다', async () => {
    const { rerender } = await render(
      <AnimatedNumber value={0} format={(n) => `${Math.round(n)}코인`} testID="n" />,
    );
    await rerender(
      <AnimatedNumber value={500} format={(n) => `${Math.round(n)}코인`} testID="n" />,
    );
    expect(screen.getByTestId('n').props.accessibilityLabel).toBe('500코인');
    await runToEnd();
    expect(screen.getByTestId('n').props.accessibilityLabel).toBe('500코인');
  });

  // 언마운트 후에도 프레임이 돌면 사라진 컴포넌트에 setState가 날아간다.
  test('언마운트하면 남은 프레임이 취소된다', async () => {
    const cancelSpy = jest.spyOn(global, 'cancelAnimationFrame');
    const { rerender, unmount } = await render(<AnimatedNumber value={0} testID="n" />);
    await rerender(<AnimatedNumber value={999} testID="n" />);
    const before = cancelSpy.mock.calls.length;
    // RTL 14에서는 unmount도 async다 — await 없이 호출하면 정리 이펙트가 아직 안 돈다
    await unmount();
    expect(cancelSpy.mock.calls.length).toBeGreaterThan(before);
    cancelSpy.mockRestore();
  });
});

// ⚠️ 미확정 구간의 보수적 reduce=true로 목표값을 소비하면 displayRef가 새 값으로 확정된다.
//    이후 false로 확정돼도 from === value라 카운트업이 통째로 사라진다(codex 리뷰).
describe('AnimatedNumber — 동작 줄이기 미확정 구간', () => {
  test('확정 전에 목표가 바뀌면 출발값을 보존하고, 확정 뒤에 카운트업한다', async () => {
    mockReady = false;
    mockReduce = true; // 미확정 구간의 보수적 값
    const view = await render(<AnimatedNumber value={0} testID="n" />);
    await view.rerender(<AnimatedNumber value={120} testID="n" />);
    // 목표를 소비하지 않았으므로 표시는 출발값 그대로다
    expect(screen.getByTestId('n')).toHaveTextContent('0');

    // '동작 줄이기 꺼짐'으로 확정됐다 — 여기서부터 0 → 120 카운트업이 돈다
    mockReady = true;
    mockReduce = false;
    await view.rerender(<AnimatedNumber value={120} testID="n" />);
    expect(screen.getByTestId('n')).toHaveTextContent('0');
    await act(async () => {
      jest.advanceTimersByTime(M.dur.slow);
    });
    expect(screen.getByTestId('n')).toHaveTextContent('120');
  });
});
