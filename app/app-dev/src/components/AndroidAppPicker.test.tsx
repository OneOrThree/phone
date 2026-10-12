import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AndroidAppPicker } from './AndroidAppPicker';
import { screenTimeNative } from '@/services/ScreenTimeModule';
import { getSession, sessionGeneration } from '@/services/api/session';

jest.mock('@/services/ScreenTimeModule', () => ({
  screenTimeNative: {
    bindMeasurementOwner: jest.fn(),
    getInstalledApps: jest.fn(),
    getAndroidSelection: jest.fn(),
    getAllowedPackages: jest.fn(),
    setAndroidSelection: jest.fn(),
    setAndroidAllowedPackages: jest.fn(),
  },
}));
jest.mock('@/services/api/session', () => ({
  getSession: jest.fn(),
  sessionGeneration: jest.fn(),
}));
jest.mock('@/services/androidScreenTime', () => ({ syncAndroidMeasurement: jest.fn() }));
jest.mock('@/design-system/patterns', () => {
  const { Text, View, Pressable, TextInput } = require('react-native');
  return {
    Txt: Text,
    Group: View,
    Row: ({ title, tail }: any) => (
      <View>
        <Text>{title}</Text>
        {tail}
      </View>
    ),
    Btn: ({ title, onPress, disabled }: any) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        disabled={disabled}
      >
        <Text>{title}</Text>
      </Pressable>
    ),
    Toggle: ({ label, value, onChange, disabled }: any) => (
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        onPress={() => onChange(!value)}
      />
    ),
    Field: ({ label, value, onChange }: any) => (
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} />
    ),
  };
});

const native = screenTimeNative as jest.Mocked<Required<NonNullable<typeof screenTimeNative>>>;
beforeEach(() => {
  jest.resetAllMocks();
  (getSession as jest.Mock).mockReturnValue({ userId: 'owner' });
  (sessionGeneration as jest.Mock).mockReturnValue(1);
  native.getInstalledApps.mockResolvedValue([
    { label: '동영상', packageName: 'video.app' },
    { label: '음악', packageName: 'music.app' },
  ]);
  native.getAndroidSelection.mockResolvedValue({
    configured: false,
    allApps: false,
    packages: [],
    pending: false,
  });
  native.getAllowedPackages.mockResolvedValue([]);
  native.setAndroidSelection.mockResolvedValue({
    configured: true,
    allApps: false,
    packages: ['video.app'],
    pending: true,
  });
  const { syncAndroidMeasurement } = require('@/services/androidScreenTime');
  syncAndroidMeasurement.mockResolvedValue(undefined);
});
afterEach(cleanup);

test('검색으로 고른 측정 앱을 현재 계정에 저장하고 예약 적용을 알린다', async () => {
  const notify = jest.fn(),
    done = jest.fn();
  const screen = await render(<AndroidAppPicker mode="measured" notify={notify} onDone={done} />);
  await screen.findByText('동영상');
  await fireEvent.changeText(screen.getByLabelText('앱 검색'), 'video');
  expect(screen.queryByText('음악')).toBeNull();
  await fireEvent.press(screen.getByLabelText('동영상 선택'));
  await fireEvent.press(screen.getByLabelText('선택 저장'));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(native.setAndroidSelection).toHaveBeenCalledWith('owner', ['video.app'], false);
  expect(notify).toHaveBeenCalledWith('측정 앱을 내일부터 적용해요.');
});

test('빈 측정 선택은 저장할 수 없고 전체 앱은 명시적으로 선택한다', async () => {
  const screen = await render(
    <AndroidAppPicker mode="measured" notify={jest.fn()} onDone={jest.fn()} />,
  );
  await screen.findByText('동영상');
  await fireEvent.press(screen.getByLabelText('선택 저장'));
  expect(native.setAndroidSelection).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('전체 앱 측정'));
  await fireEvent.press(screen.getByLabelText('선택 저장'));
  await waitFor(() => expect(native.setAndroidSelection).toHaveBeenCalledWith('owner', [], true));
});

test('허용 앱은 빈 선택을 저장해서 모두 해제할 수 있다', async () => {
  const screen = await render(
    <AndroidAppPicker mode="allowed" notify={jest.fn()} onDone={jest.fn()} />,
  );
  await screen.findByText('동영상');
  await fireEvent.press(screen.getByLabelText('선택 저장'));
  await waitFor(() => expect(native.setAndroidAllowedPackages).toHaveBeenCalledWith('owner', []));
  expect(native.setAndroidSelection).not.toHaveBeenCalled();
});

test('피커가 열린 뒤 계정이 바뀌면 이전 선택을 저장하지 않는다', async () => {
  const screen = await render(
    <AndroidAppPicker mode="allowed" notify={jest.fn()} onDone={jest.fn()} />,
  );
  await screen.findByText('동영상');
  (sessionGeneration as jest.Mock).mockReturnValue(2);
  (getSession as jest.Mock).mockReturnValue({ userId: 'other' });
  await fireEvent.press(screen.getByLabelText('선택 저장'));
  expect(native.setAndroidAllowedPackages).not.toHaveBeenCalled();
});

test('목록 조회 실패 후 다시 시도할 수 있다', async () => {
  native.getInstalledApps.mockRejectedValueOnce(new Error('UNAVAILABLE'));
  const screen = await render(
    <AndroidAppPicker mode="allowed" notify={jest.fn()} onDone={jest.fn()} />,
  );
  await screen.findByText('설치된 앱 목록을 불러오지 못했어요.');
  await fireEvent.press(screen.getByLabelText('다시 시도'));
  await screen.findByText('동영상');
});
