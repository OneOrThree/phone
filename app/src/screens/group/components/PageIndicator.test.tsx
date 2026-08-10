import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  PageIndicator,
  pageAccessibilityLabel,
  requiredDotsWidth,
  resolveIndicatorMode,
} from './PageIndicator';

describe('PageIndicator', () => {
  test('실측 폭과 N+1 페이지 수로 dots/counter를 결정한다', () => {
    expect(requiredDotsWidth(5)).toBe(236);
    expect(requiredDotsWidth(6)).toBe(284);
    expect(resolveIndicatorMode(320, 5)).toBe('dots');
    expect(resolveIndicatorMode(320, 6)).toBe('counter');
    expect(resolveIndicatorMode(0, 2)).toBe('counter');
  });

  test('dots를 누르면 해당 페이지를 선택한다', async () => {
    const onSelectPage = jest.fn();
    await render(
      <PageIndicator
        pageLabels={['아침 집중방', '저녁 스터디', '그룹 찾기']}
        activeIndex={0}
        onSelectPage={onSelectPage}
      />,
    );

    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 400 } },
      });
    });
    fireEvent.press(screen.getByTestId('group.deck.indicator.dot.2'));

    expect(onSelectPage).toHaveBeenCalledWith(2);
    expect(screen.getByLabelText('아침 집중방, 1 / 3').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByLabelText('그룹 찾기, 3 / 3').props.accessibilityState).toEqual({
      selected: false,
    });
    expect(screen.getByTestId('group.deck.indicator')).toHaveStyle({ height: 44 });
    expect(screen.getByTestId('group.deck.indicator.dot.0')).toHaveStyle({ height: 44 });
  });

  test('첫 측정 전 counter는 현재/전체를 읽는다', async () => {
    await render(
      <PageIndicator
        pageLabels={Array.from({ length: 12 }, (_, index) => `그룹 ${index + 1}`)}
        activeIndex={10}
        onSelectPage={jest.fn()}
      />,
    );
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('11 / 12');
    expect(screen.getByLabelText('현재 11, 전체 12 페이지')).toBeOnTheScreen();
  });

  test('dot 접근성 이름은 그룹명과 현재/전체 위치를 함께 제공한다', () => {
    expect(pageAccessibilityLabel('아침 집중방', 0, 3)).toBe('아침 집중방, 1 / 3');
  });
});
