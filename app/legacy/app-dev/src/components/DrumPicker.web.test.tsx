import { fireEvent, render, screen } from '@testing-library/react-native';
import { DrumPicker } from './DrumPicker.web';
import { WEB_SCROLL_SETTLE_MS } from './DrumPickerCore';

test('웹 휠은 DOM scroll이 멈추면 가운데 항목을 선택하고 스냅한다', async () => {
  const onChange = jest.fn();
  await render(
    <DrumPicker
      items={['0시간', '1시간', '2시간', '3시간']}
      selectedIndex={0}
      onChange={onChange}
    />,
  );
  const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((handler) => {
    if (typeof handler === 'function') handler();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });

  fireEvent.scroll(screen.getByTestId('drum-picker.web.scroll'), {
    nativeEvent: { contentOffset: { y: 88 } },
  });

  expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), WEB_SCROLL_SETTLE_MS);
  expect(onChange).toHaveBeenCalledWith(2);
  setTimeoutSpy.mockRestore();
});
