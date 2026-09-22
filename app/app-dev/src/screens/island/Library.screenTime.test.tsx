import React from 'react';
import { Platform } from 'react-native';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Library } from './Library';
import { RedesignScreens } from './Screens';
import { initialState } from '@/services/model';
import {
  getFocusStatistics,
  getLibraryScreen,
  getScreenTimeStatistics,
  type MeasurementStatus,
} from '@/services/api/records';

jest.mock('@/services/api/records', () => ({
  ...jest.requireActual('@/services/api/records'),
  getLibraryScreen: jest.fn(),
  getFocusStatistics: jest.fn(),
  getScreenTimeStatistics: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 52, bottom: 32, left: 0, right: 0 }),
}));

jest.mock('@/components/ScreenTimeReportView', () => 'ScreenTimeReportView');
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    landscape: false,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
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

test.each(['뒤로', '책 덮기'])('일기장의 %s는 기존 경로를 pop한다', async (label) => {
  const e = environment();
  const screen = await render(<Library e={e} />);
  await fireEvent.press(screen.getByLabelText(label));
  expect(e.back).toHaveBeenCalledTimes(1);
  expect(e.go).not.toHaveBeenCalled();
});

test('이번 주 진입 집계를 재사용하고 진행 중 집중만 있는 날은 시간대 미제공을 표시한다', async () => {
  const e = { ...environment(), tab: '', islands: [], now: Date.now() };
  const date = new Date(e.now).toISOString().slice(0, 10);
  const focus = {
    scope: 'me' as const,
    totalSeconds: 600,
    series: [{ date, seconds: 600 }],
    records: [],
    nextCursor: null,
  };
  const usage = {
    scope: 'me' as const,
    measurementStatus: 'authorized' as const,
    totalMinutes: 10,
    series: [],
    updatedAt: null,
  };
  jest.mocked(getLibraryScreen).mockResolvedValue({
    island: { id: e.state.islandId, name: '섬', role: 'owner' },
    statisticsAvailability: 'available',
    focusStatistics: focus,
    screenTimeStatistics: usage,
    fishEarnings: { members: [] },
    missingFragments: [],
  });
  (getFocusStatistics as jest.Mock).mockResolvedValue(focus);
  (getScreenTimeStatistics as jest.Mock).mockResolvedValue(usage);
  const screen = await render(<Library e={e} />);
  await waitFor(() => expect(screen.getByText('집중한 날')).toBeTruthy());
  expect(getLibraryScreen).toHaveBeenCalledTimes(1);
  expect(getFocusStatistics).not.toHaveBeenCalled();
  expect(getScreenTimeStatistics).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText('일'));
  await waitFor(() => expect(screen.getByText('시간대 기록 없음')).toBeTruthy());
  expect(screen.queryByLabelText('6시 0분')).toBeNull();
});

test.each(
  (
    [
      ['denied', '측정 권한이 꺼져 있어요'],
      ['pending', '기록을 준비하고 있어요'],
      ['unavailable', '폰 사용 기록을 이용할 수 없어요'],
      [null, '기록을 준비하고 있어요'],
    ] as const
  ).flatMap(([status, title]) =>
    [true, false].map((permission) => ({ status, title, permission })),
  ),
)('서버 측정 상태를 로컬 권한보다 우선한다: %j', async ({ status, title, permission }) => {
  const e = { ...environment({ permission, ready: permission }), tab: '', islands: [] };
  const usage = status
    ? {
        scope: 'me' as const,
        measurementStatus: status as MeasurementStatus,
        totalMinutes: null,
        series: [],
        updatedAt: null,
      }
    : null;
  jest.mocked(getLibraryScreen).mockResolvedValue({
    island: { id: e.state.islandId, name: '섬', role: 'owner' },
    statisticsAvailability: 'available',
    focusStatistics: null,
    screenTimeStatistics: usage,
    fishEarnings: { members: [] },
    missingFragments: usage ? ['focusStatistics'] : ['focusStatistics', 'screenTimeStatistics'],
  });
  const screen = await render(<Library e={e} />);
  await fireEvent.press(screen.getByLabelText('폰 사용'));
  await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
  if (status === 'denied') {
    await fireEvent.press(screen.getByText('측정 설정 열기'));
    expect(e.go).toHaveBeenCalledWith('permission');
  } else {
    expect(screen.queryByText('측정 설정 열기')).toBeNull();
    expect(e.go).not.toHaveBeenCalled();
  }
  expect(screen.queryByTestId('today-screen-time-report')).toBeNull();
});

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

test.each(['diary', 'stats'])(
  'Android %s 화면은 전날 수치를 숨기고 오늘 0분을 표시한다',
  async (route) => {
    Platform.OS = 'android';
    const e = { ...environment(), route, now: Date.parse('2026-09-23T00:00:01+09:00') };
    e.state.screenDays = {};
    e.state.screenMinutes = 777;
    e.state.settings.screenTimeMeasurementDay = '2026-09-22';
    const view = () => (route === 'diary' ? <Library e={e} /> : <RedesignScreens e={e} />);
    const screen = await render(view());
    expect(screen.queryByText('777분')).toBeNull();
    e.state.settings.screenTimeMeasurementDay = '2026-09-23';
    e.state.screenMinutes = 0;
    await screen.rerender(view());
    expect(screen.getByText('0분')).toBeTruthy();
  },
);
