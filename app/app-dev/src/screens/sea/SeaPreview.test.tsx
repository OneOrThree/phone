import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SeaPreview } from './SeaPreview';

jest.mock('@/components/CatSprite', () => ({ CatSprite: () => null }));
jest.mock('./SeaDeparture', () => ({ SeaDeparture: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

test('항해 준비창이 열리면 배경 버튼을 숨기고 닫으면 탐색을 복원한다', async () => {
  const location = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', { configurable: true, value: { search: '?sea' } });
  try {
    const screen = await render(<SeaPreview />);
    await fireEvent.press(screen.getByLabelText('망원경'));
    expect(screen.queryByLabelText('망원경')).toBeNull();
    expect(screen.queryByLabelText('이모트')).toBeNull();
    expect(screen.queryByLabelText('떠 있는 중')).toBeNull();
    expect(screen.getByLabelText('항해 시작')).toBeEnabled();
    await fireEvent.press(screen.getByLabelText('닫기'));
    expect(screen.getByLabelText('망원경')).toBeEnabled();
    expect(screen.getByLabelText('떠 있는 중')).toBeEnabled();
    await screen.unmount();
  } finally {
    if (location) Object.defineProperty(window, 'location', location);
    else Reflect.deleteProperty(window, 'location');
  }
});
