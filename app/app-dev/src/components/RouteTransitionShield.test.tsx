import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { semanticTokens } from '@/design-system/tokens';
import { RouteTransitionShield } from './RouteTransitionShield';

test('일반 route shield는 투명해 새 화면을 가리지 않는다', async () => {
  const screen = await render(<RouteTransitionShield visible />);
  const style = StyleSheet.flatten(
    screen.getByTestId('route-transition-shield', { includeHiddenElements: true }).props.style,
  );

  expect(style.backgroundColor).toBe('transparent');
});

test('건물 route cover는 canvas 색으로 화면을 덮는다', async () => {
  const screen = await render(<RouteTransitionShield visible coverLoading />);
  const style = StyleSheet.flatten(
    screen.getByTestId('route-transition-shield', { includeHiddenElements: true }).props.style,
  );

  expect(style.backgroundColor).toBe(semanticTokens.color.canvas);
});

test('route shield가 끝나도 건물 route cover가 유지되면 shield가 남는다', async () => {
  const screen = await render(<RouteTransitionShield visible coverLoading />);
  await screen.rerender(<RouteTransitionShield visible={false} coverLoading />);

  expect(
    screen.getByTestId('route-transition-shield', { includeHiddenElements: true }),
  ).toBeTruthy();
});
