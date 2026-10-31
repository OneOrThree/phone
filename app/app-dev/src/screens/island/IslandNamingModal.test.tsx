import { applyLocalePref } from '@/i18n';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { IslandNamingModal } from './IslandNamingModal';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// 이름 저장은 PATCH /islands/{id} — 서버 대신 목으로 호출만 검증한다(ISLAND_NAME_MAX 등 상수는 실제 값 유지)
const mockManage = jest.fn((_islandId: string, _patch: unknown, _key: string): Promise<any> =>
  Promise.resolve({}),
);
jest.mock('@/services/api/islandManagement', () => ({
  ...jest.requireActual('@/services/api/islandManagement'),
  manageIsland: (islandId: string, patch: unknown, key: string) => mockManage(islandId, patch, key),
}));
beforeEach(() => mockManage.mockClear());
afterEach(() => applyLocalePref('system'));

test('이름이 비어 있으면 저장할 수 없다(공백만도 비활성)', async () => {
  const onDone = jest.fn();
  const screen = await render(<IslandNamingModal islandId="i-new" onDone={onDone} />);
  const save = screen.getByText('저장하고 입장');
  await fireEvent.press(save);
  expect(mockManage).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByTestId('island-naming-input'), '   ');
  await fireEvent.press(save);
  expect(mockManage).not.toHaveBeenCalled();
});

test('이름을 저장하면 PATCH 로 공백을 다듬어 보내고 성공 시 모달을 닫는다', async () => {
  const onDone = jest.fn();
  const screen = await render(<IslandNamingModal islandId="i-new" onDone={onDone} />);
  await fireEvent.changeText(screen.getByTestId('island-naming-input'), '  파도섬  ');
  await fireEvent.press(screen.getByText('저장하고 입장'));
  expect(mockManage).toHaveBeenCalledTimes(1);
  expect(mockManage).toHaveBeenCalledWith('i-new', { name: '파도섬' }, expect.any(String));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
});

test('저장에 실패하면 모달을 닫지 않고 같은 멱등 키로 다시 시도할 수 있다', async () => {
  mockManage.mockRejectedValueOnce(new Error('network'));
  const onDone = jest.fn();
  const screen = await render(<IslandNamingModal islandId="i-new" onDone={onDone} />);
  await fireEvent.changeText(screen.getByTestId('island-naming-input'), '해초섬');
  await fireEvent.press(screen.getByText('저장하고 입장'));
  await waitFor(() =>
    expect(screen.getByText('이름을 저장하지 못했어요. 다시 눌러 주세요.')).toBeTruthy(),
  );
  expect(onDone).not.toHaveBeenCalled();
  const firstKey = mockManage.mock.calls[0][2];
  await fireEvent.press(screen.getByText('저장하고 입장'));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(mockManage.mock.calls[1][2]).toBe(firstKey);
});
