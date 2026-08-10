import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GroupCardEmojiPicker } from './GroupCardEmojiPicker';
import type { GroupCardEmoji } from '../groupCardEmojiStore';

function ControlledPicker() {
  const [value, setValue] = useState<GroupCardEmoji>('🎯');
  return <GroupCardEmojiPicker value={value} onChange={setValue} />;
}

test('방향 입력은 새로 선택된 radio를 기준으로 다음 후보까지 계속 이동한다', async () => {
  await render(<ControlledPicker />);

  await act(async () => {
    fireEvent(screen.getByTestId('group.cardEmoji.🎯'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
  });
  expect(screen.getByTestId('group.cardEmoji.🌿').props.accessibilityState.checked).toBe(true);

  await act(async () => {
    fireEvent(screen.getByTestId('group.cardEmoji.🌿'), 'keyDown', {
      nativeEvent: { key: 'ArrowRight' },
    });
  });
  expect(screen.getByTestId('group.cardEmoji.🔥').props.accessibilityState.checked).toBe(true);
});
