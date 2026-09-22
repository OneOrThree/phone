import React from 'react';
import { Platform } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import { Library } from './Library';
import { initialState } from '@/services/model';

jest.mock('@/components/ScreenTimeReportView', () => 'ScreenTimeReportView');
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    landscape: false,
    insets: { top: 52, bottom: 32 },
  }),
}));
jest.mock('./sceneKit', () => ({
  ...jest.requireActual('./sceneKit'),
  useGowun: () => undefined,
}));

const originalOS = Platform.OS;
afterEach(() => {
  cleanup();
  Platform.OS = originalOS;
});

function environment({ permission = true, ready = true, neighbors = false } = {}) {
  const state = initialState(true);
  state.settings.permission = permission;
  state.settings.screenTimeMeasurementReady = ready;
  return {
    state,
    route: 'diary',
    tab: 'screen',
    detail: neighbors ? 'residents' : '',
    body: '',
    now: Date.now(),
    go: jest.fn(),
    back: jest.fn(),
    home: jest.fn(),
  };
}

test('내 일기장에는 이력이 비어 있어도 iOS 오늘 리포트를 표시한다', async () => {
  Platform.OS = 'ios';
  const e = environment();
  e.state.screenDays = {};
  const screen = await render(<Library e={e} />);
  expect(screen.getByTestId('today-screen-time-report')).toBeTruthy();
});

test.each([{ permission: false }, { ready: false }, { neighbors: true }])(
  '권한/선택 없음 또는 이웃 기록에 내 기기 사용량을 표시하지 않는다: %j',
  async (options) => {
    Platform.OS = 'ios';
    const screen = await render(<Library e={environment(options)} />);
    expect(screen.queryByTestId('today-screen-time-report')).toBeNull();
  },
);

test('Android 기록은 iOS 리포트를 생성하지 않는다', async () => {
  Platform.OS = 'android';
  const screen = await render(<Library e={environment()} />);
  expect(screen.queryByTestId('today-screen-time-report')).toBeNull();
});
