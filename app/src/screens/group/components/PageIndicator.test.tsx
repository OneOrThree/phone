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

    expect(onSelectPage).toHaveBeenCalledWith(2, 'indicator_press');
    expect(screen.getByTestId('group.deck.indicator').props.style).toEqual(
      expect.objectContaining({ height: 44 }),
    );
    expect(
      screen.getByTestId('group.deck.indicator.dot.2', { includeHiddenElements: true }).props.style,
    ).toEqual(expect.objectContaining({ width: 44, height: 44 }));
  });

  test('첫 측정 전 counter는 현재/전체를 읽는다', async () => {
    await render(<PageIndicator pageCount={12} activeIndex={10} onSelectPage={jest.fn()} />);
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('11 / 12');
    expect(screen.getAllByLabelText('11 / 12').length).toBeGreaterThan(0);
  });

  test('dots 모드도 현재 위치를 읽고 접근성 동작으로 이동한다', async () => {
    const onSelectPage = jest.fn();
    await render(<PageIndicator pageCount={3} activeIndex={1} onSelectPage={onSelectPage} />);
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 400 } },
      });
      fireEvent(screen.getByTestId('group.deck.indicator'), 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(onSelectPage).toHaveBeenCalledWith(2, 'accessibility_action');
  });

  test('노출 확정 전에는 포인터와 접근성 입력을 모두 차단한다', async () => {
    const onSelectPage = jest.fn();
    await render(
      <PageIndicator pageCount={3} activeIndex={0} onSelectPage={onSelectPage} disabled />,
    );

    const indicator = screen.getByTestId('group.deck.indicator', {
      includeHiddenElements: true,
    });
    expect(indicator.props.pointerEvents).toBe('none');
    expect(indicator.props.accessibilityElementsHidden).toBe(true);
    fireEvent(indicator, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onSelectPage).not.toHaveBeenCalled();
  });
});
