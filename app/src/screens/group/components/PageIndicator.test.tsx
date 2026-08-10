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
    const findPage = screen.getByRole('button', { name: '그룹 찾기, 3 / 3' });
    expect(findPage.props.accessibilityState).toEqual({ selected: false, disabled: false });
    fireEvent.press(findPage);

    expect(onSelectPage).toHaveBeenCalledWith(2);
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

  test('가이드가 입력을 잠그는 동안 dot 선택도 막는다', async () => {
    const onSelectPage = jest.fn();
    await render(
      <PageIndicator
        pageLabels={['아침 집중방', '그룹 찾기']}
        activeIndex={0}
        disabled
        onSelectPage={onSelectPage}
      />,
    );
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 400 } },
      });
    });

    const findPage = screen.getByRole('button', { name: '그룹 찾기, 2 / 2' });
    expect(findPage.props.accessibilityState).toEqual({ selected: false, disabled: true });
    fireEvent.press(findPage);
    expect(onSelectPage).not.toHaveBeenCalled();
  });

  test('스크린리더 activate는 별도 접근성 선택 trigger로 위임한다', async () => {
    const onAccessibilitySelectPage = jest.fn();
    await render(
      <PageIndicator
        pageLabels={['아침 집중방', '그룹 찾기']}
        activeIndex={0}
        onSelectPage={jest.fn()}
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
  });
});
