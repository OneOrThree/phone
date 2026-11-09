import React, { memo, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { applyLocalePref, t, useLocale } from './index';

test('memo 화면도 언어 변경을 구독하고 로컬 상태는 유지한다', async () => {
  applyLocalePref('ko');
  const Counter = memo(function Counter() {
    useLocale();
    const [count, setCount] = useState(0);
    return (
      <Pressable onPress={() => setCount(count + 1)}>
        <Text>
          {t('common.save')} {count}
        </Text>
      </Pressable>
    );
  });
  const screen = await render(<Counter />);
  await fireEvent.press(screen.getByText('저장 0'));
  await act(async () => {
    applyLocalePref('en');
  });
  expect(screen.getByText('Save 1')).toBeTruthy();
  await screen.unmount();
  applyLocalePref('system');
});
