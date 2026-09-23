import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { cat } from '@/constants/assets';
import { CatSprite } from './CatSprite';

describe('CatSprite 재생 제어', () => {
  let onAppStateChange: ((state: 'active' | 'background' | 'inactive') => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event, listener) => {
      onAppStateChange = listener as (state: 'active' | 'background' | 'inactive') => void;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('걷기 프레임을 진행하고 color·motion 변경 시 첫 프레임으로 되돌린다', async () => {
    const view = await render(<CatSprite color="black" motion="walk" testID="cat" />);
    expect(view.getByTestId('cat-frame-0').props.source).toBe(
      cat('black', 'walking/walking-frame-0'),
    );

    await act(async () => jest.advanceTimersByTime(125));
    expect(view.getByTestId('cat-frame-1').props.source).toBe(
      cat('black', 'walking/walking-frame-1'),
    );

    await view.rerender(<CatSprite color="ginger" motion="walk" testID="cat" />);
    expect(view.getByTestId('cat-frame-0').props.source).toBe(
      cat('ginger', 'walking/walking-frame-0'),
    );

    await view.rerender(<CatSprite color="ginger" motion="yawn" testID="cat" />);
    await act(async () => jest.advanceTimersByTime(320));
    expect(view.getByTestId('cat-frame-1')).toBeTruthy();
    await view.rerender(<CatSprite color="ginger" motion="walk" testID="cat" />);
    expect(view.getByTestId('cat-frame-0').props.source).toBe(
      cat('ginger', 'walking/walking-frame-0'),
    );
    await view.unmount();
  });

  it('백그라운드와 reduceMotion에서는 타이머를 멈추고 첫 프레임을 유지한다', async () => {
    const view = await render(<CatSprite color="black" motion="walk" testID="cat" />);
    await act(async () => onAppStateChange?.('background'));
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(view.getByTestId('cat-frame-0')).toBeTruthy();

    await act(async () => onAppStateChange?.('active'));
    await view.rerender(<CatSprite color="black" motion="walk" reduceMotion testID="cat" />);
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(view.getByTestId('cat-frame-0')).toBeTruthy();
    await view.unmount();
  });

  it('아틀라스는 strip을 뒤집지 않고 바깥 viewport만 반전한다', async () => {
    const view = await render(<CatSprite color="black" motion="yawn" left testID="cat" />);
    const rootStyle = view.getByTestId('cat').props.style;
    const imageStyle = view.getByTestId('cat-frame-0').props.style;
    expect(rootStyle.transform[0]).toEqual({ scaleX: -1 });
    expect(imageStyle.transform).toBeUndefined();
    await view.unmount();
  });

  it('unmount 뒤에는 예약된 프레임 타이머를 정리한다', async () => {
    const clearTimeout = jest.spyOn(global, 'clearTimeout');
    const view = await render(<CatSprite color="black" motion="walk" testID="cat" />);
    await view.unmount();
    expect(clearTimeout).toHaveBeenCalled();
  });

  it('갸웃(tilt) 동작 시 프레임이 진행되고 물음표 표시가 함께 렌더링된다', async () => {
    const view = await render(<CatSprite color="ginger" motion="tilt" testID="cat" />);
    expect(view.getByTestId('cat-frame-0').props.source).toBe(cat('ginger', 'tilt/tilt-frame-0'));
    expect(view.getByTestId('cat-question')).toBeTruthy();

    await act(async () => jest.advanceTimersByTime(260));
    expect(view.getByTestId('cat-frame-1').props.source).toBe(cat('ginger', 'tilt/tilt-frame-1'));

    await act(async () => jest.advanceTimersByTime(260));
    expect(view.getByTestId('cat-frame-2').props.source).toBe(cat('ginger', 'tilt/tilt-frame-2'));
    await view.unmount();
  });
});
