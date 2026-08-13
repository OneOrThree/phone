import { act, fireEvent, render, screen } from '@testing-library/react-native';
import CutoutStep from './CutoutStep';
import { INITIAL_ONBOARDING_DATA } from '@/screens/onboarding/types';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@/services/subjectMask', () => ({
  isSubjectMaskModuleAvailable: () => true,
}));

jest.mock('@/screens/character/CharacterCreator', () => {
  const { View } = require('react-native');
  return function MockCharacterCreator() {
    return <View />;
  };
});

jest.mock('@/services/api', () => ({
  getUserIdFromToken: jest.fn(() => 'user-id'),
}));

test('캐릭터를 만들지 않아도 건너뛰기로 다음 단계에 진입한다', async () => {
  const onNext = jest.fn();
  await render(<CutoutStep data={INITIAL_ONBOARDING_DATA} update={jest.fn()} onNext={onNext} />);
  await act(async () => {});

  expect(screen.getByTestId('onboarding.secondary')).toBeOnTheScreen();
  expect(screen.getByText('건너뛰기')).toBeOnTheScreen();

  await act(async () => {
    fireEvent.press(screen.getByTestId('onboarding.secondary'));
  });

  expect(onNext).toHaveBeenCalledTimes(1);
});
