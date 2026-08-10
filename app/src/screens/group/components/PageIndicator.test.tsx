import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import * as ReactNative from 'react-native';
import { PageIndicator, requiredDotsWidth, resolveIndicatorMode } from './PageIndicator';

describe('PageIndicator', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    jest.spyOn(ReactNative, 'findNodeHandle').mockReturnValue(7);
  });

  afterEach(() => jest.restoreAllMocks());

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
        pageCount={3}
        activeIndex={0}
        onSelectPage={onSelectPage}
        pageLabels={['아침 집중방', '저녁 집중방', '그룹 찾기']}
      />,
    );

    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 400 } },
      });
    });
    fireEvent.press(
      screen.getByTestId('group.deck.indicator.dot.2', { includeHiddenElements: true }),
    );

    expect(onSelectPage).toHaveBeenCalledWith(2);
    expect(
      screen.getByLabelText('저녁 집중방, 2 / 3 페이지로 이동').props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: false, disabled: false }));
  });

  test('첫 측정 전 counter는 현재/전체를 읽는다', async () => {
    await render(<PageIndicator pageCount={12} activeIndex={10} onSelectPage={jest.fn()} />);
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('11 / 12');
    expect(screen.getByLabelText('현재 11, 전체 12 페이지')).toBeOnTheScreen();
  });

  test('재정렬 중에는 dots 입력을 막고 비활성 상태를 읽는다', async () => {
    const onSelectPage = jest.fn();
    await render(
      <PageIndicator pageCount={2} activeIndex={0} disabled onSelectPage={onSelectPage} />,
    );
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 400 } },
      });
    });

    const dot = screen.getByTestId('group.deck.indicator.dot.1', {
      includeHiddenElements: true,
    });
    fireEvent.press(dot);

    expect(onSelectPage).not.toHaveBeenCalled();
    expect(dot.props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false, disabled: true }),
    );
  });

  test('dots에서 counter로 바뀌면 현재 indicator 접근성 포커스를 이어 준다', async () => {
    jest.useFakeTimers();
    await render(<PageIndicator pageCount={3} activeIndex={1} onSelectPage={jest.fn()} />);
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 400 } },
      });
    });
    fireEvent(screen.getByTestId('group.deck.indicator.dot.1'), 'focus');

    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 120 } },
      });
    });
    await act(async () => jest.runAllTimers());

    expect(screen.getByTestId('group.deck.indicator.counter')).toBeOnTheScreen();
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(7);
    jest.useRealTimers();
  });
});
