import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { GroupCardFlip } from './GroupCardFlip';

test('같은 shell 안의 두 face에서 포인터·접근성 활성 면을 flip 상태와 함께 바꾼다', async () => {
  const view = await render(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped={false}
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
    />,
  );

  const front = () =>
    screen.getByTestId('group.card.flipFront.g1', { includeHiddenElements: true });
  const back = () => screen.getByTestId('group.card.flipBack.g1', { includeHiddenElements: true });
  expect(screen.getByTestId('group.card.flipShell.g1')).toBeOnTheScreen();
  expect(front().props.pointerEvents).toBe('auto');
  expect(front().props.importantForAccessibility).toBe('auto');
  expect(back().props.pointerEvents).toBe('none');
  expect(back().props.importantForAccessibility).toBe('no-hide-descendants');

  await view.rerender(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
    />,
  );

  expect(front().props.pointerEvents).toBe('none');
  expect(front().props.importantForAccessibility).toBe('no-hide-descendants');
  expect(back().props.pointerEvents).toBe('auto');
  expect(back().props.importantForAccessibility).toBe('auto');
});
