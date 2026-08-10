import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, View } from 'react-native';
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

test('접근성 제목을 단계 안내 앞에 포함한다', async () => {
  await render(
    <TabGuideOverlay
      storageKey="gromo:guide:groupDeck:v1"
      steps={[{ text: '카드를 확인해요', character }]}
      visible
      accessibilityTitle="그룹 카드 안내"
    />,
  );

  expect(
    screen.getByLabelText('그룹 카드 안내, 단계 1/1. 카드를 확인해요. 시작'),
  ).toBeOnTheScreen();
});

test('화면 크기가 바뀌면 이전 spotlight를 숨기고 새 anchor를 다시 측정한다', async () => {
  const originalWindow = Dimensions.get('window');
  const originalScreen = Dimensions.get('screen');
  const prepare = jest.fn();
  const callbacks: ((x: number, y: number, w: number, h: number) => void)[] = [];
  const anchor = {
    current: {
      measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => {
        callbacks.push(callback);
      },
    } as unknown as View,
  };
  const steps: GuideStep[] = [{ text: '대상', character, anchor, prepare }];
  const view = await render(
    <TabGuideOverlay storageKey="gromo:guide:resize" steps={steps} visible />,
  );

  await act(async () => callbacks[0]?.(10, 20, 100, 80));
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('guide.overlay.cutout')).toBeOnTheScreen();

  await act(async () => {
    Dimensions.set({
      window: { ...originalWindow, width: originalWindow.height, height: originalWindow.width },
      screen: { ...originalScreen, width: originalScreen.height, height: originalScreen.width },
    });
  });
  await view.rerender(<TabGuideOverlay storageKey="gromo:guide:resize" steps={steps} visible />);

  expect(screen.getByTestId('guide.overlay.dim')).toBeOnTheScreen();
  expect(callbacks).toHaveLength(2);
  expect(prepare).toHaveBeenCalledTimes(1);
  await act(async () => callbacks[1]?.(30, 40, 120, 90));
  expect(screen.getByTestId('guide.overlay.cutout')).toBeOnTheScreen();

  await act(async () => {
    Dimensions.set({ window: originalWindow, screen: originalScreen });
  });
});
