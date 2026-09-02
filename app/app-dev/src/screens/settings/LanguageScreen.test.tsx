// 앱 표시 언어 화면(GROMO-1672).
//
// 여기서 잠그는 것:
//  1) 라디오를 고르는 것만으로는 아무 일도 일어나지 않는다 — '저장'을 눌러야 적용된다.
//     적용이 곧 화면 리셋이라, 잘못 눌렀을 때 되돌리는 비용이 크기 때문이다.
//  2) 저장이 언어 적용보다 **먼저**다 — 저장 실패면 언어를 바꾸지 않는다. 언어는 서버로
//     안 나가므로 로컬 저장이 유일한 정본이고, 저장 없이 화면만 바꾸면 앱 재시작 때
//     조용히 되돌아가 '설정이 고장났다'가 된다.
//  3) 언어가 실제로 바뀐 경우에만 화면을 리셋한다 — 기기가 ko인데 'system'→'ko'를 고른
//     경우처럼 결과가 같으면 홈으로 튕길 이유가 없다.
//  4) 리셋은 navigationRef.reset — NavigationContainer 자체를 갈아치우지 않는다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LanguageScreen from './LanguageScreen';
import { STORAGE_KEYS } from '@/types/storage';
import { applyLocalePref, getLocale } from '@/i18n';
import { navigationRef } from '@/navigation/navigationRef';
import { logLanguageChanged } from '@/services/analyticsEvents';

const mockGoBack = jest.fn();
const mockShowToast = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

// 네이티브 firebase 로드를 피한다 — 이벤트 발행 여부만 본다.
jest.mock('@/services/analyticsEvents', () => ({ logLanguageChanged: jest.fn() }));

jest.mock('@/navigation/navigationRef', () => ({
  navigationRef: { reset: jest.fn() },
}));

jest.mock('@/store/ToastContext', () => ({ useToast: () => ({ show: mockShowToast }) }));

const mockReset = navigationRef.reset as jest.Mock;

// React 19 동시성 루트에서는 render 커밋이 비동기다 — 다른 설정 화면 테스트와 같은 패턴.
async function renderScreen() {
  await act(async () => {
    render(<LanguageScreen />);
  });
}

async function press(label: string) {
  await act(async () => {
    fireEvent.press(screen.getByText(label));
  });
}

async function save() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings.language.save'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  // jest.config에 setupFilesAfterEach가 없어 전역 복원 장치를 못 만든다 — 여기서 직접 되돌린다.
  applyLocalePref(null);
  await AsyncStorage.clear();
});

test('옵션 5개가 뜨고 기본값은 기기 언어 따름이다', async () => {
  await renderScreen();
  expect(screen.getByText('기기 언어 따름')).toBeTruthy();
  expect(screen.getByText('지금은 한국어')).toBeTruthy();
  for (const name of ['한국어', 'English', '日本語', '繁體中文']) {
    expect(screen.getByText(name)).toBeTruthy();
  }
});

test('고르기만 해서는 아무것도 저장·적용되지 않는다', async () => {
  await renderScreen();
  await press('English');

  expect(await AsyncStorage.getItem(STORAGE_KEYS.locale)).toBeNull();
  expect(getLocale()).toBe('ko');
  expect(logLanguageChanged).not.toHaveBeenCalled();
  expect(mockReset).not.toHaveBeenCalled();
});

test('고른 뒤 저장하면 저장·적용·계측·리셋이 모두 일어난다', async () => {
  await renderScreen();
  await press('English');
  await save();

  await waitFor(() => expect(mockReset).toHaveBeenCalledTimes(1));
  expect(await AsyncStorage.getItem(STORAGE_KEYS.locale)).toBe('en');
  expect(getLocale()).toBe('en');
  expect(logLanguageChanged).toHaveBeenCalledWith({
    app_language: 'en',
    previous_app_language: 'system',
  });
  expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });
  // 토스트는 이미 새 언어(en)로 뜬다.
  expect(mockShowToast).toHaveBeenCalledWith({ message: 'Language changed' });
});

test('기기 언어(ko)와 결과가 같은 선택은 저장은 하되 화면을 리셋하지 않는다', async () => {
  await renderScreen();
  await press('한국어');
  await save();

  await waitFor(() => expect(AsyncStorage.getItem(STORAGE_KEYS.locale)).resolves.toBe('ko'));
  expect(logLanguageChanged).toHaveBeenCalledTimes(1);
  // 적용 언어가 그대로(ko)라 홈으로 튕기지 않는다.
  expect(mockReset).not.toHaveBeenCalled();
  expect(mockShowToast).not.toHaveBeenCalled();
});

test('저장에 실패하면 언어를 바꾸지 않고 안내만 띄운다', async () => {
  // spyOn 금지 — AsyncStorage 목은 이미 jest.fn 이라 spyOn 이 같은 목을 돌려주고,
  // 거기에 mockRestore 를 부르면 복원이 아니라 **구현을 벗겨버려** 이후 테스트의 저장이
  // 조용히 no-op 이 된다(스위트에서만 깨지는 오염). Once 구현은 1회 뒤 자동 원복된다.
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(() =>
    Promise.reject(new Error('disk full')),
  );

  await renderScreen();
  await press('日本語');
  await save();

  await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));
  expect(mockShowToast).toHaveBeenCalledWith({
    message: '언어를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
    tone: 'error',
  });
  expect(getLocale()).toBe('ko');
  expect(logLanguageChanged).not.toHaveBeenCalled();
  expect(mockReset).not.toHaveBeenCalled();
});

test('명시 ko 저장 후에는 기기 언어(ko)와 같아도 한국어 라디오가 선택돼 있고, 기기 언어 따름으로 되돌릴 수 있다', async () => {
  // 코드리뷰 회귀 잠금 — 적용 결과로 초기값을 역추론하면 명시 'ko'(기기도 ko)를
  // 'system' 으로 오인해, 되돌리기 선택이 항상 현재값과 같아져 저장이 영구 비활성이 된다.
  await AsyncStorage.setItem(STORAGE_KEYS.locale, 'ko');
  applyLocalePref('ko');

  await renderScreen();
  // 초기 선택 = 명시 'ko' — 'system' 이 아니다.
  expect(screen.getByTestId('settings.language.save')).toBeDisabled();
  await press('기기 언어 따름');
  expect(screen.getByTestId('settings.language.save')).toBeEnabled();
  await save();

  expect(await AsyncStorage.getItem(STORAGE_KEYS.locale)).toBe('system');
  expect(logLanguageChanged).toHaveBeenCalledWith({
    app_language: 'system',
    previous_app_language: 'ko',
  });
  // 기기가 ko 라 적용 언어는 그대로 — 홈으로 튕기지 않는다.
  expect(mockReset).not.toHaveBeenCalled();
});

test('현재값과 같으면 저장 버튼이 비활성이라 눌러도 아무 일도 하지 않는다', async () => {
  await renderScreen();
  // 초기 선택 = 현재 적용값('기기 언어 따름')이라 저장이 비활성 상태다.
  expect(screen.getByTestId('settings.language.save')).toBeDisabled();
  await save();

  expect(logLanguageChanged).not.toHaveBeenCalled();
  expect(mockReset).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(STORAGE_KEYS.locale)).toBeNull();
});
