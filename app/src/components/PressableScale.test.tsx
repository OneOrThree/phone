// PressableScale 컴포넌트 테스트 — 눌림 피드백(햅틱·사운드)의 발화 조건.
// 스케일 애니메이션은 UI 스레드 값이라 단위 테스트로 검증하지 않고, 부수효과만 본다.
import { createRef } from 'react';
import { Text, type View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PressableScale } from './PressableScale';
import { playTapSound } from '@/utils/sound';
import { hapticLight, hapticSelect } from '@/utils/haptics';

jest.mock('@/utils/sound', () => ({ playTapSound: jest.fn(), preloadTapSound: jest.fn() }));
jest.mock('@/utils/haptics', () => ({
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
  hapticSelect: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

describe('PressableScale', () => {
  test('탭하면 onPress가 호출된다', async () => {
    const onPress = jest.fn();
    await render(
      <PressableScale testID="btn" onPress={onPress}>
        <Text>확인</Text>
      </PressableScale>,
    );
    fireEvent.press(screen.getByTestId('btn'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('기본값 — 누르는 순간 탭 사운드가 나고 햅틱은 없다', async () => {
    await render(
      <PressableScale testID="btn">
        <Text>확인</Text>
      </PressableScale>,
    );
    fireEvent(screen.getByTestId('btn'), 'pressIn');
    expect(playTapSound).toHaveBeenCalledTimes(1);
    expect(hapticLight).not.toHaveBeenCalled();
    expect(hapticSelect).not.toHaveBeenCalled();
  });

  test('sound={false}면 소리를 내지 않는다', async () => {
    await render(
      <PressableScale testID="btn" sound={false}>
        <Text>뒤로</Text>
      </PressableScale>,
    );
    fireEvent(screen.getByTestId('btn'), 'pressIn');
    expect(playTapSound).not.toHaveBeenCalled();
  });

  test('haptic 종류에 맞는 래퍼만 호출한다', async () => {
    await render(
      <PressableScale testID="btn" haptic="light">
        <Text>집중 시작</Text>
      </PressableScale>,
    );
    fireEvent(screen.getByTestId('btn'), 'pressIn');
    expect(hapticLight).toHaveBeenCalledTimes(1);
    expect(hapticSelect).not.toHaveBeenCalled();
  });

  test("기본 accessibilityRole은 'button' — VoiceOver가 버튼으로 읽는다", async () => {
    await render(
      <PressableScale testID="btn">
        <Text>확인</Text>
      </PressableScale>,
    );
    expect(screen.getByTestId('btn').props.accessibilityRole).toBe('button');
  });

  test('호출부가 accessibilityRole을 덮어쓸 수 있다', async () => {
    await render(
      <PressableScale testID="btn" accessibilityRole="tab">
        <Text>홈</Text>
      </PressableScale>,
    );
    expect(screen.getByTestId('btn').props.accessibilityRole).toBe('tab');
  });

  test('ref가 호스트 뷰로 전달된다(팝오버·드로어 앵커 measureInWindow용)', async () => {
    const ref = createRef<View>();
    await render(
      <PressableScale testID="btn" ref={ref}>
        <Text>메뉴</Text>
      </PressableScale>,
    );
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.measureInWindow).toBe('function');
  });

  test('호출부의 onPressIn도 함께 실행된다(피드백이 기존 핸들러를 가리지 않음)', async () => {
    const onPressIn = jest.fn();
    await render(
      <PressableScale testID="btn" onPressIn={onPressIn}>
        <Text>확인</Text>
      </PressableScale>,
    );
    fireEvent(screen.getByTestId('btn'), 'pressIn');
    expect(onPressIn).toHaveBeenCalledTimes(1);
    expect(playTapSound).toHaveBeenCalledTimes(1);
  });
});
