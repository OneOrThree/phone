// ScreenTimePermissionScreen '측정 대상 앱 설정' 통보 계약 테스트 — GROMO-1491
// (정책 D19 — docs/prd/motion-v2/policy.md, 상위 정본 병합 전까지 여기가 정본).
//
// 여기서 잠그는 것은 **통보 채널이 무엇이냐** 하나다.
//  1) '다음날 적용' 예약 성공(A안 GROMO-942)은 선택지 없는 결과 통보라 tone:'success' 토스트다.
//  2) 단, 새 바이너리(`dismissed`)에서만 그렇다 — 구 바이너리의 presentAppPicker는 피커 모달
//     dismiss 완료를 기다리지 않고 promise를 풀어서, 토스트가 아직 떠 있는 모달 아래에서
//     등장 연출과 2200ms 타이머를 시작한다. 이 JS는 hot-updater로 구 바이너리에도 내려간다.
//     그쪽은 Alert를 그대로 유지한다(GROMO-1381 codex 리뷰가 세운 계약, 아래 '설정 완료'와 동일).
//  3) '측정 대상을 비웠어요'는 성공이지만 측정 중단을 반드시 읽어야 하는 경고성 장문이라
//     2200ms 배너로 옮기지 않는다 — Alert로 남는다(정책 D8).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ScreenTimePermissionScreen from './ScreenTimePermissionScreen';
import ScreenTimeModule, { nativeSupportsPendingApplyDate } from '@/services/ScreenTimeModule';
import { registerUsageBucketMonitoring } from '@/services/screentimeSync';
import { updateScreenTimePermission } from '@/services/userApi';
import { STORAGE_KEYS } from '@/types/storage';

// screenTimeCapabilities 는 ScreenTimeModule 을 거치지 않고 네이티브를 직접 찾는다(그 모듈을
// 통째로 jest.mock 하는 테스트들이 술어까지 지워버리지 않게). 그래서 여기서도 네이티브가
// '있는' 상태를 만들어 줘야 안드로이드 술어가 실제 기기와 같게 열린다.
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  // jest.fn 이어야 테스트가 '구 바이너리'로 갈아끼울 수 있다.
  requireOptionalNativeModule: jest.fn(),
}));

/** 새 바이너리 — 술어가 요구하는 메서드가 다 있다. */
const newBinary = () =>
  jest.mocked(requireOptionalNativeModule).mockReturnValue({
    getUsageByApp: jest.fn(),
    getInstalledApps: jest.fn(),
    getSelectionPackages: jest.fn(),
    startFocusShield: jest.fn(),
  } as never);

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// navigate 는 단언 대상이라 호출마다 새로 만들면 안 된다 — 화면이 부른 목과 테스트가 보는
// 목이 달라져, 이동하지 않아도 통과하는 테스트가 된다.
const mockNavigate = jest.fn();
// 화면을 떠난 뒤 지연된 작업이 끝나는 경우를 재현하려면 포커스도 목이어야 한다.
const mockIsFocused = jest.fn(() => true);

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), isFocused: mockIsFocused }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

jest.mock('@/store/UserContext', () => ({ useUser: () => ({ userId: 'u1' }) }));

// 선택지 없는 결과 통보는 토스트로 나간다 — useToast는 Provider 밖에서 throw하므로 훅 자체를 목으로.
const mockToastShow = jest.fn();
jest.mock('@/store/ToastContext', () => ({ useToast: () => ({ show: mockToastShow }) }));

// 네이티브 스크린타임 모듈 — 실기기에만 구현이 있다. 능력 판별 함수(nativeSupportsPendingApplyDate)도
// NativeModules를 보므로 함께 목으로 둔다.
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    getAuthorizationStatus: jest.fn(),
    requestAuthorization: jest.fn(),
    presentAppPicker: jest.fn(),
    promoteSelection: jest.fn(),
    setPendingSelectionApplyDate: jest.fn(),
    openUsageAccessSettings: jest.fn(),
  },
  androidNativeModuleAvailable: () => false,
  nativeSupportsPendingApplyDate: jest.fn(),
}));

jest.mock('@/services/screentimeSync', () => ({ registerUsageBucketMonitoring: jest.fn() }));
jest.mock('@/services/userApi', () => ({ updateScreenTimePermission: jest.fn() }));

const mockGetStatus = ScreenTimeModule.getAuthorizationStatus as jest.MockedFunction<
  typeof ScreenTimeModule.getAuthorizationStatus
>;
const mockPresentAppPicker = ScreenTimeModule.presentAppPicker as jest.MockedFunction<
  typeof ScreenTimeModule.presentAppPicker
>;
const mockPromote = ScreenTimeModule.promoteSelection as jest.MockedFunction<
  typeof ScreenTimeModule.promoteSelection
>;
const mockSetPendingApplyDate =
  ScreenTimeModule.setPendingSelectionApplyDate as jest.MockedFunction<
    typeof ScreenTimeModule.setPendingSelectionApplyDate
  >;
const mockSupportsPendingApplyDate = nativeSupportsPendingApplyDate as jest.MockedFunction<
  typeof nativeSupportsPendingApplyDate
>;
const mockRegisterMonitoring = registerUsageBucketMonitoring as jest.MockedFunction<
  typeof registerUsageBucketMonitoring
>;

// 이미 측정 중인가 = 버킷 등록 마커 유무. 이 마커가 있어야 '다음날 적용' 예약 분기로 간다.
function setMeasuring(measuring: boolean) {
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
    key === STORAGE_KEYS.screentimeBucketMonitorRegistered && measuring ? '1' : null,
  );
}

async function openPicker() {
  await render(<ScreenTimePermissionScreen />);
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByText('측정 대상 앱 설정'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks 가 반환값까지 지우므로 매번 다시 세운다.
  newBinary();
  mockIsFocused.mockReturnValue(true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetStatus.mockResolvedValue('approved');
  mockPromote.mockResolvedValue(true);
  mockSetPendingApplyDate.mockResolvedValue(true);
  mockRegisterMonitoring.mockResolvedValue(true);
  mockSupportsPendingApplyDate.mockReturnValue(true);
  setMeasuring(true);
});

describe("측정 대상 '다음날 적용' 예약 통보", () => {
  test('새 바이너리(dismissed)에서는 tone:success 토스트로 알린다', async () => {
    mockPresentAppPicker.mockResolvedValue({
      applications: 2,
      categories: 1,
      webDomains: 0,
      dismissed: true,
    });

    await openPicker();

    // 예약 자체는 그대로 나간다(통보 채널만 바뀐다).
    expect(mockSetPendingApplyDate).toHaveBeenCalled();
    expect(mockPromote).not.toHaveBeenCalled();
    // 제목이 없는 채널이므로 '예약'이라는 요점이 본문에 남아 있어야 한다.
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '변경을 예약했어요 — 내일부터 앱·카테고리 3개로 측정해요',
      tone: 'success',
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  // 구 바이너리는 피커 모달이 아직 떠 있는 채로 resolve한다 — 그 아래에서 배너를 시작하면
  // 모달이 사라진 뒤 갑자기 나타나고 노출도 짧아진다. 그래서 Alert를 유지한다.
  test('구 바이너리(dismissed 없음)에서는 Alert를 유지한다', async () => {
    mockPresentAppPicker.mockResolvedValue({ applications: 2, categories: 1, webDomains: 0 });

    await openPicker();

    expect(Alert.alert).toHaveBeenCalledWith(
      '측정 대상 변경 예약됨',
      '오늘은 기존 대상, 내일부터 앱·카테고리 3개로 측정해요',
    );
    expect(mockToastShow).not.toHaveBeenCalled();
  });
});

// 측정 대상 선택은 양쪽 다 되지만 **가는 길이 다르다**(GROMO-995) — iOS는 네이티브 시스템
// 피커를 띄우고, 안드로이드는 RN 화면으로 이동한다. 안드로이드에서 iOS 경로를 타면
// presentAppPicker가 null을 돌려주고 호출부가 '취소'로 읽어 조용히 끝난다(= 죽은 버튼).
describe('측정 대상 선택 — 플랫폼별 진입 경로', () => {
  const originalPlatformOS = Platform.OS;
  const setPlatform = (os: typeof Platform.OS) =>
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

  afterEach(() => setPlatform(originalPlatformOS));

  test('안드로이드는 시스템 피커 대신 앱 고르기 화면으로 이동한다', async () => {
    setPlatform('android');

    await openPicker();

    expect(mockNavigate).toHaveBeenCalledWith('SettingsAppPicker', { mode: 'measured' });
    // iOS 전용 네이티브 피커를 부르면 안 된다 — 불러봤자 null이라 아무 일도 안 일어난다.
    expect(mockPresentAppPicker).not.toHaveBeenCalled();
  });

  // 권한이 없으면 고를 대상 목록 자체를 못 읽는다 — 빈 화면으로 보내는 대신 먼저 안내한다.
  test('권한이 없으면 이동하지 않고 안내한다', async () => {
    setPlatform('android');
    mockGetStatus.mockResolvedValue('denied');

    await openPicker();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      '스크린타임 권한 필요',
      '측정 대상을 고르려면 먼저 사용 정보 접근을 허용해야 해요.',
    );
  });

  test('안드로이드 부제는 카테고리를 약속하지 않는다', async () => {
    setPlatform('android');

    await render(<ScreenTimePermissionScreen />);
    await act(async () => {});

    // 카테고리 묶음 선택은 iOS FamilyActivityPicker만 준다.
    expect(screen.queryByText('사용시간을 잴 앱·카테고리 선택')).toBeNull();
    expect(screen.getByText('사용시간을 잴 앱 선택')).toBeTruthy();
  });

  // 권한 끄러 갈 곳은 OS마다 다르다 — 안드로이드에 'iOS 설정 앱'이라고 하면 안 된다.
  test('안드로이드 안내는 iOS 설정 앱을 가리키지 않는다', async () => {
    setPlatform('android');

    await render(<ScreenTimePermissionScreen />);
    await act(async () => {});

    expect(screen.queryByText(/iOS 설정 앱/)).toBeNull();
    expect(screen.getByText(/사용 정보 접근/)).toBeTruthy();
  });

  test('iOS는 네이티브 피커를 그대로 띄운다', async () => {
    setPlatform('ios');
    mockPresentAppPicker.mockResolvedValue({ applications: 1, categories: 0, webDomains: 0 });

    await openPicker();

    expect(mockPresentAppPicker).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith('SettingsAppPicker', { mode: 'measured' });
  });
});

describe('대상 비우기는 Alert로 남는다 (정책 D8 — 경고성 장문)', () => {
  test('빈 선택은 측정 중단 경고를 Alert로 띄운다', async () => {
    // 대상 0개는 예약이 아니라 즉시 적용 경로다. 네이티브가 등록을 거부한다(monitoring=false).
    mockPresentAppPicker.mockResolvedValue({
      applications: 0,
      categories: 0,
      webDomains: 0,
      dismissed: true,
    });
    mockRegisterMonitoring.mockResolvedValue(false);

    await openPicker();

    expect(Alert.alert).toHaveBeenCalledWith(
      '측정 대상 변경됨',
      '측정 대상을 비웠어요 — 사용량 측정과 서버 동기화가 중단돼요. 홈 리포트는 전체 앱 기준으로 표시돼요.',
    );
    expect(mockToastShow).not.toHaveBeenCalled();
  });
});

// 권한 **회수**의 서버 반영 — GROMO-1592 코드리뷰(P1).
//
// 지금까지 서버 동기화는 허용 경로에만 있었다(온보딩·권한 요청). 회수는 아무도 보내지 않아
// 서버의 is_screen_time_permission_granted 가 true 로 남고, GroupBetJoinService 의
// requireScreenTimePermission 이 그 값을 신뢰한다 — **보고 못 하는 사용자가 SCREEN_TIME 내기에
// 참가비를 내고 들어갈 수 있다.** 돈이 걸린 자리라 화면이 감지하는 즉시 맞춘다.
describe('권한 회수는 서버에도 반영한다', () => {
  const mockUpdatePermission = updateScreenTimePermission as jest.MockedFunction<
    typeof updateScreenTimePermission
  >;

  // AppState 리스너를 직접 깨워 '설정 다녀와서 앱이 다시 활성화된' 순간을 재현한다.
  async function returnToApp(nextStatus: 'approved' | 'denied') {
    const calls = (AppState.addEventListener as jest.Mock).mock.calls;
    const handler = calls[calls.length - 1][1] as (s: string) => void;
    mockGetStatus.mockResolvedValue(nextStatus);
    await act(async () => {
      handler('active');
    });
  }

  beforeEach(() => {
    mockIsFocused.mockReturnValue(true);
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
    mockUpdatePermission.mockResolvedValue(undefined as never);
  });

  test('허용→거부로 바뀌면 granted:false 를 보낸다', async () => {
    mockGetStatus.mockResolvedValue('approved');
    await render(<ScreenTimePermissionScreen />);
    await act(async () => {});
    // 최초 관찰은 기준선만 세운다 — 마운트만으로 서버를 때리지 않는다.
    expect(mockUpdatePermission).not.toHaveBeenCalled();

    await returnToApp('denied');

    expect(mockUpdatePermission).toHaveBeenCalledWith({ granted: false });
  });

  test('상태가 그대로면 보내지 않는다', async () => {
    mockGetStatus.mockResolvedValue('approved');
    await render(<ScreenTimePermissionScreen />);
    await act(async () => {});

    await returnToApp('approved');

    expect(mockUpdatePermission).not.toHaveBeenCalled();
  });

  // 반대 방향도 같은 경로로 맞춘다 — 설정에서 켜고 돌아온 경우.
  test('거부→허용으로 바뀌면 granted:true 를 보낸다', async () => {
    mockGetStatus.mockResolvedValue('denied');
    await render(<ScreenTimePermissionScreen />);
    await act(async () => {});

    await returnToApp('approved');

    expect(mockUpdatePermission).toHaveBeenCalledWith({ granted: true });
  });

  // 서버 반영이 실패하면 기준선을 되돌려 다음 감지에서 다시 시도한다 — 한 번 실패하고
  // 영영 어긋난 채로 남으면, 실패했다는 사실조차 아무도 모른다.
  test('전송 실패 후 다시 감지되면 재시도한다', async () => {
    mockGetStatus.mockResolvedValue('approved');
    await render(<ScreenTimePermissionScreen />);
    await act(async () => {});

    mockUpdatePermission.mockRejectedValueOnce(new Error('network'));
    await returnToApp('denied');
    expect(mockUpdatePermission).toHaveBeenCalledTimes(1);

    await returnToApp('denied');
    expect(mockUpdatePermission).toHaveBeenCalledTimes(2);
    expect(mockUpdatePermission).toHaveBeenLastCalledWith({ granted: false });
  });
});

// 피커 진입 경로 — GROMO-1593 코드리뷰 3차.
describe('측정 대상 화면으로 보내기 전에 확인한다', () => {
  const originalPlatformOS = Platform.OS;
  const setPlatform = (os: typeof Platform.OS) =>
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

  beforeEach(() => setPlatform('android'));
  afterEach(() => setPlatform(originalPlatformOS));

  // 관리 행을 숨기는 게이트만으로는 부족하다 — 구 바이너리에서 권한이 notDetermined 면
  // 상태 카드가 requestPermission() 을 거쳐 이동 경로로 오는데, 거기엔 술어 검사가 없었다.
  // ⚠️ 관리 행을 통한 진입이 아니다. 구 바이너리에선 그 행 자체가 숨겨진다.
  //    문제는 **권한 승인 직후 자동 이동** 경로다 — 상태 카드(notDetermined) 탭 →
  //    requestPermission() → 승인되면 곧장 editScreenTimeTargets() 로 넘어가는데,
  //    거기엔 술어 검사가 없어서 빈 목록에 저장도 no-op 인 화면에 도달했다.
  test('구 바이너리는 권한 승인 직후에도 피커로 보내지 않는다', async () => {
    jest.mocked(requireOptionalNativeModule).mockReturnValue({
      getTodayUsageBucketMinutes: jest.fn(), // 피커 메서드가 없는 M1 바이너리
    } as never);
    // 첫 조회는 미결정(상태 카드가 권한 요청 경로로 간다) → 승인 후엔 허용으로 바뀐다.
    mockGetStatus.mockResolvedValueOnce('notDetermined').mockResolvedValue('approved');
    (ScreenTimeModule.requestAuthorization as jest.Mock).mockResolvedValue(true);

    await render(<ScreenTimePermissionScreen />);
    await act(async () => {});
    await act(async () => {
      fireEvent.press(screen.getByText('스크린타임 접근'));
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      '아직 쓸 수 없어요',
      expect.stringContaining('업데이트'),
    );
  });

  // 설정 복귀·서버 반영을 기다리는 동안 화면을 떠났을 수 있다 — 이미 떠난 화면이 다른 화면
  // 위에 피커를 push 하면 안 된다.
  test('화면을 떠났으면 이동하지 않는다', async () => {
    mockIsFocused.mockReturnValue(false);

    await openPicker();

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
