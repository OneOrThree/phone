import React from 'react';
import { act, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { componentTokens } from '@/design-system/tokens';
import { VillageBoardIndicator } from './VillageBoardIndicator';

describe('VillageBoardIndicator', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps the board static and hides the indicator by default', async () => {
    const view = await render(<VillageBoardIndicator />);
    const source = view.getByTestId('village-board-still-image').props.source;
    expect(view.queryByTestId('village-board-new-indicator')).toBeNull();

    await act(async () => jest.advanceTimersByTime(60_000));
    expect(view.getByTestId('village-board-still-image').props.source).toBe(source);
    expect(view.queryByTestId('village-board-new-indicator')).toBeNull();
    await view.unmount();
  });

  it('shows the same ! indicator for unread notices or new comments', async () => {
    const view = await render(<VillageBoardIndicator hasUnread />);
    expect(view.getByTestId('village-board-new-indicator').props.accessibilityLabel).toBe(
      '읽지 않은 새 소식이 있습니다',
    );

    await view.rerender(<VillageBoardIndicator hasNewComment />);
    expect(view.getByTestId('village-board-new-indicator').props.accessibilityLabel).toBe(
      '새 댓글이 있습니다',
    );
    await view.unmount();
  });

  it('scales badge size, radius, and outline from the component token', async () => {
    const scale = 0.72;
    const view = await render(<VillageBoardIndicator hasUnread indicatorScale={scale} />);
    const style = StyleSheet.flatten(view.getByTestId('village-board-new-indicator').props.style);

    expect(style.width).toBe(componentTokens.villageNotificationBadge.diameter * scale);
    expect(style.height).toBe(componentTokens.villageNotificationBadge.diameter * scale);
    expect(style.borderRadius).toBe(componentTokens.villageNotificationBadge.radius * scale);
    expect(style.borderWidth).toBe(componentTokens.villageNotificationBadge.borderWidth);
    await view.unmount();
  });
});
