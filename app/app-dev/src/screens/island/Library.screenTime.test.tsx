import React from 'react';
import { Platform, ScrollView } from 'react-native';
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

test('일기장의 뒤로는 기존 경로를 pop하고, 같은 일을 하던 책 덮기(×)는 두지 않는다', async () => {
  const e = environment();
  const screen = await render(<Library e={e} />);
  expect(screen.queryByLabelText('책 덮기')).toBeNull();
  await fireEvent.press(screen.getByLabelText('뒤로'));
  expect(e.back).toHaveBeenCalledTimes(1);
  expect(e.go).not.toHaveBeenCalled();
});

test('이웃 상세에서 목록으로 돌아가면 스크롤을 맨 위로 초기화한다', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  const screen = await render(<Library e={environment({ neighbors: true })} />);
  await fireEvent.press(screen.getByTestId('diary-member-minji'));
  scrollTo.mockClear();

  await fireEvent.press(screen.getByLabelText('뒤로'));
  expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  expect(screen.getByTestId('diary-member-minji')).toBeTruthy();
  scrollTo.mockRestore();
});

test('이번 주 진입 집계를 재사용하고 진행 중 집중만 있는 날은 시간대 미제공을 표시한다', async () => {
  const e = { ...environment(), tab: '', islands: [], now: Date.now() };
  const date = new Date(e.now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
    ] as const
  ).flatMap(([status, title]) =>
    [true, false].map((permission) => ({ status, title, permission })),
  ),
)(
  '권한 철회는 숨기되 서버 대기 상태에서도 오늘의 기기 측정값을 표시한다: %j',
  async ({ status, title, permission }) => {
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
    if (usage) (getScreenTimeStatistics as jest.Mock).mockResolvedValue(usage);
    const screen = await render(<Library e={e} />);
    await fireEvent.press(screen.getByLabelText('일'));
    await fireEvent.press(screen.getByLabelText('폰 사용'));
    if (permission && status !== 'denied') {
      await waitFor(() => expect(screen.getByTestId('today-screen-time-report')).toBeTruthy());
      return;
    }
    await waitFor(() =>
      expect(
        screen.getByText(
          !permission || status === 'denied' ? '스크린타임 권한을 허용해 주세요' : title,
        ),
      ).toBeTruthy(),
    );
    if (!permission || status === 'denied') {
      await fireEvent.press(screen.getByText('권한 설정하기'));
      expect(e.go).toHaveBeenCalledWith('permission');
    } else {
      expect(screen.queryByText('측정 설정 열기')).toBeNull();
      expect(e.go).not.toHaveBeenCalled();
    }
    expect(screen.queryByTestId('today-screen-time-report')).toBeNull();
  },
);

test.each(['pending', 'unavailable'] as const)(
  '기간 상태가 %s여도 주·월의 과거 허용 측정값은 표시한다',
  async (status) => {
    const e = {
      ...environment(),
      tab: '',
      islands: [],
      now: Date.parse('2026-09-22T12:00:00+09:00'),
    };
    const focus = {
      scope: 'me' as const,
      totalSeconds: 0,
      series: [],
      records: [],
      nextCursor: null,
    };
    const usage = {
      scope: 'me' as const,
      measurementStatus: status,
      totalMinutes: null,
      series: [
        {
          date: '2026-09-21',
          minutes: 90,
          measurementStatus: 'authorized' as const,
          updatedAt: null,
        },
        { date: '2026-09-22', minutes: null, measurementStatus: status, updatedAt: null },
      ],
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
    await fireEvent.press(screen.getByLabelText('폰 사용'));
    await waitFor(() => expect(screen.getByLabelText('9월 21일 월요일 90분')).toBeTruthy());
    expect(screen.getByLabelText('9월 22일 화요일 기록 없음')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('월'));
    await waitFor(() => expect(screen.getByLabelText('9월 21일 월요일')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('9월 21일 월요일'));
    await waitFor(() => expect(screen.getByText('1시간 30분')).toBeTruthy());
    expect(screen.queryByTestId('today-screen-time-report')).toBeNull();
  },
);

test.each(['ios', 'android'] as const)(
  '월간 %s는 서버에 아직 수치가 없어도 권한이 있는 기기의 오늘 수치를 표시한다',
  async (os) => {
    Platform.OS = os;
    for (const status of ['denied', 'pending', 'unavailable', 'authorized'] as const) {
      const e = {
        ...environment(),
        tab: '',
        islands: [],
        now: Date.parse('2026-09-22T12:00:00+09:00'),
      };
      e.state.screenMinutes = 777;
      e.state.settings.screenTimeMeasurementDay = '2026-09-22';
      const focus = {
        scope: 'me' as const,
        totalSeconds: 0,
        series: [],
        records: [],
        nextCursor: null,
      };
      const usage = {
        scope: 'me' as const,
        measurementStatus: status,
        totalMinutes: null,
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
      await waitFor(() => expect(screen.queryByText('기록을 불러오지 못했어요')).toBeNull());
      await fireEvent.press(screen.getByLabelText('월'));
      await waitFor(() => expect(screen.getByText('폰 사용')).toBeTruthy());
      const native =
        os === 'ios'
          ? screen.queryByTestId('today-screen-time-report')
          : screen.queryByText('12시간 57분');
      if (status !== 'denied') expect(native).toBeTruthy();
      else expect(native).toBeNull();
      await cleanup();
    }
  },
);

test.each(['집중', '폰 사용'])('일·주 %s는 선택하지 않은 통계를 조회하지 않는다', async (tab) => {
  const e = { ...environment(), tab: '', islands: [] };
  const focus = {
    scope: 'me' as const,
    totalSeconds: 600,
    series: [],
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
  const selected = (tab === '집중' ? getFocusStatistics : getScreenTimeStatistics) as jest.Mock;
  const other = (tab === '집중' ? getScreenTimeStatistics : getFocusStatistics) as jest.Mock;
  selected.mockResolvedValue(tab === '집중' ? focus : usage);
  other.mockRejectedValue(new Error('선택하지 않은 통계 장애'));
  const screen = await render(<Library e={e} />);
  await waitFor(() => expect(screen.getByText('집중한 날')).toBeTruthy());
  if (tab === '폰 사용') await fireEvent.press(screen.getByLabelText(tab));
  await fireEvent.press(screen.getByLabelText('이전 기간'));
  await waitFor(() =>
    expect(screen.getByText(tab === '집중' ? '집중한 날' : '이번 주 폰 사용')).toBeTruthy(),
  );
  expect(selected).toHaveBeenCalled();
  expect(other).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('일'));
  await waitFor(() =>
    expect(screen.getByText(tab === '집중' ? '시간대 기록 없음' : '이날의 폰 사용')).toBeTruthy(),
  );
  expect(selected).toHaveBeenCalled();
  expect(other).not.toHaveBeenCalled();
  expect(screen.queryByText('기록을 불러오지 못했어요')).toBeNull();
});

test('로컬 주간 집중 횟수는 선택 주의 세션만 센다', async () => {
  const e = { ...environment(), tab: '', now: Date.parse('2026-09-22T12:00:00+09:00') };
  e.state.records = ['2026-09-15', '2026-09-21'].map((date) => ({
    id: date,
    islandId: e.state.islandId,
    subject: '수학',
    seconds: 600,
    at: Date.parse(`${date}T12:00:00+09:00`),
    fish: 1,
    contributed: true,
  }));
  const screen = await render(<Library e={e} />);
  expect(screen.getByText('1회')).toBeTruthy();
  expect(screen.queryByText('2회')).toBeNull();
  await fireEvent.press(screen.getByLabelText('이전 기간'));
  expect(screen.getByText('1회')).toBeTruthy();
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

test.each([false, true])(
  '주간 폰 사용은 현재 기기 권한이 없으면 합산 보류 대신 설정을 안내한다: 서버=%s',
  async (server) => {
    const e = {
      ...environment({ permission: false, ready: false }),
      tab: '',
      ...(server ? { islands: [] } : {}),
    };
    jest.mocked(getLibraryScreen).mockResolvedValue({
      island: { id: e.state.islandId, name: '섬', role: 'owner' },
      statisticsAvailability: 'available',
      focusStatistics: null,
      screenTimeStatistics: {
        scope: 'me',
        measurementStatus: 'authorized',
        totalMinutes: null,
        series: [],
        updatedAt: null,
      },
      fishEarnings: { members: [] },
      missingFragments: ['focusStatistics'],
    });
    const screen = await render(<Library e={e} />);
    await fireEvent.press(screen.getByLabelText('폰 사용'));
    expect(screen.getByText('스크린타임 권한을 허용해 주세요')).toBeTruthy();
    expect(screen.queryByText('합산 보류')).toBeNull();
    await fireEvent.press(screen.getByText('권한 설정하기'));
    expect(e.go).toHaveBeenCalledWith('permission');
  },
);

test('권한 허용 후 측정 앱 선택이 없으면 선택 안내로 구분한다', async () => {
  const screen = await render(<Library e={environment({ ready: false })} />);
  expect(screen.getByText('측정할 앱을 선택해 주세요')).toBeTruthy();
  expect(screen.queryByText('합산 보류')).toBeNull();
});

test('빈 집중 기록에서 집중 시작 버튼을 빼고 과거 날짜의 오늘 기록 이동은 유지한다', async () => {
  const e = { ...environment(), tab: '' };
  e.state.records = [];
  const screen = await render(<Library e={e} />);
  expect(screen.getAllByTestId(/^diary-weekday-/)).toHaveLength(7);
  await fireEvent.press(screen.getByLabelText('일'));
  expect(screen.getByText('이날은 기록이 없어요')).toBeTruthy();
  expect(screen.queryByText('집중하러 가기')).toBeNull();
  await fireEvent.press(screen.getByLabelText('이전 기간'));
  await fireEvent.press(screen.getByText('오늘 기록으로'));
  expect(screen.getByText('이날은 기록이 없어요')).toBeTruthy();
  expect(e.go).not.toHaveBeenCalled();
});

test.each([
  { tab: '집중', permission: true, ready: true },
  { tab: '폰 사용', permission: true, ready: true },
  { tab: '폰 사용', permission: false, ready: false },
  { tab: '폰 사용', permission: true, ready: false },
])('빈 주간 그래프도 일~토 7칸과 미래 날짜를 유지한다: %j', async ({ tab, permission, ready }) => {
  const e = {
    ...environment({ permission, ready }),
    tab: '',
    now: Date.parse('2026-09-22T12:00:00+09:00'),
  };
  e.state.records = [];
  e.state.screenDays = {};
  const screen = await render(<Library e={e} />);
  if (tab === '폰 사용') await fireEvent.press(screen.getByLabelText(tab));
  const labels = screen.getAllByTestId(/^diary-weekday-/);
  expect(labels.map((node) => node.props.children)).toEqual([
    '일',
    '월',
    '화',
    '수',
    '목',
    '금',
    '토',
  ]);
  expect(labels.map((node) => node.props.testID)).toEqual(
    [20, 21, 22, 23, 24, 25, 26].map((day) => `diary-weekday-2026-09-${day}`),
  );
  expect(screen.getByLabelText('9월 26일 토요일 기록 없음')).toBeTruthy();
});

test('폰 사용 그래프는 7칸이지만 하루 평균과 측정 날짜는 오늘까지의 날짜로 계산한다', async () => {
  const e = { ...environment(), tab: '', now: Date.parse('2026-09-22T12:00:00+09:00') };
  e.state.screenDays = { '2026-09-20': 30, '2026-09-21': 30, '2026-09-22': 30 };
  const screen = await render(<Library e={e} />);
  await fireEvent.press(screen.getByLabelText('폰 사용'));
  expect(screen.getAllByTestId(/^diary-weekday-/)).toHaveLength(7);
  expect(screen.getByText('1시간 30분')).toBeTruthy();
  expect(screen.getAllByText('30분').length).toBeGreaterThan(0);
  expect(screen.getByText('3 / 3일')).toBeTruthy();
});

test.each([0, 7])(
  '일 집중 통계는 서버의 날짜별 실제 적립 물고기 %s마리를 표시한다',
  async (earnedFish) => {
    const e = { ...environment(), tab: '', islands: [] };
    const focus = {
      scope: 'me' as const,
      totalSeconds: 600,
      earnedFish,
      series: [],
      records: [],
      nextCursor: null,
    };
    jest.mocked(getLibraryScreen).mockResolvedValue({
      island: { id: e.state.islandId, name: '섬', role: 'owner' },
      statisticsAvailability: 'available',
      focusStatistics: focus,
      screenTimeStatistics: null,
      fishEarnings: { members: [{ userId: 'me', name: '나', earnedFish: 999 }] },
      missingFragments: ['screenTimeStatistics'],
    });
    (getFocusStatistics as jest.Mock).mockResolvedValue(focus);
    const screen = await render(<Library e={e} />);
    await fireEvent.press(screen.getByLabelText('일'));
    await waitFor(() => expect(screen.getByText(`${earnedFish}마리`)).toBeTruthy());
    expect(screen.queryByText('999마리')).toBeNull();
  },
);

test('집중 기록 없이 체험 보상만 받은 날도 실제 적립 물고기를 표시한다', async () => {
  const e = { ...environment(), tab: '', islands: [] };
  const focus = {
    scope: 'me' as const,
    totalSeconds: 0,
    earnedFish: 1,
    series: [],
    records: [],
    nextCursor: null,
  };
  jest.mocked(getLibraryScreen).mockResolvedValue({
    island: { id: e.state.islandId, name: '섬', role: 'owner' },
    statisticsAvailability: 'available',
    focusStatistics: focus,
    screenTimeStatistics: null,
    fishEarnings: { members: [] },
    missingFragments: ['screenTimeStatistics'],
  });
  (getFocusStatistics as jest.Mock).mockResolvedValue(focus);
  const screen = await render(<Library e={e} />);
  await fireEvent.press(screen.getByLabelText('일'));
  await waitFor(() => expect(screen.getByText('1마리')).toBeTruthy());
  expect(screen.queryByText('이날은 기록이 없어요')).toBeNull();
});
