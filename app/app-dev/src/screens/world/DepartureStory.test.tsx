import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { DepartureStory } from './DepartureStory';
import { MotionContext } from '@/design-system/primitives';

let mockGeneration = 0;
jest.mock('@/services/api/session', () => ({ sessionGeneration: () => mockGeneration }));
jest.mock('@/components/VideoCutscene', () => {
  const { Pressable } = require('react-native');
  const { useContext } = require('react');
  const { MotionContext: Motion } = require('@/design-system/primitives');
  return {
    VideoCutscene: ({ accessibilityLabel, testID, onFinish }: any) => {
      const reduced = useContext(Motion);
      require('react').useEffect(() => {
        if (reduced) onFinish();
      }, []);
      return reduced ? null : (
        <Pressable testID={testID} accessibilityLabel={accessibilityLabel} onPress={onFinish} />
      );
    },
  };
});

beforeEach(() => {
  mockGeneration = 0;
});

test('목적지가 들어간 라벨로 출항 영상을 보여 준다', async () => {
  const screen = await render(<DepartureStory destination="먼바다" onComplete={jest.fn()} />);
  expect(screen.getByTestId('departure-story').props.accessibilityLabel).toContain('먼바다');
});

test('영상이 끝나면 onComplete 를 한 번 부른다', async () => {
  const done = jest.fn();
  const screen = await render(<DepartureStory destination="먼바다" onComplete={done} />);
  await fireEvent.press(screen.getByTestId('departure-story'));
  expect(done).toHaveBeenCalledTimes(1);
});

test('동작 줄이기에서는 영상 없이 바로 끝난다', async () => {
  const done = jest.fn();
  const screen = await render(
    <MotionContext.Provider value>
      <DepartureStory destination="먼바다" onComplete={done} />
    </MotionContext.Provider>,
  );
  expect(screen.queryByTestId('departure-story')).toBeNull();
  expect(done).toHaveBeenCalledTimes(1);
});

test('세션 세대가 바뀌면 onComplete 를 부르지 않는다', async () => {
  const done = jest.fn();
  const screen = await render(<DepartureStory destination="먼바다" onComplete={done} />);
  mockGeneration = 1;
  await act(async () => fireEvent.press(screen.getByTestId('departure-story')));
  expect(done).not.toHaveBeenCalled();
});
