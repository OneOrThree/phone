import React from 'react';
import ScreenTimeReportView from './ScreenTimeReportView';
import { cleanup, render } from '@testing-library/react-native';
import { Platform, UIManager, requireNativeComponent } from 'react-native';

jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  // RN의 지연 getter를 spread로 평가하면 Jest 환경에 없는 모듈까지 로드된다.
  const mock = Object.create(native);
  Object.defineProperties(mock, {
    requireNativeComponent: { value: jest.fn(() => 'ScreenTimeNativeReport') },
    UIManager: { value: { getViewManagerConfig: jest.fn() } },
  });
  return mock;
});
jest.mock('@/design-system/patterns', () => ({ Txt: 'Text' }));

const originalOS = Platform.OS;
afterEach(() => {
  cleanup();
  Platform.OS = originalOS;
  jest.clearAllMocks();
});

function loadReport(os: typeof Platform.OS, installed: boolean) {
  Platform.OS = os;
  // RN 타입에는 null이 빠져 있지만 미등록 뷰는 실제로 null을 반환한다.
  (UIManager.getViewManagerConfig as jest.Mock).mockReturnValue(
    installed ? { Commands: {} } : null,
  );
  return ScreenTimeReportView;
}

test('미탑재 iOS 바이너리는 네이티브 뷰를 요청하지 않고 미지원 상태를 표시한다', async () => {
  const Report = loadReport('ios', false);
  const screen = await render(<Report />);
  expect(screen.getByText('사용량 리포트를 사용할 수 없어요')).toBeTruthy();
  expect(requireNativeComponent).not.toHaveBeenCalled();
});

test.each(['android', 'web'] as const)('%s는 iOS 네이티브 뷰를 조회하지 않는다', async (os) => {
  const Report = loadReport(os, true);
  const screen = await render(<Report />);
  expect(screen.getByText('사용량 리포트를 사용할 수 없어요')).toBeTruthy();
  expect(UIManager.getViewManagerConfig).not.toHaveBeenCalled();
  expect(requireNativeComponent).not.toHaveBeenCalled();
});

test('날짜와 목표 변경을 전달하고 미설정 목표를 0초로 바꾸지 않는다', async () => {
  const Report = loadReport('ios', true);
  const screen = await render(<Report testID="report" />);
  expect(screen.getByTestId('report').props.goalSeconds).toBe(-1);
  await screen.rerender(
    <Report testID="report" reportContext="Remaining Activity" dayOffset={-1} goalSeconds={0} />,
  );
  expect(screen.getByTestId('report').props).toMatchObject({
    reportContext: 'Remaining Activity',
    dayOffset: -1,
    goalSeconds: 0,
  });
});
