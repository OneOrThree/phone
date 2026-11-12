import { configureIOSScreenTime } from './screenTimeSetup';
import { screenTime } from './screenTime';
import { screenTimeMeasurementChanged } from './screenTimeEvents';

jest.mock('./screenTimeEvents', () => ({ screenTimeMeasurementChanged: jest.fn() }));

jest.mock('./screenTime', () => ({
  ...jest.requireActual('./screenTime'),
  screenTime: {
    getAllowedSelectionCounts: jest.fn(),
    getMeasurementSelectionCounts: jest.fn(),
    presentAppPicker: jest.fn(),
    promoteSelection: jest.fn(),
    getUnconfirmedUsageBucketDays: jest.fn(),
    getTodayUsageBucketMinutes: jest.fn(),
    presentAllowedAppManager: jest.fn(),
  },
}));
const native = jest.mocked(screenTime);
const selected = { applications: 2, categories: 0, webDomains: 0 };
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  native.getAllowedSelectionCounts.mockResolvedValue(null);
  native.getMeasurementSelectionCounts.mockResolvedValue(null);
  native.presentAppPicker.mockResolvedValue({ ...selected, appliesImmediately: true });
  native.presentAllowedAppManager.mockResolvedValue({ ...selected, applications: 0 });
  native.promoteSelection.mockResolvedValue(true);
  native.getUnconfirmedUsageBucketDays.mockResolvedValue([]);
  native.getTodayUsageBucketMinutes.mockResolvedValue(0);
});
afterEach(() => jest.useRealTimers());
async function run(mode: 'setup' | 'measurement' = 'setup') {
  const pending = configureIOSScreenTime({ mode, current: () => true });
  await jest.runAllTimersAsync();
  return pending;
}

test('명시적으로 빈 허용 목록을 저장해도 완료이며 최초 측정 활성화가 먼저 끝난다', async () => {
  await expect(run()).resolves.toBe(true);
  expect(native.promoteSelection.mock.invocationCallOrder[0]).toBeLessThan(
    native.presentAllowedAppManager.mock.invocationCallOrder[0],
  );
});

test('측정 저장만 마치면 허용 앱 선택을 취소해도 즉시 서버 동기화를 요청한다', async () => {
  native.presentAllowedAppManager.mockResolvedValue(null);
  await expect(run()).resolves.toBe(false);
  expect(screenTimeMeasurementChanged).toHaveBeenCalledTimes(1);
  expect(jest.mocked(screenTimeMeasurementChanged).mock.invocationCallOrder[0]).toBeLessThan(
    native.presentAllowedAppManager.mock.invocationCallOrder[0],
  );
});

test('측정 앱 선택을 취소하면 전송을 시작하지 않는다', async () => {
  native.presentAppPicker.mockResolvedValue(null);
  await expect(run()).resolves.toBe(false);
  expect(screenTimeMeasurementChanged).not.toHaveBeenCalled();
  expect(native.presentAllowedAppManager).not.toHaveBeenCalled();
});

test('측정 저장 뒤 활성화 실패로 남은 선택은 다음 설정에서 복구한다', async () => {
  native.getMeasurementSelectionCounts.mockResolvedValue({
    ...selected,
    applications: 0,
    pendingSelection: { ...selected, pending: false },
  });
  await expect(run()).resolves.toBe(true);
  expect(native.promoteSelection).toHaveBeenCalledTimes(1);
  expect(native.presentAppPicker).not.toHaveBeenCalled();
  expect(screenTimeMeasurementChanged).toHaveBeenCalledTimes(1);
});

test('내일부터 적용되는 수정 목록은 즉시 승격하지 않고 기존 측정 대상을 유지한다', async () => {
  native.getMeasurementSelectionCounts.mockResolvedValue({
    ...selected,
    pendingSelection: { ...selected, applications: 3, pending: true },
  });
  await expect(run()).resolves.toBe(true);
  expect(native.promoteSelection).not.toHaveBeenCalled();
});

test('두 설정을 마친 사용자의 측정 목록 수정은 허용 목록을 다시 열지 않는다', async () => {
  native.getMeasurementSelectionCounts.mockResolvedValue(selected);
  native.getAllowedSelectionCounts.mockResolvedValue({ ...selected, applications: 0 });
  native.presentAppPicker.mockResolvedValue({
    ...selected,
    pending: true,
    appliesImmediately: false,
  });
  await expect(run('measurement')).resolves.toBe(true);
  expect(native.presentAppPicker).toHaveBeenCalledTimes(1);
  expect(native.presentAllowedAppManager).not.toHaveBeenCalled();
});

test('기록 화면은 허용 목록이 미설정이어도 측정 목록을 먼저 수정할 수 있다', async () => {
  native.getMeasurementSelectionCounts.mockResolvedValue(selected);
  await expect(run('measurement')).resolves.toBe(true);
  expect(native.presentAppPicker).toHaveBeenCalledTimes(1);
  expect(native.presentAllowedAppManager).toHaveBeenCalledTimes(1);
});

test('활성화 실패는 허용 앱 단계로 넘어가지 않는다', async () => {
  native.promoteSelection.mockResolvedValue(false);
  await expect(configureIOSScreenTime({ mode: 'setup', current: () => true })).rejects.toThrow(
    'measurement activation failed',
  );
  expect(native.presentAllowedAppManager).not.toHaveBeenCalled();
  expect(screenTimeMeasurementChanged).not.toHaveBeenCalled();
});

test('측정 피커 응답 전 계정이 바뀌면 활성화·허용 피커를 실행하지 않는다', async () => {
  let current = true;
  native.presentAppPicker.mockImplementation(async () => {
    current = false;
    return { ...selected, appliesImmediately: true };
  });
  await expect(configureIOSScreenTime({ mode: 'setup', current: () => current })).resolves.toBe(
    false,
  );
  expect(native.promoteSelection).not.toHaveBeenCalled();
  expect(native.presentAllowedAppManager).not.toHaveBeenCalled();
  expect(screenTimeMeasurementChanged).not.toHaveBeenCalled();
});
