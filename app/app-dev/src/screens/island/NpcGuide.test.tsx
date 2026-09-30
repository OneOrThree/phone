import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, Pressable, Text, TextInput, StyleSheet } from 'react-native';
import {
  MailboxGuide,
  ShopGuide,
  TutorialScene,
  TutorialSpotlight,
  useSpotlightTarget,
} from './NpcGuide';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    compact: false,
    floatingWidth: 370,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));

const expectBlocked = (overlay: any) => {
  expect(overlay.props.pointerEvents).toBe('none');
  expect(overlay.props.accessibilityElementsHidden).toBe(true);
  expect(overlay.props.importantForAccessibility).toBe('no-hide-descendants');
};

const expectUnblocked = (overlay: any) => {
  expect(overlay.props.pointerEvents).toBe('auto');
  expect(overlay.props.accessibilityElementsHidden).toBe(false);
  expect(overlay.props.importantForAccessibility).toBe('auto');
};

test('우체통 안내 모달은 전환 차단 중 입력과 접근성 트리에서 숨는다', async () => {
  const screen = await render(<MailboxGuide blocked onDone={jest.fn()} />);
  expectBlocked(screen.getByTestId('mailbox-guide-overlay', { includeHiddenElements: true }));
});

test('상점 안내 모달은 전환 차단 중 입력과 접근성 트리에서 숨는다', async () => {
  const screen = await render(<ShopGuide blocked onDone={jest.fn()} onCancel={jest.fn()} />);
  expectBlocked(screen.getByTestId('shop-guide-overlay', { includeHiddenElements: true }));
});

test('우체통 안내 모달은 차단이 풀리면 입력과 접근성을 복구한다', async () => {
  const screen = await render(<MailboxGuide onDone={jest.fn()} />);
  expectUnblocked(screen.getByTestId('mailbox-guide-overlay'));
});

test('상점 안내 모달은 차단이 풀리면 입력과 접근성을 복구한다', async () => {
  const screen = await render(<ShopGuide onDone={jest.fn()} onCancel={jest.fn()} />);
  expectUnblocked(screen.getByTestId('shop-guide-overlay'));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('스포트라이트는 배경 접근성을 숨기고 허용된 동작만 같은 핸들러로 실행한다', async () => {
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  const allowed = jest.fn(),
    outside = jest.fn(),
    skip = jest.fn();
  const screen = await render(
    <TutorialScene
      onSkip={skip}
      overlay={
        <TutorialSpotlight
          target={{ x: 20, y: 600, width: 100, height: 48 }}
          text="버튼 안내"
          action={{ title: '허용된 동작', onPress: allowed }}
        />
      }
    >
      <Pressable accessibilityRole="button" onPress={outside}>
        <Text>배경 버튼</Text>
      </Pressable>
    </TutorialScene>,
  );
  expect(screen.queryByText('배경 버튼')).toBeNull();
  expect(screen.getByTestId('tutorial-spotlight').props.accessibilityViewIsModal).toBe(true);
  await fireEvent.press(screen.getByText('허용된 동작'));
  expect(allowed).toHaveBeenCalledTimes(1);
  expect(outside).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('안내 그만 보기'));
  expect(skip).toHaveBeenCalledTimes(1);
  await screen.rerender(
    <TutorialScene>
      <Text>배경 버튼</Text>
    </TutorialScene>,
  );
  expect(screen.getByText('배경 버튼')).toBeTruthy();
});

test('스크린리더 입력도 같은 값 변경과 입력 완료 핸들러를 사용한다', async () => {
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  const change = jest.fn(),
    done = jest.fn();
  const screen = await render(
    <TutorialSpotlight
      text="할 일 입력"
      accessibleInput={
        <TextInput
          accessibilityLabel="오늘의 할 일"
          value=""
          onChangeText={change}
          onSubmitEditing={done}
        />
      }
    />,
  );
  await fireEvent.changeText(screen.getByLabelText('오늘의 할 일'), '수학');
  await fireEvent(screen.getByLabelText('오늘의 할 일'), 'submitEditing');
  expect(change).toHaveBeenCalledWith('수학');
  expect(done).toHaveBeenCalledTimes(1);
});

test('대상을 측정하지 못해도 2초 뒤 실행 대체 버튼과 안내 종료를 제공한다', async () => {
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.useFakeTimers();
  const action = jest.fn();
  const screen = await render(
    <TutorialScene
      onSkip={jest.fn()}
      overlay={
        <TutorialSpotlight
          target={null}
          text="집중 시작 안내"
          action={{ title: '집중 시작', onPress: action }}
        />
      }
    />,
  );
  expect(screen.getByText('안내 그만 보기')).toBeTruthy();
  expect(screen.queryByText('집중 시작')).toBeNull();
  await act(async () => jest.advanceTimersByTime(2000));
  await fireEvent.press(screen.getByText('집중 시작'));
  expect(action).toHaveBeenCalledTimes(1);
});

test('대상이 사라지거나 크기가 0이면 이전 구멍 좌표를 폐기한다', async () => {
  jest.useFakeTimers();
  const hook = await renderHook(() => useSpotlightTarget(true));
  const node = { measureInWindow: (cb: (...args: number[]) => void) => cb(10, 20, 80, 48) };
  hook.result.current.ref.current = node as any;
  await act(async () => jest.advanceTimersByTime(220));
  expect(hook.result.current.rect).toEqual({ x: 10, y: 20, width: 80, height: 48 });
  hook.result.current.ref.current = null;
  await act(async () => jest.advanceTimersByTime(220));
  expect(hook.result.current.rect).toBeNull();
  hook.result.current.ref.current = {
    measureInWindow: (cb: (...args: number[]) => void) => cb(10, 20, 0, 0),
  } as any;
  await act(async () => jest.advanceTimersByTime(220));
  expect(hook.result.current.rect).toBeNull();
});

test('키보드가 올라오면 대화창의 스크롤 영역을 키보드 위로 제한한다', async () => {
  const callbacks: Record<string, (...args: any[]) => void> = {};
  const addListener = Keyboard.addListener.bind(Keyboard);
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, cb) => {
    callbacks[name] = cb;
    return addListener(name, cb);
  });
  const screen = await render(
    <TutorialSpotlight text="입력 안내" target={{ x: 20, y: 450, width: 200, height: 48 }} />,
  );
  await act(async () => callbacks.keyboardDidShow({ endCoordinates: { screenY: 550 } }));
  const style = StyleSheet.flatten(screen.getByTestId('tutorial-dialogue').props.style);
  expect(874 - style.bottom).toBeLessThan(550);
  expect(style.maxHeight).toBeLessThan(550);
});
