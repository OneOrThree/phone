import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PageIndicator, requiredDotsWidth, resolveIndicatorMode } from './PageIndicator';

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
    await render(<PageIndicator pageCount={3} activeIndex={0} onSelectPage={onSelectPage} />);

    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 400 } },
      });
    });
    fireEvent.press(
      screen.getByTestId('group.deck.indicator.dot.2', { includeHiddenElements: true }),
    );

    expect(onSelectPage).toHaveBeenCalledWith(2);
  });

  test('접근성 activate는 전용 trigger 콜백으로 페이지를 선택한다', async () => {
    const onSelectPage = jest.fn();
    const onAccessibilitySelectPage = jest.fn();
    await render(
      <PageIndicator
        pageCount={3}
        activeIndex={0}
        onSelectPage={onSelectPage}
        onAccessibilitySelectPage={onAccessibilitySelectPage}
      />,
    );
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 400 } },
      });
    });
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator.dot.1'), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      });
    });

    expect(onAccessibilitySelectPage).toHaveBeenCalledWith(1);
    expect(onSelectPage).not.toHaveBeenCalled();
  });

  test('첫 측정 전 counter는 현재/전체를 읽는다', async () => {
    await render(<PageIndicator pageCount={12} activeIndex={10} onSelectPage={jest.fn()} />);
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('11 / 12');
    expect(screen.getByLabelText('현재 11, 전체 12 페이지')).toBeOnTheScreen();
  });
});
