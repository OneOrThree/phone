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
import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ScreenTimePermissionScreen from './ScreenTimePermissionScreen';
import ScreenTimeModule, { nativeSupportsPendingApplyDate } from '@/services/ScreenTimeModule';
import { registerUsageBucketMonitoring } from '@/services/screentimeSync';
import { STORAGE_KEYS } from '@/types/storage';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// navigate 는 단언 대상이라 호출마다 새로 만들면 안 된다 — 화면이 부른 목과 테스트가 보는
// 목이 달라져, 이동하지 않아도 통과하는 테스트가 된다.
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), isFocused: () => true }),
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
const mockOpenUsageAccess = ScreenTimeModule.openUsageAccessSettings as jest.MockedFunction<
  typeof ScreenTimeModule.openUsageAccessSettings
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

  // 안드로이드엔 대응 피커가 없다. 행을 남겨 두면 탭해도 아무 일이 없어 고장으로 보이므로
  // 섹션째 감춘다 — 무반응 진입점을 없애는 게 이 티켓의 본론이다.
  test('안드로이드에서는 측정 대상 섹션이 그려지지 않는다', async () => {
    setPlatform('android');

    await render(<ScreenTimePermissionScreen />);
    await act(async () => {});

    expect(screen.queryByText('측정 대상 앱 설정')).toBeNull();
    // 부제만 남아 없는 항목을 찾아 들어가게 만들지도 않는다.
    expect(screen.queryByText('사용시간을 잴 앱·카테고리 선택')).toBeNull();
  });

  // 피커가 없으면 허용 상태에서 상태 카드를 눌러도 갈 곳이 없다 — 무반응으로 두지 않고
  // 권한을 끄러 갈 수 있는 곳으로 보낸다.
  //
  // ⚠️ 그 '갈 곳'이 앱 상세 설정(Linking.openSettings)이면 안 된다(코드리뷰 반영). 거기엔
  //    사용 정보 접근 토글이 없어서, 눌러서 이동은 하는데 정작 할 일을 못 하는 상태가 된다.
  //    이 PR이 없애려는 '화면이 거짓말한다'와 같은 종류라 목록 딥링크를 쓴다.
  test('안드로이드에서 허용 상태 카드는 사용 정보 접근 목록으로 보낸다', async () => {
    setPlatform('android');
    mockOpenUsageAccess.mockResolvedValue(true);

    await render(<ScreenTimePermissionScreen />);
    await act(async () => {});
    await act(async () => {
      fireEvent.press(screen.getByText('스크린타임 접근'));
    });

    expect(mockPresentAppPicker).not.toHaveBeenCalled();
    expect(mockOpenUsageAccess).toHaveBeenCalled();
    // 목록을 열었으면 앱 상세로 또 보내지 않는다 — 두 화면이 겹쳐 뜨면 그게 더 헷갈린다.
    expect(Linking.openSettings).not.toHaveBeenCalled();
  });

  // 구 바이너리(OTA로 새 JS만 받아 네이티브에 이 함수가 없음)·설정을 못 여는 기기.
  // 앱 상세가 완전한 답은 아니지만, 아무 일도 안 일어나는 것보다는 낫다.
  test('목록을 못 열면 앱 상세 설정으로 폴백한다', async () => {
    setPlatform('android');
    mockOpenUsageAccess.mockResolvedValue(false);

    await render(<ScreenTimePermissionScreen />);
    await act(async () => {});
    await act(async () => {
      fireEvent.press(screen.getByText('스크린타임 접근'));
    });

    expect(Linking.openSettings).toHaveBeenCalled();
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
