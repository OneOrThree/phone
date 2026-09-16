// 뽀모도로 설정 시트의 피드백 정책 테스트 —
// "일반 버튼(스텝퍼 포함)은 스케일+사운드, 햅틱은 집중 시작 CTA에만"을 고정한다.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PomodoroSetupSheet } from './PomodoroSetupSheet';
import { playTapSound } from '@/utils/sound';
import { hapticLight } from '@/utils/haptics';

jest.mock('@/utils/sound', () => ({ playTapSound: jest.fn(), preloadTapSound: jest.fn() }));
jest.mock('@/utils/haptics', () => ({
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
  hapticSelect: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeEach(() => jest.clearAllMocks());

async function renderSheet() {
  const onStart = jest.fn();
  await render(<PomodoroSetupSheet subjectName="수학" onStart={onStart} onClose={jest.fn()} />);
  return { onStart };
}

describe('PomodoroSetupSheet', () => {
  test('스텝퍼도 탭 사운드를 낸다 — 같은 화면의 일반 버튼과 규칙이 같다', async () => {
    await renderSheet();
    await fireEvent(screen.getByLabelText('집중 늘리기'), 'pressIn');
    expect(playTapSound).toHaveBeenCalledTimes(1);
  });

  test('반복해서 누르는 스텝퍼에는 햅틱을 주지 않는다', async () => {
    await renderSheet();
    await fireEvent(screen.getByLabelText('집중 늘리기'), 'pressIn');
    await fireEvent(screen.getByLabelText('휴식 줄이기'), 'pressIn');
    expect(hapticLight).not.toHaveBeenCalled();
  });

  test('스텝퍼가 값을 실제로 조절한다(피드백 전환이 동작을 깨지 않음)', async () => {
    await renderSheet();
    expect(screen.getByText('25분')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('집중 늘리기'));
    expect(screen.getByText('30분')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('집중 줄이기'));
    expect(screen.getByText('25분')).toBeTruthy();
  });

  test('집중 시작 버튼에만 햅틱이 붙는다', async () => {
    const { onStart } = await renderSheet();
    await fireEvent(screen.getByText('집중 시작'), 'pressIn');
    expect(hapticLight).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('집중 시작'));
    expect(onStart).toHaveBeenCalledWith({ focusMin: 25, breakMin: 5, sets: 4 });
  });
});
