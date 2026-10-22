import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { componentTokens } from '@/design-system/tokens';
import { applyLocalePref } from '@/i18n';
import { RaftDestinationScene } from './RaftDestinationScene';

let mockViewport = { width: 320, height: 568, fontScale: 2.5 };
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    ...mockViewport,
    landscape: mockViewport.width > mockViewport.height,
    insets: { top: 44, bottom: 34, left: 0, right: 0 },
  }),
}));

beforeEach(() => applyLocalePref('en'));
afterEach(() => applyLocalePref('ko'));

test.each([
  { width: 320, height: 568, fontScale: 2.5 },
  { width: 568, height: 320, fontScale: 3.2 },
])('큰 글자 $width×$height에서도 모든 목적지를 스크롤 영역에서 읽고 선택한다', async (viewport) => {
  mockViewport = viewport;
  const onMembers = jest.fn(),
    onSea = jest.fn(),
    onFocus = jest.fn();
  const props = { visiting: false, busy: false, onMembers, onSea, onFocus };
  const screen = await render(<RaftDestinationScene {...props} />);
  const content = within(screen.getByTestId('raft-destination-scroll'));
  expect(content.getByRole('header', { name: 'Where shall we sail?' })).toBeTruthy();
  await fireEvent.press(content.getByRole('button', { name: 'My islands' }));
  await fireEvent.press(content.getByRole('button', { name: 'Set sail' }));
  await fireEvent.press(content.getByRole('button', { name: 'Start focusing' }));
  expect(onMembers).toHaveBeenCalledTimes(1);
  expect(onSea).toHaveBeenCalledTimes(1);
  expect(onFocus).toHaveBeenCalledTimes(1);
  await screen.rerender(<RaftDestinationScene {...props} busy />);
  await fireEvent.press(screen.getByRole('button', { name: 'Set sail' }));
  expect(onSea).toHaveBeenCalledTimes(1);
});

test('큰 글자 방문 화면에서도 바다와 소속 섬 입구를 유지하고 집중섬은 숨긴다', async () => {
  const screen = await render(
    <RaftDestinationScene
      visiting
      busy={false}
      onMembers={jest.fn()}
      onSea={jest.fn()}
      onFocus={jest.fn()}
    />,
  );
  const content = within(screen.getByTestId('raft-destination-scroll'));
  expect(content.getByRole('button', { name: 'My islands' })).toBeTruthy();
  expect(content.getByRole('button', { name: 'Set sail' })).toBeTruthy();
  expect(content.queryByRole('button', { name: 'Start focusing' })).toBeNull();
});

test('입구·목적지는 밑줄 글자가 아닌 Btn 이고, 마지막에 고른 목적지만 Pink 다', async () => {
  mockViewport = { width: 402, height: 874, fontScale: 1 };
  const screen = await render(
    <RaftDestinationScene
      visiting={false}
      selected="sea"
      busy={false}
      onMembers={jest.fn()}
      onSea={jest.fn()}
      onFocus={jest.fn()}
    />,
  );
  const bg = (name: string) =>
    StyleSheet.flatten(screen.getByRole('button', { name }).props.style).backgroundColor;
  expect(bg('Set sail')).toBe(componentTokens.button.background);
  expect(bg('Start focusing')).toBe(componentTokens.button.glassBackground);
  expect(bg('My islands')).toBe(componentTokens.button.glassBackground);
  expect(screen.getByRole('button', { name: 'Set sail' }).props.accessibilityState.selected).toBe(
    true,
  );
  for (const name of ['Set sail', 'Start focusing', 'My islands'])
    expect(
      StyleSheet.flatten(screen.getByText(name).props.style).textDecorationLine,
    ).toBeUndefined();
});
