import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import GoalSettingStep from './GoalSettingStep';
import { WEB_SCROLL_SETTLE_MS } from '@/components/DrumPickerCore';
import {
  INITIAL_ONBOARDING_DATA,
  type V2OnboardingData,
} from '@/screens/onboarding/types';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// Jest는 기본적으로 .web.tsx보다 공통 파일을 먼저 고른다. 이 테스트만 실제 웹 adapter를 사용한다.
jest.mock('@/components/DrumPicker', () => ({
  DrumPicker: jest.requireActual('@/components/DrumPicker.web').DrumPicker,
}));

jest.mock('@/services/analyticsEvents', () => ({
  logOnboardingGoalSubmitted: jest.fn(),
}));

const onNext = jest.fn();

function Harness() {
  const [data, setData] = useState<V2OnboardingData>(INITIAL_ONBOARDING_DATA);
  return (
    <GoalSettingStep
      data={data}
      update={(patch) => setData((current) => ({ ...current, ...patch }))}
      onNext={onNext}
    />
  );
}

async function scrollAndSettle(element: ReturnType<typeof screen.getAllByTestId>[number], y: number) {
  await act(async () => {
    fireEvent.scroll(element, { nativeEvent: { contentOffset: { y } } });
    jest.advanceTimersByTime(WEB_SCROLL_SETTLE_MS);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

test('웹에서 두 목표 시간을 고르면 다음 버튼이 활성화되어 진행한다', async () => {
  await render(<Harness />);

  expect(screen.getByTestId('onboarding.cta')).toBeDisabled();

  await act(async () => {
    fireEvent.press(screen.getByText('하루 집중 목표'));
  });
  await scrollAndSettle(screen.getAllByTestId('drum-picker.web.scroll')[0], 44);

  await act(async () => {
    fireEvent.press(screen.getByText('하루 스크린타임 목표'));
  });
  await scrollAndSettle(screen.getAllByTestId('drum-picker.web.scroll')[2], 44);

  expect(screen.getByTestId('onboarding.cta')).toBeEnabled();
  await act(async () => {
    fireEvent.press(screen.getByTestId('onboarding.cta'));
  });
  expect(onNext).toHaveBeenCalledTimes(1);
});
