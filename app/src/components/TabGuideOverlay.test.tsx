import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TabGuideOverlay, type GuideStep } from './TabGuideOverlay';
import { logTabGuideCompleted } from '@/services/analyticsEvents';

jest.mock('@/services/analyticsEvents', () => ({ logTabGuideCompleted: jest.fn() }));

const character = require('@/assets/character_hi.png');

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test('controlled guide는 단계/다음·시작을 읽고 외부 controller에 완료를 위임한다', async () => {
  const prepare = jest.fn();
  const onFinish = jest.fn();
  const steps: GuideStep[] = [
    { text: '첫 단계', character },
    { text: '마지막 단계', character, prepare },
  ];
  await render(
    <TabGuideOverlay
      storageKey="gromo:guide:test"
      steps={steps}
      visible
      completionMode="external"
      allowRequestClose={false}
      onFinish={onFinish}
    />,
  );

  expect(screen.getByLabelText('단계 1/2. 첫 단계. 다음')).toBeOnTheScreen();
  await act(async () => {
    fireEvent(screen.getByTestId('guide.overlay'), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
  });
  await waitFor(() => {
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('단계 2/2. 마지막 단계. 시작')).toBeOnTheScreen();
  });

  await act(async () => {
    fireEvent.press(screen.getByTestId('guide.overlay'));
  });
  expect(onFinish).toHaveBeenCalledTimes(1);
  expect(logTabGuideCompleted).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('마지막 단계에서 중단 후 재개해도 이전 prepare 없이 1단계부터 시작한다', async () => {
  const lastPrepare = jest.fn();
  const steps: GuideStep[] = [
    { text: '첫 단계', character },
    { text: '둘째 단계', character },
    { text: '셋째 단계', character },
    { text: '마지막 단계', character, prepare: lastPrepare },
  ];
  const view = await render(
    <TabGuideOverlay storageKey="gromo:guide:resume" steps={steps} visible />,
  );
  for (let step = 0; step < 3; step += 1) {
    await act(async () => fireEvent.press(screen.getByTestId('guide.overlay')));
  }
  await waitFor(() => expect(lastPrepare).toHaveBeenCalledTimes(1));

  await view.rerender(
    <TabGuideOverlay storageKey="gromo:guide:resume" steps={steps} visible={false} />,
  );
  await view.rerender(<TabGuideOverlay storageKey="gromo:guide:resume" steps={steps} visible />);

  expect(screen.getByLabelText('단계 1/4. 첫 단계. 다음')).toBeOnTheScreen();
  expect(lastPrepare).toHaveBeenCalledTimes(1);
});
