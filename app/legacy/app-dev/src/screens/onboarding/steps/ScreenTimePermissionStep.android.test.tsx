// 안드로이드 온보딩 권한 승인 경로 — GROMO-1593 코드리뷰 3차.
//
// 여기서 잠그는 건 하나다: **승인하면 측정 등록이 반드시 돈다.**
//
// 안드로이드는 측정 대상을 고르지 않는다(결정 D4 — '미설정 = 전체 앱 측정'이 계약이다).
// 그런데 '고르지 않는다'와 '등록하지 않는다'를 헷갈려서, 이 경로가 `registerUsageBucketMonitoring`
// 까지 건너뛰고 있었다. 등록 마커와 측정 시작일 앵커가 안 남으면 **온보딩을 마쳐도 측정이
// 시작되지 않는다** — ScreenTimeSyncer 가 마운트될 때까지, 도중에 이탈하면 아예.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import ScreenTimePermissionStep from './ScreenTimePermissionStep';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { registerUsageBucketMonitoring } from '@/services/screentimeSync';
import { INITIAL_ONBOARDING_DATA } from '@/screens/onboarding/types';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    requestAuthorization: jest.fn(),
    getAuthorizationStatus: jest.fn(),
    presentAppPicker: jest.fn(),
    promoteSelection: jest.fn(),
    getSystemColorScheme: jest.fn(),
  },
}));

jest.mock('@/services/screentimeSync', () => ({
  registerUsageBucketMonitoring: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logOnboardingPermissionRequested: jest.fn(),
  logOnboardingPermissionResulted: jest.fn(),
}));

const mockRegister = registerUsageBucketMonitoring as jest.MockedFunction<
  typeof registerUsageBucketMonitoring
>;
const mockRequest = ScreenTimeModule.requestAuthorization as jest.Mock;

const originalPlatformOS = Platform.OS;
const setPlatform = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const onNext = jest.fn();

async function pressAllow() {
  await act(async () => {
    render(
      <ScreenTimePermissionStep
        data={INITIAL_ONBOARDING_DATA}
        update={jest.fn()}
        onNext={onNext}
      />,
    );
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('onboarding.screentime.allow'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('android');
  mockRequest.mockResolvedValue(true);
  mockRegister.mockResolvedValue(true);
});

afterEach(() => setPlatform(originalPlatformOS));

test('권한을 허용하면 측정 등록이 돈다', async () => {
  await pressAllow();

  expect(mockRegister).toHaveBeenCalled();
  expect(onNext).toHaveBeenCalled();
});

// 측정 대상 피커는 iOS 전용이다 — 안드로이드에서 부르면 null 을 돌려받아 조용히 끝난다.
// 그 호출에 등록을 매달아 뒀던 게 이번 버그의 원인이었다.
test('안드로이드에서는 iOS 시스템 피커를 부르지 않는다', async () => {
  await pressAllow();

  expect(ScreenTimeModule.presentAppPicker).not.toHaveBeenCalled();
});

// 거부하면 측정할 게 없다 — 등록도 하지 않는다.
test('권한이 거부되면 등록하지 않는다', async () => {
  mockRequest.mockResolvedValue(false);

  await pressAllow();

  expect(mockRegister).not.toHaveBeenCalled();
  expect(onNext).toHaveBeenCalled();
});
