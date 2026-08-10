// Enter — 진입 결정 경계가 **요소 마운트**임을 잠근다. 화면 컴포넌트 안에서 늦게 나타나는
// 요소가 화면의 옛 결정에 묶이던 사고(codex 리뷰 다수)의 회귀 방어다.
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { fadeIn } from '@/constants/motion';
import { Enter } from './Enter';

let mockReduce = false;
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

const styleOf = (id: string) =>
  StyleSheet.flatten(
    screen.getByTestId(id).props.jestInlineStyle ?? screen.getByTestId(id).props.style,
  );

describe('Enter', () => {
  beforeEach(() => {
    mockReduce = false;
  });

  it('reduce가 아니면 진입 스타일을 붙인다', async () => {
    await render(<Enter preset={fadeIn()} testID="e" />);
    expect(styleOf('e').animationName).toBeDefined();
  });

  it('reduce면 진입 스타일이 없다', async () => {
    mockReduce = true;
    await render(<Enter preset={fadeIn()} testID="e" />);
    expect(styleOf('e').animationName).toBeUndefined();
  });

  // ⚠️ 핵심 — **나중에 마운트되는 요소는 그 시점 설정을 따른다.** 화면이 먼저 마운트돼
  //    reduce=false로 결정을 얼려 뒀더라도, 그 뒤 설정을 켜고 새로 나타난 요소는 연출이 없어야 한다.
  it('나중에 마운트된 요소는 그 시점 설정으로 다시 정한다', async () => {
    const view = await render(
      <>
        <Enter preset={fadeIn()} testID="first" />
      </>,
    );
    expect(styleOf('first').animationName).toBeDefined();

    mockReduce = true; // 사용자가 '동작 줄이기'를 켰다
    await view.rerender(
      <>
        <Enter preset={fadeIn()} testID="first" />
        <Enter preset={fadeIn()} testID="late" />
      </>,
    );
    // 이미 있던 요소는 그대로(붙었다 떨어지지 않는다), 새 요소는 연출 없음
    expect(styleOf('first').animationName).toBeDefined();
    expect(styleOf('late').animationName).toBeUndefined();
  });
});
